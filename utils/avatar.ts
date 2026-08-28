/**
 * Avatar & Profile Image Utilities
 * Provides resilient avatar resolution and zero-network inline SVG generation.
 */

const AVATAR_COLORS = [
    { start: '#6366f1', end: '#4338ca' }, // Indigo
    { start: '#8b5cf6', end: '#6d28d9' }, // Purple
    { start: '#ec4899', end: '#be185d' }, // Pink
    { start: '#f43f5e', end: '#be123c' }, // Rose
    { start: '#f59e0b', end: '#b45309' }, // Amber
    { start: '#10b981', end: '#047857' }, // Emerald
    { start: '#06b6d4', end: '#0e7490' }, // Cyan
    { start: '#3b82f6', end: '#1d4ed8' }, // Blue
    { start: '#14b8a6', end: '#0f766e' }, // Teal
];

/**
 * Generate a deterministic gradient color pair from a string (name or user ID)
 */
export const getAvatarColorPair = (seed: string = 'user'): { start: string; end: string } => {
    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
        hash = seed.charCodeAt(i) + ((hash << 5) - hash);
    }
    const index = Math.abs(hash) % AVATAR_COLORS.length;
    return AVATAR_COLORS[index];
};

/**
 * Generate an inline SVG Data URI for an initial-based avatar.
 * Works 100% offline with zero network requests, no external dependencies, and crystal clarity.
 */
export const getDefaultAvatarDataUri = (nameOrId: string = 'U'): string => {
    const cleanStr = (nameOrId || 'U').trim();
    const initial = cleanStr.charAt(0).toUpperCase() || 'U';
    const { start, end } = getAvatarColorPair(cleanStr);

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">
        <defs>
            <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stop-color="${start}" />
                <stop offset="100%" stop-color="${end}" />
            </linearGradient>
        </defs>
        <circle cx="50" cy="50" r="50" fill="url(#grad)" />
        <text x="50" y="65" font-size="46" font-weight="900" fill="#ffffff" font-family="system-ui, -apple-system, BlinkMacSystemFont, Roboto, sans-serif" text-anchor="middle" letter-spacing="-1">${initial}</text>
    </svg>`;

    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
};

/**
 * Safely resolves an avatar image URL.
 * If custom uploaded image (Firebase Storage or Data URI), returns it.
 * Otherwise returns the crisp inline SVG data URI.
 */
export const getSafeAvatarUrl = (
    avatar?: string | null,
    nameOrId: string = 'user',
    fallbackSeed?: string
): string => {
    if (
        avatar &&
        typeof avatar === 'string' &&
        avatar.trim() !== '' &&
        avatar !== 'undefined' &&
        avatar !== 'null' &&
        !avatar.includes('/undefined') &&
        !avatar.includes('api.dicebear.com') && // Avoid slow or blocked external requests
        (avatar.startsWith('http') || avatar.startsWith('data:') || avatar.startsWith('blob:'))
    ) {
        return avatar;
    }

    return getDefaultAvatarDataUri(nameOrId || fallbackSeed || 'user');
};
