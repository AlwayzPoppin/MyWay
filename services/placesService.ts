// Google Places Service - Fetch real nearby businesses
import { Place } from '../types';

const GOOGLE_MAPS_API_KEY = (import.meta as any).env.VITE_GOOGLE_MAPS_API_KEY || '';

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

const TYPE_TO_ICON: Record<string, string> = {
    gas_station: '⛽',
    cafe: '☕',
    restaurant: '🍔',
    grocery_or_supermarket: '🛒',
    pharmacy: '💊',
    hospital: '🏥',
    school: '🏫',
    park: '🌳',
    shopping_mall: '🛍️',
    bank: '🏦',
    default: '📍'
};

export const searchNearbyPlaces = async (
    location: { lat: number; lng: number },
    type: 'gas_station' | 'cafe' | 'restaurant' | 'grocery_or_supermarket' | 'all' = 'all',
    radius: number = 5000
): Promise<Place[]> => {
    if (!GOOGLE_MAPS_API_KEY) {
        console.warn('Google Maps API key not configured');
        return [];
    }

    try {
        // Note: In production, this should go through a backend proxy to hide the API key
        const url = new URL('https://maps.googleapis.com/maps/api/place/nearbysearch/json');
        url.searchParams.append('location', `${location.lat},${location.lng}`);
        url.searchParams.append('radius', radius.toString());
        url.searchParams.append('key', GOOGLE_MAPS_API_KEY);

        if (type !== 'all') {
            url.searchParams.append('type', type);
        }

        const response = await fetch(url.toString());
        const data = await response.json();

        if (data.status !== 'OK') {
            console.warn('Places API error:', data.status);
            return [];
        }

        return data.results.slice(0, 10).map((place: PlaceResult) => ({
            id: place.place_id,
            name: place.name,
            location: {
                lat: place.geometry.location.lat,
                lng: place.geometry.location.lng
            },
            radius: 0.001,
            type: 'discovered' as const,
            icon: TYPE_TO_ICON[place.types[0]] || TYPE_TO_ICON.default,
            brandColor: '#6366f1',
            deal: place.rating ? `⭐ ${place.rating}` : undefined
        }));
    } catch (error) {
        console.error('Failed to fetch nearby places:', error);
        return [];
    }
};

// Quick search categories
export const searchGasStations = (location: { lat: number; lng: number }) =>
    searchNearbyPlaces(location, 'gas_station');

export const searchCoffeeShops = (location: { lat: number; lng: number }) =>
    searchNearbyPlaces(location, 'cafe');

export const searchRestaurants = (location: { lat: number; lng: number }) =>
    searchNearbyPlaces(location, 'restaurant');

export const searchGroceryStores = (location: { lat: number; lng: number }) =>
    searchNearbyPlaces(location, 'grocery_or_supermarket');
