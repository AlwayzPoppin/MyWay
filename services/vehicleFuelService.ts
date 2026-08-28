/**
 * Vehicle & Fuel Economy Analytics Service
 * Calculates vehicle-specific fuel consumption, fuel costs per trip,
 * and aggregates daily, weekly, monthly, and yearly gas spending & route savings.
 */

import { Vehicle, Trip } from '../types';
import { getSavedTrips } from './tripHistoryService';

const VEHICLES_STORAGE_KEY = 'myway_user_vehicles';
const ACTIVE_VEHICLE_STORAGE_KEY = 'myway_active_vehicle_id';
const GAS_PRICE_STORAGE_KEY = 'myway_gas_price';

export const VEHICLE_PRESETS: Omit<Vehicle, 'id'>[] = [
    { name: 'Standard Sedan', make: 'Toyota', model: 'Camry', year: 2023, fuelType: 'gasoline', mpg: 32, tankCapacityGal: 15.8, isPrimary: true },
    { name: 'Compact Car', make: 'Honda', model: 'Civic', year: 2023, fuelType: 'gasoline', mpg: 36, tankCapacityGal: 12.4 },
    { name: 'Midsize SUV', make: 'Toyota', model: 'RAV4', year: 2022, fuelType: 'gasoline', mpg: 28, tankCapacityGal: 14.5 },
    { name: 'Full-Size SUV', make: 'Chevy', model: 'Tahoe', year: 2022, fuelType: 'gasoline', mpg: 18, tankCapacityGal: 24.0 },
    { name: 'Pickup Truck', make: 'Ford', model: 'F-150', year: 2023, fuelType: 'gasoline', mpg: 20, tankCapacityGal: 26.0 },
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

    constructor() {
        this.load();
    }

    private load(): void {
        if (typeof window === 'undefined') return;
        try {
            const rawVehicles = localStorage.getItem(VEHICLES_STORAGE_KEY);
            if (rawVehicles) {
                const parsed = JSON.parse(rawVehicles);
                // Strip legacy mock placeholder vehicle so wizard opens for existing users
                this.vehicles = parsed.filter((v: Vehicle) => v.id !== 'veh_default_1');
                if (parsed.length !== this.vehicles.length) this.saveVehicles();
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
        if (this.vehicles.length === 1 || vehicle.isPrimary) {
            this.setActiveVehicle(newVehicle.id);
        }
        this.saveVehicles();
        return newVehicle;
    }

    public updateVehicle(id: string, updates: Partial<Vehicle>): void {
        this.vehicles = this.vehicles.map(v => v.id === id ? { ...v, ...updates } : v);
        this.saveVehicles();
    }

    public deleteVehicle(id: string): void {
        this.vehicles = this.vehicles.filter(v => v.id !== id);
        if (this.activeVehicleId === id && this.vehicles.length > 0) {
            this.setActiveVehicle(this.vehicles[0].id);
        }
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
     * Calculates exact fuel and cost for a single trip distance
     */
    public calculateTripFuel(distanceMiles: number, vehicle?: Vehicle): {
        gallons: number;
        cost: number;
        mpg: number;
        costFormatted: string;
    } {
        const v = vehicle || this.getActiveVehicle();
        const mpg = Math.max(1, v.mpg || 28);
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
        const mpg = activeVeh.mpg || 28;
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
