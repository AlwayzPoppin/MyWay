/**
 * Haptic Feedback Utility for Mobile Web & Hybrid WebViews
 * Provides tactile physical confirmation for critical user actions,
 * input milestones, and state completions.
 */

/**
 * Safely triggers vibration pattern if supported by browser/device.
 */
export const triggerHaptic = (pattern: number | number[] = 25): boolean => {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator && typeof navigator.vibrate === 'function') {
        try {
            return navigator.vibrate(pattern);
        } catch {
            return false;
        }
    }
    return false;
};

/**
 * Micro-tick for individual keystrokes or selection changes.
 */
export const hapticTick = () => triggerHaptic(15);

/**
 * Light double-pulse for completing an input milestone (e.g. 8th character reached).
 */
export const hapticMilestone = () => triggerHaptic([30, 40, 30]);

/**
 * Satisfying multi-pulse for successful operations (e.g. joined circle, saved place).
 */
export const hapticSuccess = () => triggerHaptic([40, 50, 40, 50, 70]);

/**
 * Distinct double-buzz for errors or invalid submissions.
 */
export const hapticError = () => triggerHaptic([80, 50, 80]);
