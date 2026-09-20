// Movement State Classifier & Physical Activity Tracking
// Tracks 'driving', 'vehicle_stopped', 'walking', 'stationary' using previous-state memory
// Applies a 10-second debounce when speed drops below 2 mph

export type MovementMode = 'driving' | 'vehicle_stopped' | 'walking' | 'stationary';

export interface MovementVisuals {
    mode: MovementMode;
    label: string;
    badgeBg: string;
    badgeBorder: string;
    ringColor: string;
    textColor: string;
    dotColor: string;
    iconSvg: string;
}

interface MemberMovementMemory {
    currentMode: MovementMode;
    previousMovingMode: 'driving' | 'walking';
    lowSpeedStartMs: number | null; // timestamp when speed first dropped below 2 mph
    lastSpeed: number;
    lastUpdatedMs: number;
}

// In-memory memory store keyed by member ID
const movementMemoryStore = new Map<string, MemberMovementMemory>();

/**
 * Clear tracking memory (useful for testing and circle switches)
 */
export function clearMovementMemory(): void {
    movementMemoryStore.clear();
}

/**
 * Classify movement state for a member using previous-state memory and 10s hysteresis.
 * - IF currentSpeed >= 12 mph -> "driving"
 * - IF currentSpeed >= 2 mph AND currentSpeed < 12 mph -> "walking"
 * - IF currentSpeed < 2 mph (stationary):
 *     - If within 10s debounce -> retain previous mode to prevent stop-and-go flickering
 *     - If >= 10s elapsed:
 *         - previousMode === "driving" | "vehicle_stopped" -> "vehicle_stopped"
 *         - previousMode === "walking" | "standing" -> "standing"
 * - Default / cold start -> "standing"
 */
export function classifyMovementMode(
    memberId: string,
    currentSpeedMph: number = 0,
    timestampMs: number = Date.now()
): MovementMode {
    const speed = Math.max(0, currentSpeedMph || 0);
    const existing = movementMemoryStore.get(memberId);

    if (!existing) {
        // Cold start initialization
        let initialMode: MovementMode = 'stationary';
        let initialMovingMode: 'driving' | 'walking' = 'walking';

        if (speed >= 12) {
            initialMode = 'driving';
            initialMovingMode = 'driving';
        } else if (speed >= 2) {
            initialMode = 'walking';
            initialMovingMode = 'walking';
        } else {
            initialMode = 'stationary';
            initialMovingMode = 'walking';
        }

        movementMemoryStore.set(memberId, {
            currentMode: initialMode,
            previousMovingMode: initialMovingMode,
            lowSpeedStartMs: speed < 2 ? timestampMs : null,
            lastSpeed: speed,
            lastUpdatedMs: timestampMs
        });

        return initialMode;
    }

    // High Speed >= 12 mph -> Driving
    if (speed >= 12) {
        existing.currentMode = 'driving';
        existing.previousMovingMode = 'driving';
        existing.lowSpeedStartMs = null;
        existing.lastSpeed = speed;
        existing.lastUpdatedMs = timestampMs;
        return 'driving';
    }

    // Pedestrian Speed >= 2 mph and < 12 mph -> Walking
    if (speed >= 2) {
        existing.currentMode = 'walking';
        existing.previousMovingMode = 'walking';
        existing.lowSpeedStartMs = null;
        existing.lastSpeed = speed;
        existing.lastUpdatedMs = timestampMs;
        return 'walking';
    }

    // Low Speed / Stationary < 2 mph: Apply 10-second hysteresis debounce
    if (existing.lowSpeedStartMs === null) {
        existing.lowSpeedStartMs = timestampMs;
    }

    const elapsedLowSpeedMs = Math.max(0, timestampMs - existing.lowSpeedStartMs);

    // Within 10-second debounce: retain active mode to avoid flickering at red lights or crosswalks
    if (elapsedLowSpeedMs < 10_000) {
        existing.lastSpeed = speed;
        existing.lastUpdatedMs = timestampMs;
        return existing.currentMode;
    }

    // After 10-second debounce: shift based on previous moving mode
    if (existing.previousMovingMode === 'driving' || existing.currentMode === 'vehicle_stopped') {
        existing.currentMode = 'vehicle_stopped';
    } else {
        existing.currentMode = 'stationary';
    }

    existing.lastSpeed = speed;
    existing.lastUpdatedMs = timestampMs;
    return existing.currentMode;
}

/**
 * Returns user-friendly status label for the movement mode.
 */
export function getMovementLabel(mode: MovementMode, speedMph: number = 0): string {
    const roundedSpeed = Math.round(speedMph);
    switch (mode) {
        case 'driving':
            return roundedSpeed > 0 ? `Driving • ${roundedSpeed} mph` : 'Driving';
        case 'vehicle_stopped':
            return 'Stopped in traffic';
        case 'walking':
            return 'Walking';
        case 'stationary':
        default:
            return 'Stationary';
    }
}

/**
 * Returns full visual design metadata (colors, badges, rings, and vector SVG) for a movement mode.
 */
export function getMovementVisuals(mode: MovementMode, speedMph: number = 0): MovementVisuals {
    const label = getMovementLabel(mode, speedMph);

    switch (mode) {
        case 'driving':
            return {
                mode: 'driving',
                label,
                badgeBg: '#2563eb', // Blue
                badgeBorder: '#1d4ed8',
                ringColor: '#3b82f6',
                textColor: '#60a5fa',
                dotColor: '#3b82f6',
                iconSvg: `<svg viewBox="0 0 24 24" width="9" height="9" fill="none" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.5 2.8C2.1 11.2 2 11.6 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/></svg>`
            };
        case 'vehicle_stopped':
            return {
                mode: 'vehicle_stopped',
                label,
                badgeBg: '#d97706', // Amber / Orange
                badgeBorder: '#b45309',
                ringColor: '#f59e0b',
                textColor: '#fbbf24',
                dotColor: '#f59e0b',
                iconSvg: `<svg viewBox="0 0 24 24" width="9" height="9" fill="none" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 17h1c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C13.7 10.6 12 10 12 10s-1-1.4-1.7-2.3c-.4-.4-.9-.7-1.4-.7H4c-.5 0-.9.4-1.1.9L1.7 10.7C1.6 11.2 1.5 11.6 1.5 12v4c0 .6.4 1 1 1h1.5"/><circle cx="5.5" cy="17" r="1.5"/><circle cx="12.5" cy="17" r="1.5"/><rect x="18" y="4" width="2" height="7" fill="#fbbf24" stroke="none" rx="0.5"/><rect x="22" y="4" width="2" height="7" fill="#fbbf24" stroke="none" rx="0.5"/></svg>`
            };
        case 'walking':
            return {
                mode: 'walking',
                label,
                badgeBg: '#059669', // Emerald
                badgeBorder: '#047857',
                ringColor: '#10b981',
                textColor: '#34d399',
                dotColor: '#10b981',
                iconSvg: `<svg viewBox="0 0 24 24" width="9" height="9" fill="none" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="13" cy="4" r="2"/><path d="m9 20 3-6 3 2v4"/><path d="m6 14 3-3 4 1 3 4"/><path d="m14 8-3-2-4 3"/></svg>`
            };
        case 'stationary':
        default:
            return {
                mode: 'standing',
                label,
                badgeBg: '#0d9488', // Teal
                badgeBorder: '#0f766e',
                ringColor: '#14b8a6',
                textColor: '#2dd4bf',
                dotColor: '#14b8a6',
                iconSvg: `<svg viewBox="0 0 24 24" width="9" height="9" fill="none" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="4" r="2"/><path d="M12 6v8"/><path d="m9 21 3-7 3 7"/><path d="M7 10h10"/></svg>`
            };
    }
}

/**
 * Generate 16x16px activity badge HTML anchored to bottom-right of avatar marker.
 */
export function getMapMarkerBadgeHtml(mode: MovementMode, speedMph: number = 0): string {
    const visuals = getMovementVisuals(mode, speedMph);
    return `
        <div class="myway-activity-badge" style="position: absolute; bottom: -1px; right: -1px; width: 16px; height: 16px; border-radius: 50%; background: ${visuals.badgeBg}; border: 1.5px solid #0f172a; box-shadow: 0 2px 6px rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 5;" title="${visuals.label}">
            ${visuals.iconSvg}
        </div>
    `.trim();
}
