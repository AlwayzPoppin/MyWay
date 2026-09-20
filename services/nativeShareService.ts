import { Capacitor, registerPlugin } from '@capacitor/core';

export interface NativeSharePayload {
    title: string;
    text: string;
    url: string;
}

type NativeSharePlugin = {
    share(payload: NativeSharePayload): Promise<void>;
};

const NativeShare = registerPlugin<NativeSharePlugin>('NativeShare');

const clipboardFallback = async (payload: NativeSharePayload): Promise<'copied' | 'unavailable'> => {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return 'unavailable';
    await navigator.clipboard.writeText(`${payload.text}\n${payload.url}`.trim());
    return 'copied';
};

/** Opens the operating system's share chooser. Clipboard is only a web fallback. */
export const sharePlace = async (payload: NativeSharePayload): Promise<'shared' | 'dismissed' | 'copied' | 'unavailable'> => {
    if (Capacitor.getPlatform() === 'android') {
        try {
            await NativeShare.share(payload);
            return 'shared';
        } catch {
            // A development webview may not yet contain the native bridge.
            // Continue to the browser API before using clipboard as a last resort.
        }
    }

    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
        try {
            await navigator.share(payload);
            return 'shared';
        } catch (error) {
            if ((error as { name?: string } | undefined)?.name === 'AbortError') return 'dismissed';
            return clipboardFallback(payload);
        }
    }
    return clipboardFallback(payload);
};
