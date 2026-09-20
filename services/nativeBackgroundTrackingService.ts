import { Capacitor, registerPlugin } from '@capacitor/core';
import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';
import { getCurrentDeviceId } from './deviceSessionService';

type CircleTrackingConfig = { id: string; privacyMode: 'exact' | 'blurred' | 'invisible' };

interface NativeBackgroundTrackingPlugin {
    configure(options: {
        uid: string;
        deviceId: string;
        token: string;
        endpoint: string;
        circles: string;
        displayName: string;
        photoURL: string;
        role: string;
    }): Promise<{ running: boolean }>;
    stop(): Promise<{ running: boolean }>;
    getStatus(): Promise<{ running: boolean }>;
}

const NativeBackgroundTracking = registerPlugin<NativeBackgroundTrackingPlugin>('NativeBackgroundTracking');
const ENDPOINT = 'https://us-central1-myway-gps.cloudfunctions.net/backgroundLocationUpdate';

export const nativeBackgroundTrackingService = {
    isSupported: () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android',

    async start(config: {
        uid: string;
        displayName?: string | null;
        photoURL?: string | null;
        role?: string | null;
        circles: CircleTrackingConfig[];
    }): Promise<boolean> {
        if (!this.isSupported() || !config.uid || config.circles.length === 0) return false;
        const deviceId = getCurrentDeviceId();
        const callable = httpsCallable<{ deviceId: string }, { token: string; expiresAt: number }>(functions, 'createBackgroundTrackingCredential');
        const credential = await callable({ deviceId });
        const result = await NativeBackgroundTracking.configure({
            uid: config.uid,
            deviceId,
            token: credential.data.token,
            endpoint: ENDPOINT,
            circles: JSON.stringify(config.circles),
            displayName: config.displayName || 'You',
            photoURL: config.photoURL || '',
            role: config.role || 'Member'
        });
        return result.running;
    },

    async stop(): Promise<void> {
        if (!this.isSupported()) return;
        await NativeBackgroundTracking.stop();
    },

    async isRunning(): Promise<boolean> {
        if (!this.isSupported()) return false;
        const status = await NativeBackgroundTracking.getStatus();
        return status.running;
    }
};
