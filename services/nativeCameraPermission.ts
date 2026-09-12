import { Capacitor, registerPlugin } from '@capacitor/core';

interface NativeCameraPermissionPlugin {
    checkPermissions(): Promise<{ camera: 'granted' | 'denied' }>;
    requestPermissions(): Promise<{ camera: 'granted' | 'denied' }>;
}

const NativeCameraPermission = registerPlugin<NativeCameraPermissionPlugin>('NativeCameraPermission');

/** Requests Android camera access only from an explicit camera action. */
export const ensureCameraPermission = async (): Promise<boolean> => {
    if (!Capacitor.isNativePlatform()) return true;
    const current = await NativeCameraPermission.checkPermissions();
    if (current.camera === 'granted') return true;
    const requested = await NativeCameraPermission.requestPermissions();
    return requested.camera === 'granted';
};
