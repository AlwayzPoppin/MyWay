/**
 * Multi-Vehicle Caravan & Convoy Service
 * Real-time convoy tracking, member invite dispatching, separation alerts,
 * leader/follower telemetry, and pit stop synchronizer for multi-vehicle family road trips.
 */

import { Location, FamilyMember } from '../types';
import { getDistanceMiles } from '../utils/geo';
import { speechService } from './speechService';

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
}

export interface ConvoyInvite {
    session: ConvoySession;
    senderName: string;
    timestamp: number;
}

const CONVOY_STORAGE_KEY = 'myway_active_convoy';
const CONVOY_INVITE_EVENT = 'myway_convoy_invite_event';

class ConvoyService {
    private activeConvoy: ConvoySession | null = null;
    private listeners: ((convoy: ConvoySession | null) => void)[] = [];
    private inviteListeners: ((invite: ConvoyInvite | null) => void)[] = [];
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
            }
        });
    }

    private notify(): void {
        this.listeners.forEach(cb => cb(this.activeConvoy));
    }

    private notifyInvite(): void {
        this.inviteListeners.forEach(cb => cb(this.pendingInvite));
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
