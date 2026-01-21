// Google Places Service - Secure API proxy via Firebase Functions
import { Place } from '../types';
import { functions } from './firebase';
import { httpsCallable } from 'firebase/functions';

// SECURE: API keys are handled server-side in Firebase Functions

interface PlaceResult {
    place_id: string;
    name: string;
    geometry: {
        location: { lat: number; lng: number };
    };
    types: string[];
    rating?: number;
    opening_hours?: { open_now: boolean };
    vicinity?: string;
}

// Secure search via Firebase Functions
const searchViaProxy = async (
    location: { lat: number; lng: number },
    query: string,
    type?: string
): Promise<Place[]> => {
    try {
        const searchPlaces = httpsCallable<
            { query: string; lat: number; lng: number; type?: string },
            { places: Place[] }
        >(functions, 'searchPlaces');

        const result = await searchPlaces({
            query,
            lat: location.lat,
            lng: location.lng,
            type
        });

        return result.data.places.map(place => ({
            ...place,
            radius: 0.001,
            brandColor: '#6366f1'
        }));
    } catch (error) {
        console.error('Firebase Functions search failed:', error);
        return [];
    }
};

// Main export: Uses proxy exclusively for security
export const searchNearbyPlaces = async (
    location: { lat: number; lng: number },
    type: 'gas_station' | 'cafe' | 'restaurant' | 'grocery_or_supermarket' | 'all' = 'all',
    radius: number = 5000
): Promise<Place[]> => {
    const query = type === 'all' ? 'places' : type.replace('_', ' ');
    return searchViaProxy(location, query, type === 'all' ? undefined : type);
};

// Quick search categories
export const searchGasStations = (location: { lat: number; lng: number }) =>
    searchViaProxy(location, 'gas station', 'gas_station');

export const searchCoffeeShops = (location: { lat: number; lng: number }) =>
    searchViaProxy(location, 'coffee shop', 'cafe');

export const searchRestaurants = (location: { lat: number; lng: number }) =>
    searchViaProxy(location, 'restaurant', 'restaurant');

export const searchGroceryStores = (location: { lat: number; lng: number }) =>
    searchViaProxy(location, 'grocery store', 'grocery_or_supermarket');
