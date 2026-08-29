/**
 * Map Skin Service
 * 
 * Provides premium map themes (skins) for Platinum subscribers.
 * These are vector tile style URLs compatible with MapLibre GL.
 */

export type MapSkinId = 'default' | 'cyberpunk' | 'sunset' | 'midnight' | 'arctic' | 'forest';

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
        name: 'Muted Slate',
        description: 'Sophisticated matte slate & graphite dark aesthetic',
        styleUrl: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
        preview: '🌑',
        isPremium: false
    },
    {
        id: 'midnight',
        name: 'Midnight Onyx',
        description: 'Deep dark mode with stealth contours',
        styleUrl: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
        preview: '🌙',
        isPremium: false
    },
    {
        id: 'cyberpunk',
        name: 'Cyberpunk',
        description: 'Neon-soaked futuristic city vibes',
        styleUrl: 'https://basemaps.cartocdn.com/gl/dark-matter-nolabels-gl-style/style.json',
        preview: '🌆',
        isPremium: true
    },
    {
        id: 'sunset',
        name: 'Sunset',
        description: 'Warm golden hour aesthetic',
        styleUrl: 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json',
        preview: '🌅',
        isPremium: true
    },
    {
        id: 'arctic',
        name: 'Arctic',
        description: 'Cool blue tones, icy clarity',
        styleUrl: 'https://basemaps.cartocdn.com/gl/positron-nolabels-gl-style/style.json',
        preview: '❄️',
        isPremium: true
    },
    {
        id: 'forest',
        name: 'Forest',
        description: 'Natural greens and earth tones',
        styleUrl: 'https://basemaps.cartocdn.com/gl/voyager-nolabels-gl-style/style.json',
        preview: '🌲',
        isPremium: true
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
    skinId: MapSkinId
): void => {
    if (!map) return;

    // Custom paint overrides based on skin
    const overrides: Record<MapSkinId, Record<string, any>> = {
        default: {
            'background': { 'background-color': '#111418' },
            'water': { 'fill-color': '#131922' },
            'park': { 'fill-color': '#161e18', 'fill-opacity': 0.8 },
            'landuse': { 'fill-color': '#14181f' },
            'road': { 'line-color': '#2a303c' },
            'tunnel': { 'line-color': '#1e232c' },
            'bridge': { 'line-color': '#333b49' },
            'building': { 'fill-color': '#1c2128', 'fill-extrusion-color': '#202630' }
        },
        midnight: {
            'building': { 'fill-extrusion-color': '#161920', 'fill-extrusion-opacity': 0.95 },
            'water': { 'fill-color': '#0f141d' }
        },
        cyberpunk: {
            'building': { 'fill-extrusion-color': '#0f0f23', 'fill-extrusion-opacity': 0.95 },
            'water': { 'fill-color': '#0a192f' },
        },
        sunset: {
            'building': { 'fill-extrusion-color': '#2d1b0e', 'fill-extrusion-opacity': 0.95 },
        },
        arctic: {
            'building': { 'fill-extrusion-color': '#e0f2fe', 'fill-extrusion-opacity': 0.95 },
        },
        forest: {
            'building': { 'fill-extrusion-color': '#1a2e1a', 'fill-extrusion-opacity': 0.95 },
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
