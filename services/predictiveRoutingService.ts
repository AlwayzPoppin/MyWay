/**
 * Predictive Routing Service
 * Analyzes time of day, day of week, saved places, and historical trip logs
 * to accurately predict where the driver wants to go without typing.
 */

import { Location, Place, Trip } from '../types';
import { getSavedTrips } from './tripHistoryService';
import { searchHistoryService, RecentSearchItem } from './searchHistoryService';
import { getDistanceMiles } from '../utils/geo';

export interface PredictedDestination {
    id: string;
    name: string;
    description?: string;
    location: Location;
    type: 'school' | 'home' | 'work' | 'gym' | 'food' | 'coffee' | 'errand' | 'other';
    icon: string;
    reason: string; // e.g. "Wednesday 3:15 PM School Pickup", "Evening Commute Home", "Morning Coffee"
    confidence: number; // 0 - 100%
    distanceMiles?: string;
}

class PredictiveRoutingService {
    /**
     * Predicts the most likely destinations for the current user based on:
     * - Current Date & Time (Hour, Day of Week)
     * - Saved Places (Home, Work, School, Gym)
     * - Past Trip Logs & Destination History
     * - Current GPS Location (proximity filtering)
     */
    public getPredictions(
        userLocation: Location | null,
        userPlaces: Place[] = []
    ): PredictedDestination[] {
        const now = new Date();
        const currentHour = now.getHours(); // 0 - 23
        const currentMinute = now.getMinutes();
        const dayOfWeek = now.getDay(); // 0 = Sun, 1 = Mon, ..., 6 = Sat
        const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;
        const isWeekend = !isWeekday;

        const timeDecimal = currentHour + (currentMinute / 60);

        const savedTrips = getSavedTrips();
        const recentSearches = searchHistoryService.getHistory();

        const candidateMap = new Map<string, {
            place?: Place;
            historyItem?: RecentSearchItem;
            tripMatchCount: number;
            score: number;
            reason: string;
            type: PredictedDestination['type'];
            icon: string;
            name: string;
            location: Location;
            description?: string;
        }>();

        // 1. EVALUATE SAVED PLACES BY TIME-OF-DAY HEURISTICS
        userPlaces.forEach(p => {
            let score = 0;
            let reason = 'Saved Place';
            let icon = p.icon || '📍';
            let type: PredictedDestination['type'] = 'other';

            const pNameLower = p.name.toLowerCase();
            const pTypeLower = p.type.toLowerCase();

            // Distance check: If already within 200m of this place, don't predict it
            if (userLocation) {
                const dist = parseFloat(getDistanceMiles(userLocation, p.location) || '0');
                if (dist < 0.15) return; // Already there
            }

            // Morning Commute (6:30 AM - 9:30 AM on Weekdays) -> Work / School / Coffee
            if (isWeekday && timeDecimal >= 6.5 && timeDecimal <= 9.5) {
                if (pTypeLower === 'work' || pNameLower.includes('work') || pNameLower.includes('office')) {
                    score += 85;
                    reason = 'Morning Work Commute';
                    icon = '💼';
                    type = 'work';
                } else if (pTypeLower === 'school' || pNameLower.includes('school')) {
                    score += 80;
                    reason = 'Morning School Dropoff';
                    icon = '🏫';
                    type = 'school';
                } else if (pTypeLower === 'coffee' || pNameLower.includes('coffee') || pNameLower.includes('starbucks')) {
                    score += 70;
                    reason = 'Morning Coffee Run';
                    icon = '☕';
                    type = 'coffee';
                }
            }

            // Lunch Time (11:30 AM - 1:45 PM) -> Food / Restaurants
            else if (timeDecimal >= 11.5 && timeDecimal <= 13.75) {
                if (pTypeLower === 'food' || pTypeLower === 'coffee' || pNameLower.includes('burger') || pNameLower.includes('diner')) {
                    score += 80;
                    reason = 'Lunch Break Spot';
                    icon = '🍔';
                    type = 'food';
                }
            }

            // Afternoon School Pickup (2:30 PM - 4:15 PM on Weekdays) -> School
            else if (isWeekday && timeDecimal >= 14.5 && timeDecimal <= 16.25) {
                if (pTypeLower === 'school' || pNameLower.includes('school') || pNameLower.includes('daycare')) {
                    score += 95;
                    reason = 'Afternoon School Pickup';
                    icon = '🏫';
                    type = 'school';
                } else if (pTypeLower === 'home' || pNameLower.includes('home')) {
                    score += 60;
                    reason = 'Heading Home';
                    icon = '🏠';
                    type = 'home';
                }
            }

            // Evening Commute (4:30 PM - 7:30 PM on Weekdays) -> Gym / Grocery / Home
            else if (isWeekday && timeDecimal >= 16.5 && timeDecimal <= 19.5) {
                if (pTypeLower === 'home' || pNameLower.includes('home')) {
                    score += 90;
                    reason = 'Evening Commute Home';
                    icon = '🏠';
                    type = 'home';
                } else if (pTypeLower === 'gym' || pNameLower.includes('fitness') || pNameLower.includes('gym')) {
                    score += 75;
                    reason = 'After-Work Workout';
                    icon = '🏋️';
                    type = 'gym';
                } else if (pTypeLower === 'grocery' || pNameLower.includes('market') || pNameLower.includes('trader')) {
                    score += 70;
                    reason = 'Evening Grocery Stop';
                    icon = '🛒';
                    type = 'errand';
                }
            }

            // Weekend Activities (Sat/Sun 9 AM - 8 PM)
            else if (isWeekend) {
                if (pTypeLower === 'gym' && timeDecimal >= 8 && timeDecimal <= 12) {
                    score += 80;
                    reason = 'Weekend Workout';
                    icon = '🏋️';
                    type = 'gym';
                } else if (pTypeLower === 'coffee' && timeDecimal >= 8 && timeDecimal <= 13) {
                    score += 75;
                    reason = 'Weekend Morning Coffee';
                    icon = '☕';
                    type = 'coffee';
                } else if (pTypeLower === 'home' && timeDecimal >= 18) {
                    score += 85;
                    reason = 'Heading Home for the Evening';
                    icon = '🏠';
                    type = 'home';
                }
            }

            // Late Night (8:30 PM - 5:00 AM) -> Home
            if (timeDecimal >= 20.5 || timeDecimal <= 5.0) {
                if (pTypeLower === 'home' || pNameLower.includes('home')) {
                    score += 95;
                    reason = 'Heading Home';
                    icon = '🏠';
                    type = 'home';
                }
            }

            if (score > 0) {
                candidateMap.set(p.id, {
                    place: p,
                    tripMatchCount: 0,
                    score,
                    reason,
                    type,
                    icon,
                    name: p.name,
                    location: p.location,
                    description: p.description
                });
            }
        });

        // 2. ANALYZE HISTORICAL TRIPS (Pattern Matching)
        savedTrips.forEach(trip => {
            if (!trip.destinationName || !trip.endLocation) return;

            const tripDate = new Date(trip.startTime);
            const tripHour = tripDate.getHours();
            const tripDay = tripDate.getDay();

            // Check if trip occurred near the current time window (+- 1.5 hours)
            const hourDiff = Math.abs(tripHour - currentHour);
            const isNearHour = hourDiff <= 1 || hourDiff === 23;
            const isSameDayType = (dayOfWeek >= 1 && dayOfWeek <= 5) === (tripDay >= 1 && tripDay <= 5);

            if (isNearHour && isSameDayType) {
                const key = `trip_${trip.destinationName.toLowerCase()}`;
                const existing = candidateMap.get(key);

                if (existing) {
                    existing.score += 20;
                    existing.tripMatchCount += 1;
                    existing.reason = `Frequent at this hour (${existing.tripMatchCount} past trips)`;
                } else {
                    candidateMap.set(key, {
                        tripMatchCount: 1,
                        score: 65,
                        reason: `Traveled here around this time`,
                        type: 'other',
                        icon: '🚗',
                        name: trip.destinationName,
                        location: trip.endLocation,
                        description: `Based on your past trips`
                    });
                }
            }
        });

        // 3. BOOST FREQUENT SEARCHES
        recentSearches.forEach(search => {
            if (!search.location || !search.frequencyCount || search.frequencyCount < 2) return;

            const key = `search_${(search.name || search.query).toLowerCase()}`;
            const existing = candidateMap.get(key);

            if (existing) {
                existing.score += search.frequencyCount * 5;
            } else {
                candidateMap.set(key, {
                    historyItem: search,
                    tripMatchCount: search.frequencyCount,
                    score: 50 + (search.frequencyCount * 8),
                    reason: `Frequent destination (${search.frequencyCount} visits)`,
                    type: (search.type as any) || 'other',
                    icon: search.icon || '🔥',
                    name: search.name || search.query,
                    location: search.location,
                    description: search.description
                });
            }
        });

        // 4. MAP TO PREDICTED DESTINATIONS & SORT
        const predictions: PredictedDestination[] = Array.from(candidateMap.values())
            .map((item, idx) => {
                const distStr = userLocation ? getDistanceMiles(userLocation, item.location) : undefined;
                return {
                    id: `pred_${idx}_${item.name.replace(/\s+/g, '_')}`,
                    name: item.name,
                    description: item.description,
                    location: item.location,
                    type: item.type,
                    icon: item.icon,
                    reason: item.reason,
                    confidence: Math.min(99, Math.round(item.score)),
                    distanceMiles: distStr
                };
            })
            .sort((a, b) => b.confidence - a.confidence)
            .slice(0, 3); // Top 3 high-confidence predictions

        return predictions;
    }
}

export const predictiveRoutingService = new PredictiveRoutingService();
