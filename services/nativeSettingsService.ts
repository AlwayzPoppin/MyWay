import { registerPlugin, Capacitor } from '@capacitor/core';

export interface NativeSettingsPlugin {
    openAppSettings(): Promise<{ success: boolean; fallback?: boolean }>;
    requestIgnoreBatteryOptimizations(): Promise<{ success: boolean; fallback?: boolean }>;
    isIgnoringBatteryOptimizations(): Promise<{ isIgnoring: boolean; error?: string }>;
    openLocationSettings(): Promise<{ success: boolean }>;
}

const NativeSettings = registerPlugin<NativeSettingsPlugin>('NativeSettings');

const STORAGE_KEY_PROMPT_DISMISSED = 'myway_bg_tracking_prompt_dismissed';
const STORAGE_KEY_PROMPT_DISABLED = 'myway_bg_tracking_prompt_disabled';
const REPROMPT_COOLDOWN_DAYS = 5;

class NativeSettingsService {
    /**
     * Launch the native Android Application Info / Details settings screen
     * where the user can tap "Permissions" -> "Location" -> "Allow all the time".
     */
    async openAppSettings(): Promise<void> {
        if (!Capacitor.isNativePlatform()) {
            console.log('[NativeSettings] openAppSettings called on web/desktop');
            return;
        }

        try {
            await NativeSettings.openAppSettings();
        } catch (err) {
            console.warn('[NativeSettings] openAppSettings failed:', err);
        }
    }

    /**
     * Request system exemption from Android Doze mode and battery optimizations.
     * Triggers the native Android OS system modal:
     * "Let app always run in background?"
     */
    async requestIgnoreBatteryOptimizations(): Promise<void> {
        if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') {
            console.log('[NativeSettings] requestIgnoreBatteryOptimizations called on non-Android platform');
            return;
        }

        try {
            await NativeSettings.requestIgnoreBatteryOptimizations();
        } catch (err) {
            console.warn('[NativeSettings] requestIgnoreBatteryOptimizations failed:', err);
        }
    }

    /**
     * Check if Android has already whitelisted the app from battery optimizations.
     */
    async isIgnoringBatteryOptimizations(): Promise<boolean> {
        if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') {
            return true; // Not applicable on web/iOS
        }

        try {
            const res = await NativeSettings.isIgnoringBatteryOptimizations();
            return !!res?.isIgnoring;
        } catch (err) {
            console.warn('[NativeSettings] isIgnoringBatteryOptimizations check error:', err);
            return false;
        }
    }

    /**
     * Open device location settings.
     */
    async openLocationSettings(): Promise<void> {
        if (!Capacitor.isNativePlatform()) return;
        try {
            await NativeSettings.openLocationSettings();
        } catch (err) {
            console.warn('[NativeSettings] openLocationSettings failed:', err);
        }
    }

    /**
     * Check if the user has opted out of being prompted.
     */
    isPromptDisabledByUser(): boolean {
        return localStorage.getItem(STORAGE_KEY_PROMPT_DISABLED) === 'true';
    }

    /**
     * Set whether the user wants to disable automatic background tracking prompts.
     */
    setPromptDisabledByUser(disabled: boolean): void {
        if (disabled) {
            localStorage.setItem(STORAGE_KEY_PROMPT_DISABLED, 'true');
        } else {
            localStorage.removeItem(STORAGE_KEY_PROMPT_DISABLED);
            localStorage.removeItem(STORAGE_KEY_PROMPT_DISMISSED);
        }
    }

    /**
     * Mark the prompt as dismissed (either temporarily with cooldown, or permanently).
     */
    dismissPrompt(permanent: boolean = false): void {
        if (permanent) {
            this.setPromptDisabledByUser(true);
        } else {
            localStorage.setItem(STORAGE_KEY_PROMPT_DISMISSED, Date.now().toString());
        }
    }

    /**
     * Evaluates whether the app should proactively prompt the user for
     * background tracking and battery optimization.
     */
    async shouldShowPrompt(): Promise<boolean> {
        // Only relevant on native Android
        if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') {
            return false;
        }

        // Check if user turned off the prompt
        if (this.isPromptDisabledByUser()) {
            return false;
        }

        // Check if user dismissed recently
        const dismissedStr = localStorage.getItem(STORAGE_KEY_PROMPT_DISMISSED);
        if (dismissedStr) {
            const dismissedAt = parseInt(dismissedStr, 10);
            if (!isNaN(dismissedAt)) {
                const daysSince = (Date.now() - dismissedAt) / (1000 * 60 * 60 * 24);
                if (daysSince < REPROMPT_COOLDOWN_DAYS) {
                    return false;
                }
            }
        }

        // If battery optimizations are already bypassed, no need to harass the user
        const isBypassed = await this.isIgnoringBatteryOptimizations();
        if (isBypassed) {
            return false;
        }

        return true;
    }
}

export const nativeSettingsService = new NativeSettingsService();
