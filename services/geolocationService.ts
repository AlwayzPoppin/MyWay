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
    private readonly ACCURACY_THRESHOLD = 150; // Relaxed: Allow up to 150m for real-world reliability

    isSupported(): boolean {
        return 'geolocation' in navigator;
    }

    async getCurrentPosition(): Promise<GeolocationState> {
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
    }

    private parsePosition(position: GeolocationPosition): GeolocationState {
        const accuracy = position.coords.accuracy;
        let quality: GeolocationState['signalQuality'] = 'excellent';

        if (accuracy > this.ACCURACY_THRESHOLD) quality = 'poor';
        else if (accuracy > 40) quality = 'good';

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
