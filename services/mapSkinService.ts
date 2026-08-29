/**
 * Map Skin Service
 * 
 * Provides premium map themes (skins) for Platinum subscribers.
 * These are vector tile style URLs compatible with MapLibre GL.
 */

export type MapSkinId = 'default' | 'warm_cream' | 'muted_slate';

export interface MapSkin {
    id: MapSkinId;
    name: string;
    description: string;
    styleUrl: string; // MapLibre GL style JSON URL
    preview: string; // Emoji preview
    isPremium: boolean;
}

// CartoCSS-based free styles + custom color overrides
// For true custom skins, these would point to self-hosted style.json files
 
export const SATELLITE_STYLE = {
    version: 8,
    sources: {
        'satellite-tiles': {
            type: 'raster',
            tiles: [
                'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
            ],
            tileSize: 256,
            attribution: '© Esri — Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EBP, and the GIS User Community'
        }
    },
    layers: [
        {
            id: 'satellite',
            type: 'raster',
            source: 'satellite-tiles',
            minzoom: 0,
            maxzoom: 19
        }
    ]
};
 
export const TERRAIN_STYLE = {
    version: 8,
    sources: {
        'terrain-tiles': {
            type: 'raster',
            tiles: [
                'https://a.tile.opentopomap.org/{z}/{x}/{y}.png',
                'https://b.tile.opentopomap.org/{z}/{x}/{y}.png',
                'https://c.tile.opentopomap.org/{z}/{x}/{y}.png'
            ],
            tileSize: 256,
            attribution: 'Map data: © OpenStreetMap contributors, SRTM | Map style: © OpenTopoMap (CC-BY-SA)'
        }
    },
    layers: [
        {
            id: 'terrain',
            type: 'raster',
            source: 'terrain-tiles',
            minzoom: 0,
            maxzoom: 17
        }
    ]
};
export const MAP_SKINS: MapSkin[] = [
    {
        id: 'default',
        name: 'Auto / Dynamic',
        description: 'Warm Cream by day, Muted Slate by night',
        styleUrl: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
        preview: '🌓',
        isPremium: false
    },
    {
        id: 'warm_cream',
        name: 'Warm Cream',
        description: 'Bright warm daylight with soft cream & off-white ivory tones',
        styleUrl: 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json',
        preview: '☀️',
        isPremium: false
    },
    {
        id: 'muted_slate',
        name: 'Muted Slate',
        description: 'Sleek matte graphite & deep charcoal dark theme',
        styleUrl: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
        preview: '🌑',
        isPremium: false
    }
];

/**
 * Get a skin by ID
 */
export const getMapSkin = (id: MapSkinId): MapSkin => {
    return MAP_SKINS.find(s => s.id === id) || MAP_SKINS[0];
};

/**
 * Get all available skins for a user's membership tier
 */
export const getAvailableSkins = (isPlatinum: boolean): MapSkin[] => {
    if (isPlatinum) return MAP_SKINS;
    return MAP_SKINS.filter(s => !s.isPremium);
};

/**
 * Apply dynamic color overrides to a skin (Generative aspect)
 * This modifies the style at runtime for custom theming
 */
export const applySkinOverrides = (
    map: any, // maplibregl.Map
    skinId: MapSkinId,
    theme: 'light' | 'dark' = 'dark'
): void => {
    if (!map) return;

    // Custom paint overrides based on skin & theme
    const overrides: Record<MapSkinId, Record<string, any>> = {
        default: theme === 'dark' ? {
            'background': { 'background-color': '#111418' },
            'water': { 'fill-color': '#131922' },
            'park': { 'fill-color': '#161e18', 'fill-opacity': 0.8 },
            'road': { 'line-color': '#2a303c' }
        } : {},
        warm_cream: {},
        muted_slate: {
            'background': { 'background-color': '#111418' },
            'water': { 'fill-color': '#131922' },
            'park': { 'fill-color': '#161e18', 'fill-opacity': 0.8 },
            'road': { 'line-color': '#2a303c' }
        }
    };

    const skinOverrides = overrides[skinId];
    if (!skinOverrides) return;

    // Apply overrides after style loads
    const applyToMap = () => {
        try {
            const layers = map.getStyle()?.layers || [];
            Object.entries(skinOverrides).forEach(([layerPrefix, props]) => {
                layers.forEach((layer: any) => {
                    if (layer.id.toLowerCase().includes(layerPrefix)) {
                        Object.entries(props).forEach(([prop, value]) => {
                            try {
                                map.setPaintProperty(layer.id, prop, value);
                            } catch {
                                // Ignore non-applicable properties for specific layer types
                            }
                        });
                    }
                });
            });
        } catch (e) {
            console.warn('[applySkinOverrides] Notice:', e);
        }
    };

    if (map.isStyleLoaded()) {
        applyToMap();
    } else {
        map.once('style.load', applyToMap);
    }
};
