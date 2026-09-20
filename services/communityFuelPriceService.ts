import { addDoc, collection, getDocs, limit, query, where } from 'firebase/firestore';
import { db } from './firebase';

const CACHE_KEY = 'myway_community_fuel_price_reports_v1';
const FRESH_FOR_MS = 6 * 60 * 60 * 1000;

export interface CommunityFuelPriceReport {
    id: string;
    stationId: string;
    stationName: string;
    latitude: number;
    longitude: number;
    price: number;
    grade: 'regular';
    reportedAt: number;
}

export interface CommunityFuelPriceEstimate {
    price: number;
    reportCount: number;
    reportedAt: number;
    isFresh: boolean;
}

const readCache = (): CommunityFuelPriceReport[] => {
    if (typeof window === 'undefined') return [];
    try {
        const parsed = JSON.parse(localStorage.getItem(CACHE_KEY) || '[]');
        return Array.isArray(parsed) ? parsed.filter(report => Number.isFinite(report?.price) && report.price > 0) : [];
    } catch {
        return [];
    }
};

const writeCache = (reports: CommunityFuelPriceReport[]) => {
    if (typeof window === 'undefined') return;
    try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(reports.slice(0, 100)));
    } catch {
        // Fuel reports remain optional and must never block driving when storage is unavailable.
    }
};

const sanitize = (raw: any): CommunityFuelPriceReport | null => {
    const price = Number(raw?.price);
    const reportedAt = Number(raw?.reportedAt);
    if (!raw?.stationId || !raw?.stationName || !Number.isFinite(price) || price < 1 || price > 15 || !Number.isFinite(reportedAt)) return null;
    return {
        id: String(raw.id || `${raw.stationId}-${reportedAt}`),
        stationId: String(raw.stationId),
        stationName: String(raw.stationName),
        latitude: Number(raw.latitude) || 0,
        longitude: Number(raw.longitude) || 0,
        price,
        grade: 'regular',
        reportedAt
    };
};

class CommunityFuelPriceService {
    private merge(reports: CommunityFuelPriceReport[]) {
        const merged = [...reports, ...readCache()]
            .sort((a, b) => b.reportedAt - a.reportedAt)
            .filter((report, index, all) => all.findIndex(candidate => candidate.id === report.id) === index)
            .slice(0, 100);
        writeCache(merged);
        return merged;
    }

    async getStationEstimate(stationId: string): Promise<CommunityFuelPriceEstimate | null> {
        let reports = readCache().filter(report => report.stationId === stationId);
        try {
            const snapshot = await getDocs(query(
                collection(db, 'community_fuel_price_reports'),
                where('stationId', '==', stationId),
                limit(20)
            ));
            const remote = snapshot.docs.map(doc => sanitize({ id: doc.id, ...doc.data() })).filter((report): report is CommunityFuelPriceReport => !!report);
            reports = this.merge(remote).filter(report => report.stationId === stationId);
        } catch {
            // Offline, unauthenticated, and unconfigured Firebase all use the on-device cache.
        }
        const recent = reports.filter(report => Date.now() - report.reportedAt <= 7 * 24 * 60 * 60 * 1000);
        if (!recent.length) return null;
        const newest = Math.max(...recent.map(report => report.reportedAt));
        const fresh = recent.filter(report => newest - report.reportedAt <= 24 * 60 * 60 * 1000);
        const prices = fresh.map(report => report.price).sort((a, b) => a - b);
        const median = prices[Math.floor(prices.length / 2)];
        return { price: Number(median.toFixed(2)), reportCount: fresh.length, reportedAt: newest, isFresh: Date.now() - newest <= FRESH_FOR_MS };
    }

    async submitStationPrice(input: Omit<CommunityFuelPriceReport, 'id' | 'reportedAt' | 'grade'>): Promise<CommunityFuelPriceReport> {
        const report = sanitize({ ...input, id: `${input.stationId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, reportedAt: Date.now() });
        if (!report) throw new Error('Enter a valid regular fuel price.');
        this.merge([report]);
        try {
            await addDoc(collection(db, 'community_fuel_price_reports'), report);
        } catch {
            // Keep the contribution locally and allow retry on a future session.
        }
        return report;
    }
}

export const communityFuelPriceService = new CommunityFuelPriceService();
