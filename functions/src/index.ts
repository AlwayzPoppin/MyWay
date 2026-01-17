import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

admin.initializeApp();

// Google Places API Proxy
// This function secures your API key by keeping it server-side
export const searchPlaces = functions.https.onCall(async (data, context) => {
    // Rate limiting: Check if user is authenticated (optional but recommended)
    // if (!context.auth) {
    //   throw new functions.https.HttpsError('unauthenticated', 'User must be logged in.');
    // }

    const { query, lat, lng, type } = data;

    // Input validation
    if (!query || typeof query !== 'string') {
        throw new functions.https.HttpsError('invalid-argument', 'Query is required.');
    }

    if (typeof lat !== 'number' || typeof lng !== 'number') {
        throw new functions.https.HttpsError('invalid-argument', 'Valid coordinates are required.');
    }

    // Get API key from Firebase environment config
    const apiKey = process.env.GOOGLE_MAPS_API_KEY || functions.config().google?.maps_api_key;

    if (!apiKey) {
        console.error('Google Maps API key not configured');
        throw new functions.https.HttpsError('internal', 'API configuration error.');
    }

    try {
        // Build the Places API URL
        const radius = 5000; // 5km radius
        const placeType = type || 'point_of_interest';

        const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=${radius}&keyword=${encodeURIComponent(query)}&type=${placeType}&key=${apiKey}`;

        const response = await fetch(url);
        const json = await response.json();

        if (json.status !== 'OK' && json.status !== 'ZERO_RESULTS') {
            console.error('Places API error:', json.status, json.error_message);
            throw new functions.https.HttpsError('internal', 'Places search failed.');
        }

        // Transform results to match client expectations
        const places = (json.results || []).slice(0, 10).map((place: any, index: number) => ({
            id: `place-${place.place_id}`,
            name: place.name,
            location: {
                lat: place.geometry.location.lat,
                lng: place.geometry.location.lng
            },
            type: categorizePlace(place.types),
            icon: getPlaceIcon(place.types),
            address: place.vicinity,
            rating: place.rating,
            isOpen: place.opening_hours?.open_now
        }));

        return { places };
    } catch (error: any) {
        console.error('searchPlaces error:', error);
        throw new functions.https.HttpsError('internal', 'Failed to search places.');
    }
});

// Helper: Categorize place types
function categorizePlace(types: string[]): string {
    if (types.includes('gas_station')) return 'gas';
    if (types.includes('cafe') || types.includes('coffee')) return 'coffee';
    if (types.includes('restaurant') || types.includes('food')) return 'food';
    if (types.includes('grocery_or_supermarket')) return 'grocery';
    return 'other';
}

// Helper: Get emoji icon for place type
function getPlaceIcon(types: string[]): string {
    if (types.includes('gas_station')) return '⛽';
    if (types.includes('cafe') || types.includes('coffee')) return '☕';
    if (types.includes('restaurant')) return '🍽️';
    if (types.includes('fast_food')) return '🍔';
    if (types.includes('grocery_or_supermarket')) return '🛒';
    if (types.includes('hospital') || types.includes('pharmacy')) return '🏥';
    if (types.includes('school')) return '🏫';
    if (types.includes('park')) return '🌳';
    return '📍';
}

// Geocoding proxy (for address lookup)
export const geocodeAddress = functions.https.onCall(async (data, context) => {
    const { address } = data;

    if (!address || typeof address !== 'string') {
        throw new functions.https.HttpsError('invalid-argument', 'Address is required.');
    }

    const apiKey = process.env.GOOGLE_MAPS_API_KEY || functions.config().google?.maps_api_key;

    if (!apiKey) {
        throw new functions.https.HttpsError('internal', 'API configuration error.');
    }

    try {
        const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${apiKey}`;
        const response = await fetch(url);
        const json = await response.json();

        if (json.status !== 'OK') {
            return { location: null };
        }

        const result = json.results[0];
        return {
            location: {
                lat: result.geometry.location.lat,
                lng: result.geometry.location.lng
            },
            formattedAddress: result.formatted_address
        };
    } catch (error) {
        console.error('geocodeAddress error:', error);
        throw new functions.https.HttpsError('internal', 'Geocoding failed.');
    }
});
