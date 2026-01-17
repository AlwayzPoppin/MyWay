import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { FamilyMember, Place, NavigationRoute, CircleTask, IncidentReport, PrivacyZone } from '../types';

interface MapViewProps {
  members: FamilyMember[];
  places: Place[];
  tasks: CircleTask[];
  incidents: IncidentReport[];
  privacyZones?: PrivacyZone[];
  selectedMemberId: string | null;
  activeRoute: NavigationRoute | null;
  isNavigating: boolean;
  theme: 'light' | 'dark';
  onSelectPlace?: (place: Place) => void;
  onSelectMember?: (memberId: string) => void;
  onBoundsChange?: (bounds: { north: number; south: number; east: number; west: number }) => void;
  onUserInteraction?: () => void;
  is3DMode?: boolean;
}

// Status-based halo colors with battery awareness
const getStatusHalo = (member: FamilyMember, isGold: boolean) => {
  if (member.isGhostMode) return { color: '#6b7280', animation: 'none', isLowBattery: false };

  // Low battery = RED warning glow with pulse
  if (member.battery <= 15) {
    return {
      color: '#ef4444',
      animation: 'battery-flicker 1s ease-in-out infinite',
      isLowBattery: true
    };
  }

  if (isGold) return { color: '#f59e0b', animation: 'gold-pulse 2s ease-in-out infinite', isLowBattery: false };

  switch (member.status) {
    case 'Driving':
      return { color: '#6366f1', animation: 'driving-pulse 1.5s ease-in-out infinite', isLowBattery: false };
    case 'Moving':
      return { color: '#22c55e', animation: 'moving-pulse 2s ease-in-out infinite', isLowBattery: false };
    case 'Stationary':
      return { color: '#94a3b8', animation: 'none', isLowBattery: false };
    case 'Offline':
      return { color: '#374151', animation: 'none', isLowBattery: false };
    default:
      return { color: '#22c55e', animation: 'none', isLowBattery: false };
  }
};

// Create member marker with status halo and 3D depth
const createMemberMarker = (member: FamilyMember, isGold: boolean, is3D: boolean = false) => {
  const halo = getStatusHalo(member, isGold);
  const isYou = member.name === 'You';
  const isMoving = member.status === 'Driving' || member.status === 'Moving';

  // 3D shadow for depth effect
  const shadowStyle = `
    filter: drop-shadow(0 8px 16px rgba(0,0,0,0.4)) drop-shadow(0 4px 6px rgba(0,0,0,0.3));
  `;

  return L.divIcon({
    className: 'custom-marker',
    html: `
      <div style="
        position: relative; 
        width: 72px; 
        height: 72px; 
        ${shadowStyle}
        transform: ${is3D ? 'rotateX(-45deg) scale(1.1) translateY(-10px)' : 'none'};
        transform-origin: bottom center;
        transition: transform 0.5s ease;
      ">
        <!-- Outer status halo (animated ring) -->
        ${!member.isGhostMode ? `
          <div style="
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            width: 64px;
            height: 64px;
            border-radius: 50%;
            border: 3px solid ${halo.color};
            opacity: 0.6;
            animation: ${halo.animation};
          "></div>
          <!-- Inner glow ring -->
          <div style="
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            width: 56px;
            height: 56px;
            border-radius: 50%;
            background: radial-gradient(circle, ${halo.color}33 0%, transparent 70%);
            ${isMoving ? 'animation: breathe 2s ease-in-out infinite;' : ''}
          "></div>
        ` : ''}
        
        <!-- Avatar container with 3D effect -->
        <div style="
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          width: 52px;
          height: 52px;
          border-radius: 50%;
          border: 3px solid ${member.battery <= 20 ? '#ef4444' : (isMoving ? '#22c55e' : '#ffffff')};
          box-shadow: 0 0 0 2px ${halo.color}, 0 4px 12px rgba(0,0,0,0.5);
          overflow: hidden;
          background: linear-gradient(135deg, #1e293b, #0f172a);
          ${member.isGhostMode ? 'opacity: 0.4; filter: blur(1px) grayscale(50%);' : ''}
        ">
          <img 
            src="${member.avatar}" 
            style="width: 100%; height: 100%; object-fit: cover;" 
            onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><rect fill=%22%231e293b%22 width=%22100%22 height=%22100%22/><text x=%2250%22 y=%2255%22 text-anchor=%22middle%22 fill=%22white%22 font-size=%2240%22>${member.name[0]}</text></svg>'"
          />
        </div>
        
        <!-- Premium badge -->
        ${isGold ? `
          <div style="
            position: absolute;
            top: 2px;
            right: 2px;
            width: 20px;
            height: 20px;
            background: linear-gradient(135deg, #fbbf24, #f59e0b);
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 10px;
            box-shadow: 0 2px 8px rgba(245,158,11,0.5);
            border: 2px solid #0f172a;
          ">👑</div>
        ` : ''}
        
        <!-- "YOU" badge -->
        ${isYou ? `
          <div style="
            position: absolute;
            bottom: -2px;
            left: 50%;
            transform: translateX(-50%);
            background: linear-gradient(135deg, #6366f1, #8b5cf6);
            color: white;
            font-size: 9px;
            font-weight: 800;
            padding: 2px 8px;
            border-radius: 10px;
            white-space: nowrap;
            letter-spacing: 0.5px;
            box-shadow: 0 2px 8px rgba(99,102,241,0.4);
            border: 2px solid #0f172a;
          ">YOU</div>
        ` : ''}
        
        <!-- Speed indicator for moving members -->
        ${isMoving && member.speed > 0 ? `
          <div style="
            position: absolute;
            top: auto;
            bottom: -12px;
            left: 50%;
            transform: translateX(-50%);
            background: ${member.status === 'Driving' ? '#4f46e5' : '#16a34a'};
            color: white;
            font-size: 11px;
            font-weight: 800;
            padding: 2px 8px;
            border-radius: 12px;
            box-shadow: 0 4px 8px rgba(0,0,0,0.2);
            z-index: 20;
            white-space: nowrap;
            border: 2px solid white;
          ">
            ${Math.round(member.speed)} mph
          </div>
        ` : ''}
      </div>
    `,
    iconSize: [72, 72],
    iconAnchor: [36, 36]
  });
};

// Create place marker
const createPlaceMarker = (place: Place) => {
  const isSponsored = place.type === 'sponsored';
  return L.divIcon({
    className: 'place-marker',
    html: `
      <div style="
        position: relative;
        width: 48px;
        height: 48px;
        filter: drop-shadow(0 4px 12px rgba(0,0,0,0.3));
        cursor: pointer;
        pointer-events: auto;
      ">
        ${isSponsored ? `
          <div style="
            position: absolute;
            inset: -4px;
            border-radius: 16px;
            background: linear-gradient(135deg, #fbbf2444, #f59e0b44);
            animation: sponsor-glow 2s ease-in-out infinite;
          "></div>
        ` : ''}
        <div style="
          position: absolute;
          inset: 0;
          border-radius: 14px;
          background: ${isSponsored ? 'linear-gradient(135deg, #1a1a2e, #16213e)' : '#1e293b'};
          border: 2px solid ${isSponsored ? '#fbbf24' : 'rgba(255,255,255,0.1)'};
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 24px;
        ">
          ${place.icon}
        </div>
      </div>
    `,
    iconSize: [48, 48],
    iconAnchor: [24, 24]
  });
};

// --- CLUSTERING HELPER ---
interface Cluster {
  id: string;
  lat: number;
  lng: number;
  members: FamilyMember[];
}

const getClusters = (members: FamilyMember[], zoom: number): Cluster[] => {
  const clusters: Cluster[] = [];
  const threshold = 0.0001 * Math.pow(2, 20 - zoom); // Dynamic threshold based on zoom

  members.forEach(member => {
    let added = false;
    for (const cluster of clusters) {
      if (Math.abs(cluster.lat - member.location.lat) < threshold &&
        Math.abs(cluster.lng - member.location.lng) < threshold) {
        cluster.members.push(member);
        // Average position
        cluster.lat = (cluster.lat * (cluster.members.length - 1) + member.location.lat) / cluster.members.length;
        cluster.lng = (cluster.lng * (cluster.members.length - 1) + member.location.lng) / cluster.members.length;
        added = true;
        break;
      }
    }
    if (!added) {
      clusters.push({
        id: `cluster-${member.id}`,
        lat: member.location.lat,
        lng: member.location.lng,
        members: [member]
      });
    }
  });

  return clusters;
};

// Create cluster marker icon
const createClusterMarker = (cluster: Cluster) => {
  return L.divIcon({
    className: 'cluster-marker',
    html: `
      <div style="
        width: 48px; height: 48px;
        background: rgba(30, 41, 59, 0.9);
        border: 2px solid #fbbf24;
        border-radius: 50%;
        display: flex; align-items: center; justify-content: center;
        color: white; font-weight: bold;
        box-shadow: 0 4px 12px rgba(0,0,0,0.5);
      ">
        ${cluster.members.length}
      </div>
    `,
    iconSize: [48, 48],
    iconAnchor: [24, 24]
  });
};

const MapView: React.FC<MapViewProps> = ({
  members,
  places,
  tasks,
  incidents,
  privacyZones,
  selectedMemberId,
  activeRoute,
  isNavigating,
  theme,
  onSelectPlace,
  onSelectMember,
  onBoundsChange,
  onUserInteraction,
  is3DMode = false
}) => {
  const mapRef = useRef<L.Map | null>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const markersRef = useRef<Map<string, L.Marker>>(new Map());
  const trailsRef = useRef<Map<string, L.Polyline>>(new Map());
  const [mapReady, setMapReady] = useState(false);

  // Initialize map
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const defaultCenter: [number, number] = [35.2271, -80.8431];

    mapRef.current = L.map(mapContainerRef.current, {
      center: defaultCenter,
      zoom: 12,
      zoomControl: false,
      attributionControl: false
    });

    const tileUrl = theme === 'dark'
      ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
      : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';

    L.tileLayer(tileUrl, { maxZoom: 19 }).addTo(mapRef.current);
    L.control.zoom({ position: 'bottomright' }).addTo(mapRef.current);

    // Emit bounds when map moves
    mapRef.current.on('moveend', () => {
      if (mapRef.current && onBoundsChange) {
        const bounds = mapRef.current.getBounds();
        onBoundsChange({
          north: bounds.getNorth(),
          south: bounds.getSouth(),
          east: bounds.getEast(),
          west: bounds.getWest()
        });
      }
    });

    // Detect user interaction to stop auto-following
    mapRef.current.on('dragstart', () => {
      onUserInteraction?.();
    });
    mapRef.current.on('zoomstart', () => {
      onUserInteraction?.();
    });

    setTimeout(() => {
      setMapReady(true);
      // Emit initial bounds
      if (mapRef.current && onBoundsChange) {
        const bounds = mapRef.current.getBounds();
        onBoundsChange({
          north: bounds.getNorth(),
          south: bounds.getSouth(),
          east: bounds.getEast(),
          west: bounds.getWest()
        });
      }
    }, 100);

    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
      setMapReady(false);
    };
  }, []);

  // Update tile layer on theme change
  useEffect(() => {
    if (!mapRef.current) return;

    mapRef.current.eachLayer((layer) => {
      if (layer instanceof L.TileLayer) {
        mapRef.current?.removeLayer(layer);
      }
    });

    const tileUrl = theme === 'dark'
      ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
      : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';

    L.tileLayer(tileUrl, { maxZoom: 19 }).addTo(mapRef.current);
  }, [theme]);

  // Update member markers (CLUSTERING ENABLED)
  useEffect(() => {
    if (!mapRef.current || !mapReady) return;

    // Get current zoom for clustering - simpler than listening to zoomend for now
    const zoom = mapRef.current.getZoom();
    const clusters = getClusters(members, zoom);

    // Clear markers not in new clusters (simple diff)
    // For this optimization, we'll do a full refresh if count changes to avoid complex diffing logic in this phase
    // In a prod app, we'd use a robust diff or Leaflet.markercluster

    // Iterate clusters
    clusters.forEach(cluster => {
      // If single member, use standard logic
      if (cluster.members.length === 1) {
        const member = cluster.members[0];
        const isGold = member.membershipTier === 'gold' || member.membershipTier === 'platinum';
        const position: [number, number] = [member.location.lat, member.location.lng];

        if (markersRef.current.has(cluster.id)) {
          const marker = markersRef.current.get(cluster.id)!;
          marker.setLatLng(position);
          marker.setIcon(createMemberMarker(member, isGold, is3DMode));
        } else {
          const marker = L.marker(position, {
            icon: createMemberMarker(member, isGold, is3DMode),
            zIndexOffset: member.name === 'You' ? 1000 : 0
          }).addTo(mapRef.current!);
          marker.on('click', () => onSelectMember?.(member.id));
          markersRef.current.set(cluster.id, marker);
        }
      } else {
        // Render Cluster
        const position: [number, number] = [cluster.lat, cluster.lng];
        if (markersRef.current.has(cluster.id)) {
          const marker = markersRef.current.get(cluster.id)!;
          marker.setLatLng(position);
          marker.setIcon(createClusterMarker(cluster));
        } else {
          const marker = L.marker(position, {
            icon: createClusterMarker(cluster),
            zIndexOffset: 500
          }).addTo(mapRef.current!);
          marker.on('click', () => {
            mapRef.current?.flyTo(position, mapRef.current.getZoom() + 2);
          });
          markersRef.current.set(cluster.id, marker);
        }
      }
    });

    // Cleanup old keys
    const newKeys = new Set(clusters.map(c => c.id));
    markersRef.current.forEach((marker, id) => {
      if (!newKeys.has(id)) {
        marker.remove();
        markersRef.current.delete(id);
      }
    });

    // Trails logic remains separate (omitted for brevity in this specific patch, assuming trails work on member IDs)
    // Note: Trails might look weird if clustered, but usually clusters happen at low zoom where trails are less visible
  }, [members, mapReady, onSelectMember, is3DMode]);


  // Update place markers
  useEffect(() => {
    if (!mapRef.current || !mapReady) return;

    places.forEach(place => {
      const markerId = `place-${place.id}`;
      const position: [number, number] = [place.location.lat, place.location.lng];

      if (!markersRef.current.has(markerId)) {
        const marker = L.marker(position, {
          icon: createPlaceMarker(place)
        }).addTo(mapRef.current!);

        marker.on('click', () => onSelectPlace?.(place));
        markersRef.current.set(markerId, marker);
      }
    });
  }, [places, mapReady, onSelectPlace]);

  // NOTE: 3D Buildings are now handled by MapLibre3DView component
  // This MapView is only used for 2D mode

  // Center on selected member with smooth animation
  useEffect(() => {
    if (!mapRef.current || !selectedMemberId) return;

    const member = members.find(m => m.id === selectedMemberId);
    if (member && !isNaN(member.location.lat) && !isNaN(member.location.lng)) {
      mapRef.current.flyTo([member.location.lat, member.location.lng], 16, {
        duration: 1.2,
        easeLinearity: 0.25
      });
    }
  }, [selectedMemberId, members]);

  return (
    <div className="w-full h-full relative">
      <div
        ref={mapContainerRef}
        className="w-full h-full"
        style={{
          background: theme === 'dark' ? '#0a0f1e' : '#f8fafc',
          filter: theme === 'dark' ? 'contrast(1.2) brightness(1.2)' : 'none'
        }}
      />

      {/* Navigation overlay */}
      {isNavigating && activeRoute && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[1000]">
          <div className="bg-black/90 px-6 py-3 rounded-2xl border border-white/10 shadow-2xl">
            <div className="text-white font-bold text-sm">{activeRoute.destinationName}</div>
            <div className="text-indigo-400 text-xs">{activeRoute.totalTime} • {activeRoute.totalDistance}</div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MapView;
