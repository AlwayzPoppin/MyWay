import { IncidentReport, IncidentType, Location } from '../types';
import { auth, database as rtdb } from './firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { ref, set, onValue, update, remove, get } from 'firebase/database';
import { getDistanceMeters } from '../utils/geo';
import { speechService } from './speechService';

const INCIDENTS_REF_PATH = 'road_incidents';
const LOCAL_STORAGE_KEY = 'myway_local_incidents';

// Default time-to-live per incident category (milliseconds)
const TTL_MAP: Record<IncidentType, number> = {
    police: 45 * 60 * 1000,        // 45 mins
    hazard: 120 * 60 * 1000,       // 2 hours
    shoulder: 60 * 60 * 1000,      // 1 hour
    construction: 360 * 60 * 1000, // 6 hours
    traffic: 90 * 60 * 1000,       // 1.5 hours
    safety_alert: 180 * 60 * 1000, // 3 hours
    road_closed: 4 * 60 * 60 * 1000,
    signal_out: 2 * 60 * 60 * 1000,
    crash: 2 * 60 * 60 * 1000,
    blocked_lane: 60 * 60 * 1000,
    bad_weather: 3 * 60 * 60 * 1000,
    animal: 45 * 60 * 1000,
    stop_sign: 0, speed_bump: 0,
    missing_vehicle_access: 0, wrong_traffic_direction: 0, restricted_access: 0
};

class IncidentService {
    private activeIncidents: IncidentReport[] = [];
    private listeners = new Set<(incidents: IncidentReport[]) => void>();
    private stopAuth: (() => void) | undefined;
    private stopRealtime: (() => void) | undefined;

    constructor() {
        this.loadLocalCache();
    }

    private loadLocalCache() {
        try {
            const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
            if (raw) {
                const list: IncidentReport[] = JSON.parse(raw);
                const now = Date.now();
                this.activeIncidents = list.filter(i => !i.expiresAt || i.expiresAt > now);
            }
        } catch (e) {
            console.warn('[IncidentService] Local cache load failed:', e);
        }
    }

    private saveLocalCache() {
        try {
            localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(this.activeIncidents));
        } catch (e) {}
    }

    /**
     * Subscribe to real-time incident updates across all drivers & circle members
     */
    public subscribe(callback: (incidents: IncidentReport[]) => void): () => void {
        this.listeners.add(callback);
        // Immediately provide cached data
        callback(this.activeIncidents);

        if (!this.stopAuth && rtdb) {
            this.stopAuth = onAuthStateChanged(auth, user => {
                this.stopRealtime?.();
                this.stopRealtime = undefined;
                if (!user) return;
                const incidentsRef = ref(rtdb, INCIDENTS_REF_PATH);
                this.stopRealtime = onValue(incidentsRef, (snapshot) => {
                    const data = snapshot.val();
                    if (!data) {
                        this.activeIncidents = [];
                    } else {
                        const now = Date.now();
                        const list: IncidentReport[] = [];
                        Object.keys(data).forEach(key => {
                            const item = data[key] as IncidentReport;
                            if (item && item.location && (!item.expiresAt || item.expiresAt > now)) {
                                list.push({ ...item, id: key });
                            }
                        });
                        this.activeIncidents = list;
                    }
                    this.saveLocalCache();
                    this.notifyListeners();
                }, (error) => {
                    console.warn('[IncidentService] RTDB sync error:', error);
                });
            });
        }

        return () => {
            this.listeners.delete(callback);
            if (this.listeners.size === 0) {
                this.stopAuth?.();
                this.stopRealtime?.();
                this.stopAuth = undefined;
                this.stopRealtime = undefined;
            }
        };
    }

    private notifyListeners() {
        this.listeners.forEach(cb => cb(this.activeIncidents));
    }

    /**
     * Report a road incident after the driver confirms the selected detail.
     */
    public async reportIncident(
        type: IncidentType,
        location: Location,
        user: { id: string; name?: string; avatar?: string },
        details?: string
    ): Promise<IncidentReport> {
        const id = `inc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        const now = Date.now();
        const ttl = TTL_MAP[type] || (60 * 60 * 1000);
        const isPermanent = type === 'speed_bump' || type === 'stop_sign'
            || type === 'missing_vehicle_access' || type === 'wrong_traffic_direction' || type === 'restricted_access';

        const newIncident: IncidentReport = {
            id,
            type,
            location: {
                lat: Number(location.lat.toFixed(6)),
                lng: Number(location.lng.toFixed(6))
            },
            timestamp: new Date(now).toISOString(),
            reporterId: user.id || 'anonymous',
            reporterName: user.name || 'Driver',
            reporterAvatar: user.avatar || '',
            details: details || '',
            upvotes: 1,
            upvoterIds: [user.id],
            downvotes: 0,
            downvoterIds: [],
            ...(isPermanent ? {} : { expiresAt: now + ttl }),
            isPermanent,
            verified: false
        };

        // 1. Optimistic Local Update
        this.activeIncidents = [newIncident, ...this.activeIncidents];
        this.saveLocalCache();
        this.notifyListeners();

        // 2. Audio voice confirmation
        const speechMsg = 
            type === 'police' ? 'Police radar trap reported. Shared with community.' :
            type === 'hazard' ? 'Road hazard reported. Drive safely.' :
            type === 'shoulder' ? 'Vehicle on shoulder reported.' :
            type === 'construction' ? 'Road construction reported.' :
            type === 'road_closed' ? 'Road closure reported. Rerouting may be needed.' :
            type === 'signal_out' ? 'Traffic signal outage reported. Use caution.' :
            type === 'crash' ? 'Crash reported. Drive carefully.' :
            type === 'blocked_lane' ? 'Blocked lane reported. Use caution.' :
            type === 'bad_weather' ? 'Road weather condition reported. Drive carefully.' :
            type === 'animal' ? 'Animal near the road reported. Use caution.' :
            type === 'stop_sign' ? 'Stop sign added as a road feature.' : type === 'speed_bump' ? 'Speed bump added as a road feature.' :
            type === 'missing_vehicle_access' ? 'Missing vehicle access shared with My Way drivers.' :
            type === 'wrong_traffic_direction' ? 'Traffic direction issue shared with My Way drivers.' :
            type === 'restricted_access' ? 'Restricted road access shared with My Way drivers.' :
            type === 'safety_alert' ? 'Flooded road reported. Use caution.' :
            'Road incident reported.';
        speechService.speak(speechMsg);

        // 3. Persist to Firebase Realtime Database
        if (rtdb) {
            try {
                const itemRef = ref(rtdb, `${INCIDENTS_REF_PATH}/${id}`);
                await set(itemRef, newIncident);
            } catch (e) {
                console.warn('[IncidentService] RTDB write error:', e);
            }
        }

        return newIncident;
    }

    /**
     * Upvote an incident ("Still There")
     */
    public async upvoteIncident(incidentId: string, userId: string): Promise<void> {
        const item = this.activeIncidents.find(i => i.id === incidentId);
        if (!item) return;

        const upvoterIds = item.upvoterIds || [];
        if (upvoterIds.includes(userId)) return; // Already upvoted

        const newUpvotes = (item.upvotes || 0) + 1;
        const newUpvoterIds = [...upvoterIds, userId];
        const verified = newUpvotes >= 2;

        // Local state update
        item.upvotes = newUpvotes;
        item.upvoterIds = newUpvoterIds;
        item.verified = verified;
        this.notifyListeners();
        this.saveLocalCache();

        speechService.speak('Thanks for confirming. Incident verified.');

        // Firebase RTDB update
        if (rtdb) {
            try {
                const itemRef = ref(rtdb, `${INCIDENTS_REF_PATH}/${incidentId}`);
                await update(itemRef, {
                    upvotes: newUpvotes,
                    upvoterIds: newUpvoterIds,
                    verified
                });
            } catch (e) {
                console.warn('[IncidentService] RTDB upvote error:', e);
            }
        }
    }

    /**
     * Downvote / clear an incident ("Cleared / Not There")
     */
    public async clearIncident(incidentId: string, userId: string): Promise<void> {
        const item = this.activeIncidents.find(i => i.id === incidentId);
        if (!item) return;

        const downvoterIds = item.downvoterIds || [];
        if (downvoterIds.includes(userId)) return; // Already voted

        const newDownvotes = (item.downvotes || 0) + 1;
        const newDownvoterIds = [...downvoterIds, userId];

        // If 2 or more cleared votes, remove the incident entirely
        if (newDownvotes >= 2 || newDownvotes > (item.upvotes || 1)) {
            this.activeIncidents = this.activeIncidents.filter(i => i.id !== incidentId);
            this.notifyListeners();
            this.saveLocalCache();

            speechService.speak('Incident marked as cleared.');

            if (rtdb) {
                try {
                    const itemRef = ref(rtdb, `${INCIDENTS_REF_PATH}/${incidentId}`);
                    await remove(itemRef);
                } catch (e) {}
            }
        } else {
            item.downvotes = newDownvotes;
            item.downvoterIds = newDownvoterIds;
            this.notifyListeners();
            this.saveLocalCache();

            speechService.speak('Report received.');

            if (rtdb) {
                try {
                    const itemRef = ref(rtdb, `${INCIDENTS_REF_PATH}/${incidentId}`);
                    await update(itemRef, {
                        downvotes: newDownvotes,
                        downvoterIds: newDownvoterIds
                    });
                } catch (e) {}
            }
        }
    }

    /**
     * Directly delete / cancel an incident report (e.g. placed by accident or wrong alert)
     */
    public async removeIncident(incidentId: string, userId?: string): Promise<boolean> {
        // Optimistic local update
        this.activeIncidents = this.activeIncidents.filter(i => i.id !== incidentId);
        this.saveLocalCache();
        this.notifyListeners();

        speechService.speak('Alert removed.');

        if (rtdb) {
            try {
                const itemRef = ref(rtdb, `${INCIDENTS_REF_PATH}/${incidentId}`);
                await remove(itemRef);
                return true;
            } catch (e) {
                console.warn('[IncidentService] RTDB remove error:', e);
            }
        }
        return true;
    }

    public async deleteIncident(incidentId: string, userId?: string): Promise<boolean> {
        return this.removeIncident(incidentId, userId);
    }

    /**
     * Find active incidents within radius of a target location
     */
    public findIncidentsNear(location: Location, radiusMeters: number = 600): IncidentReport[] {
        return this.activeIncidents.filter(inc => {
            if (!inc.location) return false;
            const dist = getDistanceMeters(location, inc.location);
            return dist <= radiusMeters;
        });
    }

    public getActiveIncidents(): IncidentReport[] {
        return this.activeIncidents;
    }
}

export const incidentService = new IncidentService();
