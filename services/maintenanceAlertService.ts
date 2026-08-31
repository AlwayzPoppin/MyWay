/**
 * Predictive Maintenance & Mileage Alert Service
 * Tracks vehicle odometer, monitors service intervals (oil changes, tire rotations, brakes, EV checks),
 * forecasts due dates based on driving pace, and dispatches push + in-app notifications at intervals.
 */

import { Vehicle, Trip } from '../types';
import { addNotification } from '../components/NotificationCenter';
import { getSavedTrips } from './tripHistoryService';

export type MaintenanceCategory =
    | 'oil_change'
    | 'tires'
    | 'air_filter'
    | 'brakes'
    | 'battery'
    | 'transmission'
    | 'spark_plugs'
    | 'ev_checkup'
    | 'custom';

export interface MaintenanceItem {
    id: string;
    category: MaintenanceCategory;
    title: string;
    icon: string;
    intervalMiles: number; // e.g. 5000
    lastServiceMileage: number; // Odometer reading when last serviced
    lastServiceDate?: string; // ISO date string
    lastServiceCost?: number;
    notes?: string;
}

export interface VehicleHealthItem extends MaintenanceItem {
    currentOdometer: number;
    milesDrivenSinceService: number;
    milesRemaining: number;
    progressPercent: number; // 0 to 100+
    status: 'good' | 'due_soon' | 'overdue';
    estimatedDaysRemaining: number | null; // based on user's daily driving pace
    estimatedDueDate: string | null;
}

export interface VehicleMaintenanceProfile {
    vehicleId: string;
    baseOdometer: number; // User-set starting odometer reading
    accumulatedTripMiles: number; // Sum of GPS trips tracked
    items: MaintenanceItem[];
    lastNotifiedMilestones: Record<string, 'none' | 'due_soon' | 'overdue'>; // itemId -> status notified
}

const MAINTENANCE_PROFILES_KEY = 'myway_vehicle_maintenance_profiles';

const DEFAULT_GAS_ITEMS: Omit<MaintenanceItem, 'id' | 'lastServiceMileage'>[] = [
    { category: 'oil_change', title: 'Engine Oil & Filter', icon: '🛢️', intervalMiles: 5000 },
    { category: 'tires', title: 'Tire Rotation & Balance', icon: '🛞', intervalMiles: 6000 },
    { category: 'air_filter', title: 'Cabin & Engine Air Filters', icon: '🌬️', intervalMiles: 15000 },
    { category: 'brakes', title: 'Brake Pads & Rotors Inspection', icon: '🛑', intervalMiles: 20000 },
    { category: 'battery', title: 'Coolant & Battery Service', icon: '🔋', intervalMiles: 30000 },
    { category: 'transmission', title: 'Transmission / Drivetrain Fluid', icon: '⚙️', intervalMiles: 45000 },
    { category: 'spark_plugs', title: 'Spark Plugs Replacement', icon: '⚡', intervalMiles: 60000 },
];

const DEFAULT_EV_ITEMS: Omit<MaintenanceItem, 'id' | 'lastServiceMileage'>[] = [
    { category: 'tires', title: 'Tire Rotation & Alignment', icon: '🛞', intervalMiles: 6000 },
    { category: 'air_filter', title: 'Cabin Air Filter & HEPA', icon: '🌬️', intervalMiles: 15000 },
    { category: 'brakes', title: 'Brake Fluid & Pad Inspection', icon: '🛑', intervalMiles: 25000 },
    { category: 'battery', title: 'Battery Coolant & Thermal System', icon: '🔋', intervalMiles: 40000 },
    { category: 'ev_checkup', title: 'EV Drivetrain & Suspension Check', icon: '⚡', intervalMiles: 50000 },
];

class MaintenanceAlertService {
    private profiles: Record<string, VehicleMaintenanceProfile> = {};

    constructor() {
        this.load();
    }

    private load(): void {
        if (typeof window === 'undefined') return;
        try {
            const raw = localStorage.getItem(MAINTENANCE_PROFILES_KEY);
            if (raw) {
                this.profiles = JSON.parse(raw);
            }
        } catch (e) {
            console.warn('[MaintenanceAlertService] Failed to load profiles:', e);
        }
    }

    private save(): void {
        if (typeof window === 'undefined') return;
        try {
            localStorage.setItem(MAINTENANCE_PROFILES_KEY, JSON.stringify(this.profiles));
        } catch (e) {
            console.warn('[MaintenanceAlertService] Failed to save profiles:', e);
        }
    }

    /**
     * Get or create maintenance profile for a vehicle
     */
    public getProfile(vehicle?: Vehicle | null): VehicleMaintenanceProfile {
        const vId = vehicle?.id || 'primary_vehicle';
        if (!this.profiles[vId]) {
            const isEv = vehicle?.fuelType === 'electric';
            const template = isEv ? DEFAULT_EV_ITEMS : DEFAULT_GAS_ITEMS;

            const initialItems: MaintenanceItem[] = template.map(t => ({
                ...t,
                id: `maint_${t.category}_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`,
                lastServiceMileage: 0
            }));

            this.profiles[vId] = {
                vehicleId: vId,
                baseOdometer: 0,
                accumulatedTripMiles: 0,
                items: initialItems,
                lastNotifiedMilestones: {}
            };
            this.save();
        }
        return this.profiles[vId];
    }

    /**
     * Compute current vehicle total odometer reading
     */
    public getCurrentOdometer(vehicle?: Vehicle | null): number {
        const profile = this.getProfile(vehicle);
        return Math.round((profile.baseOdometer + profile.accumulatedTripMiles) * 10) / 10;
    }

    /**
     * Set starting odometer reading (e.g. 45,200 miles on the dashboard)
     */
    public setBaseOdometer(vehicleId: string, odometer: number): void {
        if (this.profiles[vehicleId]) {
            this.profiles[vehicleId].baseOdometer = Math.max(0, odometer);
            this.save();
        }
    }

    /**
     * Calculates average daily miles driven over past 30 days
     */
    public getAverageDailyMiles(trips?: Trip[]): number {
        const allTrips = trips || getSavedTrips();
        if (allTrips.length === 0) return 25; // default fallback 25 mi/day

        const thirtyDaysAgo = Date.now() - 30 * 86400000;
        const recentTrips = allTrips.filter(t => t.startTime >= thirtyDaysAgo);
        const totalMiles = recentTrips.reduce((s, t) => s + (t.totalDistanceMiles || 0), 0);

        if (recentTrips.length === 0) return 25;
        const daySpan = Math.max(1, (Date.now() - recentTrips[recentTrips.length - 1].startTime) / 86400000);
        return Math.max(5, Math.round((totalMiles / daySpan) * 10) / 10);
    }

    /**
     * Get detailed health and predictive status for all items on a vehicle
     */
    public getVehicleHealth(vehicle?: Vehicle | null, trips?: Trip[]): {
        items: VehicleHealthItem[];
        currentOdometer: number;
        overdueCount: number;
        dueSoonCount: number;
        overallStatus: 'good' | 'due_soon' | 'overdue';
        averageDailyMiles: number;
    } {
        const profile = this.getProfile(vehicle);
        const currentOdo = this.getCurrentOdometer(vehicle);
        const avgDailyMiles = this.getAverageDailyMiles(trips);

        let overdueCount = 0;
        let dueSoonCount = 0;

        const healthItems: VehicleHealthItem[] = profile.items.map(item => {
            const drivenSinceService = Math.max(0, currentOdo - item.lastServiceMileage);
            const remaining = item.intervalMiles - drivenSinceService;
            const progressPercent = Math.min(150, Math.round((drivenSinceService / item.intervalMiles) * 100));

            let status: VehicleHealthItem['status'] = 'good';
            if (remaining <= 0) {
                status = 'overdue';
                overdueCount++;
            } else if (remaining <= 500 || progressPercent >= 90) {
                status = 'due_soon';
                dueSoonCount++;
            }

            // Estimate days remaining
            let estimatedDaysRemaining: number | null = null;
            let estimatedDueDate: string | null = null;

            if (remaining > 0 && avgDailyMiles > 0) {
                estimatedDaysRemaining = Math.max(1, Math.round(remaining / avgDailyMiles));
                const targetDate = new Date(Date.now() + estimatedDaysRemaining * 86400000);
                estimatedDueDate = targetDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            }

            return {
                ...item,
                currentOdometer: currentOdo,
                milesDrivenSinceService: Math.round(drivenSinceService * 10) / 10,
                milesRemaining: Math.round(remaining * 10) / 10,
                progressPercent,
                status,
                estimatedDaysRemaining,
                estimatedDueDate
            };
        });

        const overallStatus: 'good' | 'due_soon' | 'overdue' =
            overdueCount > 0 ? 'overdue' : dueSoonCount > 0 ? 'due_soon' : 'good';

        return {
            items: healthItems,
            currentOdometer: currentOdo,
            overdueCount,
            dueSoonCount,
            overallStatus,
            averageDailyMiles: avgDailyMiles
        };
    }

    /**
     * Check if vehicle is approaching any maintenance milestone within specified threshold (default 100 miles)
     */
    public getPendingMaintenanceDue(vehicle?: Vehicle | null, thresholdMiles: number = 100): {
        isDue: boolean;
        item?: VehicleHealthItem;
        categoryQuery: string;
        milesRemaining: number;
    } {
        const health = this.getVehicleHealth(vehicle);
        const dueItems = health.items.filter(i => i.milesRemaining <= thresholdMiles || i.status === 'due_soon' || i.status === 'overdue');
        if (dueItems.length === 0) {
            return { isDue: false, categoryQuery: 'auto repair', milesRemaining: Infinity };
        }

        // Sort by most urgent (least miles remaining)
        dueItems.sort((a, b) => a.milesRemaining - b.milesRemaining);
        const mostUrgent = dueItems[0];

        let categoryQuery = 'auto repair mechanic';
        if (mostUrgent.category === 'oil_change') categoryQuery = 'oil change';
        else if (mostUrgent.category === 'tires') categoryQuery = 'tire shop';
        else if (mostUrgent.category === 'brakes') categoryQuery = 'brake repair';
        else if (mostUrgent.category === 'battery' || mostUrgent.category === 'ev_checkup') categoryQuery = 'auto electric battery service';

        return {
            isDue: true,
            item: mostUrgent,
            categoryQuery,
            milesRemaining: mostUrgent.milesRemaining
        };
    }

    /**
     * Add new custom maintenance item to vehicle
     */
    public addMaintenanceItem(
        vehicleId: string,
        item: { title: string; category: MaintenanceCategory; intervalMiles: number; icon?: string }
    ): MaintenanceItem {
        const profile = this.profiles[vehicleId];
        if (!profile) throw new Error('Vehicle profile not found');

        const currentOdo = profile.baseOdometer + profile.accumulatedTripMiles;
        const newItem: MaintenanceItem = {
            id: `maint_${item.category}_${Date.now()}`,
            title: item.title,
            category: item.category,
            icon: item.icon || '🔧',
            intervalMiles: Math.max(500, item.intervalMiles),
            lastServiceMileage: currentOdo
        };

        profile.items.push(newItem);
        this.save();
        return newItem;
    }

    /**
     * Log a completed maintenance service (resets the interval and records expense)
     */
    public logServiceCompleted(
        vehicleId: string,
        itemId: string,
        details: {
            cost?: number;
            date?: string;
            notes?: string;
            serviceMileage?: number;
        } = {}
    ): void {
        const profile = this.profiles[vehicleId];
        if (!profile) return;

        const currentOdo = details.serviceMileage != null 
            ? details.serviceMileage 
            : (profile.baseOdometer + profile.accumulatedTripMiles);

        const item = profile.items.find(i => i.id === itemId);
        if (item) {
            item.lastServiceMileage = Math.round(currentOdo * 10) / 10;
            item.lastServiceDate = details.date || new Date().toISOString().split('T')[0];
            item.lastServiceCost = details.cost;
            item.notes = details.notes;

            // Clear alert state
            profile.lastNotifiedMilestones[itemId] = 'none';
            this.save();

            console.log(`✅ [Maintenance] Service logged for ${item.title} at ${item.lastServiceMileage} mi`);
        }
    }

    /**
     * Update custom interval for an item (e.g. change oil change to 7,500 miles)
     */
    public updateInterval(vehicleId: string, itemId: string, newIntervalMiles: number): void {
        const profile = this.profiles[vehicleId];
        if (!profile) return;
        const item = profile.items.find(i => i.id === itemId);
        if (item && newIntervalMiles > 0) {
            item.intervalMiles = newIntervalMiles;
            this.save();
        }
    }

    /**
     * Check milestone alerts upon trip completion
     * Dispatches in-app notifications and native OS push notifications if due soon or overdue
     */
    public recordTripAndCheckMilestones(vehicle: Vehicle, tripDistanceMiles: number): {
        triggeredAlerts: { item: MaintenanceItem; status: 'due_soon' | 'overdue'; message: string }[];
    } {
        if (!vehicle || tripDistanceMiles <= 0) return { triggeredAlerts: [] };

        const profile = this.getProfile(vehicle);
        profile.accumulatedTripMiles += tripDistanceMiles;

        const currentOdo = Math.round((profile.baseOdometer + profile.accumulatedTripMiles) * 10) / 10;
        const triggeredAlerts: { item: MaintenanceItem; status: 'due_soon' | 'overdue'; message: string }[] = [];

        profile.items.forEach(item => {
            const driven = currentOdo - item.lastServiceMileage;
            const remaining = item.intervalMiles - driven;
            const lastNotified = profile.lastNotifiedMilestones[item.id] || 'none';

            const vehName = `${vehicle.year ? vehicle.year + ' ' : ''}${vehicle.make} ${vehicle.model}`;

            if (remaining <= 0 && lastNotified !== 'overdue') {
                // OVERDUE ALERT
                const title = `🚨 ${item.icon} ${item.title} Due!`;
                const message = `Your ${vehName} has reached its ${item.intervalMiles.toLocaleString()}-mile interval (${Math.abs(Math.round(remaining))} mi overdue). Schedule service now to keep your vehicle safe!`;

                this.dispatchAlert(title, message, item.icon);
                profile.lastNotifiedMilestones[item.id] = 'overdue';
                triggeredAlerts.push({ item, status: 'overdue', message });

            } else if (remaining <= 500 && remaining > 0 && lastNotified === 'none') {
                // DUE SOON WARNING (~500 mi left)
                const title = `⚠️ ${item.icon} ${item.title} Due Soon`;
                const message = `Your ${vehName} is ${Math.round(remaining)} miles away from its ${item.intervalMiles.toLocaleString()}-mile ${item.title.toLowerCase()}. Plan ahead!`;

                this.dispatchAlert(title, message, item.icon);
                profile.lastNotifiedMilestones[item.id] = 'due_soon';
                triggeredAlerts.push({ item, status: 'due_soon', message });
            }
        });

        this.save();
        return { triggeredAlerts };
    }

    /**
     * Helper to dispatch in-app notification + browser/PWA native notification
     */
    private dispatchAlert(title: string, message: string, icon: string): void {
        // 1. Add to In-App Notification Center
        try {
            addNotification('safety', title, message, icon);
        } catch (e) {
            console.warn('Could not add to NotificationCenter:', e);
        }

        // 2. Trigger Native OS / Browser Push Notification
        if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
            try {
                if ('serviceWorker' in navigator) {
                    navigator.serviceWorker.getRegistration().then(reg => {
                        if (reg && reg.showNotification) {
                            reg.showNotification(title, {
                                body: message,
                                icon: '/icon-192.png',
                                badge: '/icon-192.png',
                                tag: `maint_${Date.now()}`,
                                data: { url: '/maintenance' }
                            });
                        } else {
                            new Notification(title, { body: message, icon: '/icon-192.png' });
                        }
                    }).catch(() => {
                        new Notification(title, { body: message, icon: '/icon-192.png' });
                    });
                } else {
                    new Notification(title, { body: message, icon: '/icon-192.png' });
                }
            } catch (err) {
                console.warn('Could not fire native notification:', err);
            }
        }
    }
}

export const maintenanceAlertService = new MaintenanceAlertService();
