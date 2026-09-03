import { Location } from '../types';
import { MapSkinId } from './mapSkinService';

export interface SolarInfo {
    isDaylight: boolean;
    sunElevationDeg: number;
    sunriseTime: string; // e.g. "6:48 AM"
    sunsetTime: string;  // e.g. "7:52 PM"
    sunriseDate: Date;
    sunsetDate: Date;
    recommendedSkin: MapSkinId;
    solarPhase: 'day' | 'golden_hour' | 'twilight' | 'night';
}

/**
 * High-precision NOAA Solar Position Algorithm
 * Calculates sunrise, sunset, solar elevation angle, and day/night transitions
 * based on geographic coordinates and local time.
 */
export function calculateSolarInfo(location?: Location | null, date: Date = new Date()): SolarInfo {
    // Default fallback to 35.05 N (approx US mid-latitude), -78.87 W if no GPS available yet
    const lat = location && typeof location.lat === 'number' && !isNaN(location.lat) ? location.lat : 35.0527;
    const lng = location && typeof location.lng === 'number' && !isNaN(location.lng) ? location.lng : -78.8784;

    const rad = Math.PI / 180;
    const deg = 180 / Math.PI;

    // Day of Year
    const startOfYear = new Date(date.getFullYear(), 0, 0);
    const diff = date.getTime() - startOfYear.getTime();
    const oneDay = 1000 * 60 * 60 * 24;
    const dayOfYear = Math.floor(diff / oneDay);

    // Fractional Year in radians
    const gamma = 2 * Math.PI / 365 * (dayOfYear - 1 + (date.getHours() - 12) / 24);

    // Equation of Time (in minutes)
    const eqtime = 229.18 * (
        0.000075 +
        0.001868 * Math.cos(gamma) -
        0.032077 * Math.sin(gamma) -
        0.014615 * Math.cos(2 * gamma) -
        0.040849 * Math.sin(2 * gamma)
    );

    // Solar Declination Angle (in radians)
    const decl = 0.006918 -
        0.399912 * Math.cos(gamma) +
        0.070257 * Math.sin(gamma) -
        0.006758 * Math.cos(2 * gamma) +
        0.000907 * Math.sin(2 * gamma) -
        0.002697 * Math.cos(3 * gamma) +
        0.00148 * Math.sin(3 * gamma);

    // Hour angle for sunrise/sunset (zenith = 90.833 degrees for atmospheric refraction)
    const cosHourAngle = (Math.cos(90.833 * rad) / (Math.cos(lat * rad) * Math.cos(decl))) - (Math.tan(lat * rad) * Math.tan(decl));
    
    // Polar day / polar night handling
    let haDeg = 90;
    if (cosHourAngle >= 1) {
        haDeg = 0; // 24h polar night
    } else if (cosHourAngle <= -1) {
        haDeg = 180; // 24h polar day
    } else {
        haDeg = Math.acos(cosHourAngle) * deg;
    }

    // Sunrise & Sunset in UTC minutes from midnight
    const sunriseMinutesUtc = 720 - 4 * (lng + haDeg) - eqtime;
    const sunsetMinutesUtc = 720 - 4 * (lng - haDeg) - eqtime;

    // Convert to Date objects
    const sunriseDate = new Date(date);
    sunriseDate.setUTCHours(0, 0, 0, 0);
    sunriseDate.setUTCMinutes(sunriseMinutesUtc);

    const sunsetDate = new Date(date);
    sunsetDate.setUTCHours(0, 0, 0, 0);
    sunsetDate.setUTCMinutes(sunsetMinutesUtc);

    // Current Sun Elevation Angle
    const timeZoneOffsetMinutes = -date.getTimezoneOffset();
    const currentMinutesUtc = date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60;
    
    // True Solar Time
    const trueSolarTimeMinutes = (currentMinutesUtc + 4 * lng + eqtime) % 1440;
    const trueHourAngle = (trueSolarTimeMinutes / 4) - 180;

    // Solar Zenith & Elevation Angle
    const sinElevation = Math.sin(lat * rad) * Math.sin(decl) + Math.cos(lat * rad) * Math.cos(decl) * Math.cos(trueHourAngle * rad);
    const sunElevationDeg = Math.asin(Math.max(-1, Math.min(1, sinElevation))) * deg;

    // Determine Phase & Daylight
    // Elevation > 6°: Full Day
    // 0° <= Elevation <= 6°: Golden Hour / Low Sun
    // -6° <= Elevation < 0°: Civil Twilight
    // Elevation < -6°: Night
    let isDaylight = sunElevationDeg >= -0.833; // Standard geometric horizon with refraction
    let solarPhase: 'day' | 'golden_hour' | 'twilight' | 'night' = 'night';

    if (sunElevationDeg > 6) {
        solarPhase = 'day';
    } else if (sunElevationDeg >= 0) {
        solarPhase = 'golden_hour';
    } else if (sunElevationDeg >= -6) {
        solarPhase = 'twilight';
    } else {
        solarPhase = 'night';
    }

    const recommendedSkin: MapSkinId = isDaylight ? 'warm_cream' : 'carbon-amber';

    const formatTime = (d: Date) => {
        try {
            return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        } catch {
            return `${d.getHours()}:${d.getMinutes() < 10 ? '0' : ''}${d.getMinutes()}`;
        }
    };

    return {
        isDaylight,
        sunElevationDeg: Number(sunElevationDeg.toFixed(1)),
        sunriseTime: formatTime(sunriseDate),
        sunsetTime: formatTime(sunsetDate),
        sunriseDate,
        sunsetDate,
        recommendedSkin,
        solarPhase
    };
}

class SolarService {
    private currentSolarInfo: SolarInfo = calculateSolarInfo();
    private listeners = new Set<(info: SolarInfo) => void>();
    private intervalId: any = null;
    private lastLocation: Location | null = null;

    constructor() {
        this.recalculate();
        if (typeof window !== 'undefined') {
            // Recalculate every 60 seconds
            this.intervalId = setInterval(() => {
                this.recalculate();
            }, 60 * 1000);
        }
    }

    public updateLocation(location: Location | null) {
        if (!location) return;
        this.lastLocation = location;
        this.recalculate();
    }

    public recalculate() {
        const next = calculateSolarInfo(this.lastLocation);
        const changed = 
            next.isDaylight !== this.currentSolarInfo.isDaylight ||
            next.recommendedSkin !== this.currentSolarInfo.recommendedSkin ||
            Math.abs(next.sunElevationDeg - this.currentSolarInfo.sunElevationDeg) >= 1.0;

        this.currentSolarInfo = next;
        if (changed) {
            this.notifyListeners();
        }
    }

    public getSolarInfo(): SolarInfo {
        return this.currentSolarInfo;
    }

    public subscribe(callback: (info: SolarInfo) => void): () => void {
        this.listeners.add(callback);
        callback(this.currentSolarInfo);
        return () => {
            this.listeners.delete(callback);
        };
    }

    private notifyListeners() {
        this.listeners.forEach(cb => cb(this.currentSolarInfo));
    }
}

export const solarService = new SolarService();
