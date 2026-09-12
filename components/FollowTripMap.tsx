import React, { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import { SharedTrip } from '../services/sharedTripService';

export default function FollowTripMap({ trip }: { trip: SharedTrip }) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const marker = useRef<maplibregl.Marker | null>(null);
  useEffect(() => {
    if (!container.current) return;
    const view = new maplibregl.Map({ container: container.current,
      style: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
      center: [trip.destinationLocation.lng, trip.destinationLocation.lat], zoom: 12 });
    map.current = view;
    view.on('load', () => {
      const coordinates = JSON.parse(trip.geometry) as [number, number][];
      view.addSource('trip', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } } });
      view.addLayer({ id: 'trip', type: 'line', source: 'trip', paint: { 'line-color': '#7c3aed', 'line-width': 5 } });
      if (coordinates.length > 1) {
        const bounds = new maplibregl.LngLatBounds();
        coordinates.forEach(point => bounds.extend(point));
        view.fitBounds(bounds, { padding: 40, maxZoom: 16, duration: 0 });
      }
      new maplibregl.Marker({ color: '#7c3aed' }).setLngLat([trip.destinationLocation.lng, trip.destinationLocation.lat]).addTo(view);
    });
    return () => { marker.current = null; map.current = null; view.remove(); };
  }, [trip.id, trip.geometry]);
  useEffect(() => {
    if (!map.current || !trip.location) return;
    if (!marker.current) marker.current = new maplibregl.Marker({ color: '#0284c7' })
      .setLngLat([trip.location.lng, trip.location.lat]).addTo(map.current);
    marker.current.setLngLat([trip.location.lng, trip.location.lat]);
  }, [trip.location, trip.geometry]);
  return <div ref={container} className="h-[40vh] min-h-48 w-full rounded-xl" aria-label="Shared trip route map" />;
}
