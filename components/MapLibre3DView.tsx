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
    activeRoute?: any; // NavigationRoute | null
    places?: any[]; // Place[]
    incidents?: any[]; // IncidentReport[]
    privacyZones?: any[]; // PrivacyZone[]
}

const MapLibre3DView: React.FC<MapLibre3DViewProps> = ({
    members,
    theme,
    mapSkin = 'default',
    selectedMemberId,
    center = [-80.8431, 35.2271], // NC default (Charlotte)
    zoom = 16,
    onUserInteraction,
    activeRoute,
    places = [],
    incidents = [],
    privacyZones = []
}) => {
    const mapContainer = useRef<HTMLDivElement>(null);
    const map = useRef<maplibregl.Map | null>(null);
    const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
    const [isMapReady, setIsMapReady] = React.useState(false);
    const placesMarkersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
    const incidentsMarkersRef = useRef<Map<string, maplibregl.Marker>>(new Map());

    // Get the skin style URL
    // If skin is default, respect the app theme (Light/Dark)
    const skin = getMapSkin(mapSkin as MapSkinId);
    let styleUrl = skin.styleUrl;

    if (mapSkin === 'default' && theme === 'dark') {
        styleUrl = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
    }

    useEffect(() => {
        if (!mapContainer.current || map.current) return;

        map.current = new maplibregl.Map({
            container: mapContainer.current,
            style: styleUrl,
            center: center as [number, number],
            zoom: zoom,
            pitch: 60, // Tilt for 3D effect
            bearing: -17.6, // Rotation
        });

        map.current.on('load', () => {
            if (!map.current) return;

            // Apply skin-specific color overrides
            applySkinOverrides(map.current, mapSkin as MapSkinId);

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
                    }
                });
            }

            setIsMapReady(true);
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

    // Update Route Line
    useEffect(() => {
        if (!map.current || !isMapReady) return;

        const routeId = 'active-route-line';
        const routeData = activeRoute && activeRoute.steps ? {
            'type': 'Feature',
            'properties': {},
            'geometry': {
                'type': 'LineString',
                'coordinates': [
                    [activeRoute.startLoc?.lng || activeRoute.steps[0]?.startLocation?.lng || center[0],
                    activeRoute.startLoc?.lat || activeRoute.steps[0]?.startLocation?.lat || center[1]],
                    ...activeRoute.steps.filter((s: any) => s.endLocation).map((s: any) => [s.endLocation.lng, s.endLocation.lat]),
                    [activeRoute.destinationLoc.lng, activeRoute.destinationLoc.lat]
                ]
            }
        } : null;

        if (map.current.getSource(routeId)) {
            (map.current.getSource(routeId) as maplibregl.GeoJSONSource).setData(routeData as any || { type: 'FeatureCollection', features: [] });
        } else if (routeData) {
            map.current.addSource(routeId, {
                'type': 'geojson',
                'data': routeData as any
            });

            map.current.addLayer({
                'id': routeId,
                'type': 'line',
                'source': routeId,
                'layout': {
                    'line-join': 'round',
                    'line-cap': 'round'
                },
                'paint': {
                    'line-color': '#6366f1',
                    'line-width': 8,
                    'line-opacity': 0.8
                }
            });

            // Add a glow effect
            map.current.addLayer({
                'id': `${routeId}-glow`,
                'type': 'line',
                'source': routeId,
                'layout': {
                    'line-join': 'round',
                    'line-cap': 'round'
                },
                'paint': {
                    'line-color': '#818cf8',
                    'line-width': 12,
                    'line-opacity': 0.3
                }
            }, routeId);
        }
    }, [activeRoute, map.current?.isStyleLoaded()]);

    // Update Places Markers
    useEffect(() => {
        if (!map.current) return;

        places.forEach(place => {
            if (!placesMarkersRef.current.has(place.id)) {
                const el = document.createElement('div');
                el.className = 'maplibre-place-marker';
                el.innerHTML = `<div style="font-size: 24px;">${place.icon}</div>`;
                el.style.cursor = 'pointer';

                const marker = new maplibregl.Marker({ element: el })
                    .setLngLat([place.location.lng, place.location.lat])
                    .setPopup(new maplibregl.Popup({ offset: 25 }).setHTML(`<b>${place.name}</b>`))
                    .addTo(map.current!);

                placesMarkersRef.current.set(place.id, marker);
            }
        });

        // Cleanup
        placesMarkersRef.current.forEach((marker, id) => {
            if (!places.find(p => p.id === id)) {
                marker.remove();
                placesMarkersRef.current.delete(id);
            }
        });
    }, [places]);

    // Update Incident Markers
    useEffect(() => {
        if (!map.current) return;

        incidents.forEach(incident => {
            if (!incidentsMarkersRef.current.has(incident.id)) {
                const el = document.createElement('div');
                el.className = 'maplibre-incident-marker';
                el.innerHTML = `<div style="font-size: 24px; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.5))">⚠️</div>`;
                el.style.cursor = 'pointer';

                const marker = new maplibregl.Marker({ element: el })
                    .setLngLat([incident.location.lng, incident.location.lat])
                    .setPopup(new maplibregl.Popup({ offset: 25 }).setHTML(`<b>${incident.type.toUpperCase()}</b>`))
                    .addTo(map.current!);

                incidentsMarkersRef.current.set(incident.id, marker);
            }
        });

        // Cleanup
        incidentsMarkersRef.current.forEach((marker, id) => {
            if (!incidents.find(i => i.id === id)) {
                marker.remove();
                incidentsMarkersRef.current.delete(id);
            }
        });
    }, [incidents]);

    // Update Privacy Zones
    useEffect(() => {
        if (!map.current || !isMapReady) return;

        privacyZones.forEach(zone => {
            const sourceId = `privacy-zone-${zone.id}`;
            if (!map.current?.getSource(sourceId)) {
                // Simple circular approximation with 64 points
                const points = 64;
                const radius = zone.radius || 0.1; // km
                const coords = [];
                const distanceX = radius / (111.32 * Math.cos(zone.location.lat * Math.PI / 180));
                const distanceY = radius / 110.574;

                for (let i = 0; i < points; i++) {
                    const theta = (i / points) * (2 * Math.PI);
                    const x = distanceX * Math.cos(theta);
                    const y = distanceY * Math.sin(theta);
                    coords.push([zone.location.lng + x, zone.location.lat + y]);
                }
                coords.push(coords[0]);

                map.current?.addSource(sourceId, {
                    'type': 'geojson',
                    'data': {
                        'type': 'Feature',
                        'geometry': {
                            'type': 'Polygon',
                            'coordinates': [coords]
                        },
                        'properties': {}
                    }
                });

                map.current?.addLayer({
                    'id': sourceId,
                    'type': 'fill',
                    'source': sourceId,
                    'paint': {
                        'fill-color': '#6366f1',
                        'fill-opacity': 0.2
                    }
                });
            }
        });
    }, [privacyZones, map.current?.isStyleLoaded()]);

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

    // Fly to center when it changes (e.g. from search)
    useEffect(() => {
        if (!map.current || !center) return;

        // Check if we are already roughly at the center to avoid infinite loops or jitter
        const currentCenter = map.current.getCenter();
        const dist = Math.sqrt(Math.pow(currentCenter.lng - center[0], 2) + Math.pow(currentCenter.lat - center[1], 2));

        if (dist > 0.0001) { // Only fly if the change is significant
            map.current.flyTo({
                center: center,
                zoom: 17,
                pitch: 60,
                duration: 2000
            });
        }
    }, [center]);

    return (
        <div
            ref={mapContainer}
            className="w-full h-full"
            style={{ minHeight: '100vh' }}
        />
    );
};

export default React.memo(MapLibre3DView);
