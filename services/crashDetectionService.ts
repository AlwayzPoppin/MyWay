import { Location } from '../types';
import { audioService } from './audioService';
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';

/**
 * Crash & Telemetry Detection Service
 * Monitors device accelerometer and background GPS telemetry for sudden deceleration events (>4G) or hard-braking (>4.5 m/s²).
 * Emits EventTarget telemetry events and supports dynamic speed getter references and background headless execution.
 */

export type CrashCallback = (location: Location) => void;
export type CancelCallback = () => void;
export type HardBrakeCallback = () => void;
export type RapidAccelCallback = () => void;
export type SpeedGetter = () => number;

export class CrashDetectionService extends EventTarget {
    private isMonitoring = false;
    private onCrashDetected: CrashCallback | null = null;
    private onHardBrakeDetected: HardBrakeCallback | null = null;
    private onRapidAccelDetected: RapidAccelCallback | null = null;
    private countdownTimer: NodeJS.Timeout | null = null;
    private countdownSeconds = 30;
    private countdownCallback: ((remaining: number) => void) | null = null;
    private cancelCallback: CancelCallback | null = null;
    private speedGetter: SpeedGetter | null = null;
    private currentSpeedMph = 0;
    private lastKnownLocation: Location | null = null;

    // Threshold: 4G = ~39.2 m/s² — typical car crash produces 20-60G
    private readonly CRASH_THRESHOLD_MS2 = 39.2;
    // Hard brake threshold: ~4.5 m/s² (~0.46G) deceleration
    private readonly HARD_BRAKE_THRESHOLD_MS2 = 4.5;
    // Rapid acceleration threshold: ~3.5 m/s² (~0.36G) acceleration
    private readonly RAPID_ACCEL_THRESHOLD_MS2 = 3.5;
    // Speed gate: Only trigger crash/hard brake detection when driving > 10 mph
    private readonly MIN_SPEED_MPH = 10;
    // Cooldowns
    private lastCrashTime = 0;
    private readonly COOLDOWN_MS = 60000; // 1 minute
    private lastHardBrakeTime = 0;
    private readonly HARD_BRAKE_COOLDOWN_MS = 3000; // 3 seconds debounce
    private lastRapidAccelTime = 0;
    private readonly RAPID_ACCEL_COOLDOWN_MS = 3000; // 3 seconds debounce

    /** Update current speed and dispatch event */
    public updateSpeed(speedMph: number): void {
        this.currentSpeedMph = speedMph;
        this.dispatchEvent(new CustomEvent('speed', { detail: { speed: speedMph } }));
    }

    /** Update last known location */
    public updateLocation(location: Location): void {
        this.lastKnownLocation = location;
    }

    /** Get the effective speed dynamically */
    public getSpeed(): number {
        return this.speedGetter ? this.speedGetter() : this.currentSpeedMph;
    }

    /** Headless background crash trigger (e.g. from native background GPS deceleration) */
    public triggerHeadlessCrash(location: Location, speedMph: number): void {
        const now = Date.now();
        if (now - this.lastCrashTime < this.COOLDOWN_MS) return;
        this.lastCrashTime = now;
        this.lastKnownLocation = location;

        console.warn(`🚨 Headless Crash Triggered: ${speedMph.toFixed(0)} mph sudden stop at (${location.lat.toFixed(4)}, ${location.lng.toFixed(4)})`);
        this.dispatchEvent(new CustomEvent('crash', { detail: { speed: speedMph, deceleration: 30 } }));
        this.startCountdown();
    }

    /** Headless background hard brake record */
    public recordHardBrake(speedMph: number, deceleration: number): void {
        const now = Date.now();
        if (now - this.lastHardBrakeTime < this.HARD_BRAKE_COOLDOWN_MS) return;
        this.lastHardBrakeTime = now;

        console.log(`🛑 Headless Hard Brake: ${deceleration.toFixed(1)} m/s² at ${speedMph.toFixed(0)} mph`);
        this.dispatchEvent(new CustomEvent('hard_brake', { detail: { speed: speedMph, deceleration } }));
        this.onHardBrakeDetected?.();
    }

    /** Headless background rapid acceleration record */
    public recordRapidAccel(speedMph: number, acceleration: number): void {
        const now = Date.now();
        if (now - this.lastRapidAccelTime < this.RAPID_ACCEL_COOLDOWN_MS) return;
        this.lastRapidAccelTime = now;

        console.log(`⚡ Headless Rapid Acceleration: ${acceleration.toFixed(1)} m/s² at ${speedMph.toFixed(0)} mph`);
        this.dispatchEvent(new CustomEvent('rapid_accel', { detail: { speed: speedMph, acceleration } }));
        this.onRapidAccelDetected?.();
    }

    private handleMotion = (event: DeviceMotionEvent): void => {
        if (!event.accelerationIncludingGravity) return;

        const { x, y, z } = event.accelerationIncludingGravity;
        if (x === null || y === null || z === null) return;

        const speed = this.getSpeed();

        // Skip if not driving fast enough (prevents "dropped phone" false positives)
        if (speed < this.MIN_SPEED_MPH) return;

        // Calculate total acceleration magnitude (minus gravity ~9.81)
        const magnitude = Math.sqrt(x * x + y * y + z * z);
        const accelerationDelta = Math.abs(magnitude - 9.81);

        if (accelerationDelta >= this.CRASH_THRESHOLD_MS2) {
            const now = Date.now();
            if (now - this.lastCrashTime < this.COOLDOWN_MS) return;
            this.lastCrashTime = now;

            console.warn(`🚨 Crash Detection: ${accelerationDelta.toFixed(1)} m/s² spike at ${speed.toFixed(0)} mph!`);
            this.dispatchEvent(new CustomEvent('crash', { detail: { speed, deceleration: accelerationDelta } }));
            this.startCountdown();
        } else if (accelerationDelta >= this.HARD_BRAKE_THRESHOLD_MS2) {
            const now = Date.now();
            if (now - this.lastHardBrakeTime < this.HARD_BRAKE_COOLDOWN_MS) return;
            this.lastHardBrakeTime = now;

            console.log(`🛑 Hard Brake Detected via Accelerometer: ${accelerationDelta.toFixed(1)} m/s² at ${speed.toFixed(0)} mph`);
            this.dispatchEvent(new CustomEvent('hard_brake', { detail: { speed, deceleration: accelerationDelta } }));
            this.onHardBrakeDetected?.();
        } else if (accelerationDelta >= this.RAPID_ACCEL_THRESHOLD_MS2) {
            const now = Date.now();
            if (now - this.lastRapidAccelTime < this.RAPID_ACCEL_COOLDOWN_MS) return;
            this.lastRapidAccelTime = now;

            console.log(`⚡ Rapid Acceleration Detected via Accelerometer: ${accelerationDelta.toFixed(1)} m/s² at ${speed.toFixed(0)} mph`);
            this.dispatchEvent(new CustomEvent('rapid_accel', { detail: { speed, acceleration: accelerationDelta } }));
            this.onRapidAccelDetected?.();
        }
    };

    private startCountdown(): void {
        this.countdownSeconds = 30;
        this.countdownCallback?.(this.countdownSeconds);
        audioService.speak('Crash detected. Sending SOS in 30 seconds.');

        if (Capacitor.isNativePlatform()) {
            LocalNotifications.schedule({
                notifications: [{
                    id: 911,
                    title: '🚨 Crash Detected — SOS Alert',
                    body: 'High impact detected. Sending emergency SOS in 30s. Tap to cancel if safe.',
                    sound: 'beep.wav'
                }]
            }).catch(err => console.warn('Local notification error:', err));
        }

        this.countdownTimer = setInterval(() => {
            this.countdownSeconds--;
            this.countdownCallback?.(this.countdownSeconds);

            if (this.countdownSeconds <= 0) {
                if (this.countdownTimer) {
                    clearInterval(this.countdownTimer);
                    this.countdownTimer = null;
                }
                audioService.speak('Sending SOS now.');

                if (Capacitor.isNativePlatform()) {
                    LocalNotifications.schedule({
                        notifications: [{
                            id: 912,
                            title: '🚨 Emergency SOS Dispatched',
                            body: 'Your emergency contacts and circle have been alerted with your location.',
                            sound: 'beep.wav'
                        }]
                    }).catch(() => {});
                }

                // Auto-trigger SOS
                if (this.lastKnownLocation) {
                    this.onCrashDetected?.(this.lastKnownLocation);
                } else if (navigator.geolocation) {
                    navigator.geolocation.getCurrentPosition(
                        (pos) => {
                            this.onCrashDetected?.({
                                lat: pos.coords.latitude,
                                lng: pos.coords.longitude
                            });
                        },
                        () => {
                            this.onCrashDetected?.({ lat: 0, lng: 0 });
                        }
                    );
                } else {
                    this.onCrashDetected?.({ lat: 0, lng: 0 });
                }
            }
        }, 1000);
    }

    /** Start monitoring for crashes, hard braking, and rapid acceleration */
    public startMonitoring(
        onCrash: CrashCallback,
        onCountdown?: (remaining: number) => void,
        onCancel?: CancelCallback,
        onHardBrake?: HardBrakeCallback,
        onRapidAccel?: RapidAccelCallback,
        getSpeed?: SpeedGetter
    ): boolean {
        this.onCrashDetected = onCrash;
        this.countdownCallback = onCountdown || null;
        this.cancelCallback = onCancel || null;
        this.onHardBrakeDetected = onHardBrake || null;
        this.onRapidAccelDetected = onRapidAccel || null;
        this.speedGetter = getSpeed || null;
        this.isMonitoring = true;

        if (typeof window !== 'undefined' && 'DeviceMotionEvent' in window) {
            const DME = (window as any).DeviceMotionEvent;
            if (typeof DME?.requestPermission === 'function') {
                DME.requestPermission()
                    .then((permissionState: string) => {
                        if (permissionState === 'granted') {
                            window.addEventListener('devicemotion', this.handleMotion);
                            console.log('🛡️ Crash & Telemetry Detection: iOS motion permission granted & active');
                        } else {
                            console.warn('🛡️ Crash & Telemetry Detection: iOS motion permission denied');
                        }
                    })
                    .catch((err: any) => {
                        console.warn('🛡️ Crash & Telemetry Detection: iOS motion permission request error:', err);
                    });
            } else {
                window.addEventListener('devicemotion', this.handleMotion);
                console.log('🛡️ Crash & Telemetry Detection: Web motion active');
            }
        } else {
            console.log('🛡️ Crash & Telemetry Detection: Headless background GPS telemetry active');
        }
        return true;
    }

    /** Request iOS 13+ DeviceMotionEvent permission on user interaction */
    public async requestMotionPermission(): Promise<boolean> {
        if (typeof window !== 'undefined' && 'DeviceMotionEvent' in window) {
            const DME = (window as any).DeviceMotionEvent;
            if (typeof DME?.requestPermission === 'function') {
                try {
                    const response = await DME.requestPermission();
                    return response === 'granted';
                } catch (err) {
                    console.warn('🛡️ DeviceMotionEvent permission request failed:', err);
                    return false;
                }
            }
            return true;
        }
        return false;
    }

    /** Stop monitoring */
    public stopMonitoring(): void {
        if (typeof window !== 'undefined' && 'DeviceMotionEvent' in window) {
            window.removeEventListener('devicemotion', this.handleMotion);
        }
        if (this.countdownTimer) clearInterval(this.countdownTimer);
        this.isMonitoring = false;
        this.onCrashDetected = null;
        this.countdownCallback = null;
        this.onHardBrakeDetected = null;
        this.onRapidAccelDetected = null;
        this.speedGetter = null;
        console.log('🛡️ Crash Detection: Monitoring stopped');
    }

    /** Cancel an active countdown (user responded) */
    public cancelCountdown(): void {
        if (this.countdownTimer) {
            clearInterval(this.countdownTimer);
            this.countdownTimer = null;
            this.countdownSeconds = 30;
            this.cancelCallback?.();
            audioService.speak('SOS alert cancelled.');

            if (Capacitor.isNativePlatform()) {
                LocalNotifications.cancel({ notifications: [{ id: 911 }] }).catch(() => {});
            }

            console.log('✅ Crash countdown cancelled — driver is okay');
        }
    }

    public isMonitoringActive(): boolean {
        return this.isMonitoring;
    }

    public isCountdownInProgress(): boolean {
        return this.countdownTimer !== null;
    }

    public getRemainingSeconds(): number {
        return this.countdownSeconds;
    }
}

// Singleton Service Instance
export const crashDetectionService = new CrashDetectionService();

// Standalone Functional API (Backward-Compatible)
export const startCrashMonitoring = (
    onCrash: CrashCallback,
    onCountdown?: (remaining: number) => void,
    onCancel?: CancelCallback,
    onHardBrake?: HardBrakeCallback,
    onRapidAccel?: RapidAccelCallback,
    getSpeed?: SpeedGetter
): boolean => crashDetectionService.startMonitoring(onCrash, onCountdown, onCancel, onHardBrake, onRapidAccel, getSpeed);

export const stopCrashMonitoring = (): void => crashDetectionService.stopMonitoring();
export const cancelCrashCountdown = (): void => crashDetectionService.cancelCountdown();
export const updateCrashDetectionSpeed = (speedMph: number): void => crashDetectionService.updateSpeed(speedMph);
export const isCrashMonitoringActive = (): boolean => crashDetectionService.isMonitoringActive();
export const isCountdownActive = (): boolean => crashDetectionService.isCountdownInProgress();
export const getCountdownRemaining = (): number => crashDetectionService.getRemainingSeconds();
export const requestMotionPermission = (): Promise<boolean> => crashDetectionService.requestMotionPermission();
