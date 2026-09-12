const LOW_BATTERY_THRESHOLD = 20;
const LOW_BATTERY_RESET_THRESHOLD = 25;

/**
 * Emits one low-battery notice per discharge cycle. Charging above 25% arms it
 * again, which prevents reconnects and component remounts from spamming a circle.
 */
export const shouldNotifyLowBattery = (memberId: string, battery: number): boolean => {
    if (!memberId || !Number.isFinite(battery) || battery <= 0) return false;
    const key = `myway_low_battery_notified_${memberId}`;
    if (battery >= LOW_BATTERY_RESET_THRESHOLD) {
        localStorage.removeItem(key);
        return false;
    }
    if (battery > LOW_BATTERY_THRESHOLD || localStorage.getItem(key) === 'true') return false;
    localStorage.setItem(key, 'true');
    return true;
};

export const getLocationFreshness = (timestamp?: string | number, now = Date.now()) => {
    const time = typeof timestamp === 'number' ? timestamp : Date.parse(timestamp || '');
    if (!Number.isFinite(time)) return { label: 'Location unavailable', isLive: false };
    const ageMs = Math.max(0, now - time);
    if (ageMs < 90_000) return { label: 'Live location', isLive: true };
    if (ageMs < 60 * 60 * 1000) return { label: `Last updated ${Math.floor(ageMs / 60_000)}m ago`, isLive: false };
    return { label: `Last updated ${Math.floor(ageMs / 3_600_000)}h ago`, isLive: false };
};

