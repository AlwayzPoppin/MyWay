/**
 * Android Auto Bridge Service
 * Syncs MyWay's navigation telemetry, turn-by-turn guidance, arrival geofence states,
 * saved places, and session lifecycle to the native NativeAndroidAuto Capacitor plugin
 * for projection onto vehicle infotainment displays.
 */
import { Capacitor, registerPlugin, PluginListenerHandle } from '@capacitor/core';

interface NativeAndroidAutoPlugin {
  updateNavigationState(options: {
    destinationName: string;
    eta: string;
    remainingDistance: string;
    currentInstruction: string;
    speedMph: number;
    speedLimit: number;
    isArrived?: boolean;
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

  isCarConnected(): Promise<{ connected: boolean }>;

  addListener(
    eventName: 'carNavigationCancelled',
    listenerFunc: (data: { source: string; timestamp: number }) => void
  ): Promise<PluginListenerHandle>;

  addListener(
    eventName: 'carSessionStateChanged',
    listenerFunc: (data: { connected: boolean }) => void
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
