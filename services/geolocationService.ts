import { registerPlugin, Capacitor } from '@capacitor/core';
import type { BackgroundGeolocationPlugin, Location as NativeLocation } from '@capacitor-community/background-geolocation';
import { Geolocation as CapGeolocation, Position as CapPosition } from '@capacitor/geolocation';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Geofence, GeofenceTransition, detectTransition } from './geofenceService';
import { crashDetectionService } from './crashDetectionService';
import { offlineMapService, computeRadiusBounds } from './offlineMapService';

const BackgroundGeolocation = registerPlugin<BackgroundGeolocationPlugin>('BackgroundGeolocation');

export interface GeolocationState {
    latitude: number;
    longitude: number;
    accuracy: number;
    heading: number | null;
    speed: number | null;
    timestamp: number;
    signalQuality: 'excellent' | 'good' | 'poor' | 'searching';
}

export interface GeolocationError {
    code: number;
    message: string;
}

export type LocationCallback = (location: GeolocationState) => void;
export type ErrorCallback = (error: GeolocationError) => void;
export type TrackingTier = 'driving' | 'transit' | 'dwelling';

/**
 * 1D Kalman Filter for GPS coordinate smoothing.
 * Reduces jitter when stationary while preserving responsive updates when moving.
 */
class KalmanFilter {
    private estimate: number = 0;
    private errorEstimate: number = 1;
    private errorMeasure: number;
    private q: number; // Process noise

    constructor(errorMeasure: number = 3, q: number = 0.1) {
        this.errorMeasure = errorMeasure;
        this.q = q;
    }

    process(measurement: number, accuracy?: number): number {
        // Adapt measurement noise to GPS accuracy (higher accuracy = lower noise)
        const R = accuracy ? Math.max(accuracy * 0.00001, 0.5) : this.errorMeasure;

        // First measurement — initialize
        if (this.errorEstimate === 1 && this.estimate === 0) {
            this.estimate = measurement;
            this.errorEstimate = R;
            return measurement;
        }

        // Prediction step
        this.errorEstimate += this.q;

        // Update step
        const kalmanGain = this.errorEstimate / (this.errorEstimate + R);
        this.estimate += kalmanGain * (measurement - this.estimate);
        this.errorEstimate *= (1 - kalmanGain);

        return this.estimate;
    }

    reset(): void {
        this.estimate = 0;
        this.errorEstimate = 1;
    }
}

/**
 * Velocity Smoother with deadband filtering and Exponential Moving Average.
 * Eliminates stationary multipath noise (< 0.8 mph) and smooths acceleration spikes.
 */
class VelocitySmoother {
    private currentSpeedMph: number = 0;
    private readonly DEADBAND_MPH = 0.8;

    process(rawSpeedMps: number | null | undefined): number {
        if (rawSpeedMps == null || isNaN(rawSpeedMps)) {
            return 0;
        }

        const rawMph = Math.max(0, rawSpeedMps * 2.23694);

        // Stationary deadband clamp
        if (rawMph < this.DEADBAND_MPH) {
            this.currentSpeedMph = 0;
            return 0;
        }

        // Dynamic EMA: faster response when braking/decelerating (alpha 0.5), smooth when accelerating (alpha 0.35)
        const alpha = rawMph < this.currentSpeedMph ? 0.5 : 0.35;
        this.currentSpeedMph = this.currentSpeedMph + alpha * (rawMph - this.currentSpeedMph);

        return Math.round(this.currentSpeedMph * 10) / 10;
    }

    reset(): void {
        this.currentSpeedMph = 0;
    }
}

/**
 * Circular Heading Smoother with shortest angular arc interpolation.
 * Locks heading when stationary (< 1.5 mph) and smoothly handles 0°/360° boundary transitions.
 */
class HeadingSmoother {
    private currentHeading: number | null = null;
    private readonly SPEED_LOCK_THRESHOLD_MPH = 1.5;

    process(rawHeading: number | null | undefined, speedMph: number): number | null {
        if (rawHeading == null || isNaN(rawHeading)) {
            return this.currentHeading;
        }

        const normalizedRaw = ((rawHeading % 360) + 360) % 360;

        // Lock heading when stationary or walking very slowly to eliminate spinning compass
        if (speedMph < this.SPEED_LOCK_THRESHOLD_MPH && this.currentHeading !== null) {
            return this.currentHeading;
        }

        if (this.currentHeading === null) {
            this.currentHeading = normalizedRaw;
            return normalizedRaw;
        }

        // Shortest angular difference (-180° to +180°)
        const delta = ((normalizedRaw - this.currentHeading + 540) % 360) - 180;
        const alpha = speedMph > 25 ? 0.4 : 0.25;
        this.currentHeading = ((this.currentHeading + alpha * delta + 360) % 360);

        return Math.round(this.currentHeading * 10) / 10;
    }

    reset(): void {
        this.currentHeading = null;
    }
}

class GeolocationService {
    private webWatchId: number | null = null;
    private nativeWatcherId: string | null = null;
    private nativeWatcherPromise: Promise<string> | null = null;
    private isWatching = false;

    private readonly ACCURACY_THRESHOLD = 150;
    private trackingTier: TrackingTier = 'transit';
    private stationaryTimeout: NodeJS.Timeout | null = null;
    private lastSpeed = 0;
    private readonly DWELL_THRESHOLD_MS = 2 * 60 * 1000; // 2 minutes stationary -> dwelling tier

    // Coordinate, Velocity and Heading Smoothers
    private kalmanLat = new KalmanFilter(3, 0.1);
    private kalmanLng = new KalmanFilter(3, 0.1);
    private velocitySmoother = new VelocitySmoother();
    private headingSmoother = new HeadingSmoother();

    // Background Headless Execution State
    private backgroundGeofences: Geofence[] = [];
    private onGeofenceTransitionCallback: ((transition: GeofenceTransition) => void) | null = null;
    private lastTelemetryState: GeolocationState | null = null;

    /** Configure geofences for background evaluation and native push notifications */
    public setBackgroundGeofences(
        geofences: Geofence[],
        onTransition?: (transition: GeofenceTransition) => void
    ): void {
        this.backgroundGeofences = geofences;
        this.onGeofenceTransitionCallback = onTransition || null;
    }

    public getTrackingTier(): TrackingTier {
        return this.trackingTier;
    }

    /** Run headless geofence and telemetry processing directly from background GPS stream */
    private evaluateBackgroundHeadless(current: GeolocationState): void {
        // Feed live telemetry to crash detection
        crashDetectionService.updateLocation({ lat: current.latitude, lng: current.longitude });
        if (current.speed !== null) {
            crashDetectionService.updateSpeed(current.speed);
        }

        // 1. Headless Safe Zone / Geofence Detection
        if (this.backgroundGeofences.length > 0) {
            this.backgroundGeofences.forEach(gf => {
                const storedStatus = localStorage.getItem(`gf_state_${gf.id}`);
                const isKnown = storedStatus !== null;
                const prevStatus = (storedStatus || 'OUTSIDE') as any;

                const transition = detectTransition({ lat: current.latitude, lng: current.longitude }, gf, prevStatus);
                if (transition) {
                    localStorage.setItem(`gf_state_${gf.id}`, transition.to);

                    if (isKnown) {
                        this.onGeofenceTransitionCallback?.(transition);

                        // Trigger native local notification if on mobile platform
                        if (Capacitor.isNativePlatform()) {
                            const isInside = transition.to === 'INSIDE';
                            const notifId = Math.abs(gf.id.split('').reduce((a, b) => ((a << 5) - a) + b.charCodeAt(0), 0)) % 100000;
                            LocalNotifications.schedule({
                                notifications: [{
                                    id: notifId,
                                    title: 'MyWay Safe Zone',
                                    body: `${isInside ? 'Arrived at' : 'Departed from'} ${gf.name}`,
                                    sound: 'beep.wav'
                                }]
                            }).catch(err => console.warn('Geofence local notification error:', err));
                        }
                    }
                }
            });
        }

        // 2. Headless GPS Deceleration, Crash & Rapid Acceleration Detection
        if (this.lastTelemetryState) {
            const dt = (current.timestamp - this.lastTelemetryState.timestamp) / 1000;
            if (dt > 0.3 && dt < 8) {
                const prevSpeedMph = this.lastTelemetryState.speed || 0;
                const currSpeedMph = current.speed || 0;
                const v1_mps = prevSpeedMph / 2.23694;
                const v2_mps = currSpeedMph / 2.23694;
                const decel = (v1_mps - v2_mps) / dt; // m/s²
                const accel = (v2_mps - v1_mps) / dt; // m/s²

                if (prevSpeedMph >= 10) {
                    if (decel >= 4.5 && decel < 25) {
                        crashDetectionService.recordHardBrake(currSpeedMph, decel);
                    } else if (decel >= 25 || (prevSpeedMph >= 25 && currSpeedMph === 0 && dt <= 2)) {
                        crashDetectionService.triggerHeadlessCrash(
                            { lat: current.latitude, lng: current.longitude },
                            prevSpeedMph
                        );
                    }
                }

                if (currSpeedMph >= 10 && accel >= 3.5) {
                    crashDetectionService.recordRapidAccel(currSpeedMph, accel);
                }
            }
        }
        this.lastTelemetryState = current;
    }

    isSupported(): boolean {
        if (Capacitor.isNativePlatform()) {
            return true;
        }
        return typeof navigator !== 'undefined' && 'geolocation' in navigator;
    }

    async getCurrentPosition(): Promise<GeolocationState> {
        if (!this.isSupported()) {
            throw { code: 0, message: 'Geolocation not supported' };
        }

        // 1. Try Native Capacitor Geolocation first on mobile
        if (Capacitor.isNativePlatform()) {
            try {
                const position = await CapGeolocation.getCurrentPosition({
                    enableHighAccuracy: true,
                    timeout: 20000,
                    maximumAge: 10000
                });
                return this.normalizeAndSmoothPosition(
                    position.coords.latitude,
                    position.coords.longitude,
                    position.coords.accuracy,
                    position.coords.heading,
                    position.coords.speed,
                    position.timestamp
                );
            } catch (capError: any) {
                console.warn('📡 Native getCurrentPosition failed, attempting web fallback:', capError);
            }
        }

        // 2. Web Geolocation standard fallback
        return new Promise((resolve, reject) => {
            if (typeof navigator === 'undefined' || !navigator.geolocation) {
                reject({ code: 0, message: 'Geolocation not supported' });
                return;
            }

            navigator.geolocation.getCurrentPosition(
                (position) => {
                    resolve(this.normalizeAndSmoothPosition(
                        position.coords.latitude,
                        position.coords.longitude,
                        position.coords.accuracy,
                        position.coords.heading,
                        position.coords.speed,
                        position.timestamp
                    ));
                },
                (error) => {
                    if (error.code === 3) { // Timeout
                        navigator.geolocation.getCurrentPosition(
                            (pos) => resolve(this.normalizeAndSmoothPosition(
                                pos.coords.latitude,
                                pos.coords.longitude,
                                pos.coords.accuracy,
                                pos.coords.heading,
                                pos.coords.speed,
                                pos.timestamp
                            )),
                            (err) => reject(this.parseError(err)),
                            { enableHighAccuracy: false, timeout: 20000 }
                        );
                    } else {
                        reject(this.parseError(error));
                    }
                },
                {
                    enableHighAccuracy: true,
                    timeout: 20000,
                    maximumAge: 10000
                }
            );
        });
    }

    watchPosition(onLocation: LocationCallback, onError?: ErrorCallback): void {
        if (!this.isSupported()) {
            onError?.({ code: 0, message: 'Geolocation not supported' });
            return;
        }

        this.isWatching = true;

        if (Capacitor.isNativePlatform()) {
            this.startNativeBackgroundWatch(onLocation, onError);
        } else {
            this.startWebWatch(onLocation, onError);
        }
    }

    private async startNativeBackgroundWatch(onLocation: LocationCallback, onError?: ErrorCallback): Promise<void> {
        await this.stopNativeWatch();

        if (!this.isWatching) return;

        try {
            console.log('📡 Starting Native Background Geolocation Watcher...');
            const distanceFilter = this.trackingTier === 'driving' ? 5 : this.trackingTier === 'transit' ? 10 : 25;

            const addPromise = BackgroundGeolocation.addWatcher(
                {
                    backgroundTitle: 'MyWay is active',
                    backgroundMessage: 'Sharing location with your circle',
                    requestPermissions: true,
                    stale: false,
                    distanceFilter
                },
                (location, error) => {
                    if (error) {
                        console.error('📡 Background Geolocation Error:', error);
                        onError?.({
                            code: error.code ? parseInt(error.code, 10) || 2 : 2,
                            message: error.message || 'Background location error'
                        });
                        return;
                    }

                    if (location) {
                        const parsed = this.normalizeAndSmoothPosition(
                            location.latitude,
                            location.longitude,
                            location.accuracy,
                            location.bearing,
                            location.speed,
                            location.time || Date.now()
                        );
                        this.updateAdaptiveTier(parsed.speed || 0, onLocation, onError);
                        this.evaluateBackgroundHeadless(parsed);
                        onLocation(parsed);
                    }
                }
            );

            this.nativeWatcherPromise = addPromise;
            const watcherId = await addPromise;
            this.nativeWatcherId = watcherId;
            this.nativeWatcherPromise = null;

            if (!this.isWatching) {
                await this.stopNativeWatch();
            }
        } catch (err: any) {
            console.error('❌ Failed to initialize Native Background Geolocation, falling back to web watch:', err);
            if (this.isWatching) {
                this.startWebWatch(onLocation, onError);
            }
        }
    }

    private startWebWatch(onLocation: LocationCallback, onError?: ErrorCallback): void {
        if (typeof navigator === 'undefined' || !navigator.geolocation) {
            onError?.({ code: 0, message: 'Geolocation not supported' });
            return;
        }

        if (this.webWatchId !== null) {
            navigator.geolocation.clearWatch(this.webWatchId);
        }

        const isDwelling = this.trackingTier === 'dwelling';

        this.webWatchId = navigator.geolocation.watchPosition(
            (position) => {
                const parsed = this.normalizeAndSmoothPosition(
                    position.coords.latitude,
                    position.coords.longitude,
                    position.coords.accuracy,
                    position.coords.heading,
                    position.coords.speed,
                    position.timestamp
                );
                this.updateAdaptiveTier(parsed.speed || 0, onLocation, onError);
                this.evaluateBackgroundHeadless(parsed);
                onLocation(parsed);
            },
            (error) => {
                onError?.(this.parseError(error));
            },
            {
                enableHighAccuracy: !isDwelling,
                timeout: isDwelling ? 30000 : 15000,
                maximumAge: isDwelling ? 15000 : this.trackingTier === 'driving' ? 1000 : 3000
            }
        );
    }

    /** Dynamically adjusts power/frequency tiers based on movement */
    private updateAdaptiveTier(speedMph: number, onLocation: LocationCallback, onError?: ErrorCallback): void {
        this.lastSpeed = speedMph;

        if (speedMph >= 15) {
            // Tier 1: Driving
            if (this.stationaryTimeout) {
                clearTimeout(this.stationaryTimeout);
                this.stationaryTimeout = null;
            }
            if (this.trackingTier !== 'driving') {
                this.trackingTier = 'driving';
                console.log('🏎️ GPS Tier: Driving (>15 mph) — High-Frequency 1s sync');
            }
        } else if (speedMph >= 1) {
            // Tier 2: Transit / Walking
            if (this.stationaryTimeout) {
                clearTimeout(this.stationaryTimeout);
                this.stationaryTimeout = null;
            }
            if (this.trackingTier !== 'transit') {
                this.trackingTier = 'transit';
                console.log('🚶 GPS Tier: Transit/Walking — Balanced 3s sync');
            }
        } else {
            // Tier 3: Stationary / Dwelling
            if (!this.stationaryTimeout && this.trackingTier !== 'dwelling') {
                this.stationaryTimeout = setTimeout(() => {
                    if (this.lastSpeed < 1 && this.isWatching) {
                        this.trackingTier = 'dwelling';
                        console.log('🔋 GPS Tier: Dwelling (Stationary >2 min) — Battery-Saver mode enabled');

                        // Predictive Dwelling Cache: Pre-cache immediate 5km radius (z13-z15) to secure outbound navigation
                        if (this.lastTelemetryState) {
                            const currentBounds = computeRadiusBounds(
                                { lat: this.lastTelemetryState.latitude, lng: this.lastTelemetryState.longitude },
                                5
                            );
                            offlineMapService.downloadArea('Auto-Cache', currentBounds, 13, 15)
                                .then(() => console.log('📦 [OfflineMapService] Predictive dwelling auto-cache complete (5km radius, z13-z15)'))
                                .catch(err => console.warn('[OfflineMapService] Predictive dwelling auto-cache skipped/failed:', err));
                        }

                        if (!Capacitor.isNativePlatform()) {
                            this.startWebWatch(onLocation, onError);
                        }
                    }
                    this.stationaryTimeout = null;
                }, this.DWELL_THRESHOLD_MS);
            }
        }
    }

    /** Centralized smoothing for Lat/Lng Kalman filtering, Speed EMA, and Circular Bearing */
    private normalizeAndSmoothPosition(
        rawLat: number,
        rawLng: number,
        accuracy: number,
        rawHeading: number | null | undefined,
        rawSpeedMps: number | null | undefined,
        timestamp: number
    ): GeolocationState {
        let quality: GeolocationState['signalQuality'] = 'excellent';
        if (accuracy > this.ACCURACY_THRESHOLD) quality = 'poor';
        else if (accuracy > 40) quality = 'good';

        // 1. Speed smoothing with stationary deadband
        const speedMph = this.velocitySmoother.process(rawSpeedMps);

        // 2. Lat/Lng Kalman filtering when slow or stationary (< 5 mph)
        const lat = speedMph < 5 ? this.kalmanLat.process(rawLat, accuracy) : rawLat;
        const lng = speedMph < 5 ? this.kalmanLng.process(rawLng, accuracy) : rawLng;

        // 3. Circular heading smoothing with stationary compass lock
        const heading = this.headingSmoother.process(rawHeading, speedMph);

        return {
            latitude: lat,
            longitude: lng,
            accuracy,
            heading,
            speed: speedMph,
            timestamp,
            signalQuality: quality
        };
    }

    async stopWatching(): Promise<void> {
        this.isWatching = false;

        // 1. Clear Web Watcher
        if (this.webWatchId !== null) {
            if (typeof navigator !== 'undefined' && navigator.geolocation) {
                navigator.geolocation.clearWatch(this.webWatchId);
            }
            this.webWatchId = null;
        }

        // 2. Clear Native Watcher
        await this.stopNativeWatch();

        // 3. Clear timers & reset filters
        if (this.stationaryTimeout) {
            clearTimeout(this.stationaryTimeout);
            this.stationaryTimeout = null;
        }
        this.kalmanLat.reset();
        this.kalmanLng.reset();
        this.velocitySmoother.reset();
        this.headingSmoother.reset();
        this.trackingTier = 'transit';
    }

    private async stopNativeWatch(): Promise<void> {
        if (this.nativeWatcherPromise) {
            try {
                const id = await this.nativeWatcherPromise;
                await BackgroundGeolocation.removeWatcher({ id });
            } catch (e) {
                console.warn('⚠️ Error removing pending BackgroundGeolocation watcher:', e);
            }
            this.nativeWatcherPromise = null;
        }

        if (this.nativeWatcherId) {
            try {
                await BackgroundGeolocation.removeWatcher({ id: this.nativeWatcherId });
            } catch (e) {
                console.warn('⚠️ Error removing BackgroundGeolocation watcher:', e);
            }
            this.nativeWatcherId = null;
        }
    }

    private parseError(error: GeolocationPositionError): GeolocationError {
        const messages: Record<number, string> = {
            1: 'Location permission denied',
            2: 'Location unavailable',
            3: 'Location request timed out'
        };
        return {
            code: error.code,
            message: messages[error.code] || 'Unknown error'
        };
    }
}

export const geolocationService = new GeolocationService();
