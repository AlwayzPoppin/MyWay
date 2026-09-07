/**
 * Android Auto Bridge Service
 * Syncs MyWay's navigation telemetry, saved places, and session state
 * to the native NativeAndroidAuto Capacitor plugin for projection onto
 * vehicle infotainment displays.
 */
import { Capacitor, registerPlugin } from '@capacitor/core';

interface NativeAndroidAutoPlugin {
  updateNavigationState(options: {
    destinationName: string;
    eta: string;
    remainingDistance: string;
    currentInstruction: string;
    speedMph: number;
    speedLimit: number;
  }): Promise<{ success: boolean; isCarConnected: boolean }>;

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
 * Push current navigation telemetry to the Android Auto display.
 * Call this on every navigation tick to keep the car dashboard in sync.
 */
export async function syncNavigationTelemetry(data: {
  destinationName: string;
  eta: string;
  remainingDistance: string;
  currentInstruction: string;
  speedMph: number;
  speedLimit?: number;
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
    });
  } catch (err) {
    console.warn('[AndroidAuto] Failed to sync navigation telemetry:', err);
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
