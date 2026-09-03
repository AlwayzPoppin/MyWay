/**
 * Map Skin Service
 * 
 * Provides map themes (skins) with automatic day/night solar transitions.
 * These are vector tile style URLs compatible with MapLibre GL.
 */

import { solarService } from './solarService';

export type MapSkinId = 'default' | 'warm_cream' | 'carbon-amber' | 'los-santos' | 'muted_slate' | 'midnight-amber' | 'gta_radar' | 'midnight_amber';

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
        description: 'Warm Cream by day, Carbon Amber by night (synced to sunrise/sunset)',
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
        id: 'carbon-amber',
        name: 'Carbon Amber',
        description: 'Tactical deep carbon ground with vivid amber freeways, warm gold arteries & ivory labels',
        styleUrl: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
        preview: '⚡',
        isPremium: false
    }
];

/**
 * Resolves dynamic skin ID to a concrete theme
 */
export const resolveMapSkinId = (id: MapSkinId | string, isDaylight?: boolean): MapSkinId => {
    if (id === 'los-santos' || id === 'muted_slate' || id === 'midnight-amber' || id === 'midnight_amber' || id === 'gta_radar') {
        return 'carbon-amber';
    }
    if (id !== 'default') {
        const found = MAP_SKINS.find(s => s.id === id);
        if (found) return found.id;
    }
    if (typeof isDaylight === 'boolean') {
        return isDaylight ? 'warm_cream' : 'carbon-amber';
    }
    return solarService.getSolarInfo().isDaylight ? 'warm_cream' : 'carbon-amber';
};

/**
 * Get a skin by ID with automatic solar day/night resolution
 */
export const getMapSkin = (id: MapSkinId | string, isDaylight?: boolean): MapSkin => {
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
    map: any,
    skinId: MapSkinId,
    _theme: 'light' | 'dark' = 'dark'
): void => {
    if (!map || !map.isStyleLoaded()) return;
    const isCarbonAmber = skinId === 'carbon-amber' || skinId === 'los-santos' || skinId === 'midnight-amber' || skinId === 'midnight_amber';

    if (isCarbonAmber) {
        const roadLabelLayerIds = [
            'roadname_minor', 'roadname_sec', 'roadname_pri', 'roadname_major',
            'myway-road-labels-major', 'myway-road-labels-minor',
            'road-label', 'street-labels', 'road_label'
        ];

        roadLabelLayerIds.forEach(id => {
            if (map.getLayer(id)) {
                try {
                    map.setLayoutProperty(id, 'visibility', 'visible');
                    map.setLayoutProperty(id, 'text-field', ['get', 'name']);
                    map.setLayoutProperty(id, 'text-font', ['Open Sans Regular', 'Arial Unicode MS Regular']);
                    map.setPaintProperty(id, 'text-color', '#fef9c3');
                    map.setPaintProperty(id, 'text-halo-color', '#000000');
                    map.setPaintProperty(id, 'text-halo-width', 2.8);
                    map.setPaintProperty(id, 'text-halo-blur', 0.5);
                } catch (e) {}
            }
        });
    }

    const layers = map.getStyle()?.layers || [];
    layers.forEach((l: any) => {
        if (isCarbonAmber && l.type === 'symbol' && (l['source-layer'] === 'transportation_name' || l.id.includes('roadname') || l.id.includes('road-label') || l.id.includes('street-label'))) {
            try {
                map.setLayoutProperty(l.id, 'visibility', 'visible');
                map.setLayoutProperty(l.id, 'text-field', ['get', 'name']);
                map.setLayoutProperty(l.id, 'text-font', ['Open Sans Regular', 'Arial Unicode MS Regular']);
                map.setPaintProperty(l.id, 'text-color', '#fef9c3');
                map.setPaintProperty(l.id, 'text-halo-color', '#000000');
                map.setPaintProperty(l.id, 'text-halo-width', 2.8);
                map.setPaintProperty(l.id, 'text-halo-blur', 0.5);
            } catch (e) {}
        } else if (l.id === 'housenumber' || l['source-layer'] === 'housenumber') {
            try {
                map.setLayoutProperty(l.id, 'visibility', 'visible');
                map.setPaintProperty(l.id, 'text-color', isCarbonAmber ? '#cccccc' : '#555555');
                map.setPaintProperty(l.id, 'text-halo-color', isCarbonAmber ? '#000000' : '#ffffff');
                map.setPaintProperty(l.id, 'text-halo-width', 2.0);
                map.setPaintProperty(l.id, 'text-halo-blur', 0.5);
            } catch (e) {}
        }
    });
};
