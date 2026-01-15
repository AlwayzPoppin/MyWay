// Geolocation service for real GPS tracking

export interface GeolocationState {
    latitude: number;
    longitude: number;
    accuracy: number;
    heading: number | null;
    speed: number | null;
    timestamp: number;
}

export interface GeolocationError {
    code: number;
    message: string;
}

export type LocationCallback = (location: GeolocationState) => void;
export type ErrorCallback = (error: GeolocationError) => void;

class GeolocationService {
    private watchId: number | null = null;

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
                    reject(this.parseError(error));
                },
                {
                    enableHighAccuracy: true,
                    timeout: 10000,
                    maximumAge: 0
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
                timeout: 10000,
                maximumAge: 5000
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
        return {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
            heading: position.coords.heading,
            speed: position.coords.speed,
            timestamp: position.timestamp
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
