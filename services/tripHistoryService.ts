
import { Trip, TripPoint, Location } from '../types';
import { getDistanceMiles } from '../utils/geo';
import { vehicleFuelService } from './vehicleFuelService';
import { maintenanceAlertService } from './maintenanceAlertService';

// In-memory active trip + localStorage persistence for history
const TRIPS_STORAGE_KEY = 'myway_trip_history';
const ACTIVE_TRIP_STORAGE_KEY = 'myway_active_trip';
const MAX_STORED_TRIPS = 50;

let activeTrip: Trip | null = null;
let lastRecordedPoint: TripPoint | null = null;

const persistActiveTrip = (): void => {
    try {
        if (activeTrip) localStorage.setItem(ACTIVE_TRIP_STORAGE_KEY, JSON.stringify(activeTrip));
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
export const startTrip = (startLocation: Location, destinationName?: string): Trip => {
    const trip: Trip = {
        id: `trip_${Date.now()}`,
        userId: '',
        startTime: Date.now(),
        startLocation,
        destinationName,
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

    // Persist to localStorage
    const existing = getSavedTrips();
    existing.unshift(completedTrip);
    if (existing.length > MAX_STORED_TRIPS) existing.pop();
    localStorage.setItem(TRIPS_STORAGE_KEY, JSON.stringify(existing));

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
        return stored ? JSON.parse(stored) : [];
    } catch {
        return [];
    }
};

/** Delete a specific trip */
export const deleteTrip = (tripId: string): void => {
    const trips = getSavedTrips().filter(t => t.id !== tripId);
    localStorage.setItem(TRIPS_STORAGE_KEY, JSON.stringify(trips));
};

/** Clear all trip history */
export const clearTripHistory = (): void => {
    localStorage.removeItem(TRIPS_STORAGE_KEY);
};

/** Format duration from ms to human readable */
export const formatDuration = (startTime: number, endTime: number): string => {
    const mins = Math.floor((endTime - startTime) / 60000);
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    const remainMins = mins % 60;
    return `${hrs}h ${remainMins}m`;
};
