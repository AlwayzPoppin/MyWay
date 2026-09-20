/**
 * Vehicle & Fuel Economy Analytics Service
 * Calculates vehicle-specific fuel consumption, fuel costs per trip,
 * and aggregates daily, weekly, monthly, and yearly gas spending & route savings.
 */

import { Vehicle, Trip, Place } from '../types';
import { getSavedTrips } from './tripHistoryService';

const VEHICLES_STORAGE_KEY = 'myway_user_vehicles';
const ACTIVE_VEHICLE_STORAGE_KEY = 'myway_active_vehicle_id';
const GAS_PRICE_STORAGE_KEY = 'myway_gas_price';
const FUEL_TANK_STORAGE_KEY = 'myway_fuel_tank_state_v1';

export interface LowFuelAlert {
    vehicleId: string;
    vehicleName: string;
    fuelType: 'gasoline' | 'diesel' | 'hybrid' | 'electric';
    gallonsRemaining: number;
    percentRemaining: number;
    estimatedRangeMiles: number;
    usableRangeMiles: number;
    tripMiles: number;
    isCriticalRange: boolean;
    severity: 'critical' | 'warning';
    title: string;
    message: string;
    subtext: string;
    spokenPrompt: string;
    gasStations?: Place[];
    recommendedGasStation?: Place;
}

export interface FuelTankStatus {
    vehicleId: string;
    /** Actual gallons currently believed to be in the tank. */
    gallonsRemaining: number;
    tankCapacityGal: number;
    percentRemaining: number;
    estimatedRangeMiles: number;
    /** Range after preserving a 10% tank reserve. */
    usableRangeMiles: number;
    lastUpdatedAt: number;
    source: 'manual' | 'fill_up' | 'trip_tracking';
    calibratedMpg?: number;
    milesSinceFillUp: number;
}

export interface TripFuelReadiness {
    isTracking: boolean;
    canCompleteWithReserve: boolean;
    gallonsNeeded: number;
    gallonsNeededWithReserve: number;
    gallonsToAdd: number;
    reserveGallons: number;
    status?: FuelTankStatus;
}

interface StoredFuelTankState {
    gallonsRemaining: number;
    lastUpdatedAt: number;
    source: FuelTankStatus['source'];
    milesSinceFillUp?: number;
    calibratedMpg?: number;
}

export const VEHICLE_PRESETS: Omit<Vehicle, 'id'>[] = [
    { name: 'Standard Sedan', make: 'Toyota', model: 'Camry', year: 2023, fuelType: 'gasoline', mpg: 32, tankCapacityGal: 15.8, isPrimary: true },
    { name: 'Compact Car', make: 'Honda', model: 'Civic', year: 2023, fuelType: 'gasoline', mpg: 36, tankCapacityGal: 12.4 },
    { name: 'Midsize SUV', make: 'Toyota', model: 'RAV4', year: 2022, fuelType: 'gasoline', mpg: 28, tankCapacityGal: 14.5 },
    { name: 'Full-Size SUV', make: 'Chevy', model: 'Tahoe', year: 2022, fuelType: 'gasoline', mpg: 18, tankCapacityGal: 24.0 },
    { name: 'Pickup Truck', make: 'Ford', model: 'F-150', year: 2023, fuelType: 'gasoline', mpg: 20, tankCapacityGal: 26.0 },
    { name: 'Off-Road 4×4 SUV', make: 'Jeep', model: 'Wrangler', year: 2023, fuelType: 'gasoline', mpg: 16, tankCapacityGal: 18.6 },
    { name: 'Hybrid Vehicle', make: 'Toyota', model: 'Prius', year: 2023, fuelType: 'hybrid', mpg: 52, tankCapacityGal: 11.3 },
    { name: 'Electric Vehicle (EV)', make: 'Tesla', model: 'Model Y', year: 2023, fuelType: 'electric', mpg: 115, tankCapacityGal: 75 }, // MPGe & kWh
    { name: 'Diesel Truck', make: 'Ford', model: 'Super Duty', year: 2022, fuelType: 'diesel', mpg: 16, tankCapacityGal: 34.0 },
];

export interface FuelSpendingSummary {
    period: 'today' | 'week' | 'month' | 'year' | 'lifetime';
    totalDistanceMiles: number;
    totalGallons: number;
    totalCost: number;
    totalMoneySaved: number;
    tripCount: number;
    avgMpg: number;
}

export interface RollingFuelReport {
    today: FuelSpendingSummary;
    thisWeek: FuelSpendingSummary;
    thisMonth: FuelSpendingSummary;
    thisYear: FuelSpendingSummary;
    lifetime: FuelSpendingSummary;
    projectedAnnualCost: number;
    activeVehicle: Vehicle;
    gasPricePerGallon: number;
}

class VehicleFuelService {
    private vehicles: Vehicle[] = [];
    private activeVehicleId: string = '';
    private gasPrice: number = 3.45; // Default national gas price $/gal
    private fuelTankStates: Record<string, StoredFuelTankState> = {};

    constructor() {
        this.load();
    }

    private load(): void {
        if (typeof window === 'undefined') return;
        try {
            const rawVehicles = localStorage.getItem(VEHICLES_STORAGE_KEY);
            if (rawVehicles) {
                const parsed = JSON.parse(rawVehicles);
                let migratedLegacyWrangler = false;
                // Strip legacy mock placeholder vehicle so wizard opens for existing users
                this.vehicles = parsed.filter((v: Vehicle) => v.id !== 'veh_default_1').map((v: Vehicle) => {
                    // Correct the old built-in Wrangler seed. Only this exact
                    // legacy preset is migrated; custom vehicle MPG is never
                    // touched by the app.
                    const isLegacyWranglerPreset = v.name === 'Jeep Wrangler 4x4'
                        && v.make === 'Jeep'
                        && v.model === 'Wrangler'
                        && v.year === 2024
                        && v.mpg === 22;
                    // Repair the short-lived year-specific preset migration,
                    // without changing independently named custom vehicles.
                    const isPreviousMigration = v.name === '2008 Jeep Wrangler 4x4'
                        && v.make === 'Jeep'
                        && v.model === 'Wrangler'
                        && v.year === 2008
                        && v.mpg === 16;
                    if (!isLegacyWranglerPreset && !isPreviousMigration) return v;
                    migratedLegacyWrangler = true;
                    return { ...v, name: 'Jeep Wrangler 4x4', year: undefined, mpg: 16, tankCapacityGal: 18.6 };
                });
                if (parsed.length !== this.vehicles.length || migratedLegacyWrangler) this.saveVehicles();
            }
            // No default vehicles — user adds their own via the setup wizard

            const activeId = localStorage.getItem(ACTIVE_VEHICLE_STORAGE_KEY);
            if (activeId && this.vehicles.some(v => v.id === activeId)) {
                this.activeVehicleId = activeId;
            } else if (this.vehicles.length > 0) {
                this.activeVehicleId = this.vehicles[0].id;
            }

            const rawPrice = localStorage.getItem(GAS_PRICE_STORAGE_KEY);
            if (rawPrice) {
                const parsed = parseFloat(rawPrice);
                if (!isNaN(parsed) && parsed > 0) this.gasPrice = parsed;
            }
            const rawTankStates = localStorage.getItem(FUEL_TANK_STORAGE_KEY);
            if (rawTankStates) {
                const parsed = JSON.parse(rawTankStates);
                if (parsed && typeof parsed === 'object') this.fuelTankStates = parsed;
            }
        } catch (e) {
            console.warn('[VehicleFuelService] Failed to load data:', e);
        }
    }

    private saveVehicles(): void {
        if (typeof window === 'undefined') return;
        try {
            localStorage.setItem(VEHICLES_STORAGE_KEY, JSON.stringify(this.vehicles));
        } catch (e) {
            console.warn('[VehicleFuelService] Failed to save vehicles:', e);
        }
    }

    private saveFuelTankStates(): void {
        if (typeof window === 'undefined') return;
        try {
            localStorage.setItem(FUEL_TANK_STORAGE_KEY, JSON.stringify(this.fuelTankStates));
        } catch (e) {
            console.warn('[VehicleFuelService] Failed to save fuel tank state:', e);
        }
    }

    public getVehicles(): Vehicle[] {
        return [...this.vehicles];
    }

    public getActiveVehicle(): Vehicle {
        const found = this.vehicles.find(v => v.id === this.activeVehicleId);
        if (found) return found;
        if (this.vehicles.length > 0) return this.vehicles[0];
        return {
            id: 'veh_fallback',
            name: 'Standard Car',
            make: 'Generic',
            model: 'Sedan',
            fuelType: 'gasoline',
            mpg: 28,
            isPrimary: true
        };
    }

    public getActiveVehicleNullable(): Vehicle | null {
        if (this.vehicles.length === 0) return null;
        const found = this.vehicles.find(v => v.id === this.activeVehicleId);
        if (found) return found;
        return this.vehicles[0] || null;
    }

    public clearActiveVehicle(): void {
        this.activeVehicleId = '';
        if (typeof window !== 'undefined') {
            localStorage.removeItem(ACTIVE_VEHICLE_STORAGE_KEY);
        }
    }

    public setActiveVehicle(id: string): void {
        this.activeVehicleId = id;
        if (typeof window !== 'undefined') {
            localStorage.setItem(ACTIVE_VEHICLE_STORAGE_KEY, id);
        }
    }

    public addVehicle(vehicle: Omit<Vehicle, 'id'>): Vehicle {
        const newVehicle: Vehicle = {
            ...vehicle,
            id: `veh_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
        };
        this.vehicles.push(newVehicle);
        // Instantly populate this active card with the newly added vehicle
        this.setActiveVehicle(newVehicle.id);
        this.saveVehicles();
        return newVehicle;
    }

    public updateVehicle(id: string, updates: Partial<Vehicle>): void {
        this.vehicles = this.vehicles.map(v => v.id === id ? { ...v, ...updates } : v);
        this.saveVehicles();
    }

    public deleteVehicle(id: string): void {
        this.vehicles = this.vehicles.filter(v => v.id !== id);
        if (this.activeVehicleId === id) {
            if (this.vehicles.length > 0) {
                this.setActiveVehicle(this.vehicles[0].id);
            } else {
                this.clearActiveVehicle();
            }
        }
        delete this.fuelTankStates[id];
        this.saveFuelTankStates();
        this.saveVehicles();
    }

    public getGasPrice(): number {
        return this.gasPrice;
    }

    public setGasPrice(price: number): void {
        if (price > 0) {
            this.gasPrice = price;
            if (typeof window !== 'undefined') {
                localStorage.setItem(GAS_PRICE_STORAGE_KEY, price.toFixed(2));
            }
        }
    }

    /**
     * Establishes the known amount in the active vehicle's tank. The app only
     * deducts trip fuel after this first manual or fill-up reading, so it never
     * pretends to know a user's starting fuel level.
     */
    public setFuelLevel(gallonsRemaining: number, vehicle?: Vehicle, source: FuelTankStatus['source'] = 'manual'): FuelTankStatus | null {
        const v = vehicle || this.getActiveVehicleNullable();
        const capacity = v?.tankCapacityGal;
        if (!v || !capacity || capacity <= 0 || !Number.isFinite(gallonsRemaining)) return null;
        this.fuelTankStates[v.id] = {
            gallonsRemaining: Math.max(0, Math.min(capacity, gallonsRemaining)),
            lastUpdatedAt: Date.now(),
            source,
            milesSinceFillUp: this.fuelTankStates[v.id]?.milesSinceFillUp || 0,
            calibratedMpg: this.fuelTankStates[v.id]?.calibratedMpg
        };
        this.saveFuelTankStates();
        return this.getFuelTankStatus(v);
    }

    /** Records a full fill-up with one tap and resets the remaining-fuel estimate. */
    public markTankFull(vehicle?: Vehicle): FuelTankStatus | null {
        const v = vehicle || this.getActiveVehicleNullable();
        if (!v?.tankCapacityGal) return null;
        const previous = this.fuelTankStates[v.id];
        this.fuelTankStates[v.id] = {
            gallonsRemaining: v.tankCapacityGal,
            lastUpdatedAt: Date.now(),
            source: 'fill_up',
            milesSinceFillUp: 0,
            calibratedMpg: previous?.calibratedMpg
        };
        this.saveFuelTankStates();
        return this.getFuelTankStatus(v);
    }

    /**
     * Logs a full fill-up. When the driver enters the gallons shown on the
     * pump, MyWay learns observed MPG from completed-trip distance since the
     * previous full fill-up. A rolling average prevents one bad tank from
     * wildly changing future route predictions.
     */
    public recordFullFillUp(gallonsAdded: number, vehicle?: Vehicle): FuelTankStatus | null {
        const v = vehicle || this.getActiveVehicleNullable();
        if (!v?.tankCapacityGal || !Number.isFinite(gallonsAdded) || gallonsAdded <= 0) return this.markTankFull(v || undefined);
        const previous = this.fuelTankStates[v.id];
        const milesSinceFillUp = previous?.milesSinceFillUp || 0;
        const observedMpg = milesSinceFillUp >= 5 ? milesSinceFillUp / gallonsAdded : undefined;
        // Guard against input mistakes such as dollars entered instead of gallons.
        const plausibleObservedMpg = observedMpg && observedMpg >= 4 && observedMpg <= 150 ? observedMpg : undefined;
        const calibratedMpg = plausibleObservedMpg
            ? parseFloat((((previous?.calibratedMpg || v.mpg) * 0.65) + (plausibleObservedMpg * 0.35)).toFixed(1))
            : previous?.calibratedMpg;
        this.fuelTankStates[v.id] = {
            gallonsRemaining: v.tankCapacityGal,
            lastUpdatedAt: Date.now(),
            source: 'fill_up',
            milesSinceFillUp: 0,
            calibratedMpg
        };
        this.saveFuelTankStates();
        return this.getFuelTankStatus(v);
    }

    public getEffectiveMpg(vehicle?: Vehicle): number {
        const v = vehicle || this.getActiveVehicle();
        return Math.max(1, this.fuelTankStates[v.id]?.calibratedMpg || v.mpg || 28);
    }

    public getFuelTankStatus(vehicle?: Vehicle): FuelTankStatus | null {
        const v = vehicle || this.getActiveVehicleNullable();
        const capacity = v?.tankCapacityGal;
        if (!v || !capacity || capacity <= 0) return null;
        const stored = this.fuelTankStates[v.id];
        if (!stored || !Number.isFinite(stored.gallonsRemaining)) return null;
        const gallonsRemaining = Math.max(0, Math.min(capacity, stored.gallonsRemaining));
        const mpg = this.getEffectiveMpg(v);
        const reserveGallons = capacity * 0.10;
        return {
            vehicleId: v.id,
            gallonsRemaining: parseFloat(gallonsRemaining.toFixed(2)),
            tankCapacityGal: capacity,
            percentRemaining: Math.round((gallonsRemaining / capacity) * 100),
            estimatedRangeMiles: Math.max(0, Math.round(gallonsRemaining * mpg)),
            usableRangeMiles: Math.max(0, Math.round((gallonsRemaining - reserveGallons) * mpg)),
            lastUpdatedAt: stored.lastUpdatedAt,
            source: stored.source,
            calibratedMpg: stored.calibratedMpg,
            milesSinceFillUp: parseFloat((stored.milesSinceFillUp || 0).toFixed(1))
        };
    }

    /** Evaluates a planned route using a 10% reserve; never fabricates a warning without a known tank level. */
    public assessTripFuel(distanceMiles: number, vehicle?: Vehicle): TripFuelReadiness {
        const v = vehicle || this.getActiveVehicle();
        const capacity = Math.max(0, v.tankCapacityGal || 0);
        const mpg = this.getEffectiveMpg(v);
        const gallonsNeeded = Math.max(0, distanceMiles) / mpg;
        const reserveGallons = capacity * 0.10;
        const status = this.getFuelTankStatus(v);
        const gallonsNeededWithReserve = gallonsNeeded + reserveGallons;
        const gallonsToAdd = status ? Math.max(0, gallonsNeededWithReserve - status.gallonsRemaining) : 0;
        return {
            isTracking: !!status,
            canCompleteWithReserve: !!status && status.gallonsRemaining >= gallonsNeededWithReserve,
            gallonsNeeded: parseFloat(gallonsNeeded.toFixed(2)),
            gallonsNeededWithReserve: parseFloat(gallonsNeededWithReserve.toFixed(2)),
            gallonsToAdd: parseFloat(gallonsToAdd.toFixed(2)),
            reserveGallons: parseFloat(reserveGallons.toFixed(2)),
            status: status || undefined
        };
    }

    /**
     * Evaluates whether the active vehicle has low fuel/battery or cannot safely
     * complete the planned trip distance. Returns a LowFuelAlert object if triggered,
     * or null if fuel is adequate or not tracked.
     */
    public checkLowFuelAlert(tripMiles: number = 0, vehicle?: Vehicle): LowFuelAlert | null {
        const v = vehicle || this.getActiveVehicleNullable();
        if (!v) return null;
        const status = this.getFuelTankStatus(v);
        if (!status) return null;

        const isEv = v.fuelType === 'electric';
        const unit = isEv ? 'kWh' : 'gal';
        const percent = status.percentRemaining;
        const estRange = status.estimatedRangeMiles;
        const usableRange = status.usableRangeMiles;
        const readiness = this.assessTripFuel(tripMiles, v);

        // Conditions that warrant an alert:
        // 1. Critical range: Estimated range is less than trip distance (cannot reach destination)
        const isCriticalRange = tripMiles > 0 && estRange < tripMiles;
        
        // 2. Dangerously near empty: <= 10% tank / battery
        const isNearEmpty = percent <= 10;

        // 3. Low fuel warning: <= 25% tank (1/4 tank threshold), or usable reserve is 0 for any non-trivial trip, or cannot complete with reserve
        const isLowFuel = percent <= 25 || (usableRange <= 0 && tripMiles > 2) || (tripMiles > 0 && !readiness.canCompleteWithReserve);

        if (!isCriticalRange && !isNearEmpty && !isLowFuel) {
            return null;
        }

        const severity: 'critical' | 'warning' = (isCriticalRange || isNearEmpty) ? 'critical' : 'warning';
        
        let title = '';
        let message = '';
        let subtext = '';
        let spokenPrompt = '';

        if (isCriticalRange) {
            title = isEv ? 'Critical Battery Alert' : 'Critical Low Fuel';
            message = `Range (${estRange} mi) is less than trip distance (${tripMiles.toFixed(1)} mi)!`;
            subtext = `You will run out of ${isEv ? 'charge' : 'fuel'} before arriving. Add a fuel stop now.`;
            spokenPrompt = `Caution: Critically low ${isEv ? 'battery' : 'fuel'}. Your estimated range is ${estRange} miles, but your trip is ${tripMiles.toFixed(1)} miles. You need to ${isEv ? 'charge' : 'refuel'} to reach your destination.`;
        } else if (isNearEmpty) {
            title = isEv ? 'Low Battery Alert' : 'Low Fuel Alert';
            message = `${status.gallonsRemaining} ${unit} left (${percent}% • ~${estRange} mi range)`;
            subtext = `Emergency reserve level. Find ${isEv ? 'a charging station' : 'a gas station'} immediately.`;
            spokenPrompt = `Warning: ${isEv ? 'Battery' : 'Fuel tank'} is near empty at ${percent} percent. Only ${status.gallonsRemaining} ${isEv ? 'kilowatt hours' : 'gallons'} remaining.`;
        } else {
            title = isEv ? 'Low Battery Alert' : 'Low Fuel Alert';
            message = `${status.gallonsRemaining} ${unit} left (${percent}% • ~${estRange} mi range)`;
            subtext = tripMiles > 0 && !readiness.canCompleteWithReserve
                ? `Insufficient fuel for ${tripMiles.toFixed(1)} mi trip with 10% reserve. Fill-up recommended.`
                : `Reserve depleted. Recommended to fill up before highway or long segments.`;
            spokenPrompt = `Low ${isEv ? 'battery' : 'fuel'} warning. Your ${isEv ? 'charge' : 'tank'} is at ${percent} percent with ${estRange} miles of range. Would you like to stop for ${isEv ? 'charging' : 'fuel'}?`;
        }

        return {
            vehicleId: v.id,
            vehicleName: v.name,
            fuelType: (v.fuelType as any) || 'gasoline',
            gallonsRemaining: status.gallonsRemaining,
            percentRemaining: percent,
            estimatedRangeMiles: estRange,
            usableRangeMiles: usableRange,
            tripMiles,
            isCriticalRange,
            severity,
            title,
            message,
            subtext,
            spokenPrompt
        };
    }

    /** Deducts recorded trip fuel only after the driver has established a real tank level. */
    public recordTripConsumption(gallonsUsed: number, vehicle?: Vehicle, distanceMiles = 0): FuelTankStatus | null {
        const v = vehicle || this.getActiveVehicleNullable();
        if (!v || !Number.isFinite(gallonsUsed) || gallonsUsed <= 0) return this.getFuelTankStatus(v || undefined);
        const status = this.getFuelTankStatus(v);
        if (!status) return null;
        const previous = this.fuelTankStates[v.id];
        this.fuelTankStates[v.id] = {
            gallonsRemaining: Math.max(0, status.gallonsRemaining - gallonsUsed),
            lastUpdatedAt: Date.now(),
            source: 'trip_tracking',
            milesSinceFillUp: (previous?.milesSinceFillUp || 0) + Math.max(0, distanceMiles),
            calibratedMpg: previous?.calibratedMpg
        };
        this.saveFuelTankStates();
        return this.getFuelTankStatus(v);
    }

    /**
     * Calculates exact fuel and cost for a single trip distance
     */
    public calculateTripFuel(distanceMiles: number, vehicle?: Vehicle): {
        gallons: number;
        cost: number;
        mpg: number;
        costFormatted: string;
    } {
        const v = vehicle || this.getActiveVehicle();
        const mpg = this.getEffectiveMpg(v);
        const gallons = distanceMiles / mpg;
        const cost = gallons * this.gasPrice;

        return {
            gallons: parseFloat(gallons.toFixed(2)),
            cost: parseFloat(cost.toFixed(2)),
            mpg,
            costFormatted: `$${cost.toFixed(2)}`
        };
    }

    /**
     * Generates rolling fuel spending and route savings summary
     */
    public getRollingFuelReport(trips?: Trip[]): RollingFuelReport {
        const allTrips = trips || getSavedTrips();
        const activeVeh = this.getActiveVehicle();
        const mpg = this.getEffectiveMpg(activeVeh);
        const gasPrice = this.gasPrice;

        const now = Date.now();
        const ONE_DAY_MS = 86400000;

        const startOfToday = new Date();
        startOfToday.setHours(0, 0, 0, 0);
        const startOfTodayMs = startOfToday.getTime();

        const sevenDaysAgoMs = now - (7 * ONE_DAY_MS);
        const thirtyDaysAgoMs = now - (30 * ONE_DAY_MS);
        const oneYearAgoMs = now - (365 * ONE_DAY_MS);

        const aggregate = (filteredTrips: Trip[], period: FuelSpendingSummary['period']): FuelSpendingSummary => {
            let totalDist = 0;
            let totalGal = 0;
            let totalCost = 0;
            let totalSaved = 0;

            filteredTrips.forEach(t => {
                const dist = t.totalDistanceMiles || 0;
                totalDist += dist;

                // Calculate or use recorded trip fuel
                const gal = t.fuelGallons !== undefined ? t.fuelGallons : (dist / mpg);
                const cost = t.fuelCost !== undefined ? t.fuelCost : (gal * gasPrice);
                
                // Typical eco route savings ~12% or recorded savings
                const saved = t.moneySaved !== undefined ? t.moneySaved : (cost * 0.12);

                totalGal += gal;
                totalCost += cost;
                totalSaved += saved;
            });

            return {
                period,
                totalDistanceMiles: parseFloat(totalDist.toFixed(1)),
                totalGallons: parseFloat(totalGal.toFixed(1)),
                totalCost: parseFloat(totalCost.toFixed(2)),
                totalMoneySaved: parseFloat(totalSaved.toFixed(2)),
                tripCount: filteredTrips.length,
                avgMpg: mpg
            };
        };

        const todaySummary = aggregate(allTrips.filter(t => t.startTime >= startOfTodayMs), 'today');
        const weekSummary = aggregate(allTrips.filter(t => t.startTime >= sevenDaysAgoMs), 'week');
        const monthSummary = aggregate(allTrips.filter(t => t.startTime >= thirtyDaysAgoMs), 'month');
        const yearSummary = aggregate(allTrips.filter(t => t.startTime >= oneYearAgoMs), 'year');
        const lifetimeSummary = aggregate(allTrips, 'lifetime');

        // Projected annual cost based on monthly average (or standard 12,000 miles/yr)
        const projectedAnnual = monthSummary.totalCost > 0 
            ? monthSummary.totalCost * 12 
            : (12000 / mpg) * gasPrice;

        return {
            today: todaySummary,
            thisWeek: weekSummary,
            thisMonth: monthSummary,
            thisYear: yearSummary,
            lifetime: lifetimeSummary,
            projectedAnnualCost: parseFloat(projectedAnnual.toFixed(2)),
            activeVehicle: activeVeh,
            gasPricePerGallon: gasPrice
        };
    }
}

export const vehicleFuelService = new VehicleFuelService();

/**
 * Live Trip Fuel Snapshot — real-time fuel consumption state during active navigation.
 */
export interface LiveFuelSnapshot {
    gallonsBurned: number;
    costSoFar: number;
    effectiveTripMpg: number;
    milesDriven: number;
    gallonsRemaining: number | null;
    percentRemaining: number | null;
    predictedRangeMiles: number | null;
    tankCapacityGal: number | null;
    idleSeconds: number;
    behaviorPenaltyGallons: number;
    vehicleName?: string;
    fuelType?: Vehicle['fuelType'];
    isPenaltyActive?: boolean;
    penaltyType?: 'hard_brake' | 'rapid_accel' | null;
    isIdling?: boolean;
}

/**
 * Live Trip Fuel Tracker
 * 
 * Runs during active navigation and computes real-time fuel burn per GPS tick.
 * Accounts for driving behavior penalties:
 *   - Hard brake event   → +15% fuel waste (wasted momentum recovery)
 *   - Rapid acceleration → +25% fuel enrichment under heavy engine load
 *   - Idle (< 2 mph for > 8s) → baseline idle burn (~0.3 gal/hr or EV accessory draw)
 */
export class LiveTripFuelTracker {
    private gallonsBurned = 0;
    private behaviorPenaltyGallons = 0;
    private milesDriven = 0;
    private penaltyMultiplier = 1.0;
    private penaltySecondsRemaining = 0;
    private lastPenaltyType: 'hard_brake' | 'rapid_accel' | null = null;
    private idleStartTime: number | null = null;
    private idleTotalSeconds = 0;
    private lastTickTime: number | null = null;

    // Tuning constants
    private readonly IDLE_SPEED_THRESHOLD_MPS = 0.9; // ~2 mph
    private readonly IDLE_QUALIFY_MS = 8_000; // 8s at red light before idle burn kicks in
    private readonly IDLE_BURN_GAL_PER_HOUR = 0.28; // ~0.28 gal/hr baseline idle for gas/diesel

    private vehicle: Vehicle;
    private baseMpg: number;
    private gasPrice: number;
    private initialGallonsRemaining: number | null;
    private tankCapacityGal: number | null;

    constructor() {
        this.vehicle = vehicleFuelService.getActiveVehicle();
        this.baseMpg = vehicleFuelService.getEffectiveMpg(this.vehicle);
        this.gasPrice = vehicleFuelService.getGasPrice();
        const tankStatus = vehicleFuelService.getFuelTankStatus(this.vehicle);
        this.initialGallonsRemaining = tankStatus?.gallonsRemaining ?? null;
        this.tankCapacityGal = this.vehicle.tankCapacityGal ?? null;
    }

    /**
     * Called every GPS tick with the raw (un-smoothed) speed and time delta.
     * Computes incremental fuel burn for the segment.
     */
    recordTick(rawSpeedMps: number, dtSeconds: number): void {
        if (dtSeconds <= 0 || dtSeconds > 30 || !Number.isFinite(rawSpeedMps)) return;

        const now = Date.now();
        const isEv = this.vehicle.fuelType === 'electric';

        // --- Idle tracking ---
        if (rawSpeedMps < this.IDLE_SPEED_THRESHOLD_MPS) {
            if (this.idleStartTime === null) {
                this.idleStartTime = now;
            } else {
                const idleDuration = now - this.idleStartTime;
                if (idleDuration >= this.IDLE_QUALIFY_MS) {
                    // Accumulate idle burn (EV draws ~1.5 kW auxiliary AC/electronics; combustion engine burns ~0.28 gal/hr)
                    const hourlyRate = isEv ? 0.04 : this.IDLE_BURN_GAL_PER_HOUR;
                    const idleBurnGal = (hourlyRate / 3600) * dtSeconds;
                    this.gallonsBurned += idleBurnGal;
                    this.idleTotalSeconds += dtSeconds;
                }
            }
            this.lastTickTime = now;
            return; // No distance traveled — skip distance-based burn
        }

        // Moving — reset idle tracker
        if (this.idleStartTime !== null) {
            this.idleStartTime = null;
        }

        // --- Distance-based fuel burn ---
        const distanceMiles = (rawSpeedMps * dtSeconds) / 1609.344;
        this.milesDriven += distanceMiles;

        // Apply sustained behavior penalty if active
        let effectiveMultiplier = 1.0;
        if (this.penaltySecondsRemaining > 0) {
            effectiveMultiplier = this.penaltyMultiplier;
            this.penaltySecondsRemaining = Math.max(0, this.penaltySecondsRemaining - dtSeconds);
            if (this.penaltySecondsRemaining <= 0) {
                this.penaltyMultiplier = 1.0;
                this.lastPenaltyType = null;
            }
        }

        const baselineGallons = distanceMiles / this.baseMpg;
        const gallonsForSegment = baselineGallons * effectiveMultiplier;
        this.gallonsBurned += gallonsForSegment;

        if (effectiveMultiplier > 1.0) {
            this.behaviorPenaltyGallons += (gallonsForSegment - baselineGallons);
        }

        this.lastTickTime = now;
    }

    /** Register a drive behavior event that penalizes fuel efficiency over the next window of driving. */
    recordDriveEvent(type: 'hard_brake' | 'rapid_accel'): void {
        this.lastPenaltyType = type;
        if (type === 'hard_brake') {
            this.penaltyMultiplier = Math.max(this.penaltyMultiplier, 1.15); // +15% fuel wasted regaining momentum
            this.penaltySecondsRemaining = Math.max(this.penaltySecondsRemaining, 8);
        } else if (type === 'rapid_accel') {
            this.penaltyMultiplier = Math.max(this.penaltyMultiplier, 1.25); // +25% fuel enrichment under heavy load
            this.penaltySecondsRemaining = Math.max(this.penaltySecondsRemaining, 8);
        }
    }

    /** Returns the current live fuel snapshot for HUD display. */
    getSnapshot(): LiveFuelSnapshot {
        const effectiveMpg = this.milesDriven > 0.05 && this.gallonsBurned > 0
            ? this.milesDriven / this.gallonsBurned
            : this.baseMpg;

        const gallonsRemaining = this.initialGallonsRemaining !== null
            ? Math.max(0, this.initialGallonsRemaining - this.gallonsBurned)
            : null;

        const percentRemaining = gallonsRemaining !== null && this.tankCapacityGal
            ? Math.round((gallonsRemaining / this.tankCapacityGal) * 100)
            : null;

        const predictedRange = gallonsRemaining !== null
            ? Math.max(0, Math.round(gallonsRemaining * effectiveMpg))
            : null;

        const isIdling = this.idleStartTime !== null && (Date.now() - this.idleStartTime) >= this.IDLE_QUALIFY_MS;

        return {
            gallonsBurned: parseFloat(this.gallonsBurned.toFixed(3)),
            costSoFar: parseFloat((this.gallonsBurned * this.gasPrice).toFixed(2)),
            effectiveTripMpg: parseFloat(effectiveMpg.toFixed(1)),
            milesDriven: parseFloat(this.milesDriven.toFixed(2)),
            gallonsRemaining: gallonsRemaining !== null ? parseFloat(gallonsRemaining.toFixed(2)) : null,
            percentRemaining,
            predictedRangeMiles: predictedRange,
            tankCapacityGal: this.tankCapacityGal,
            idleSeconds: Math.round(this.idleTotalSeconds),
            behaviorPenaltyGallons: parseFloat(this.behaviorPenaltyGallons.toFixed(4)),
            vehicleName: this.vehicle.name,
            fuelType: this.vehicle.fuelType,
            isPenaltyActive: this.penaltySecondsRemaining > 0,
            penaltyType: this.penaltySecondsRemaining > 0 ? this.lastPenaltyType : null,
            isIdling
        };
    }

    /** Rebase the active trip after a manual pump/charge reading without losing trip burn data. */
    syncFuelLevel(gallonsRemaining: number): void {
        if (!Number.isFinite(gallonsRemaining)) return;
        this.initialGallonsRemaining = Math.max(0, gallonsRemaining) + this.gallonsBurned;
    }

    /** Get total gallons burned for final trip recording. */
    getGallonsBurned(): number {
        return this.gallonsBurned;
    }

    reset(): void {
        this.gallonsBurned = 0;
        this.behaviorPenaltyGallons = 0;
        this.milesDriven = 0;
        this.penaltyMultiplier = 1.0;
        this.penaltySecondsRemaining = 0;
        this.idleStartTime = null;
        this.idleTotalSeconds = 0;
        this.lastTickTime = null;
    }
}
