/**
 * Privacy Service - Granular Per-Circle Visibility Controls
 * 
 * Levels:
 * 1. 'exact': Full Live GPS (Precise Coordinates, Speed, Heading)
 * 2. 'blurred': Neighborhood Bubble (~1.5 mi radius quantization, hides exact house/street)
 * 3. 'invisible': No live location is shared with the circle.
 */

export type CirclePrivacyMode = 'exact' | 'blurred' | 'invisible';

export interface PrivacyLevelMetadata {
    id: CirclePrivacyMode;
    title: string;
    badge: string;
    icon: string;
    tagline: string;
    description: string;
    color: string;
    accentHex: string;
}

export const PRIVACY_LEVELS: PrivacyLevelMetadata[] = [
    {
        id: 'exact',
        title: 'Exact Live GPS',
        badge: '⚡ Exact Live',
        icon: '📍',
        tagline: 'Full Real-Time Tracking',
        description: 'Shares precise street-level coordinates, live turn-by-turn driving speed, and bearing. Best for immediate family & convoys.',
        color: 'emerald',
        accentHex: '#10B981'
    },
    {
        id: 'blurred',
        title: 'Blurred Neighborhood',
        badge: '🛡️ ~1.5 mi Bubble',
        icon: '🛡️',
        tagline: '~1.5 Mile Radius Area',
        description: 'Hides your exact house, street address, and live speed. Members only see a general neighborhood bubble. Best for friends & coworkers.',
        color: 'indigo',
        accentHex: '#6366F1'
    },
    {
        id: 'invisible',
        title: 'Invisible',
        badge: '👁️ Invisible',
        icon: '👁️',
        tagline: 'No Location Shared',
        description: 'Stops sharing your live location with this circle until you choose Exact or Blurred again.',
        color: 'purple',
        accentHex: '#8B5CF6'
    }
];

export const getCirclePrivacyMode = (circleId: string): CirclePrivacyMode => {
    if (typeof window === 'undefined' || !circleId) return 'exact';
    
    // Check specific circle setting
    const circleSetting = localStorage.getItem(`myway_privacy_circle_${circleId}`);
    if (circleSetting) {
        if (circleSetting === 'exact' || circleSetting === 'blurred' || circleSetting === 'invisible') {
            return circleSetting;
        }
        if (circleSetting === 'status_only' || circleSetting === 'frozen') {
            return 'invisible';
        }
        try {
            const parsed = JSON.parse(circleSetting);
            if (parsed.mode === 'exact' || parsed.mode === 'blurred' || parsed.mode === 'invisible') return parsed.mode;
            if (parsed.mode === 'status_only' || parsed.mode === 'frozen') return 'invisible';
        } catch {
            // ignore
        }
    }

    // Fallback to legacy global setting if present
    const globalMode = localStorage.getItem('myway_privacy_mode');
    if (globalMode === 'blurred' || globalMode === 'invisible') {
        return globalMode;
    }
    if (globalMode === 'status_only' || globalMode === 'frozen') {
        return 'invisible';
    }

    return 'exact';
};

export const setCirclePrivacyMode = (circleId: string, mode: CirclePrivacyMode): void => {
    if (typeof window === 'undefined' || !circleId) return;
    localStorage.setItem(`myway_privacy_circle_${circleId}`, mode);
    window.dispatchEvent(new CustomEvent('myway-privacy-mode-changed', { detail: { circleId, mode } }));
};

export const getAllCirclePrivacyModes = (circleIds: string[]): Record<string, CirclePrivacyMode> => {
    const map: Record<string, CirclePrivacyMode> = {};
    circleIds.forEach(id => {
        map[id] = getCirclePrivacyMode(id);
    });
    return map;
};
