import React, { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { FamilyMember } from '../types';
import { MapSkinId, getMapSkin, applySkinOverrides } from '../services/mapSkinService';

interface MapLibre3DViewProps {
    members: FamilyMember[];
    theme: 'light' | 'dark';
    mapSkin?: MapSkinId;
    selectedMemberId?: string | null;
    center?: [number, number]; // [lng, lat]
    zoom?: number;
    onUserInteraction?: () => void;
}

const MapLibre3DView: React.FC<MapLibre3DViewProps> = ({
    members,
    theme,
    mapSkin = 'default',
    selectedMemberId,
    center = [-80.8431, 35.2271], // NC default (Charlotte)
    zoom = 16,
    onUserInteraction
}) => {
    const mapContainer = useRef<HTMLDivElement>(null);
    const map = useRef<maplibregl.Map | null>(null);
    const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map());

    // Get the skin style URL
    // If skin is default, respect the app theme (Light/Dark)
    const skin = getMapSkin(mapSkin);
    let styleUrl = skin.styleUrl;

    if (mapSkin === 'default' && theme === 'dark') {
        styleUrl = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
    }

    useEffect(() => {
        if (!mapContainer.current || map.current) return;

        map.current = new maplibregl.Map({
            container: mapContainer.current,
            style: styleUrl,
            center: center,
            zoom: zoom,
            pitch: 60, // Tilt for 3D effect
            bearing: -17.6, // Rotation
            antialias: true
        });

        map.current.on('load', () => {
            if (!map.current) return;

            // Apply skin-specific color overrides
            applySkinOverrides(map.current, mapSkin);

            // CartoCSS styles don't have building heights, so we add a fill-extrusion layer
            // with procedural heights based on the building geometry
            const layers = map.current.getStyle().layers || [];

            // Find existing building layer
            const buildingLayer = layers.find(
                (layer: any) => layer.id.includes('building') && layer.type === 'fill'
            );

            if (buildingLayer) {
                // Get the source and source-layer from existing building layer
                const source = (buildingLayer as any).source;
                const sourceLayer = (buildingLayer as any)['source-layer'];

                // Add 3D extrusion layer before labels
                const labelLayerId = layers.find(
                    (layer: any) => layer.type === 'symbol' && layer.layout?.['text-field']
                )?.id;

                // Remove old flat building layer
                map.current.setLayoutProperty(buildingLayer.id, 'visibility', 'none');

                // Add new 3D building layer
                map.current.addLayer({
                    'id': 'buildings-3d',
                    'source': source,
                    'source-layer': sourceLayer,
                    'type': 'fill-extrusion',
                    'minzoom': 13,
                    'paint': {
                        'fill-extrusion-color': [
                            'interpolate', ['linear'], ['zoom'],
                            15, theme === 'dark' ? '#1e293b' : '#cbd5e1',
                            17, theme === 'dark' ? '#334155' : '#94a3b8'
                        ],
                        'fill-extrusion-height': [
                            'interpolate', ['linear'], ['zoom'],
                            14, 0,
                            15, ['case',
                                ['has', 'render_height'], ['get', 'render_height'],
                                ['has', 'height'], ['get', 'height'],
                                ['has', 'levels'], ['*', ['get', 'levels'], 3],
                                10 // Fallback for residential/unknown info
                            ],
                            17, ['case',
                                ['has', 'render_height'], ['*', ['get', 'render_height'], 1.5],
                                ['has', 'height'], ['*', ['get', 'height'], 1.5],
                                ['has', 'levels'], ['*', ['get', 'levels'], 4.5], // Exaggerate height slightly for effect
                                20 // Fallback
                            ]
                        ],
                        'fill-extrusion-base': [
                            'case',
                            ['has', 'render_min_height'], ['get', 'render_min_height'],
                            ['has', 'min_height'], ['get', 'min_height'],
                            0
                        ],
                        'fill-extrusion-opacity': 0.85
                    }
                }, labelLayerId);

                console.log('[3D] Added extrusion layer:', { source, sourceLayer, theme });

                // Diagnostic: Check if we actually have data
                map.current.on('sourcedata', (e) => {
                    if (e.isSourceLoaded && e.sourceId === source) {
                        const features = map.current?.querySourceFeatures(source, { sourceLayer });
                        if (features && features.length > 0) {
                            console.log('[3D] Sample feature properties:', features[0].properties);
                        }
                    }
                });
            } else {
                console.log('No building layer found in style, 3D buildings disabled');
            }

            console.log(`MapLibre 3D initialized with skin: ${mapSkin}, pitch: ${map.current.getPitch()}`);
        });

        // Track user interaction
        map.current.on('dragstart', () => onUserInteraction?.());
        map.current.on('zoomstart', () => onUserInteraction?.());

        // Add navigation controls
        map.current.addControl(new maplibregl.NavigationControl(), 'bottom-right');

        return () => {
            map.current?.remove();
            map.current = null;
        };
    }, [styleUrl, mapSkin]);

    // Update member markers
    useEffect(() => {
        if (!map.current) return;

        members.forEach(member => {
            const position: [number, number] = [member.location.lng, member.location.lat];

            if (markersRef.current.has(member.id)) {
                // Update existing marker
                markersRef.current.get(member.id)?.setLngLat(position);
            } else {
                // Create new marker with avatar
                const el = document.createElement('div');
                el.className = 'maplibre-member-marker';
                el.style.cssText = `
          width: 48px;
          height: 48px;
          border-radius: 50%;
          border: 3px solid ${member.status === 'Driving' ? '#6366f1' : '#22c55e'};
          background-image: url(${member.avatar});
          background-size: cover;
          box-shadow: 0 4px 12px rgba(0,0,0,0.4);
          cursor: pointer;
        `;

                const marker = new maplibregl.Marker({ element: el })
                    .setLngLat(position)
                    .addTo(map.current!);

                markersRef.current.set(member.id, marker);
            }
        });

        // Cleanup old markers
        markersRef.current.forEach((marker, id) => {
            if (!members.find(m => m.id === id)) {
                marker.remove();
                markersRef.current.delete(id);
            }
        });
    }, [members]);

    // Fly to first member on mount
    useEffect(() => {
        if (map.current && members.length > 0) {
            const you = members.find(m => m.name === 'You') || members[0];
            map.current.flyTo({
                center: [you.location.lng, you.location.lat],
                zoom: 17,
                pitch: 60,
                bearing: 0,
                duration: 2000
            });
        }
    }, [members.length > 0]);

    // Fly to selected member when selectedMemberId changes
    useEffect(() => {
        if (!map.current || !selectedMemberId) return;

        const member = members.find(m => m.id === selectedMemberId);
        if (member) {
            map.current.flyTo({
                center: [member.location.lng, member.location.lat],
                zoom: 17,
                pitch: 60,
                bearing: 0,
                duration: 1500
            });
        }
    }, [selectedMemberId, members]);

    return (
        <div
            ref={mapContainer}
            className="w-full h-full"
            style={{ minHeight: '100vh' }}
        />
    );
};

export default MapLibre3DView;
