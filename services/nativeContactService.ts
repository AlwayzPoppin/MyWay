import { Capacitor, registerPlugin } from '@capacitor/core';
import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';

export type ContactAction = 'text' | 'call';
export interface ContactPreferences { phone: string; circleIds: string[] }
export interface CircleContacts { preferences: ContactPreferences; contacts: Record<string, string> }
export const normalizeContactNumber = (value: string): string => {
    const number = value.trim().replace(/[\s().-]/g, '');
    if (!/^\+[1-9]\d{6,14}$/.test(number)) throw new Error('Enter a phone number with country code, for example +1 910 555 0123.');
    return number;
};
export const loadCircleContacts = async (circleIds: string[]): Promise<CircleContacts> =>
    (await httpsCallable<{ circleIds: string[] }, CircleContacts>(functions, 'getCircleContacts')({ circleIds })).data;
export const saveContactPreferences = async (preferences: ContactPreferences): Promise<void> => {
    await httpsCallable(functions, 'saveContactPreferences')({
        ...preferences, phone: preferences.phone.trim() ? normalizeContactNumber(preferences.phone) : ''
    });
};
const NativeContact = registerPlugin<{ open(options: { phone: string; action: ContactAction }): Promise<void> }>('NativeContact');
export const openNativeContact = async (phone: string, action: ContactAction): Promise<void> => {
    const number = normalizeContactNumber(phone);
    if (Capacitor.getPlatform() === 'android') {
        await NativeContact.open({ phone: number, action });
    } else {
        window.location.href = `${action === 'text' ? 'sms' : 'tel'}:${number}`;
    }
};
