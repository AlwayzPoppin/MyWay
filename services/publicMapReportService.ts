/**
 * Public Map Report Service
 * Waze-style global crowdsourcing system for map edits, entrance fixes, and road hazards.
 * Uses root-level 'public_map_reports' collection with geohash spatial indexing and community trust scoring.
 */

import { db, database } from './firebase';
import {
    collection,
    doc,
    setDoc,
    getDocs,
    updateDoc,
    deleteDoc,
    query,
    where,
    orderBy,
    startAt,
    endAt,
    limit
} from 'firebase/firestore';
import { ref, set as setRtdb, get as getRtdb, update as updateRtdb, remove as removeRtdb, onValue } from 'firebase/database';
import { encodeGeohash, isCoordinateInBounds, BoundingBox } from '../utils/geohash';

export type PublicReportType = 'pin_move' | 'entrance_fix' | 'hazard';

export interface PublicMapReport {
    id: string;
    reportType: PublicReportType;
    coordinates: { lat: number; lng: number };
    geohash: string;
    reportedBy: string;
    reporterName?: string;
    reporterAvatar?: string;
    timestamp: number;
    trustScore: number;
    upvoterIds: string[];
    downvoterIds: string[];
    placeId?: string;
    placeName?: string;
    details?: string;
    imageUrl?: string;
    entranceType?: string;
    entranceNotes?: string;
    expiresAt?: number;
    visibility: 'public' | 'circle';
}

const LOCAL_STORAGE_KEY = 'myway_public_map_reports_cache';
const HAZARD_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours for road hazards
const MIN_TRUST_THRESHOLD = 0; // Automatically hide/purge if trustScore falls below 0

class PublicMapReportService {
    private localCache: Map<string, PublicMapReport> = new Map();
    private activeListeners: Set<(reports: PublicMapReport[]) => void> = new Set();
    private lastFetchedBounds: BoundingBox | null = null;

    constructor() {
        this.loadLocalCache();
    }

    private loadLocalCache() {
        try {
            const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
            if (raw) {
                const list: PublicMapReport[] = JSON.parse(raw);
                const now = Date.now();
                // Deduplicate by placeId or placeName for pin fixes/entrance fixes
                const seenPlaceKeys = new Set<string>();
                // Sort newest first
                list.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

                list.forEach(report => {
                    if (this.isValidReport(report, now)) {
                        // Enforce anonymized name for public reports
                        if (report.visibility === 'public') {
                            report.reporterName = 'MyWay Community';
                            report.reporterAvatar = '';
                        }

                        if (report.reportType === 'entrance_fix' || report.reportType === 'pin_move') {
                            const dedupKey = report.placeId || (report.placeName ? report.placeName.toLowerCase().trim() : report.id);
                            if (seenPlaceKeys.has(dedupKey)) {
                                return; // Skip older duplicate
                            }
                            seenPlaceKeys.add(dedupKey);
                        }
                        this.localCache.set(report.id, report);
                    }
                });
            }
        } catch (e) {
            console.warn('[PublicMapReportService] Local cache load error:', e);
        }
    }

    private saveLocalCache() {
        try {
            const list = Array.from(this.localCache.values());
            localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(list));
        } catch (e) {}
    }

    private isValidReport(report: PublicMapReport, now = Date.now()): boolean {
        if (!report || !report.coordinates) return false;
        // Purge if trust score is below minimum threshold
        if (typeof report.trustScore === 'number' && report.trustScore < MIN_TRUST_THRESHOLD) return false;
        // Purge if expired (e.g. temporary hazards > 2 hours)
        if (report.expiresAt && report.expiresAt < now) return false;
        return true;
    }

    /**
     * Look up a public report by place ID or matching name
     */
    public getReportForPlace(place: { id?: string; name?: string }): PublicMapReport | null {
        if (!place) return null;
        const cleanName = (place.name || '').toLowerCase().trim();
        for (const report of this.localCache.values()) {
            if (place.id && report.placeId === place.id) return report;
            if (cleanName && report.placeName && report.placeName.toLowerCase().trim() === cleanName) {
                return report;
            }
        }
        return null;
    }

    /**
     * Submit a new public map report or edit (with upsert deduplication)
     */
    public async submitReport(params: {
        reportType: PublicReportType;
        coordinates: { lat: number; lng: number };
        userId: string;
        userName?: string;
        userAvatar?: string;
        placeId?: string;
        placeName?: string;
        details?: string;
        imageUrl?: string;
        entranceType?: string;
        entranceNotes?: string;
        visibility?: 'public' | 'circle';
    }): Promise<PublicMapReport> {
        const {
            reportType,
            coordinates,
            userId,
            userName,
            userAvatar,
            placeId,
            placeName,
            details,
            imageUrl,
            entranceType,
            entranceNotes,
            visibility = 'public'
        } = params;

        const isPublic = visibility === 'public';
        // HARDCODE anonymous display name for public reports to protect user privacy
        const reporterDisplayName = isPublic ? 'MyWay Community' : (userName || 'Circle Member');
        const reporterAvatarUrl = isPublic ? '' : (userAvatar || '');

        // Deduplication: Check if a report already exists for this place
        let existingReport: PublicMapReport | null = null;
        for (const cached of this.localCache.values()) {
            if (placeId && cached.placeId === placeId) {
                existingReport = cached;
                break;
            }
            if (
                placeName &&
                cached.placeName &&
                cached.placeName.toLowerCase().trim() === placeName.toLowerCase().trim() &&
                (cached.reportType === 'entrance_fix' || cached.reportType === 'pin_move')
            ) {
                existingReport = cached;
                break;
            }
        }

        const id = existingReport ? existingReport.id : `pub_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        const geohash = encodeGeohash(coordinates.lat, coordinates.lng, 7);
        const timestamp = Date.now();

        // 2-hour TTL for road hazards; indefinite for structural pin moves & entrance fixes
        const expiresAt = reportType === 'hazard' ? timestamp + HAZARD_TTL_MS : undefined;

        const report: PublicMapReport = {
            id,
            reportType,
            coordinates: {
                lat: Number(coordinates.lat.toFixed(6)),
                lng: Number(coordinates.lng.toFixed(6))
            },
            geohash,
            reportedBy: userId || 'anonymous',
            reporterName: reporterDisplayName,
            reporterAvatar: reporterAvatarUrl,
            timestamp,
            trustScore: existingReport?.trustScore ?? 1,
            upvoterIds: existingReport
                ? Array.from(new Set([...(existingReport.upvoterIds || []), userId].filter(Boolean)))
                : [userId].filter(Boolean),
            downvoterIds: existingReport?.downvoterIds || [],
            placeId,
            placeName,
            details,
            imageUrl: imageUrl || existingReport?.imageUrl,
            entranceType: entranceType || existingReport?.entranceType,
            entranceNotes: entranceNotes || existingReport?.entranceNotes,
            expiresAt,
            visibility
        };

        // 1. Optimistic local cache update
        this.localCache.set(id, report);
        this.saveLocalCache();
        this.notifyListeners();

        // 2. Persist to Firestore root-level 'public_map_reports' collection
        try {
            if (db) {
                const reportDocRef = doc(db, 'public_map_reports', id);
                await setDoc(reportDocRef, report);
                console.log(`🌐 [PublicMapReport] Written to Firestore: ${id} (${geohash})`);
            }
        } catch (err) {
            console.warn('[PublicMapReportService] Firestore write fallback:', err);
        }

        // 3. Mirror to Realtime Database for instant fallback sync
        try {
            if (database) {
                const rtdbRef = ref(database, `public_map_reports/${id}`);
                await setRtdb(rtdbRef, report);
            }
        } catch (err) {
            console.warn('[PublicMapReportService] RTDB write fallback:', err);
        }

        return report;
    }

    /**
     * Query public reports in the visible map viewport
     */
    public async fetchReportsInViewport(bounds: BoundingBox): Promise<PublicMapReport[]> {
        this.lastFetchedBounds = bounds;
        const now = Date.now();
        const resultsMap = new Map<string, PublicMapReport>();

        // 1. First add matching local cached items
        this.localCache.forEach(report => {
            if (this.isValidReport(report, now) && isCoordinateInBounds(report.coordinates, bounds)) {
                resultsMap.set(report.id, report);
            }
        });

        // 2. Query Firestore root collection
        try {
            if (db) {
                const reportsCol = collection(db, 'public_map_reports');
                // Calculate geohash query prefix for bounds at precision 5 (~4.9km)
                const centerLat = (bounds.north + bounds.south) / 2;
                const centerLng = (bounds.east + bounds.west) / 2;
                const centerHash = encodeGeohash(centerLat, centerLng, 4);

                // Fetch documents starting with the center geohash range
                const q = query(
                    reportsCol,
                    orderBy('geohash'),
                    startAt(centerHash),
                    endAt(centerHash + '~'),
                    limit(60)
                );

                const snapshot = await getDocs(q);
                snapshot.forEach(docSnap => {
                    const data = docSnap.data() as PublicMapReport;
                    if (data && this.isValidReport(data, now) && isCoordinateInBounds(data.coordinates, bounds)) {
                        resultsMap.set(data.id, data);
                        this.localCache.set(data.id, data);
                    }
                });
            }
        } catch (err) {
            // If range query fails (e.g. index pending), query fallback from RTDB
            try {
                if (database) {
                    const rtdbRef = ref(database, 'public_map_reports');
                    const snapshot = await getRtdb(rtdbRef);
                    if (snapshot.exists()) {
                        const data = snapshot.val();
                        Object.keys(data).forEach(key => {
                            const item = data[key] as PublicMapReport;
                            if (item && this.isValidReport(item, now) && isCoordinateInBounds(item.coordinates, bounds)) {
                                resultsMap.set(item.id, item);
                                this.localCache.set(item.id, item);
                            }
                        });
                    }
                }
            } catch (rtdbErr) {
                console.warn('[PublicMapReportService] Viewport fetch fallback error:', rtdbErr);
            }
        }

        const validResults = Array.from(resultsMap.values()).filter(r => this.isValidReport(r, now));
        this.saveLocalCache();
        this.notifyListeners();
        return validResults;
    }

    /**
     * Upvote or downvote a public map report
     * Upvote: +1 trust
     * Downvote: -1 trust
     * If trust drops below MIN_TRUST_THRESHOLD (0), auto-deletes the report
     */
    public async voteReport(reportId: string, userId: string, vote: 'up' | 'down'): Promise<{ trustScore: number; isDeleted: boolean }> {
        const report = this.localCache.get(reportId);
        if (!report) {
            return { trustScore: 0, isDeleted: true };
        }

        let upvoterIds = report.upvoterIds || [];
        let downvoterIds = report.downvoterIds || [];

        if (vote === 'up') {
            if (upvoterIds.includes(userId)) {
                return { trustScore: report.trustScore, isDeleted: false }; // Already upvoted
            }
            downvoterIds = downvoterIds.filter(id => id !== userId);
            upvoterIds.push(userId);
        } else {
            if (downvoterIds.includes(userId)) {
                return { trustScore: report.trustScore, isDeleted: false }; // Already downvoted
            }
            upvoterIds = upvoterIds.filter(id => id !== userId);
            downvoterIds.push(userId);
        }

        const newTrustScore = 1 + upvoterIds.length - 1 - downvoterIds.length;
        report.trustScore = newTrustScore;
        report.upvoterIds = upvoterIds;
        report.downvoterIds = downvoterIds;

        // Auto-purge if trust drops below threshold
        if (newTrustScore < MIN_TRUST_THRESHOLD) {
            await this.deleteReport(reportId);
            return { trustScore: newTrustScore, isDeleted: true };
        }

        // Update local cache
        this.localCache.set(reportId, report);
        this.saveLocalCache();
        this.notifyListeners();

        // Update Firestore
        try {
            if (db) {
                const reportRef = doc(db, 'public_map_reports', reportId);
                await updateDoc(reportRef, {
                    trustScore: newTrustScore,
                    upvoterIds,
                    downvoterIds
                });
            }
        } catch (e) {
            console.warn('[PublicMapReportService] Firestore vote update error:', e);
        }

        // Update Realtime Database
        try {
            if (database) {
                const rtdbRef = ref(database, `public_map_reports/${reportId}`);
                await updateRtdb(rtdbRef, {
                    trustScore: newTrustScore,
                    upvoterIds,
                    downvoterIds
                });
            }
        } catch (e) {}

        return { trustScore: newTrustScore, isDeleted: false };
    }

    /**
     * Delete an expired or untrusted report
     */
    public async deleteReport(reportId: string): Promise<void> {
        this.localCache.delete(reportId);
        this.saveLocalCache();
        this.notifyListeners();

        try {
            if (db) {
                const reportRef = doc(db, 'public_map_reports', reportId);
                await deleteDoc(reportRef);
            }
        } catch (e) {}

        try {
            if (database) {
                const rtdbRef = ref(database, `public_map_reports/${reportId}`);
                await removeRtdb(rtdbRef);
            }
        } catch (e) {}
    }

    /**
     * Subscribe to updates
     */
    public subscribe(listener: (reports: PublicMapReport[]) => void): () => void {
        this.activeListeners.add(listener);
        listener(Array.from(this.localCache.values()));
        return () => {
            this.activeListeners.delete(listener);
        };
    }

    private notifyListeners() {
        const list = Array.from(this.localCache.values());
        this.activeListeners.forEach(listener => {
            try {
                listener(list);
            } catch (err) {
                console.error('[PublicMapReportService] Listener error:', err);
            }
        });
    }

    public getCachedReports(): PublicMapReport[] {
        return Array.from(this.localCache.values());
    }
}

export const publicMapReportService = new PublicMapReportService();
export default publicMapReportService;
