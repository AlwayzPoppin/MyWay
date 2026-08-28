/**
 * Search History Service
 * Manages persistent local history for searched addresses, places, and destinations.
 */

import { Location } from '../types';

export interface RecentSearchItem {
    id: string;
    query: string;
    name?: string;
    description?: string;
    location?: Location;
    type?: string;
    icon?: string;
    timestamp: number;
    frequencyCount?: number;
}

const STORAGE_KEY = 'myway_search_history';
const MAX_HISTORY_ITEMS = 25;

type HistoryListener = (items: RecentSearchItem[]) => void;
const listeners: Set<HistoryListener> = new Set();

class SearchHistoryService {
    private history: RecentSearchItem[] = [];

    constructor() {
        this.loadHistory();
    }

    private loadHistory(): void {
        if (typeof window === 'undefined') return;
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) {
                this.history = JSON.parse(raw);
            }
        } catch (e) {
            console.warn('[SearchHistory] Failed to parse stored history:', e);
            this.history = [];
        }
    }

    private saveHistory(): void {
        if (typeof window === 'undefined') return;
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(this.history));
            this.notifyListeners();
        } catch (e) {
            console.warn('[SearchHistory] Failed to persist history:', e);
        }
    }

    private notifyListeners(): void {
        const copy = this.getHistory();
        listeners.forEach(cb => {
            try { cb(copy); } catch (e) { console.error(e); }
        });
    }

    /**
     * Returns history items sorted by Smart Frequency & Recency Weight
     */
    public getHistory(): RecentSearchItem[] {
        const now = Date.now();
        return [...this.history].sort((a, b) => {
            const freqA = a.frequencyCount || 1;
            const freqB = b.frequencyCount || 1;

            // Recency decay over 7 days (1.0 = right now, 0.0 = 7 days ago)
            const recencyA = Math.max(0, 1 - (now - a.timestamp) / (7 * 86400000));
            const recencyB = Math.max(0, 1 - (now - b.timestamp) / (7 * 86400000));

            const scoreA = (freqA * 1.5) + (recencyA * 2.0);
            const scoreB = (freqB * 1.5) + (recencyB * 2.0);

            return scoreB - scoreA;
        });
    }

    public addItem(item: {
        query: string;
        name?: string;
        description?: string;
        location?: Location;
        type?: string;
        icon?: string;
    }): void {
        if (!item.query || !item.query.trim()) return;

        const cleanQuery = item.query.trim();
        const cleanName = item.name?.trim() || cleanQuery;

        // Auto-detect icon
        let icon = item.icon || '🕒';
        const isAddress = /^\d+\s+/i.test(cleanQuery) || /\b(st|street|dr|drive|rd|road|ave|avenue|ln|lane|blvd|ct|court|cir|circle|way)\b/i.test(cleanQuery);
        if (isAddress && icon === '🕒') {
            icon = '📍';
        }

        // Find existing match to increment frequency
        let frequencyCount = 1;
        const existing = this.history.find(h => 
            h.query.toLowerCase() === cleanQuery.toLowerCase() ||
            (item.name && h.name?.toLowerCase() === cleanName.toLowerCase())
        );

        if (existing) {
            frequencyCount = (existing.frequencyCount || 1) + 1;
        }

        // Deduplicate existing entry by query or name
        this.history = this.history.filter(h => 
            h.query.toLowerCase() !== cleanQuery.toLowerCase() &&
            (!item.name || h.name?.toLowerCase() !== cleanName.toLowerCase())
        );

        const newItem: RecentSearchItem = {
            id: `hist_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
            query: cleanQuery,
            name: cleanName,
            description: item.description || existing?.description,
            location: item.location || existing?.location,
            type: item.type || existing?.type || 'search_history',
            icon,
            timestamp: Date.now(),
            frequencyCount
        };

        this.history.unshift(newItem);

        if (this.history.length > MAX_HISTORY_ITEMS) {
            this.history = this.history.slice(0, MAX_HISTORY_ITEMS);
        }

        this.saveHistory();
    }

    public removeItem(id: string): void {
        this.history = this.history.filter(h => h.id !== id);
        this.saveHistory();
    }

    public clearHistory(): void {
        this.history = [];
        this.saveHistory();
    }

    public subscribe(listener: HistoryListener): () => void {
        listeners.add(listener);
        listener(this.getHistory());
        return () => {
            listeners.delete(listener);
        };
    }
}

export const searchHistoryService = new SearchHistoryService();
