/**
 * Map Skin Service
 * 
 * Provides map themes (skins) with automatic day/night solar transitions.
 * These are vector tile style URLs compatible with MapLibre GL.
 */

import { solarService } from './solarService';

export type MapSkinId = 'default' | 'warm_cream' | 'muted_slate' | 'gta_radar';

export interface MapSkin {
    id: MapSkinId;
    name: string;
    description: string;
    styleUrl: string; // MapLibre GL style JSON URL
    preview: string; // Emoji preview
    isPremium: boolean;
}

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
        name: 'Auto Solar Transition',
        description: 'Warm Cream by day, Muted Slate by night (synced to sunrise/sunset)',
        styleUrl: 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json',
        preview: '🌓',
        isPremium: false
    },
    {
        id: 'warm_cream',
        name: 'Warm Cream (Day)',
        description: 'Bright warm daylight with soft cream & off-white ivory tones',
        styleUrl: 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json',
        preview: '☀️',
        isPremium: false
    },
    {
        id: 'muted_slate',
        name: 'Muted Slate (Night)',
        description: 'Sleek matte graphite & deep charcoal dark theme',
        styleUrl: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
        preview: '🌑',
        isPremium: false
    },
    {
        id: 'gta_radar',
        name: 'Los Santos (GTA)',
        description: 'GTA V radar style with amber freeways, asphalt & golden GPS route',
        styleUrl: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
        preview: '🕹️',
        isPremium: false
    }
];

/**
 * Resolves dynamic skin ID to a concrete theme
 */
export const resolveMapSkinId = (id: MapSkinId, isDaylight?: boolean): MapSkinId => {
    if (id !== 'default') return id;
    if (typeof isDaylight === 'boolean') {
        return isDaylight ? 'warm_cream' : 'muted_slate';
    }
    return solarService.getSolarInfo().isDaylight ? 'warm_cream' : 'muted_slate';
};

/**
 * Get a skin by ID with automatic solar day/night resolution
 */
export const getMapSkin = (id: MapSkinId, isDaylight?: boolean): MapSkin => {
    const resolvedId = resolveMapSkinId(id, isDaylight);
    return MAP_SKINS.find(s => s.id === resolvedId) || MAP_SKINS[1];
};

/**
 * Get all available skins for a user's membership tier
 */
export const getAvailableSkins = (isPlatinum: boolean): MapSkin[] => {
    if (isPlatinum) return MAP_SKINS;
    return MAP_SKINS.filter(s => !s.isPremium);
};

/**
 * Apply dynamic color overrides to a skin
 */
export const applySkinOverrides = (
    _map: any,
    _skinId: MapSkinId,
    _theme: 'light' | 'dark' = 'dark'
): void => {
    // Handled natively by vector tile styles
};
