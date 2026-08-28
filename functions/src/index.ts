import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { GoogleGenerativeAI } from '@google/generative-ai';

admin.initializeApp();

// Gemini AI Proxy
// This function secures your Gemini API key by keeping it server-side
export const callGeminiAI = functions.https.onCall(async (data, context) => {
    const { prompt, config, model = 'gemini-2.0-flash-exp' } = data;

    if (!prompt) {
        throw new functions.https.HttpsError('invalid-argument', 'Prompt is required.');
    }

    const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || functions.config().google?.gemini_api_key;

    if (!apiKey) {
        console.error('Gemini API key not configured');
        throw new functions.https.HttpsError('internal', 'AI configuration error.');
    }

    try {
        const genAI = new GoogleGenerativeAI(apiKey);
        const aiModel = genAI.getGenerativeModel({ model });

        const result = await aiModel.generateContent({
            contents: Array.isArray(prompt) ? prompt : [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: config
        });

        const response = await result.response;
        return {
            text: response.text(),
            candidates: response.candidates || []
        };
    } catch (error: any) {
        console.error('callGeminiAI runtime error:', error);
        throw new functions.https.HttpsError('internal', error.message || 'AI service failed');
    }
});

// Google Places API Proxy
// This function secures your API key by keeping it server-side
export const searchPlaces = functions.https.onCall(async (data, context) => {
    // Rate limiting: Check if user is authenticated (optional but recommended)
    // if (!context.auth) {
    //   throw new functions.https.HttpsError('unauthenticated', 'User must be logged in.');
    // }

    const { query, lat, lng, type } = data;
    console.log(`🔌 [searchPlaces] Triggered with query="${query}", lat=${lat}, lng=${lng}, type=${type}`);

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
        console.error('🔌 [searchPlaces] Google Maps API key not configured in process.env or functions.config()');
        throw new functions.https.HttpsError('internal', 'API configuration error.');
    }
    console.log(`🔌 [searchPlaces] Using API Key: ${apiKey.substring(0, 8)}...`);

    try {
        // Build the Places API URL
        const radius = 5000; // 5km radius
        const placeType = type || 'point_of_interest';

        const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=${radius}&keyword=${encodeURIComponent(query)}&type=${placeType}&key=${apiKey}`;
        console.log(`🔌 [searchPlaces] Fetching from Google Maps Places API...`);

        const response = await fetch(url);
        const json = await response.json();

        console.log(`🔌 [searchPlaces] Google Places response status: ${json.status}`);
        if (json.status !== 'OK' && json.status !== 'ZERO_RESULTS') {
            console.error('🔌 [searchPlaces] Google Places API error:', json.status, json.error_message);
            throw new functions.https.HttpsError('internal', `Places search failed: ${json.status} ${json.error_message || ''}`);
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

        console.log(`🔌 [searchPlaces] Successfully returned ${places.length} places to client`);
        return { places };
    } catch (error: any) {
        console.error('🔌 [searchPlaces] Runtime error:', error);
        throw new functions.https.HttpsError('internal', error.message || 'Failed to search places.');
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

// ==========================================
// FCM Push Notification for Geofence Alerts
// ==========================================
/**
 * Sends push notifications to family circle members when geofence events occur.
 * Called from the client when a transition is detected.
 */
export const sendGeofenceAlert = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be logged in.');
    }

    const { circleId, memberId, memberName, geofenceName, eventType, location } = data;

    if (!circleId || !memberId || !geofenceName || !eventType) {
        throw new functions.https.HttpsError('invalid-argument', 'Missing required fields.');
    }

    try {
        // Get all circle members' FCM tokens
        const circleRef = admin.database().ref(`circles/${circleId}/members`);
        const snapshot = await circleRef.once('value');

        if (!snapshot.exists()) {
            return { sent: 0 };
        }

        const memberTokens: string[] = [];
        const members = snapshot.val();

        for (const uid of Object.keys(members)) {
            if (uid === memberId) continue; // Don't notify the person who triggered

            const tokenSnapshot = await admin.database().ref(`users/${uid}/fcmToken`).once('value');
            const fcmToken = tokenSnapshot.val();
            if (fcmToken) memberTokens.push(fcmToken);
        }

        if (memberTokens.length === 0) {
            return { sent: 0 };
        }

        // Build notification
        const isArrival = eventType === 'entered';
        const title = isArrival
            ? `📍 ${memberName} arrived at ${geofenceName}`
            : `🚗 ${memberName} left ${geofenceName}`;
        const body = isArrival
            ? `${memberName} just arrived at ${geofenceName}.`
            : `${memberName} just departed from ${geofenceName}.`;

        const message: admin.messaging.MulticastMessage = {
            tokens: memberTokens,
            notification: { title, body },
            data: {
                type: isArrival ? 'geofence_enter' : 'geofence_exit',
                memberId,
                memberName,
                circleId,
                geofenceName,
                lat: location?.lat?.toString() || '',
                lng: location?.lng?.toString() || '',
                timestamp: Date.now().toString()
            },
            android: {
                priority: 'high',
                notification: {
                    channelId: 'geofence_alerts',
                    icon: 'ic_stat_name',
                    color: '#6366f1'
                }
            },
            apns: {
                payload: {
                    aps: {
                        sound: 'default',
                        badge: 1
                    }
                }
            }
        };

        const response = await admin.messaging().sendEachForMulticast(message);
        console.log(`[FCM] Sent ${response.successCount}/${memberTokens.length} notifications for ${eventType} at ${geofenceName}`);

        return { sent: response.successCount, failed: response.failureCount };
    } catch (error: any) {
        console.error('sendGeofenceAlert error:', error);
        throw new functions.https.HttpsError('internal', 'Failed to send notification.');
    }
});
