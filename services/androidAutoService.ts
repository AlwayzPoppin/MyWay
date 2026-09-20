/**
 * Android Auto Bridge Service
 * Syncs MyWay's navigation telemetry, turn-by-turn guidance, arrival geofence states,
 * saved places, and session lifecycle to the native NativeAndroidAuto Capacitor plugin
 * for projection onto vehicle infotainment displays.
 */
import { Capacitor, registerPlugin, PluginListenerHandle } from '@capacitor/core';
import type { NavigationRoute, IncidentReport } from '../types';

export interface CarIncidentItem {
  id: string;
  type: string;
  lat: number;
  lng: number;
  title: string;
  badge: string;
  color: string;
  reporterName: string;
  isReporter: boolean;
  upvotes: number;
  verified: boolean;
  isPermanent: boolean;
  details: string;
  timestamp: string;
}

interface NativeAndroidAutoPlugin {
  updateNavigationState(options: {
    destinationName: string;
    eta: string;
    remainingDistance: string;
    currentInstruction: string;
    speedMph: number;
    speedLimit: number;
    isArrived?: boolean;
    currentLatitude?: number;
    currentLongitude?: number;
    destinationLatitude?: number;
    destinationLongitude?: number;
    bearing?: number;
    routeCoordinates?: Array<{ lat: number; lng: number }>;
    fuelGallonsBurned?: number;
    fuelCostSoFar?: number;
    fuelGallonsRemaining?: number;
    fuelPercentRemaining?: number;
    fuelRangeMiles?: number;
  }): Promise<{ success: boolean; isCarConnected: boolean }>;

  notifyArrival(options?: { destinationName?: string }): Promise<{ success: boolean }>;

  stopNavigation(): Promise<{ success: boolean }>;

  updateSavedPlaces(options: {
    places: Array<{
      id: string;
      name: string;
      address: string;
      lat: number;
      lng: number;
    }>;
  }): Promise<{ success: boolean; count: number }>;

  updateRouteOptions(options: {
    activeRouteId: string;
    routes: Array<{ id: string; summary: string; totalTime: string; totalDistance: string; tollLabel: string }>;
  }): Promise<{ success: boolean; count: number }>;

  updateSearchResults(options: {
    results: Array<{ name: string; address: string; lat: number; lng: number }>;
  }): Promise<{ success: boolean; count: number }>;

  updateRecentTrips(options: {
    trips: Array<{ name: string; address: string; lat: number; lng: number; timestamp: number }>;
  }): Promise<{ success: boolean; count: number }>;

  updateIncidents(options: {
    incidents: Array<CarIncidentItem>;
  }): Promise<{ success: boolean; count: number }>;

  updateMapSkin(options: {
    skin: string;
    theme: string;
    is3DMode: boolean;
  }): Promise<{ success: boolean }>;

  isCarConnected(): Promise<{ connected: boolean }>;

  addListener(
    eventName: 'carNavigationCancelled',
    listenerFunc: (data: { source: string; timestamp: number }) => void
  ): Promise<PluginListenerHandle>;

  addListener(
    eventName: 'carSessionStateChanged',
    listenerFunc: (data: { connected: boolean }) => void
  ): Promise<PluginListenerHandle>;

  addListener(
    eventName: 'carRouteSelected',
    listenerFunc: (data: { routeId: string; timestamp: number }) => void
  ): Promise<PluginListenerHandle>;

  addListener(
    eventName: 'carDestinationSelected',
    listenerFunc: (data: { name: string; lat: number; lng: number; intent?: 'start_trip' | 'add_stop'; timestamp: number }) => void
  ): Promise<PluginListenerHandle>;

  addListener(
    eventName: 'carSearchRequested',
    listenerFunc: (data: { query: string; intent?: 'start_trip' | 'add_stop'; timestamp: number }) => void
  ): Promise<PluginListenerHandle>;

  addListener(
    eventName: 'carIncidentConfirmed',
    listenerFunc: (data: { incidentId: string; timestamp: number }) => void
  ): Promise<PluginListenerHandle>;

  addListener(
    eventName: 'carIncidentCleared',
    listenerFunc: (data: { incidentId: string; timestamp: number }) => void
  ): Promise<PluginListenerHandle>;

  addListener(
    eventName: 'carIncidentRemoved',
    listenerFunc: (data: { incidentId: string; timestamp: number }) => void
  ): Promise<PluginListenerHandle>;
}

const NativeAndroidAuto = registerPlugin<NativeAndroidAutoPlugin>('NativeAndroidAuto');

/**
 * Check if Android Auto is available on the current platform.
 */
export function isAndroidAutoAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}

/**
 * Check if a car session is currently active (phone plugged into Android Auto head unit).
 */
export async function isCarConnected(): Promise<boolean> {
  if (!isAndroidAutoAvailable()) return false;
  try {
    const result = await NativeAndroidAuto.isCarConnected();
    return result.connected;
  } catch {
    return false;
  }
}

/**
 * Push current navigation telemetry and turn-by-turn step to the Android Auto display.
 * Call this on every navigation tick to keep the car dashboard in sync.
 */
export async function syncNavigationTelemetry(data: {
  destinationName: string;
  eta: string;
  remainingDistance: string;
  currentInstruction: string;
  speedMph: number;
  speedLimit?: number;
  isArrived?: boolean;
  currentLocation?: { lat: number; lng: number };
  destinationLocation?: { lat: number; lng: number };
  bearing?: number;
  routeCoordinates?: Array<{ lat: number; lng: number }>;
  fuelGallonsBurned?: number;
  fuelCostSoFar?: number;
  fuelGallonsRemaining?: number | null;
  fuelPercentRemaining?: number | null;
  fuelRangeMiles?: number | null;
}): Promise<void> {
  if (!isAndroidAutoAvailable()) return;
  try {
    await NativeAndroidAuto.updateNavigationState({
      destinationName: data.destinationName,
      eta: data.eta,
      remainingDistance: data.remainingDistance,
      currentInstruction: data.currentInstruction,
      speedMph: data.speedMph,
      speedLimit: data.speedLimit || 0,
      isArrived: data.isArrived || false,
      currentLatitude: data.currentLocation?.lat,
      currentLongitude: data.currentLocation?.lng,
      destinationLatitude: data.destinationLocation?.lat,
      destinationLongitude: data.destinationLocation?.lng,
      bearing: typeof data.bearing === 'number' ? data.bearing : undefined,
      routeCoordinates: data.routeCoordinates,
      fuelGallonsBurned: data.fuelGallonsBurned,
      fuelCostSoFar: data.fuelCostSoFar,
      fuelGallonsRemaining: data.fuelGallonsRemaining ?? undefined,
      fuelPercentRemaining: data.fuelPercentRemaining ?? undefined,
      fuelRangeMiles: data.fuelRangeMiles ?? undefined,
    });
  } catch (err) {
    console.warn('[AndroidAuto] Failed to sync navigation telemetry:', err);
  }
}

/**
 * Notify the vehicle infotainment system that the destination has been reached.
 * Updates the screen's text to "Arrived!" and displays destination arrival celebration.
 */
export async function notifyArrival(destinationName: string = 'Destination'): Promise<void> {
  if (!isAndroidAutoAvailable()) return;
  try {
    await NativeAndroidAuto.updateNavigationState({
      destinationName,
      eta: '0 min',
      remainingDistance: '0 ft',
      currentInstruction: 'Arrived!',
      speedMph: 0,
      speedLimit: 25,
      isArrived: true,
    });
  } catch (err) {
    console.warn('[AndroidAuto] Failed to notify car arrival:', err);
  }
}

/**
 * Clear navigation state on the Android Auto display (trip ended or cancelled).
 */
export async function clearNavigation(): Promise<void> {
  if (!isAndroidAutoAvailable()) return;
  try {
    await NativeAndroidAuto.stopNavigation();
  } catch (err) {
    console.warn('[AndroidAuto] Failed to clear navigation:', err);
  }
}

/**
 * Listen for trip cancellation initiated from the vehicle's red "X" Action Strip button.
 */
export function onCarNavigationCancelled(callback: () => void): () => void {
  if (!isAndroidAutoAvailable()) return () => {};

  let listenerPromise: Promise<PluginListenerHandle> | null = null;
  try {
    listenerPromise = NativeAndroidAuto.addListener('carNavigationCancelled', () => {
      callback();
    });
  } catch (err) {
    console.warn('[AndroidAuto] Failed to bind cancellation listener:', err);
  }

  return () => {
    if (listenerPromise) {
      listenerPromise.then(handle => handle.remove()).catch(() => {});
    }
  };
}

/**
 * Listen for car head unit connection / disconnection events.
 */
export function onCarSessionStateChanged(callback: (connected: boolean) => void): () => void {
  if (!isAndroidAutoAvailable()) return () => {};

  let listenerPromise: Promise<PluginListenerHandle> | null = null;
  try {
    listenerPromise = NativeAndroidAuto.addListener('carSessionStateChanged', (data) => {
      callback(data.connected);
    });
  } catch (err) {
    console.warn('[AndroidAuto] Failed to bind session state listener:', err);
  }

  return () => {
    if (listenerPromise) {
      listenerPromise.then(handle => handle.remove()).catch(() => {});
    }
  };
}

/**
 * Sync user's saved places to the Android Auto idle screen.
 */
export async function syncSavedPlaces(places: Array<{
  id: string;
  name: string;
  address?: string;
  description?: string;
  location: { lat: number; lng: number };
}>): Promise<void> {
  if (!isAndroidAutoAvailable()) return;
  try {
    const mapped = places.slice(0, 10).map(p => ({
      id: p.id,
      name: p.name,
      address: p.address || p.description || '',
      lat: p.location.lat,
      lng: p.location.lng,
    }));
    await NativeAndroidAuto.updateSavedPlaces({ places: mapped });
  } catch (err) {
    console.warn('[AndroidAuto] Failed to sync saved places:', err);
  }
}

/** Sync up to three safe route choices to the car display. */
export async function syncRouteOptions(activeRoute: NavigationRoute, alternatives: NavigationRoute[]): Promise<void> {
  if (!isAndroidAutoAvailable()) return;
  const routes = [activeRoute, ...alternatives.filter(route => route.id !== activeRoute.id)]
    .filter((route, index, all) => !!route.id && all.findIndex(candidate => candidate.id === route.id) === index)
    .slice(0, 3);
  try {
    await NativeAndroidAuto.updateRouteOptions({
      activeRouteId: activeRoute.id || '',
      routes: routes.map(route => ({
        id: route.id || '',
        summary: route.summary || route.routeLabel || 'Route option',
        totalTime: route.totalTime || '',
        totalDistance: route.totalDistance || '',
        tollLabel: route.hasTolls ? (route.tollCostEstimate || 'Tolls') : 'No tolls'
      }))
    });
  } catch (err) {
    console.warn('[AndroidAuto] Failed to sync route options:', err);
  }
}

/** Handle a driver-selected alternative from Android Auto. */
export function onCarRouteSelected(callback: (routeId: string) => void): () => void {
  if (!isAndroidAutoAvailable()) return () => {};
  let listenerPromise: Promise<PluginListenerHandle> | null = null;
  try {
    listenerPromise = NativeAndroidAuto.addListener('carRouteSelected', data => callback(data.routeId));
  } catch (err) {
    console.warn('[AndroidAuto] Failed to bind route selection listener:', err);
  }
  return () => { if (listenerPromise) listenerPromise.then(handle => handle.remove()).catch(() => {}); };
}

/**
 * Listen for a destination selected by the driver on the car head unit
 * (from saved places, recent trips, or search results).
 */
export function onCarDestinationSelected(callback: (data: { name: string; lat: number; lng: number; intent: 'start_trip' | 'add_stop' }) => void): () => void {
  if (!isAndroidAutoAvailable()) return () => {};
  let listenerPromise: Promise<PluginListenerHandle> | null = null;
  try {
    listenerPromise = NativeAndroidAuto.addListener('carDestinationSelected', (data) => {
      callback({ name: data.name, lat: data.lat, lng: data.lng, intent: data.intent === 'add_stop' ? 'add_stop' : 'start_trip' });
    });
  } catch (err) {
    console.warn('[AndroidAuto] Failed to bind destination selection listener:', err);
  }
  return () => { if (listenerPromise) listenerPromise.then(handle => handle.remove()).catch(() => {}); };
}

/**
 * Listen for a search query typed by the driver on the car head unit.
 */
export function onCarSearchRequested(callback: (query: string, intent: 'start_trip' | 'add_stop') => void): () => void {
  if (!isAndroidAutoAvailable()) return () => {};
  let listenerPromise: Promise<PluginListenerHandle> | null = null;
  try {
    listenerPromise = NativeAndroidAuto.addListener('carSearchRequested', (data) => {
      callback(data.query, data.intent === 'add_stop' ? 'add_stop' : 'start_trip');
    });
  } catch (err) {
    console.warn('[AndroidAuto] Failed to bind search request listener:', err);
  }
  return () => { if (listenerPromise) listenerPromise.then(handle => handle.remove()).catch(() => {}); };
}

/**
 * Push geocoded search results to the car SearchTemplate screen.
 */
export async function sendSearchResults(results: Array<{ name: string; address: string; lat: number; lng: number }>): Promise<void> {
  if (!isAndroidAutoAvailable()) return;
  try {
    await NativeAndroidAuto.updateSearchResults({ results: results.slice(0, 6) });
  } catch (err) {
    console.warn('[AndroidAuto] Failed to send search results:', err);
  }
}

/**
 * Sync the user's recent search/trip history to the Android Auto idle screen.
 */
export async function syncRecentTrips(trips: Array<{
  name: string;
  address?: string;
  lat: number;
  lng: number;
  timestamp: number;
}>): Promise<void> {
  if (!isAndroidAutoAvailable()) return;
  try {
    const mapped = trips.slice(0, 10).map(t => ({
      name: t.name,
      address: t.address || '',
      lat: t.lat,
      lng: t.lng,
      timestamp: t.timestamp,
    }));
    await NativeAndroidAuto.updateRecentTrips({ trips: mapped });
  } catch (err) {
    console.warn('[AndroidAuto] Failed to sync recent trips:', err);
  }
}

/**
 * Match metadata identical to mobile IncidentDetailModal.tsx
 */
function getIncidentCarMeta(type: string): { title: string; badge: string; color: string } {
  switch (type) {
    case 'police': return { title: 'Police Radar Trap', color: '#3b82f6', badge: 'Speed Enforcement' };
    case 'hazard': return { title: 'Road Hazard', color: '#f59e0b', badge: 'Obstruction Ahead' };
    case 'shoulder': return { title: 'Vehicle on Shoulder', color: '#a855f7', badge: 'Stationary Vehicle' };
    case 'construction': return { title: 'Road Work Zone', color: '#f97316', badge: 'Construction' };
    case 'traffic': return { title: 'Traffic Jam', color: '#ef4444', badge: 'Heavy Congestion' };
    case 'road_closed': return { title: 'Road Closed', color: '#e11d48', badge: 'Closure / Detour' };
    case 'signal_out': return { title: 'Traffic Signal Out', color: '#ca8a04', badge: 'Use Caution' };
    case 'crash': return { title: 'Crash', color: '#e11d48', badge: 'Collision Ahead' };
    case 'blocked_lane': return { title: 'Blocked Lane', color: '#ea580c', badge: 'Lane Obstruction' };
    case 'bad_weather': return { title: 'Bad Weather', color: '#0284c7', badge: 'Road Conditions' };
    case 'animal': return { title: 'Animal Near Road', color: '#059669', badge: 'Use Caution' };
    case 'stop_sign': return { title: 'Stop Sign', color: '#dc2626', badge: 'Road Feature' }; case 'speed_bump': return { title: 'Speed Bump', color: '#64748b', badge: 'Road Feature' };
    case 'missing_vehicle_access': return { title: 'Missing Vehicle Access', color: '#7c3aed', badge: 'Map Correction' };
    case 'wrong_traffic_direction': return { title: 'Wrong Traffic Direction', color: '#0891b2', badge: 'Map Correction' };
    case 'restricted_access': return { title: 'Restricted Access', color: '#475569', badge: 'Map Correction' };
    case 'safety_alert':
    case 'alert':
    default: return { title: 'Flooded Road', color: '#0ea5e9', badge: 'Water across road' };
  }
}

/**
 * Sync active road incidents and permanent road features to Android Auto display.
 */
export async function syncIncidents(incidents: IncidentReport[], currentUserId?: string): Promise<void> {
  if (!isAndroidAutoAvailable()) return;
  try {
    const mapped: CarIncidentItem[] = (incidents || [])
      .filter(i => i && i.location && typeof i.location.lat === 'number' && typeof i.location.lng === 'number')
      .map(i => {
        const meta = getIncidentCarMeta(i.type);
        const isReporter = !i.reporterId || i.reporterId === currentUserId || i.reporterId === 'anonymous' || i.reporterName === 'You';
        return {
          id: i.id,
          type: i.type,
          lat: i.location.lat,
          lng: i.location.lng,
          title: meta.title,
          badge: meta.badge,
          color: meta.color,
          reporterName: i.reporterName || 'Driver',
          isReporter,
          upvotes: i.upvotes || 1,
          verified: !!i.verified,
          isPermanent: i.isPermanent === true || i.type === 'speed_bump' || i.type === 'stop_sign',
          details: i.details || '',
          timestamp: i.timestamp || new Date().toISOString()
        };
      });

    await NativeAndroidAuto.updateIncidents({ incidents: mapped });
  } catch (err) {
    console.warn('[AndroidAuto] Failed to sync road incidents:', err);
  }
}

/**
 * Sync user's map skin, theme, and 3D mode configuration to Android Auto.
 */
export async function syncMapSkinSettings(settings: {
  skin?: string;
  theme?: string;
  is3DMode?: boolean;
}): Promise<void> {
  if (!isAndroidAutoAvailable()) return;
  try {
    await NativeAndroidAuto.updateMapSkin({
      skin: settings.skin || 'default',
      theme: settings.theme || 'dark',
      is3DMode: settings.is3DMode !== false
    });
  } catch (err) {
    console.warn('[AndroidAuto] Failed to sync map skin settings:', err);
  }
}

/**
 * Listen for incident confirmation ("Still There" / "Confirm feature") initiated from car head unit.
 */
export function onCarIncidentConfirmed(callback: (incidentId: string) => void): () => void {
  if (!isAndroidAutoAvailable()) return () => {};
  let listenerPromise: Promise<PluginListenerHandle> | null = null;
  try {
    listenerPromise = NativeAndroidAuto.addListener('carIncidentConfirmed', data => callback(data.incidentId));
  } catch (err) {
    console.warn('[AndroidAuto] Failed to bind incident confirmation listener:', err);
  }
  return () => { if (listenerPromise) listenerPromise.then(handle => handle.remove()).catch(() => {}); };
}

/**
 * Listen for incident cleared ("Cleared" / "Feature removed") initiated from car head unit.
 */
export function onCarIncidentCleared(callback: (incidentId: string) => void): () => void {
  if (!isAndroidAutoAvailable()) return () => {};
  let listenerPromise: Promise<PluginListenerHandle> | null = null;
  try {
    listenerPromise = NativeAndroidAuto.addListener('carIncidentCleared', data => callback(data.incidentId));
  } catch (err) {
    console.warn('[AndroidAuto] Failed to bind incident cleared listener:', err);
  }
  return () => { if (listenerPromise) listenerPromise.then(handle => handle.remove()).catch(() => {}); };
}

/**
 * Listen for incident removal ("Remove feature I added") initiated from car head unit.
 */
export function onCarIncidentRemoved(callback: (incidentId: string) => void): () => void {
  if (!isAndroidAutoAvailable()) return () => {};
  let listenerPromise: Promise<PluginListenerHandle> | null = null;
  try {
    listenerPromise = NativeAndroidAuto.addListener('carIncidentRemoved', data => callback(data.incidentId));
  } catch (err) {
    console.warn('[AndroidAuto] Failed to bind incident removal listener:', err);
  }
  return () => { if (listenerPromise) listenerPromise.then(handle => handle.remove()).catch(() => {}); };
}
