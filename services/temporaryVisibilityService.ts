const PREFIX = 'myway_temporary_visibility_until_';

export const startTemporaryVisibility = (circleId: string, durationMs = 60 * 60_000): number => {
    const expiresAt = Date.now() + durationMs;
    localStorage.setItem(`${PREFIX}${circleId}`, String(expiresAt));
    return expiresAt;
};

export const getTemporaryVisibilityExpiry = (circleId: string): number | null => {
    const value = Number(localStorage.getItem(`${PREFIX}${circleId}`));
    return Number.isFinite(value) && value > 0 ? value : null;
};

export const clearTemporaryVisibility = (circleId: string): void => {
    localStorage.removeItem(`${PREFIX}${circleId}`);
};
