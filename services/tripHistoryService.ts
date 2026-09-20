
import { Trip, TripPoint, Location } from '../types';
import { getDistanceMiles } from '../utils/geo';
import { vehicleFuelService } from './vehicleFuelService';
import { maintenanceAlertService } from './maintenanceAlertService';

// In-memory active trip + localStorage persistence for history
const TRIPS_STORAGE_KEY = 'myway_trip_history';
const ACTIVE_TRIP_STORAGE_KEY = 'myway_active_trip';
const MAX_STORED_TRIPS = 30;
const MAX_STORED_POINTS_PER_TRIP = 24;
const MAX_ACTIVE_TRIP_POINTS = 4_000;
const TRIP_DETAILS_DB = 'myway_trip_details';
const TRIP_DETAILS_STORE = 'trips';

let activeTrip: Trip | null = null;
let lastRecordedPoint: TripPoint | null = null;

/** Keep the first and last points while evenly sampling long GPS traces. */
const compactPath = (path: TripPoint[], limit: number): TripPoint[] => {
    if (path.length <= limit) return path;
    const step = (path.length - 1) / (limit - 1);
    return Array.from({ length: limit }, (_, index) => path[Math.min(path.length - 1, Math.round(index * step))]);
};

const compactTripForStorage = (trip: Trip): Trip => ({
    ...trip,
    path: compactPath(trip.path || [], MAX_STORED_POINTS_PER_TRIP),
    driveEvents: (trip.driveEvents || []).slice(-50)
});

const openTripDetailsDb = (): Promise<IDBDatabase | null> => new Promise(resolve => {
    if (typeof indexedDB === 'undefined') return resolve(null);
    try {
        const request = indexedDB.open(TRIP_DETAILS_DB, 1);
        request.onupgradeneeded = () => {
            if (!request.result.objectStoreNames.contains(TRIP_DETAILS_STORE)) request.result.createObjectStore(TRIP_DETAILS_STORE, { keyPath: 'id' });
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
    } catch { resolve(null); }
});

const persistTripDetail = async (trip: Trip): Promise<void> => {
    const database = await openTripDetailsDb();
    if (!database) return;
    try {
        await new Promise<void>(resolve => {
            const request = database.transaction(TRIP_DETAILS_STORE, 'readwrite').objectStore(TRIP_DETAILS_STORE).put(trip);
            request.onsuccess = request.onerror = () => resolve();
        });
    } catch (error) {
        console.warn('[TripHistory] Could not save detailed trip trace:', error);
    } finally {
        database.close();
    }
};

export const getTripDetail = async (tripId: string): Promise<Trip | null> => {
    const database = await openTripDetailsDb();
    if (!database) return null;
    try {
        return await new Promise<Trip | null>(resolve => {
            const request = database.transaction(TRIP_DETAILS_STORE, 'readonly').objectStore(TRIP_DETAILS_STORE).get(tripId);
            request.onsuccess = () => resolve((request.result as Trip | undefined) || null);
            request.onerror = () => resolve(null);
        });
    } catch {
        return null;
    } finally {
        database.close();
    }
};

const removeTripDetail = async (tripId?: string): Promise<void> => {
    const database = await openTripDetailsDb();
    if (!database) return;
    await new Promise<void>(resolve => {
        const store = database.transaction(TRIP_DETAILS_STORE, 'readwrite').objectStore(TRIP_DETAILS_STORE);
        const request = tripId ? store.delete(tripId) : store.clear();
        request.onsuccess = request.onerror = () => resolve();
    });
    database.close();
};

/**
 * History is a convenience cache, never a reason to crash navigation. Save
 * the newest compact records first and shed only oldest records if storage is
 * constrained by unrelated WebView data.
 */
const persistTripHistory = (trips: Trip[]): boolean => {
    const compacted = trips.slice(0, MAX_STORED_TRIPS).map(compactTripForStorage);
    if (compacted.length === 0) {
        try {
            localStorage.removeItem(TRIPS_STORAGE_KEY);
            return true;
        } catch {
            return false;
        }
    }
    for (let count = compacted.length; count >= 1; count -= 1) {
        try {
            localStorage.setItem(TRIPS_STORAGE_KEY, JSON.stringify(compacted.slice(0, count)));
            return true;
        } catch (error) {
            if (count === 1) console.warn('[TripHistory] Storage quota reached; trip history was not cached locally.', error);
        }
    }
    return false;
};

const persistActiveTrip = (): void => {
    try {
        if (activeTrip) localStorage.setItem(ACTIVE_TRIP_STORAGE_KEY, JSON.stringify({
            ...activeTrip,
            path: compactPath(activeTrip.path || [], MAX_ACTIVE_TRIP_POINTS)
        }));
    } catch {}
};

const hydrateActiveTrip = (): Trip | null => {
    if (activeTrip) return activeTrip;
    try {
        const stored = localStorage.getItem(ACTIVE_TRIP_STORAGE_KEY);
        if (!stored) return null;
        const parsed = JSON.parse(stored) as Trip;
        if (!parsed?.id || !parsed.isActive || !parsed.startTime || !Array.isArray(parsed.path)) return null;
        activeTrip = parsed;
        lastRecordedPoint = parsed.path[parsed.path.length - 1] || null;
        return activeTrip;
    } catch {
        return null;
    }
};

/** Start recording a new trip */
export const startTrip = (startLocation: Location, destinationName?: string, destinationLocation?: Location): Trip => {
    const trip: Trip = {
        id: `trip_${Date.now()}`,
        userId: '',
        startTime: Date.now(),
        startLocation,
        destinationName,
        destinationLocation,
        path: [{
            lat: startLocation.lat,
            lng: startLocation.lng,
            speed: 0,
            heading: 0,
            timestamp: Date.now()
        }],
        totalDistanceMiles: 0,
        maxSpeedMph: 0,
        avgSpeedMph: 0,
        driveEvents: [],
        safetyScore: 100,
        isActive: true
    };

    activeTrip = trip;
    lastRecordedPoint = trip.path[0];
    persistActiveTrip();
    console.log(`🛣️ Trip started: ${destinationName || 'Free drive'}`);
    return trip;
};

/** Record a GPS point during active trip */
export const recordTripPoint = (
    lat: number,
    lng: number,
    speed: number,
    heading: number
): void => {
    if (!activeTrip) return;

    const point: TripPoint = { lat, lng, speed, heading, timestamp: Date.now() };

    // Skip if too close to last point (< 10m) to avoid clutter
    if (lastRecordedPoint) {
        const dist = getDistanceMiles(lastRecordedPoint, point);
        if (dist < 0.006) return; // ~10 meters
    }

    // Update distance
    if (lastRecordedPoint) {
        activeTrip.totalDistanceMiles += getDistanceMiles(lastRecordedPoint, point);
    }

    // Update speed stats
    if (speed > activeTrip.maxSpeedMph) activeTrip.maxSpeedMph = speed;
    const totalSpeed = activeTrip.path.reduce((sum, p) => sum + p.speed, 0) + speed;
    activeTrip.avgSpeedMph = Math.round(totalSpeed / (activeTrip.path.length + 1));

    activeTrip.path.push(point);
    if (activeTrip.path.length > MAX_ACTIVE_TRIP_POINTS) {
        activeTrip.path = compactPath(activeTrip.path, Math.floor(MAX_ACTIVE_TRIP_POINTS * 0.75));
    }
    lastRecordedPoint = point;
    persistActiveTrip();
};

/** Record a driving event during active trip */
export const recordDriveEvent = (
    type: 'hard_brake' | 'rapid_accel' | 'speeding',
    location: Location
): void => {
    if (!activeTrip) return;
    activeTrip.driveEvents.push({ type, timestamp: Date.now(), location });
    persistActiveTrip();

    // Penalty per event
    const penalty = type === 'hard_brake' ? 3 : type === 'speeding' ? 5 : 2;
    activeTrip.safetyScore = Math.max(0, activeTrip.safetyScore - penalty);
};

/** End the active trip and save it */
export const endTrip = (endLocation?: Location, actualFuelGallons?: number): Trip | null => {
    hydrateActiveTrip();
    if (!activeTrip) return null;

    activeTrip.endTime = Date.now();
    activeTrip.endLocation = endLocation || (lastRecordedPoint ? { lat: lastRecordedPoint.lat, lng: lastRecordedPoint.lng } : undefined);
    activeTrip.isActive = false;
    activeTrip.totalDistanceMiles = Math.round(activeTrip.totalDistanceMiles * 100) / 100;

    // Calculate exact fuel usage & cost based on active vehicle (using live-tracked fuel burn when available)
    try {
        const activeVeh = vehicleFuelService.getActiveVehicle();
        const fuelCalc = vehicleFuelService.calculateTripFuel(activeTrip.totalDistanceMiles, activeVeh);
        const gallonsToRecord = (actualFuelGallons && actualFuelGallons > 0)
            ? Math.round(actualFuelGallons * 1000) / 1000
            : fuelCalc.gallons;
        const gasPrice = vehicleFuelService.getGasPrice();
        const costToRecord = (actualFuelGallons && actualFuelGallons > 0)
            ? parseFloat((gallonsToRecord * gasPrice).toFixed(2))
            : fuelCalc.cost;
        activeTrip.fuelGallons = gallonsToRecord;
        activeTrip.fuelCost = costToRecord;
        // Fuel range is only tracked after the driver records an actual tank
        // level or fill-up. This prevents a made-up "low fuel" warning.
        vehicleFuelService.recordTripConsumption(gallonsToRecord, activeVeh, activeTrip.totalDistanceMiles);
        activeTrip.moneySaved = parseFloat((costToRecord * 0.12).toFixed(2)); // ~12% optimal routing savings
        activeTrip.vehicleName = `${activeVeh.year ? activeVeh.year + ' ' : ''}${activeVeh.make} ${activeVeh.model}`.trim();
        
        // Check predictive maintenance milestones and trigger alerts if due
        try {
            maintenanceAlertService.recordTripAndCheckMilestones(activeVeh, activeTrip.totalDistanceMiles);
        } catch (mErr) {
            console.warn('Could not check maintenance milestones:', mErr);
        }
    } catch (e) {
        console.warn('Could not compute trip fuel:', e);
    }

    const completedTrip = { ...activeTrip };
    void persistTripDetail(completedTrip);

    // Persist to localStorage
    const existing = getSavedTrips();
    existing.unshift(completedTrip);
    persistTripHistory(existing);

    console.log(`🏁 Trip ended: ${completedTrip.totalDistanceMiles} mi, score: ${completedTrip.safetyScore}`);

    activeTrip = null;
    lastRecordedPoint = null;
    try { localStorage.removeItem(ACTIVE_TRIP_STORAGE_KEY); } catch {}
    return completedTrip;
};

/** Get the active trip (null if no trip in progress) */
export const getActiveTrip = (): Trip | null => hydrateActiveTrip();

/** Reconnect navigation to an interrupted active trip instead of creating a duplicate. */
export const resumeTrip = (fallbackStartLocation: Location, destinationName?: string): Trip => {
    const existing = hydrateActiveTrip();
    if (existing) return existing;
    return startTrip(fallbackStartLocation, destinationName);
};

/** Drop an interrupted trip that the user explicitly chose not to continue. */
export const discardActiveTrip = (): void => {
    activeTrip = null;
    lastRecordedPoint = null;
    try { localStorage.removeItem(ACTIVE_TRIP_STORAGE_KEY); } catch {}
};

/** Get saved trip history from localStorage */
export const getSavedTrips = (): Trip[] => {
    try {
        const stored = localStorage.getItem(TRIPS_STORAGE_KEY);
        const trips = stored ? JSON.parse(stored) as Trip[] : [];
        if (!Array.isArray(trips)) return [];
        // Migrate oversized histories from earlier builds the next time the
        // app starts, before another trip attempts to append to them.
        const compacted = trips.slice(0, MAX_STORED_TRIPS).map(trip => {
            if (trip.path?.length > MAX_STORED_POINTS_PER_TRIP) void persistTripDetail(trip);
            return compactTripForStorage(trip);
        });
        if (stored && JSON.stringify(compacted).length < stored.length) persistTripHistory(compacted);
        return compacted;
    } catch {
        return [];
    }
};

/** Delete a specific trip */
export const deleteTrip = (tripId: string): void => {
    const trips = getSavedTrips().filter(t => t.id !== tripId);
    persistTripHistory(trips);
    void removeTripDetail(tripId);
};

/** Clear all trip history */
export const clearTripHistory = (): void => {
    localStorage.removeItem(TRIPS_STORAGE_KEY);
    void removeTripDetail();
};

/** Format duration from ms to human readable */
export const formatDuration = (startTime: number, endTime: number): string => {
    const mins = Math.floor((endTime - startTime) / 60000);
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    const remainMins = mins % 60;
    return `${hrs}h ${remainMins}m`;
};
