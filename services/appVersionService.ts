/**
 * Shared, non-sensitive build metadata used only to spot incompatible Circle
 * sync clients. Keep the protocol number separate from the app's marketing
 * version: a UI-only release does not need to make another member update.
 */
export const APP_VERSION = (import.meta as any).env?.VITE_APP_VERSION || '1.0.26';
export const CIRCLE_SYNC_PROTOCOL_VERSION = 2;

export const isOlderCircleSyncProtocol = (protocol?: number): boolean =>
    typeof protocol === 'number' && protocol < CIRCLE_SYNC_PROTOCOL_VERSION;
