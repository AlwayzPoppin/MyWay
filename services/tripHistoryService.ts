
import { Trip, TripPoint, Location } from '../types';
import { getDistanceMiles } from '../utils/geo';
import { vehicleFuelService } from './vehicleFuelService';
import { maintenanceAlertService } from './maintenanceAlertService';

// In-memory active trip + localStorage persistence for history
const TRIPS_STORAGE_KEY = 'myway_trip_history';
const MAX_STORED_TRIPS = 50;

let activeTrip: Trip | null = null;
let lastRecordedPoint: TripPoint | null = null;

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
};

/** Record a driving event during active trip */
export const recordDriveEvent = (
    type: 'hard_brake' | 'rapid_accel' | 'speeding',
    location: Location
): void => {
    if (!activeTrip) return;
    activeTrip.driveEvents.push({ type, timestamp: Date.now(), location });

    // Penalty per event
    const penalty = type === 'hard_brake' ? 3 : type === 'speeding' ? 5 : 2;
    activeTrip.safetyScore = Math.max(0, activeTrip.safetyScore - penalty);
};

/** End the active trip and save it */
export const endTrip = (endLocation?: Location): Trip | null => {
    if (!activeTrip) return null;

    activeTrip.endTime = Date.now();
    activeTrip.endLocation = endLocation || (lastRecordedPoint ? { lat: lastRecordedPoint.lat, lng: lastRecordedPoint.lng } : undefined);
    activeTrip.isActive = false;
    activeTrip.totalDistanceMiles = Math.round(activeTrip.totalDistanceMiles * 100) / 100;

    // Calculate exact fuel usage & cost based on active vehicle
    try {
        const activeVeh = vehicleFuelService.getActiveVehicle();
        const fuelCalc = vehicleFuelService.calculateTripFuel(activeTrip.totalDistanceMiles, activeVeh);
        activeTrip.fuelGallons = fuelCalc.gallons;
        activeTrip.fuelCost = fuelCalc.cost;
        activeTrip.moneySaved = parseFloat((fuelCalc.cost * 0.12).toFixed(2)); // ~12% optimal routing savings
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
    return completedTrip;
};

/** Get the active trip (null if no trip in progress) */
export const getActiveTrip = (): Trip | null => activeTrip;

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
