import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { ChevronUp, Home } from 'lucide-react';
import { FamilyMember, Place } from '../types';
import { getSafeAvatarUrl } from '../utils/avatar';
import { MapViewportBounds, mapViewportStore } from '../services/mapViewportStore';

type Direction = 'north' | 'northeast' | 'east' | 'southeast' | 'south' | 'southwest' | 'west' | 'northwest';
type Target = { id: string; kind: 'member' | 'place'; name: string; avatar?: string; location: { lat: number; lng: number }; member?: FamilyMember; place?: Place };

interface MapEdgeAwarenessProps {
  bounds: MapViewportBounds | null;
  members: FamilyMember[];
  savedPlaces: Place[];
  currentUserId?: string;
  onSelectMember: (id: string) => void;
  onSelectPlace: (place: Place) => void;
}

const arrowDegrees: Record<Direction, number> = {
  north: 0, northeast: 45, east: 90, southeast: 135,
  south: 180, southwest: 225, west: 270, northwest: 315
};

const getOffscreenPosition = (lat: number, lng: number, bounds: MapViewportBounds): { direction: Direction; left: number; top: number } | null => {
  if (lat <= bounds.north && lat >= bounds.south && lng <= bounds.east && lng >= bounds.west) return null;
  const northSouth = (lat - ((bounds.north + bounds.south) / 2)) / Math.max(0.0001, bounds.north - bounds.south);
  const eastWest = (lng - ((bounds.east + bounds.west) / 2)) / Math.max(0.0001, bounds.east - bounds.west);
  const edgeScale = 1 / Math.max(Math.abs(northSouth), Math.abs(eastWest), 0.0001);
  const left = Math.min(97, Math.max(3, 50 + (eastWest * edgeScale * 47)));
  // Buttons are center-anchored. Keep a small visible in-map margin so north
  // edge pills sit flush with the map top without being clipped.
  const top = Math.min(96, Math.max(1.5, 50 - (northSouth * edgeScale * 52)));
  const bearing = (Math.atan2(eastWest, northSouth) * 180 / Math.PI + 360) % 360;
  const directions: Direction[] = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];
  return { direction: directions[Math.round(bearing / 45) % 8], left, top };
};

/**
 * Fans markers that land on the same part of the perimeter apart. The offsets
 * are calculated with the viewport update, so panning still only mutates DOM
 * styles and never waits for a React render.
 */
const getLaidOutPositions = (targets: Target[], bounds: MapViewportBounds) => {
  const positioned = targets.flatMap(target => {
    const position = getOffscreenPosition(target.location.lat, target.location.lng, bounds);
    return position ? [{ target, position }] : [];
  });
  const result = new Map<string, { direction: Direction; left: number; top: number }>();
  const clustered = new Set<string>();

  positioned.forEach(item => {
    if (clustered.has(item.target.id)) return;
    const group = positioned.filter(candidate =>
      !clustered.has(candidate.target.id)
      && Math.hypot(candidate.position.left - item.position.left, candidate.position.top - item.position.top) < 6
    );
    group.forEach(candidate => clustered.add(candidate.target.id));
    const normalX = item.position.left - 50;
    const normalY = item.position.top - 50;
    const length = Math.max(1, Math.hypot(normalX, normalY));
    const tangentX = -normalY / length;
    const tangentY = normalX / length;
    group.forEach((candidate, index) => {
      const spread = (index - ((group.length - 1) / 2)) * 5;
      result.set(candidate.target.id, {
        direction: candidate.position.direction,
        left: Math.min(97, Math.max(3, candidate.position.left + (tangentX * spread))),
        top: Math.min(96, Math.max(1.5, candidate.position.top + (tangentY * spread)))
      });
    });
  });
  return result;
};

/** Keeps React out of the per-frame pan path: only DOM styles change while MapLibre moves. */
const MapEdgeAwareness: React.FC<MapEdgeAwarenessProps> = ({ bounds, members, savedPlaces, currentUserId, onSelectMember, onSelectPlace }) => {
  const markerRefs = useRef(new Map<string, HTMLButtonElement>());
  const targets = useMemo<Target[]>(() => {
    const memberTargets = members
      .filter(member => member.id !== currentUserId && !member.isGhostMode && member.locationSharing !== false && member.isSharingLocation !== false && Number.isFinite(member.location?.lat) && Number.isFinite(member.location?.lng))
      .map(member => ({ id: `member:${member.id}`, kind: 'member' as const, name: member.name, avatar: member.avatar, location: member.location, member }));
    const placeTargets = savedPlaces
      .filter(place => place.isSaved && Number.isFinite(place.location?.lat) && Number.isFinite(place.location?.lng))
      .map(place => ({ id: `place:${place.id}`, kind: 'place' as const, name: place.name, location: place.location, place }));
    return [...memberTargets, ...placeTargets].slice(0, 12);
  }, [members, savedPlaces, currentUserId]);

  const applyViewport = useCallback((viewport: MapViewportBounds | null) => {
    if (!viewport) return;
    const positions = getLaidOutPositions(targets, viewport);
    targets.forEach(target => {
      const marker = markerRefs.current.get(target.id);
      if (!marker) return;
      const position = positions.get(target.id);
      if (!position) {
        marker.style.opacity = '0';
        marker.style.pointerEvents = 'none';
        marker.style.visibility = 'hidden';
        return;
      }
      marker.style.left = `${position.left}%`;
      marker.style.top = `${position.top}%`;
      marker.style.setProperty('--edge-angle', `${arrowDegrees[position.direction]}deg`);
      marker.style.opacity = '1';
      marker.style.pointerEvents = 'auto';
      marker.style.visibility = 'visible';
    });
  }, [targets]);

  useEffect(() => {
    applyViewport(mapViewportStore.getSnapshot() || bounds);
    return mapViewportStore.subscribe(() => applyViewport(mapViewportStore.getSnapshot()));
  }, [applyViewport, bounds]);

  if (!targets.length) return null;
  const initialBounds = mapViewportStore.getSnapshot() || bounds;
  const initialPositions = initialBounds ? getLaidOutPositions(targets, initialBounds) : new Map();
  return (
    <aside
      className="absolute inset-0 z-[35] pointer-events-none"
      aria-label="Off-screen circle and saved-place directions"
    >
      {targets.map(target => {
        const initial = initialPositions.get(target.id);
        const isMember = target.kind === 'member';
        return (
          <button
            key={target.id}
            ref={node => { if (node) markerRefs.current.set(target.id, node); else markerRefs.current.delete(target.id); }}
            type="button"
            className="absolute pointer-events-auto relative flex h-11 w-11 items-center justify-center rounded-full border-[3px] border-white bg-white shadow-[0_5px_16px_rgba(15,23,42,0.28)] active:scale-90"
            style={{
              left: `${initial?.left ?? 50}%`, top: `${initial?.top ?? 50}%`, transform: 'translate(-50%, -50%)',
              opacity: initial ? 1 : 0, visibility: initial ? 'visible' : 'hidden', pointerEvents: initial ? 'auto' : 'none',
              ['--edge-angle' as string]: `${arrowDegrees[initial?.direction || 'north']}deg`
            }}
            onClick={() => isMember ? onSelectMember(target.member!.id) : onSelectPlace(target.place!)}
            aria-label={`${target.name} is off the visible map`}
            title={target.name}
          >
            <span className={`flex h-full w-full items-center justify-center overflow-hidden rounded-full ${isMember ? 'bg-emerald-50' : 'bg-violet-50 text-violet-600'}`}>
              {isMember ? <img src={getSafeAvatarUrl(target.avatar, target.name)} alt="" className="h-full w-full object-cover" /> : <Home className="h-5 w-5" strokeWidth={2.5} />}
            </span>
            <span className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full border-2 border-white bg-indigo-600 text-white shadow-sm">
              <ChevronUp className="h-3.5 w-3.5" strokeWidth={3} style={{ transform: 'rotate(var(--edge-angle))' }} aria-hidden="true" />
            </span>
          </button>
        );
      })}
    </aside>
  );
};

export default MapEdgeAwareness;
