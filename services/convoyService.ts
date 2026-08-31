/**
 * Multi-Vehicle Caravan & Convoy Service
 * Real-time convoy tracking, member invite dispatching, separation alerts,
 * leader/follower telemetry, and pit stop synchronizer for multi-vehicle family road trips.
 */

import { Location, FamilyMember, NavigationRoute } from '../types';
import { getDistanceMiles } from '../utils/geo';
import { speechService } from './speechService';
import { ref, set, onValue, off } from 'firebase/database';
import { database } from './firebase';

export interface ConvoyMember {
    id: string;
    name: string;
    avatar?: string;
    location: Location;
    speed: number;
    heading: number;
    distanceToUserMiles: number;
    isAhead: boolean;
    role: 'leader' | 'follower';
    status: 'on_track' | 'lagging' | 'stopped' | 'pit_stop';
    vehicleInfo?: string;
}

export interface ConvoySession {
    id: string;
    name: string;
    destinationName: string;
    destinationLocation: Location;
    leaderId: string;
    leaderName: string;
    memberIds: string[];
    isActive: boolean;
    startTime: number;
    currentRoute?: NavigationRoute | null;
    lastRerouteTimestamp?: number;
}

export interface ConvoyInvite {
    session: ConvoySession;
    senderName: string;
    timestamp: number;
}

export interface ConvoyRerouteEvent {
    convoyId: string;
    route: NavigationRoute;
    leaderId: string;
    timestamp: number;
}

const CONVOY_STORAGE_KEY = 'myway_active_convoy';
const CONVOY_INVITE_EVENT = 'myway_convoy_invite_event';
const CONVOY_REROUTE_EVENT = 'myway_convoy_reroute_event';

class ConvoyService {
    private activeConvoy: ConvoySession | null = null;
    private listeners: ((convoy: ConvoySession | null) => void)[] = [];
    private inviteListeners: ((invite: ConvoyInvite | null) => void)[] = [];
    private rerouteListeners: ((route: NavigationRoute, event: ConvoyRerouteEvent) => void)[] = [];
    private pendingInvite: ConvoyInvite | null = null;
    private lastSeparationAlertTime: number = 0;

    constructor() {
        this.load();
        this.setupBroadcastListener();
    }

    private load(): void {
        if (typeof window === 'undefined') return;
        try {
            const raw = localStorage.getItem(CONVOY_STORAGE_KEY);
            if (raw) this.activeConvoy = JSON.parse(raw);
        } catch (e) {
            console.warn('[ConvoyService] Failed to load convoy:', e);
        }
    }

    private save(): void {
        if (typeof window === 'undefined') return;
        try {
            if (this.activeConvoy) {
                localStorage.setItem(CONVOY_STORAGE_KEY, JSON.stringify(this.activeConvoy));
            } else {
                localStorage.removeItem(CONVOY_STORAGE_KEY);
            }
            this.notify();
        } catch (e) {
            console.warn('[ConvoyService] Failed to save convoy:', e);
        }
    }

    private setupBroadcastListener(): void {
        if (typeof window === 'undefined') return;
        window.addEventListener('storage', (e) => {
            if (e.key === CONVOY_INVITE_EVENT && e.newValue) {
                try {
                    const invite: ConvoyInvite = JSON.parse(e.newValue);
                    this.pendingInvite = invite;
                    this.notifyInvite();
                } catch (err) {
                    console.warn('[ConvoyService] Failed to parse invite event:', err);
                }
            } else if (e.key === CONVOY_REROUTE_EVENT && e.newValue) {
                try {
                    const event: ConvoyRerouteEvent = JSON.parse(e.newValue);
                    if (this.activeConvoy && this.activeConvoy.id === event.convoyId) {
                        this.activeConvoy.currentRoute = event.route;
                        this.activeConvoy.lastRerouteTimestamp = event.timestamp;
                        this.save();
                    }
                    this.notifyReroute(event.route, event);
                } catch (err) {
                    console.warn('[ConvoyService] Failed to parse reroute event:', err);
                }
            }
        });
    }

    private notify(): void {
        this.listeners.forEach(cb => cb(this.activeConvoy));
    }

    private notifyInvite(): void {
        this.inviteListeners.forEach(cb => cb(this.pendingInvite));
    }

    private notifyReroute(route: NavigationRoute, event: ConvoyRerouteEvent): void {
        this.rerouteListeners.forEach(cb => cb(route, event));
    }

    public subscribe(callback: (convoy: ConvoySession | null) => void): () => void {
        this.listeners.push(callback);
        callback(this.activeConvoy);
        return () => {
            this.listeners = this.listeners.filter(cb => cb !== callback);
        };
    }

    public onInvite(callback: (invite: ConvoyInvite | null) => void): () => void {
        this.inviteListeners.push(callback);
        callback(this.pendingInvite);
        return () => {
            this.inviteListeners = this.inviteListeners.filter(cb => cb !== callback);
        };
    }

    public onReroute(callback: (route: NavigationRoute, event: ConvoyRerouteEvent) => void): () => void {
        this.rerouteListeners.push(callback);
        return () => {
            this.rerouteListeners = this.rerouteListeners.filter(cb => cb !== callback);
        };
    }

    public getActiveConvoy(): ConvoySession | null {
        return this.activeConvoy;
    }

    public isConvoyActive(): boolean {
        return !!this.activeConvoy && this.activeConvoy.isActive;
    }

    /**
     * Start a new convoy session with selected circle members
     */
    public startConvoy(
        destinationName: string,
        destinationLocation: Location,
        leaderId: string,
        leaderName: string,
        memberIds: string[] = []
    ): ConvoySession {
        const session: ConvoySession = {
            id: `convoy_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            name: `Caravan to ${destinationName}`,
            destinationName,
            destinationLocation,
            leaderId,
            leaderName,
            memberIds: Array.from(new Set([leaderId, ...memberIds])),
            isActive: true,
            startTime: Date.now()
        };

        this.activeConvoy = session;
        this.save();

        // Broadcast invite to other devices / members
        this.broadcastInvite(session, leaderName);

        speechService.speak(`Caravan launched for ${destinationName}. Convoy telemetry linked with ${session.memberIds.length > 1 ? `${session.memberIds.length - 1} vehicles` : 'circle'}.`);
        return session;
    }

    /**
     * Broadcast an invite to circle members
     */
    public broadcastInvite(session: ConvoySession, senderName: string): void {
        const invite: ConvoyInvite = {
            session,
            senderName,
            timestamp: Date.now()
        };
        this.pendingInvite = invite;
        this.notifyInvite();

        if (typeof window !== 'undefined') {
            try {
                localStorage.setItem(CONVOY_INVITE_EVENT, JSON.stringify(invite));
                // Clear key shortly after to allow re-triggering
                setTimeout(() => localStorage.removeItem(CONVOY_INVITE_EVENT), 5000);
            } catch (e) {
                console.warn('[ConvoyService] Failed to broadcast invite:', e);
            }
        }
    }

    /**
     * Accept a received convoy invite
     */
    public acceptInvite(invite: ConvoyInvite, currentUserId: string): ConvoySession {
        this.activeConvoy = {
            ...invite.session,
            memberIds: Array.from(new Set([...invite.session.memberIds, currentUserId]))
        };
        this.pendingInvite = null;
        this.save();
        this.notifyInvite();

        speechService.speak(`Joined caravan with ${invite.senderName} to ${invite.session.destinationName}. Following route.`);
        return this.activeConvoy;
    }

    /**
     * Decline a received convoy invite
     */
    public declineInvite(): void {
        this.pendingInvite = null;
        this.notifyInvite();
    }

    /**
     * Join an existing convoy or add a member
     */
    public joinConvoy(memberId: string): void {
        if (!this.activeConvoy) return;
        if (!this.activeConvoy.memberIds.includes(memberId)) {
            this.activeConvoy.memberIds.push(memberId);
            this.save();
        }
    }

    /**
     * Leave / End the current convoy
     */
    public endConvoy(): void {
        if (this.activeConvoy) {
            speechService.speak('Convoy mode ended.');
        }
        this.activeConvoy = null;
        this.save();
    }

    /**
     * Broadcast an in-flight route recalculation or reroute from the Convoy Leader to all trailing followers
     */
    public broadcastReroute(newRoute: NavigationRoute, circleId?: string): void {
        if (!this.activeConvoy) return;
        this.activeConvoy.currentRoute = newRoute;
        this.activeConvoy.lastRerouteTimestamp = Date.now();
        this.save();

        const event: ConvoyRerouteEvent = {
            convoyId: this.activeConvoy.id,
            route: newRoute,
            leaderId: this.activeConvoy.leaderId,
            timestamp: Date.now()
        };

        // 1. Notify active local listeners
        this.notifyReroute(newRoute, event);

        // 2. Broadcast via StorageEvent for browser tab pair synchrony
        if (typeof window !== 'undefined') {
            try {
                localStorage.setItem(CONVOY_REROUTE_EVENT, JSON.stringify(event));
                setTimeout(() => localStorage.removeItem(CONVOY_REROUTE_EVENT), 5000);
            } catch (e) {
                console.warn('[ConvoyService] Failed to broadcast local reroute:', e);
            }
        }

        // 3. Sync to Firebase Realtime Database for multi-device network fleet routing
        if (circleId) {
            try {
                const convoyRef = ref(database, `convoys/${circleId}/${this.activeConvoy.id}`);
                set(convoyRef, {
                    ...this.activeConvoy,
                    currentRoute: newRoute,
                    lastRerouteTimestamp: Date.now()
                }).catch(err => console.warn('[ConvoyService] Firebase convoy sync error:', err));
            } catch (err) {
                console.warn('[ConvoyService] Network broadcast error:', err);
            }
        }
    }

    /**
     * Subscribe to circle active convoys and leader reroutes from Firebase Realtime Database
     */
    public subscribeCircleConvoy(circleId: string, currentUserId: string): () => void {
        if (!circleId) return () => {};
        try {
            const circleConvoysRef = ref(database, `convoys/${circleId}`);
            onValue(circleConvoysRef, (snapshot) => {
                if (!snapshot.exists()) return;
                const convoysData = snapshot.val();
                if (!convoysData) return;

                const sessions = Object.values(convoysData) as ConvoySession[];
                const active = sessions.find(c => c && c.isActive && c.memberIds?.includes(currentUserId));
                if (active) {
                    const isLeader = active.leaderId === currentUserId;
                    const prevRerouteTime = this.activeConvoy?.lastRerouteTimestamp || 0;

                    // If route has been updated by the leader and current user is a follower
                    if (!isLeader && active.currentRoute && active.lastRerouteTimestamp && active.lastRerouteTimestamp > prevRerouteTime) {
                        this.activeConvoy = active;
                        this.save();
                        const event: ConvoyRerouteEvent = {
                            convoyId: active.id,
                            route: active.currentRoute,
                            leaderId: active.leaderId,
                            timestamp: active.lastRerouteTimestamp
                        };
                        this.notifyReroute(active.currentRoute, event);
                    }
                }
            });

            return () => off(circleConvoysRef);
        } catch (err) {
            console.warn('[ConvoyService] Error subscribing to circle convoy:', err);
            return () => {};
        }
    }

    /**
     * Calculates relative telemetry for all convoy members relative to the current driver
     */
    public getConvoyTelemetry(
        userLocation: Location | null,
        userSpeed: number,
        currentUserId: string,
        circleMembers: FamilyMember[]
    ): ConvoyMember[] {
        if (!userLocation || circleMembers.length === 0) return [];

        const telemetryList: ConvoyMember[] = [];
        const isConvoyOn = this.isConvoyActive();
        const activeSession = this.activeConvoy;

        circleMembers.forEach(member => {
            // Skip current driver
            if (member.id === currentUserId) return;

            // If convoy is active, only include convoy members; otherwise check nearby circle members (within 15 miles)
            const isMemberInConvoy = activeSession?.memberIds.includes(member.id);
            const distStr = getDistanceMiles(userLocation, member.location);
            const distNum = parseFloat(distStr || '999');

            // Include if in convoy session OR within 15 miles while driving
            if (isConvoyOn && !isMemberInConvoy) return;
            if (!isConvoyOn && (distNum > 15 || member.privacyMode === 'frozen')) return;

            // Determine if member is ahead or behind based on coordinates relative to destination or speed
            let isAhead = false;
            if (activeSession?.destinationLocation) {
                const userDistToDest = parseFloat(getDistanceMiles(userLocation, activeSession.destinationLocation) || '0');
                const memberDistToDest = parseFloat(getDistanceMiles(member.location, activeSession.destinationLocation) || '0');
                isAhead = memberDistToDest < userDistToDest;
            } else {
                isAhead = member.speed >= userSpeed;
            }

            // Determine status
            let status: ConvoyMember['status'] = 'on_track';
            if (member.speed === 0 && userSpeed > 15) {
                status = 'stopped';
            } else if (distNum > 2.0 && !isAhead) {
                status = 'lagging';
            }

            // Trigger audio separation alert if a follower falls > 2.5 miles behind
            if (status === 'lagging' && distNum > 2.5 && isConvoyOn) {
                const now = Date.now();
                if (now - this.lastSeparationAlertTime > 120000) { // Max once every 2 minutes
                    this.lastSeparationAlertTime = now;
                    speechService.speak(`Convoy Alert: ${member.name} is falling behind, currently ${distNum.toFixed(1)} miles back.`);
                }
            }

            telemetryList.push({
                id: member.id,
                name: member.name,
                avatar: member.avatar,
                location: member.location,
                speed: member.speed || 0,
                heading: member.heading || 0,
                distanceToUserMiles: distNum,
                isAhead,
                role: activeSession?.leaderId === member.id ? 'leader' : 'follower',
                status
            });
        });

        // Sort by distance (closest first)
        return telemetryList.sort((a, b) => a.distanceToUserMiles - b.distanceToUserMiles);
    }
}

export const convoyService = new ConvoyService();
