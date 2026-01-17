// Geolocation service for real GPS tracking
import { FamilyMember } from '../types';

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

class GeolocationService {
    private watchId: number | null = null;
    private isSimulating: boolean = false;
    private simulationInterval: any = null;

    isSupported(): boolean {
        return 'geolocation' in navigator;
    }

    async getCurrentPosition(): Promise<GeolocationState> {
        if (this.isSimulating) {
            return this.getMockPosition();
        }

        return new Promise((resolve, reject) => {
            if (!this.isSupported()) {
                reject({ code: 0, message: 'Geolocation not supported' });
                return;
            }

            navigator.geolocation.getCurrentPosition(
                (position) => {
                    resolve(this.parsePosition(position));
                },
                (error) => {
                    // Fallback to low accuracy if high accuracy fails/times out
                    if (error.code === 3) { // Timeout
                        navigator.geolocation.getCurrentPosition(
                            (pos) => resolve(this.parsePosition(pos)),
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
        if (this.isSimulating) {
            this.startSimulation(onLocation);
            return;
        }

        if (!this.isSupported()) {
            onError?.({ code: 0, message: 'Geolocation not supported' });
            return;
        }

        this.watchId = navigator.geolocation.watchPosition(
            (position) => {
                onLocation(this.parsePosition(position));
            },
            (error) => {
                onError?.(this.parseError(error));
            },
            {
                enableHighAccuracy: true,
                timeout: 30000,
                maximumAge: 1000
            }
        );
    }

    stopWatching(): void {
        if (this.watchId !== null) {
            navigator.geolocation.clearWatch(this.watchId);
            this.watchId = null;
        }
        if (this.simulationInterval) {
            clearInterval(this.simulationInterval);
            this.simulationInterval = null;
        }
    }

    // Simulation Methods
    // Production guard: Simulation is disabled in production builds
    setSimulationMode(active: boolean) {
        const isProduction = (import.meta as any).env?.PROD || false;
        if (isProduction && active) {
            console.warn('Simulation mode is disabled in production builds');
            return;
        }
        this.isSimulating = active;
        if (!active) this.stopWatching();
    }

    private currentRoutePoints: { lat: number; lng: number }[] = [];
    private currentRouteIndex = 0;

    setSimulationRoute(points: { lat: number; lng: number }[]) {
        this.currentRoutePoints = points;
        this.currentRouteIndex = 0;
    }

    private startSimulation(onLocation: LocationCallback) {
        // If we have a route, follow it
        // Otherwise, move in a circle around SF

        this.simulationInterval = setInterval(() => {
            let lat, lng, speed, heading;

            if (this.currentRoutePoints.length > 0) {
                // Determine current segment
                // Simplified: Just jump to next point every 3 seconds for testing "arrival"
                // Or: Interpolate. Let's do simple interpolation for smoothness.

                const targetPoint = this.currentRoutePoints[this.currentRouteIndex];

                // For this simulation, we'll just teleport slowly towards the target to trigger "Arrived" logic
                // Actually, let's just emit the target point directly to ensure we hit the waypoint radius
                // But we need to move THROUGH the points.

                if (targetPoint) {
                    lat = targetPoint.lat;
                    lng = targetPoint.lng;
                    speed = 45; // mph
                    heading = 0;

                    // Move to next point for next tick
                    this.currentRouteIndex = (this.currentRouteIndex + 1) % this.currentRoutePoints.length;
                    // In a real app we'd stop at the end, but let's loop or stop?
                    if (this.currentRouteIndex === 0) {
                        // End of route - stop simulation? 
                        // For now, loop to verify behavior or just hold
                    }
                } else {
                    lat = 35.2271; lng = -80.8431;
                }
            } else {
                // Default circle logic
                const time = Date.now() / 1000;
                lat = 35.2271 + Math.sin(time) * 0.01;
                lng = -80.8431 + Math.cos(time) * 0.01;
                speed = 30;
                heading = (time * 180 / Math.PI) % 360;
            }

            onLocation({
                latitude: lat,
                longitude: lng,
                accuracy: 5,
                heading: heading || 0,
                speed: speed || 0,
                timestamp: Date.now(),
                signalQuality: 'excellent'
            });
        }, 3000); // 3-second updates
    }

    private getMockPosition(): GeolocationState {
        return {
            latitude: 35.2271,
            longitude: -80.8431,
            accuracy: 5,
            heading: null,
            speed: 0,
            timestamp: Date.now(),
            signalQuality: 'excellent'
        };
    }

    private parsePosition(position: GeolocationPosition): GeolocationState {
        const accuracy = position.coords.accuracy;
        let quality: GeolocationState['signalQuality'] = 'excellent';

        if (accuracy > 50) quality = 'poor';
        else if (accuracy > 20) quality = 'good';

        return {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: accuracy,
            heading: position.coords.heading,
            speed: position.coords.speed ? (position.coords.speed * 2.23694) : 0, // Convert m/s to mph
            timestamp: position.timestamp,
            signalQuality: quality
        };
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
