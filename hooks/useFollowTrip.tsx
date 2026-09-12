import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FamilyCircle } from '../services/authService';
import { NavigationRoute } from '../types';
import { FOLLOW_TRIP_ENABLED, saveSharedTrip, SharedTrip, subscribeToSharedTrips } from '../services/sharedTripService';
import FollowTripMap from '../components/FollowTripMap';

type Start = (name: string, coords?: { lat: number; lng: number }, route?: NavigationRoute) => Promise<void>;
export function useFollowTrip(options: {
  userId?: string; name: string; circles: FamilyCircle[]; route: NavigationRoute | null;
  navigating: boolean; arrived: boolean; location: { lat: number; lng: number } | null;
  locationUpdatedAt: number;
  start: Start; notify: (message: string, duration?: number) => void;
}) {
  const latest = useRef(options); latest.current = options;
  const [pending, setPending] = useState<Parameters<Start> | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [sharing, setSharing] = useState(false);
  const [trips, setTrips] = useState<SharedTrip[]>([]);
  const [following, setFollowing] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());
  const active = useRef<SharedTrip | null>(null);
  const seen = useRef(new Set<string>());
  const busy = useRef(false);
  const ending = useRef(false);
  useEffect(() => {
    if (!options.userId || !FOLLOW_TRIP_ENABLED) return;
    seen.current.clear(); setTrips([]); setFollowing(null);
    return subscribeToSharedTrips(options.userId, received => {
      setTrips(received.filter(t => t.driverId !== options.userId));
      for (const trip of received) {
        if (trip.driverId === options.userId || Date.now() - trip.updatedAt > 120000) continue;
        const key = `${trip.id}:${trip.status}`;
        if (seen.current.has(key)) continue;
        seen.current.add(key);
        latest.current.notify(trip.status === 'active'
          ? `${trip.driverName} started a trip to ${trip.destination}. Open Follow Trip to watch.`
          : `${trip.driverName}${trip.status === 'arrived' ? ` arrived at ${trip.destination}` : ' ended their trip'}.`, 6000);
      }
    }, () => setError('Follow Trip is unavailable. Check your connection and circle access.'));
  }, [options.userId]);

  const stop = useCallback(async () => {
    ending.current = true;
    if (busy.current) return;
    if (!active.current) { setSharing(false); ending.current = false; return; }
    busy.current = true;
    try {
      await saveSharedTrip({ ...active.current, status: latest.current.arrived ? 'arrived' : 'ended',
        location: null, geometry: '[]', updatedAt: Date.now() });
      active.current = null; setSharing(false); ending.current = false;
    } catch { setError('Could not end sharing yet. Reconnecting will retry.'); }
    finally { busy.current = false; }
  }, []);

  useEffect(() => {
    const publish = async () => {
      setNow(Date.now());
      const o = latest.current;
      if (ending.current || (active.current && !o.navigating)) { await stop(); return; }
      if (!sharing || !o.navigating || !o.route || !o.userId || busy.current) return;
      const circles = o.circles.filter(c => selected.includes(c.id));
      if (!circles.length) { await stop(); return; }
      const participants = [...new Set([o.userId, ...circles.flatMap(c => c.members)])];
      const trip: SharedTrip = { id: active.current?.id || crypto.randomUUID(), driverId: o.userId,
        driverName: o.name, participantIds: participants, circleNames: circles.map(c => c.name),
        destination: o.route.destinationName, destinationLocation: o.route.destinationLoc,
        geometry: JSON.stringify(o.route.routeGeometry || []),
        location: o.location ? { lat: o.location.lat, lng: o.location.lng } : null,
        eta: o.route.totalTime, startedAt: active.current?.startedAt || Date.now(), updatedAt: Date.now(),
        locationUpdatedAt: o.locationUpdatedAt, status: 'active' };
      active.current = trip; busy.current = true;
      try { await saveSharedTrip(trip); setError(''); }
      catch { setError('Trip sharing has not synced. Your circle may not see this trip yet.'); }
      finally { busy.current = false; }
    };
    void publish();
    const timer = window.setInterval(publish, 15000);
    return () => window.clearInterval(timer);
  }, [sharing, selected, options.navigating, stop]);

  const requestStart = useCallback<Start>(async (...args) => {
    if (!FOLLOW_TRIP_ENABLED || !latest.current.userId || !latest.current.circles.length) { await latest.current.start(...args); return; }
    let saved: string[] = [];
    try { saved = JSON.parse(localStorage.getItem(`myway-trip-sharing-${latest.current.userId}`) || '[]'); } catch {}
    setSelected(Array.isArray(saved) ? saved : []); setPending(args);
  }, []);
  const start = async (share: boolean) => {
    if (!pending) return;
    const args = pending; setPending(null); setError(''); ending.current = false;
    if (active.current) {
      await stop();
      if (active.current) { setError('Please wait for the previous trip sharing to stop before starting another shared trip.'); return; }
    }
    try { localStorage.setItem(`myway-trip-sharing-${options.userId}`, JSON.stringify(share ? selected : [])); } catch {}
    await options.start(args[0], args[1], args[2]);
    setSharing(share && selected.length > 0);
  };
  const trip = trips.find(t => t.id === following);
  const live = trips.filter(t => t.status === 'active' && now - t.updatedAt < 86400000);
  const panel = 'rounded-2xl bg-white text-slate-900 p-4 shadow-xl border border-slate-200';
  return { requestStart, overlay: <>
    {pending && <div className="fixed inset-0 z-[350] bg-black/60 flex items-center justify-center p-4">
      <div role="dialog" aria-modal="true" aria-label="Share this trip" className={`${panel} w-full max-w-sm space-y-3`}>
        <h2 className="text-lg font-bold">Share this trip?</h2>
        <p className="text-sm">Let selected circles follow your route to {pending[0]}, destination and live location. You can stop sharing anytime.</p>
        {options.circles.map(c => <label key={c.id} className="flex gap-3 items-center p-2"><input type="checkbox" checked={selected.includes(c.id)} onChange={e => setSelected(ids => e.target.checked ? [...ids, c.id] : ids.filter(id => id !== c.id))} />{c.name}</label>)}
        <button className="w-full p-3 rounded-xl bg-violet-600 text-white disabled:opacity-50" disabled={!selected.length} onClick={() => void start(true)}>Share and start trip</button>
        <button className="w-full p-3 rounded-xl bg-slate-100" onClick={() => void start(false)}>Start privately</button>
        <button className="w-full p-2" onClick={() => setPending(null)}>Back</button>
      </div>
    </div>}
    {sharing && <button onClick={() => void stop()} className="fixed left-3 top-2 z-[110] rounded-full px-3 py-2 bg-violet-700 text-white text-xs shadow-lg">Sharing trip · Stop sharing</button>}
    {!options.navigating && live.length > 0 && !following && <div className="fixed right-3 top-24 z-[110] max-w-[min(280px,85vw)] space-y-2">
      {live.map(t => <button key={t.id} onClick={() => setFollowing(t.id)} className={`${panel} block w-full text-left text-sm`}><b>{t.driverName} → {t.destination}</b><br />Follow Trip</button>)}
    </div>}
    {following && <div className="fixed inset-0 z-[340] bg-black/60 flex items-center justify-center p-3"><div role="dialog" aria-modal="true" aria-label="Follow trip" className={`${panel} w-full max-w-lg space-y-3`}>
      <div className="flex justify-between gap-3"><h2 className="font-bold">{trip?.driverName || 'Member'} · Follow Trip</h2><button onClick={() => setFollowing(null)} aria-label="Close trip view">Close</button></div>
      {!trip ? <p>This trip is no longer shared with you.</p> : trip.status !== 'active' ? <p>{trip.status === 'arrived' ? `Arrived at ${trip.destination}` : 'Trip ended. Sharing has stopped.'}</p> : <>
        <p>Heading to {trip.destination} · Trip estimate {trip.eta}</p>
        <p className="text-sm text-slate-600">{trip.locationUpdatedAt ? `Location updated ${Math.max(0, Math.floor((now - trip.locationUpdatedAt) / 60000))} min ago` : 'Waiting for a GPS fix'}{now - trip.locationUpdatedAt > 120000 ? ' · Location may be stale' : ''}</p>
        <FollowTripMap trip={trip} />
        <p className="text-xs text-slate-500">Read-only trip view · {trip.circleNames.join(', ')}</p>
      </>}
    </div></div>}
    {error && <div role="alert" className="fixed bottom-44 left-3 right-3 z-[360] rounded-xl bg-amber-100 text-amber-950 p-3 text-sm" onClick={() => setError('')}>{error}</div>}
  </> };
}
