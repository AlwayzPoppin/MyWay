export interface MapViewportBounds {
    north: number;
    south: number;
    east: number;
    west: number;
}

/**
 * Keeps high-frequency viewport motion out of App state. Map overlays can
 * subscribe independently while expensive map/POI work continues on moveend.
 */
class MapViewportStore {
    private bounds: MapViewportBounds | null = null;
    private listeners = new Set<() => void>();

    getSnapshot = (): MapViewportBounds | null => this.bounds;

    subscribe = (listener: () => void) => {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    };

    setBounds(bounds: MapViewportBounds) {
        const previous = this.bounds;
        if (previous && previous.north === bounds.north && previous.south === bounds.south && previous.east === bounds.east && previous.west === bounds.west) return;
        this.bounds = bounds;
        this.listeners.forEach(listener => listener());
    }
}

export const mapViewportStore = new MapViewportStore();
