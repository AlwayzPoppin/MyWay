/**
 * Parking Service
 * Manages the dynamic "Last Parked" lifecycle:
 * - Detects vehicle parking upon transition from driving to walking/stationary away from home.
 * - Enforces strict Home exclusion (never tags parked vehicle when at home).
 * - Creates temporary Parked Vehicle place with a 25m (~82 ft) geofence radius.
 * - Triggers "You parked here" local notification and circle broadcast on exit (walking away).
 * - Triggers "[User] returned to their vehicle" circle broadcast on return.
 * - Automatically deletes temporary parked vehicle upon sustained driving.
 */

import { Place, ParkedVehiclePlace, Location } from '../types';
import { getDistanceFromCoords } from '../utils/geo';
import { isAtHomePlace, isPointInDrivewayZone } from './locationService';
import { reverseGeocode } from './placesService';
import { broadcastGeofencePushAlert } from './pushNotificationService';
import { sendMessage } from './chatService';
import { updateUserStatusInFirestore } from './authService';
import { isCurrentLocationPublisher } from './deviceSessionService';

export const PARKED_GEOFENCE_RADIUS_METERS = 25; // 25 meters ≈ 82 feet (within 50–100 ft requirement)
const STORAGE_KEY = 'myway_parked_vehicle';

export interface ParkingTelemetryParams {
    userLocation: Location;
    speedMph: number;
    status: 'Driving' | 'Walking' | 'Stationary';
    /** Parking must only be inferred from a recent, reasonably precise GPS fix. */
    accuracy?: number;
    gpsTimestamp?: number;
    places: Place[];
    user?: { uid: string; displayName?: string | null } | null;
    profile?: { displayName?: string; familyCircleId?: string; activeLocationDeviceId?: string | null } | null;
    circleId?: string;
    showNotification?: (message: string, duration?: number) => void;
    logActivity?: (type: any, title: string, message: string, icon: string, memberId?: string) => void;
}

class ParkingService {
    private parkedVehicle: ParkedVehiclePlace | null = null;
    private listeners = new Set<(place: ParkedVehiclePlace | null) => void>();
    private wasDriving: boolean = false;
    private isDrivewayParked: boolean = false;
    private sustainedDrivingFixes: number = 0;
    private confirmedDrivingFixes: number = 0;
    private parkingCandidate: { location: Location; firstSeenAt: number; lastSeenAt: number; fixes: number } | null = null;
    private lastEvaluationTime: number = 0;
    private isProcessing: boolean = false;
    private alertHandlers?: {
        showNotification?: (message: string, duration?: number) => void;
        logActivity?: (type: any, title: string, message: string, icon: string, memberId?: string) => void;
    };

    constructor() {
        this.loadFromStorage();
    }

    public setAlertHandlers(handlers: {
        showNotification?: (message: string, duration?: number) => void;
        logActivity?: (type: any, title: string, message: string, icon: string, memberId?: string) => void;
    }): void {
        this.alertHandlers = handlers;
    }

    public reset(): void {
        this.parkedVehicle = null;
        this.wasDriving = false;
        this.isDrivewayParked = false;
        this.sustainedDrivingFixes = 0;
        this.confirmedDrivingFixes = 0;
        this.parkingCandidate = null;
        this.lastEvaluationTime = 0;
        this.isProcessing = false;
        this.saveToStorage();
        this.notifyListeners();
    }

    public isParkedInDriveway(): boolean {
        return this.isDrivewayParked;
    }

    /**
     * A parking label is valid only while the user remains inside the original
     * parked-vehicle zone and has not walked away from it.
     */
    public isWithinConfirmedParkedZone(location: Location | null | undefined): boolean {
        if (!this.parkedVehicle || this.parkedVehicle.hasWalkedAway || !location) {
            return false;
        }

        return getDistanceFromCoords(
            location.lat,
            location.lng,
            this.parkedVehicle.location.lat,
            this.parkedVehicle.location.lng
        ) <= PARKED_GEOFENCE_RADIUS_METERS;
    }

    private loadFromStorage(): void {
        if (typeof localStorage === 'undefined') return;
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed && parsed.location && typeof parsed.location.lat === 'number') {
                    this.parkedVehicle = parsed;
                }
            }
        } catch (e) {
            console.warn('[ParkingService] Failed to load stored parked vehicle:', e);
        }
    }

    private saveToStorage(): void {
        if (typeof localStorage === 'undefined') return;
        try {
            if (this.parkedVehicle) {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(this.parkedVehicle));
            } else {
                localStorage.removeItem(STORAGE_KEY);
            }
        } catch (e) {
            console.warn('[ParkingService] Failed to persist parked vehicle:', e);
        }
    }

    private notifyListeners(): void {
        this.listeners.forEach(cb => {
            try {
                cb(this.parkedVehicle);
            } catch (err) {
                console.error('[ParkingService] Listener notification error:', err);
            }
        });
    }

    public getParkedVehicle(): ParkedVehiclePlace | null {
        return this.parkedVehicle;
    }

    public subscribe(callback: (place: ParkedVehiclePlace | null) => void): () => void {
        this.listeners.add(callback);
        callback(this.parkedVehicle);
        return () => {
            this.listeners.delete(callback);
        };
    }

    public clearParkedVehicle(): void {
        console.log('🅿️ [ParkingService] Manually cleared parked vehicle.');
        this.parkedVehicle = null;
        this.sustainedDrivingFixes = 0;
        this.saveToStorage();
        this.notifyListeners();
    }

    /**
     * Set parked vehicle manually or for testing
     */
    public setParkedVehicle(place: ParkedVehiclePlace | null): void {
        this.parkedVehicle = place;
        this.saveToStorage();
        this.notifyListeners();
    }

    /**
     * Main telemetry evaluation loop called on each high-precision GPS update
     */
    public async processTelemetry(params: ParkingTelemetryParams): Promise<void> {
        const { userLocation, speedMph, status, places, user, profile, circleId, showNotification, logActivity, accuracy, gpsTimestamp } = params;
        if (!userLocation || typeof userLocation.lat !== 'number' || typeof userLocation.lng !== 'number') {
            return;
        }

        const notify = showNotification || this.alertHandlers?.showNotification;
        const log = logActivity || this.alertHandlers?.logActivity;

        const now = Date.now();
        const fixAgeMs = gpsTimestamp ? now - gpsTimestamp : 0;
        const isRecentFix = !gpsTimestamp || (fixAgeMs >= 0 && fixAgeMs <= 20_000);
        const isPreciseEnoughToPark = typeof accuracy === 'number' && accuracy <= 50;

        // A stale or broad accuracy circle can be useful as context, but it is
        // never evidence that a vehicle stopped at that coordinate.
        if (!isRecentFix || !isPreciseEnoughToPark) {
            this.parkingCandidate = null;
            return;
        }
        // Throttle evaluation to at most once every 1 second
        if (now - this.lastEvaluationTime < 1000) {
            return;
        }
        this.lastEvaluationTime = now;

        if (this.isProcessing) return;
        this.isProcessing = true;

        try {
            const isDriving = status === 'Driving' || speedMph > 5;
            const isWalking = status === 'Walking' || (speedMph > 0.6 && speedMph <= 5);
            const isStationary = status === 'Stationary' || speedMph <= 0.6;
            const isWalkingOrStationary = isWalking || isStationary || speedMph <= 1.5;

            this.confirmedDrivingFixes = isDriving ? this.confirmedDrivingFixes + 1 : 0;
            if (isDriving) {
                this.parkingCandidate = null;
            }

            // ──────────────────────────────────────────────────────────
            // 0. DRIVEWAY STATUS RESET
            // ──────────────────────────────────────────────────────────
            // When user transitions back to "walking" (leaving driveway on foot) or "driving" (leaving in vehicle),
            // clear "Parked in Driveway" status and revert to standard location tracking
            if (this.isDrivewayParked) {
                const drivewayCheck = isPointInDrivewayZone(userLocation, places);
                if (isDriving || (isWalking && !drivewayCheck.isDriveway)) {
                    console.log(`🚗 [ParkingService] User left Driveway (${isDriving ? 'driving' : 'walking on foot'}). Clearing "Parked in Driveway" status.`);
                    this.isDrivewayParked = false;
                    const activeCircleId = circleId || profile?.familyCircleId;
                    const memberId = user?.uid || 'demo-you';
                    if (activeCircleId && isCurrentLocationPublisher(profile?.activeLocationDeviceId)) {
                        const standardStatus = isDriving ? `Driving • ${speedMph} MPH` : 'Walking';
                        updateUserStatusInFirestore(activeCircleId, memberId, standardStatus).catch(e => {});
                    }
                }
            }

            // ──────────────────────────────────────────────────────────
            // 1. SUSTAINED DRIVING -> AUTO-CLEANUP / RESET STATE
            // ──────────────────────────────────────────────────────────
            if (this.parkedVehicle) {
                const distFromVehicle = getDistanceFromCoords(
                    userLocation.lat,
                    userLocation.lng,
                    this.parkedVehicle.location.lat,
                    this.parkedVehicle.location.lng
                );

                if (isDriving) {
                    this.sustainedDrivingFixes++;
                    // Cleanup when user sustained driving speed > 10 mph for >= 3 fixes or moved > 100m away while driving
                    if ((speedMph > 10 && this.sustainedDrivingFixes >= 3) || (distFromVehicle > 100 && this.sustainedDrivingFixes >= 2)) {
                        console.log(`🅿️ [ParkingService] User resumed sustained driving (${speedMph} mph, ${distFromVehicle.toFixed(0)}m from vehicle). Deleting temporary parked vehicle.`);
                        this.clearParkedVehicle();
                        this.wasDriving = true;
                        return;
                    }
                } else {
                    this.sustainedDrivingFixes = 0;
                }
            }

            // ──────────────────────────────────────────────────────────
            // 2. PARKING DETECTION, DRIVEWAY POLYGON & HOME EXCLUSION
            // ──────────────────────────────────────────────────────────
            // Triggered on transition: previous state was driving -> now walking/stationary
            if (this.wasDriving && isWalkingOrStationary && !this.parkedVehicle) {
                const candidate = this.parkingCandidate;
                const isSameStop = candidate && getDistanceFromCoords(
                    userLocation.lat,
                    userLocation.lng,
                    candidate.location.lat,
                    candidate.location.lng
                ) <= 35;

                this.parkingCandidate = isSameStop
                    ? { ...candidate!, location: userLocation, lastSeenAt: now, fixes: candidate!.fixes + 1 }
                    : { location: userLocation, firstSeenAt: now, lastSeenAt: now, fixes: 1 };

                // A stopped-looking point is not a parked car. Require a real
                // driving sequence followed by three accurate fixes at the same
                // stop, which prevents a single bad GPS sample from creating a pin.
                if (this.parkingCandidate.fixes < 3) {
                    return;
                }

                this.parkingCandidate = null;
                // Home takes priority, including a driveway configured for Home.
                if (isAtHomePlace(userLocation, places)) {
                    console.log('🏠 [ParkingService] At Home: skipping parked-vehicle creation.');
                    this.isDrivewayParked = false;
                    this.wasDriving = false;
                    return;
                }

                // CONDITIONAL CHECK 1: Check a non-Home driveway polygon intersection
                const drivewayCheck = isPointInDrivewayZone(userLocation, places);

                if (drivewayCheck.isDriveway) {
                    console.log('🏠 [ParkingService] User parked within Driveway polygon zone. Setting status to "Parked in Driveway".');
                    this.isDrivewayParked = true;

                    const activeCircleId = circleId || profile?.familyCircleId;
                    const memberId = user?.uid || 'demo-you';
                    const userFullName = profile?.displayName?.trim() || user?.displayName?.trim() || '';
                    const userFirstName = userFullName && !/^you$/i.test(userFullName)
                        ? userFullName.split(/\s+/)[0] : 'A circle member';

                    // 1. Update user's live status in Firestore to: "Parked in Driveway"
                    if (activeCircleId && isCurrentLocationPublisher(profile?.activeLocationDeviceId)) {
                        updateUserStatusInFirestore(activeCircleId, memberId, 'Parked in Driveway').catch(e => {
                            console.warn('[ParkingService] Could not update Firestore status to Parked in Driveway:', e);
                        });
                    }

                    // 2. Trigger specific Circle notification: "[User First Name] parked in the Driveway."
                    const drivewayNotification = `${userFirstName} parked in the Driveway.`;
                    console.log(`📢 [ParkingService] Circle Notification: ${drivewayNotification}`);

                    if (notify) {
                        notify('🏠 You parked in the driveway.', 6000);
                    }

                    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
                        try {
                            new Notification('Parked in Driveway', {
                                body: 'You parked in the driveway.',
                                icon: '/icon-192.png'
                            });
                        } catch (e) {}
                    }

                    if (activeCircleId) {
                        sendMessage(activeCircleId, memberId, drivewayNotification, 'geofence').catch(e => {});
                        broadcastGeofencePushAlert(
                            activeCircleId,
                            memberId,
                            userFirstName,
                            'Driveway',
                            'arrival',
                            userLocation
                        ).catch(e => {});
                    }

                    if (log) {
                        log('arrival', 'Parked in Driveway', 'You parked in the driveway.', '🏠', memberId);
                    }

                    // Do not create a temporary "Last Parked" map pin or generic radius
                    this.wasDriving = false;
                    return;
                }

                // CONDITIONAL CHECK 2: Outside Home/Driveway Zones -> Fallback to temporary Last Parked place
                console.log(`🅿️ [ParkingService] Detected parking transition away from home at ${userLocation.lat.toFixed(5)}, ${userLocation.lng.toFixed(5)}`);

                    // Reverse geocode to get nearest address or POI
                    let nearestAddress = 'your parking location';
                    let poiName = 'Parked Vehicle';
                    try {
                        const geoResult = await reverseGeocode({ lat: userLocation.lat, lng: userLocation.lng });
                        if (geoResult) {
                            if (geoResult.address) nearestAddress = geoResult.address.split(',')[0].trim();
                            if (geoResult.name) poiName = geoResult.name;
                        }
                    } catch (geoErr) {
                        console.warn('[ParkingService] Reverse geocoding failed:', geoErr);
                    }

                    const newParkedPlace: ParkedVehiclePlace = {
                        id: 'temp-parked-vehicle',
                        name: 'Parked Vehicle',
                        type: 'parked_vehicle',
                        category: 'parked_vehicle',
                        icon: '🚗',
                        location: { lat: userLocation.lat, lng: userLocation.lng },
                        radius: PARKED_GEOFENCE_RADIUS_METERS,
                        departureRadius: PARKED_GEOFENCE_RADIUS_METERS,
                        isSaved: false,
                        parkedAt: Date.now(),
                        hasWalkedAway: false,
                        hasReturned: false,
                        nearestAddress,
                        description: `Parked near ${nearestAddress}`
                    };

                    this.parkedVehicle = newParkedPlace;
                    this.sustainedDrivingFixes = 0;
                    this.saveToStorage();
                    this.notifyListeners();
                }

            // ──────────────────────────────────────────────────────────
            // 3. TEMPORARY GEOFENCE TRIGGERS (WALKING AWAY & RETURNING)
            // ──────────────────────────────────────────────────────────
            if (this.parkedVehicle) {
                const distToVehicle = getDistanceFromCoords(
                    userLocation.lat,
                    userLocation.lng,
                    this.parkedVehicle.location.lat,
                    this.parkedVehicle.location.lng
                );

                const activeCircleId = circleId || profile?.familyCircleId;
                const memberId = user?.uid || 'demo-you';
                const userFullName = profile?.displayName?.trim() || user?.displayName?.trim() || '';
                const userFirstName = userFullName && !/^you$/i.test(userFullName)
                    ? userFullName.split(/\s+/)[0] : 'A circle member';
                const nearestDesc = this.parkedVehicle.nearestAddress || 'their destination';

                // A. ON EXIT (WALKING AWAY): Live location breaches outer edge of small radius (> 25m)
                if (!this.parkedVehicle.hasWalkedAway && distToVehicle > PARKED_GEOFENCE_RADIUS_METERS) {
                    console.log(`🚶 [ParkingService] User breached parking geofence (${distToVehicle.toFixed(1)}m > ${PARKED_GEOFENCE_RADIUS_METERS}m). Walking away.`);
                    this.parkedVehicle.hasWalkedAway = true;
                    this.saveToStorage();
                    this.notifyListeners();

                    // Event 1: Local Notification: "You parked here."
                    if (notify) {
                        notify('📍 You parked here.', 6000);
                    }
                    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
                        try {
                            new Notification('You parked here.', {
                                body: `Your vehicle's location was saved near ${this.parkedVehicle.nearestAddress || 'your destination'}.`,
                                icon: '/icon-192.png'
                            });
                        } catch (e) {}
                    }

                    // Event 2: Circle Broadcast (Firestore): "[User First Name] just parked near [Nearest Address/POI]."
                    const broadcastMessage = `${userFirstName} just parked near ${nearestDesc}.`;
                    console.log(`📢 [ParkingService] Circle Broadcast: ${broadcastMessage}`);

                    if (activeCircleId) {
                        // Persist to Circle Firestore Chat / Geofence Alerts feed
                        sendMessage(activeCircleId, memberId, broadcastMessage, 'geofence').catch(e => {
                            console.warn('[ParkingService] Could not send circle chat broadcast:', e);
                        });
                        broadcastGeofencePushAlert(
                            activeCircleId,
                            memberId,
                            userFirstName,
                            `Parked near ${nearestDesc}`,
                            'departure',
                            this.parkedVehicle.location
                        ).catch(e => {
                            console.warn('[ParkingService] Could not broadcast push alert:', e);
                        });
                    }

                    if (log) {
                        log(
                            'departure',
                            'Vehicle Parked',
                            `You parked near ${this.parkedVehicle.nearestAddress || 'your destination'}.`,
                            '🚗',
                            memberId
                        );
                    }
                }

                // B. ON ENTER (RETURNING): Live location re-enters radius after being away (<= 25m)
                else if (this.parkedVehicle.hasWalkedAway && !this.parkedVehicle.hasReturned && distToVehicle <= PARKED_GEOFENCE_RADIUS_METERS) {
                    console.log(`🚗 [ParkingService] User returned to parking geofence (${distToVehicle.toFixed(1)}m <= ${PARKED_GEOFENCE_RADIUS_METERS}m).`);
                    this.parkedVehicle.hasReturned = true;
                    this.saveToStorage();
                    this.notifyListeners();

                    // Event: Circle Broadcast (Firestore): "[User First Name] returned to their vehicle."
                    const returnMessage = `${userFirstName} returned to their vehicle.`;
                    console.log(`📢 [ParkingService] Circle Broadcast: ${returnMessage}`);

                    if (notify) {
                        notify('🚗 You returned to your car.', 5000);
                    }

                    if (activeCircleId) {
                        sendMessage(activeCircleId, memberId, returnMessage, 'geofence').catch(e => {
                            console.warn('[ParkingService] Could not send circle return broadcast:', e);
                        });
                        broadcastGeofencePushAlert(
                            activeCircleId,
                            memberId,
                            userFirstName,
                            'Parked Vehicle',
                            'arrival',
                            this.parkedVehicle.location
                        ).catch(e => {
                            console.warn('[ParkingService] Could not broadcast return push alert:', e);
                        });
                    }

                    if (log) {
                        log(
                            'arrival',
                            'Returned to Vehicle',
                            'You returned to your car.',
                            '🚗',
                            memberId
                        );
                    }
                }
            }

            // Update wasDriving state for next tick
            this.wasDriving = this.confirmedDrivingFixes >= 2;
        } finally {
            this.isProcessing = false;
        }
    }
}

export const parkingService = new ParkingService();

if (typeof window !== 'undefined') {
    (window as any).parkingService = parkingService;
}
