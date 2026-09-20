import { httpsCallable } from 'firebase/functions';
import { onValue, ref } from 'firebase/database';
import { Capacitor } from '@capacitor/core';
import { database, functions } from './firebase';

const DEVICE_ID_KEY = 'myway_device_id';
const DEVICE_SESSION_STARTED_AT_KEY = 'myway_device_session_started_at';

export interface TrustedDevice {
    id: string;
    label: string;
    platform: string;
    createdAt: number;
    lastActiveAt: number;
    isLocationPublisher: boolean;
    revokedAt?: number | null;
}

const storageAvailable = () => typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';

export const getCurrentDeviceId = (): string => {
    if (!storageAvailable()) return 'server';
    const existing = window.localStorage.getItem(DEVICE_ID_KEY);
    if (existing) return existing;
    const generated = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    window.localStorage.setItem(DEVICE_ID_KEY, generated);
    return generated;
};

export const getCurrentSessionStartedAt = (): number => {
    if (typeof window === 'undefined' || typeof window.sessionStorage === 'undefined') return Date.now();
    const existing = Number(window.sessionStorage.getItem(DEVICE_SESSION_STARTED_AT_KEY));
    if (Number.isFinite(existing) && existing > 0) return existing;
    const startedAt = Date.now();
    window.sessionStorage.setItem(DEVICE_SESSION_STARTED_AT_KEY, String(startedAt));
    return startedAt;
};

export const getCurrentDeviceLabel = (): { label: string; platform: string } => {
    const userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent;
    // A mobile browser is still a companion viewer. Only the installed native
    // app may claim the account's one GPS-publishing device role.
    const nativePlatform = Capacitor.isNativePlatform() ? Capacitor.getPlatform() : '';
    if (nativePlatform === 'android') return { label: 'Android phone', platform: 'android' };
    if (nativePlatform === 'ios') return { label: 'Apple device', platform: 'ios' };
    if (/android/i.test(userAgent)) return { label: 'Android browser', platform: 'web' };
    if (/iphone|ipad|ipod/i.test(userAgent)) return { label: 'Apple browser', platform: 'web' };
    if (/windows/i.test(userAgent)) return { label: 'Windows browser', platform: 'web' };
    if (/macintosh/i.test(userAgent)) return { label: 'Mac browser', platform: 'web' };
    return { label: 'Web browser', platform: 'web' };
};

export const isMobilePlatform = (platform?: string | null): boolean => platform === 'android' || platform === 'ios';

export const isCurrentDeviceMobile = (): boolean => isMobilePlatform(getCurrentDeviceLabel().platform);

const asDeviceList = (value: unknown): TrustedDevice[] => {
    if (!value || typeof value !== 'object') return [];
    return Object.entries(value as Record<string, Partial<TrustedDevice>>)
        .filter(([id, device]) => id && device && typeof device === 'object')
        .map(([id, device]) => ({
            id,
            label: typeof device.label === 'string' ? device.label : 'My Way device',
            platform: typeof device.platform === 'string' ? device.platform : 'unknown',
            createdAt: typeof device.createdAt === 'number' ? device.createdAt : 0,
            lastActiveAt: typeof device.lastActiveAt === 'number' ? device.lastActiveAt : 0,
            isLocationPublisher: device.isLocationPublisher === true,
            revokedAt: typeof device.revokedAt === 'number' ? device.revokedAt : null
        }))
        .sort((a, b) => b.lastActiveAt - a.lastActiveAt);
};

export const registerCurrentDevice = async (userId: string): Promise<void> => {
    if (!userId) return;
    const { label, platform } = getCurrentDeviceLabel();
    await httpsCallable(functions, 'registerTrustedDevice')({
        deviceId: getCurrentDeviceId(),
        label,
        platform
    });
};

export const updateCurrentDevicePushToken = async (token: string): Promise<void> => {
    if (!token) return;
    await httpsCallable(functions, 'updateTrustedDevicePushToken')({
        deviceId: getCurrentDeviceId(),
        token
    });
};

export const claimLocationSharingForCurrentDevice = async (): Promise<void> => {
    await httpsCallable(functions, 'claimLocationSharingDevice')({ deviceId: getCurrentDeviceId() });
};

export const revokeTrustedDevice = async (deviceId: string): Promise<void> => {
    await httpsCallable(functions, 'revokeTrustedDevice')({ deviceId });
};

export const signOutEverywhere = async (): Promise<void> => {
    await httpsCallable(functions, 'revokeAllDeviceSessions')({});
};

export const subscribeToTrustedDevices = (userId: string, callback: (devices: TrustedDevice[]) => void): (() => void) => {
    if (!userId) return () => undefined;
    const deviceRef = ref(database, `userDevices/${userId}`);
    return onValue(deviceRef, snapshot => callback(asDeviceList(snapshot.val())));
};

/** Returns true only for the one device permitted to publish Circle GPS. */
export const isCurrentLocationPublisher = (activeLocationDeviceId?: string | null): boolean => {
    // A desktop is a companion screen: it can plan routes, open contacts, and receive alerts,
    // but only a phone supplies the account's shared live position.
    if (!isCurrentDeviceMobile()) return false;
    // Older profiles are allowed until their first device registration completes.
    return !activeLocationDeviceId || activeLocationDeviceId === getCurrentDeviceId();
};

export const subscribeToCurrentDeviceRevocation = (
    userId: string,
    onRevoked: () => void
): (() => void) => {
    if (!userId) return () => undefined;
    const deviceId = getCurrentDeviceId();
    const sessionStartedAt = getCurrentSessionStartedAt();
    const deviceRef = ref(database, `userDevices/${userId}/${deviceId}/revokedAt`);
    const globalRef = ref(database, `userDeviceControls/${userId}/signOutAllAt`);
    let handled = false;
    const check = (value: unknown) => {
        if (handled || typeof value !== 'number' || value < sessionStartedAt) return;
        handled = true;
        onRevoked();
    };
    const unsubscribeDevice = onValue(deviceRef, snapshot => check(snapshot.val()));
    const unsubscribeGlobal = onValue(globalRef, snapshot => check(snapshot.val()));
    return () => {
        unsubscribeDevice();
        unsubscribeGlobal();
    };
};
