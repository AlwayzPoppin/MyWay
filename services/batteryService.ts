import { Capacitor, registerPlugin } from '@capacitor/core';

interface NativeBatteryPluginInterface {
    getBatteryInfo(): Promise<{ level: number; isCharging: boolean }>;
}

const NativeBattery = registerPlugin<NativeBatteryPluginInterface>('NativeBattery');

export interface BatteryInfo {
    level: number; // 0 - 100
    isCharging: boolean;
}

/**
 * Universal Battery Service
 * Real-time hardware battery percentage and charging monitor with automatic polling
 * across Native Android, iOS, and Web environments.
 */
class BatteryService {
    private cachedLevel: number = 100;
    private isCharging: boolean = false;
    private listeners: ((info: BatteryInfo) => void)[] = [];
    private pollInterval: ReturnType<typeof setInterval> | null = null;
    private isInitialized: boolean = false;

    constructor() {
        this.init();
    }

    private async init() {
        if (this.isInitialized) return;
        this.isInitialized = true;

        // Perform initial battery read immediately
        await this.refresh();

        // 1. Web Battery API event listeners (Chrome/Edge/Android WebView)
        if (typeof window !== 'undefined' && typeof navigator !== 'undefined' && 'getBattery' in navigator) {
            try {
                const battery = await (navigator as any).getBattery();
                this.updateFromWeb(battery);

                battery.addEventListener('levelchange', () => this.updateFromWeb(battery));
                battery.addEventListener('chargingchange', () => this.updateFromWeb(battery));
            } catch (e) {
                // Ignore web battery permissions
            }
        }

        // 2. Continuous Periodic Polling (every 30 seconds to track live battery changes)
        if (typeof window !== 'undefined') {
            this.pollInterval = setInterval(() => {
                this.refresh();
            }, 30000);
        }
    }

    private updateFromWeb(battery: any) {
        if (typeof battery?.level === 'number') {
            const pct = Math.round(battery.level * 100);
            this.cachedLevel = Math.max(0, Math.min(100, pct));
            this.isCharging = Boolean(battery.charging);
            this.notify();
        }
    }

    public async refresh(): Promise<BatteryInfo> {
        // 1. Mobile Native Android / iOS via Capacitor Plugin
        if (Capacitor.isNativePlatform()) {
            try {
                const info = await NativeBattery.getBatteryInfo();
                if (typeof info?.level === 'number' && info.level >= 0) {
                    this.cachedLevel = Math.max(0, Math.min(100, Math.round(info.level)));
                    this.isCharging = Boolean(info.isCharging);
                    this.notify();
                    return { level: this.cachedLevel, isCharging: this.isCharging };
                }
            } catch (e) {
                // Fallback to Web API if available
            }
        }

        // 2. Web API Fallback
        if (typeof navigator !== 'undefined' && 'getBattery' in navigator) {
            try {
                const battery = await (navigator as any).getBattery();
                this.updateFromWeb(battery);
            } catch (e) {}
        }

        return { level: this.cachedLevel, isCharging: this.isCharging };
    }

    public getBatteryLevel(): number {
        return this.cachedLevel;
    }

    public getBatteryInfo(): BatteryInfo {
        return { level: this.cachedLevel, isCharging: this.isCharging };
    }

    public subscribe(listener: (info: BatteryInfo) => void): () => void {
        this.listeners.push(listener);
        listener({ level: this.cachedLevel, isCharging: this.isCharging });
        return () => {
            this.listeners = this.listeners.filter(l => l !== listener);
        };
    }

    private notify() {
        const info = { level: this.cachedLevel, isCharging: this.isCharging };
        this.listeners.forEach(l => l(info));
    }
}

export const batteryService = new BatteryService();
