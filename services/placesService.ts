// Google Places Service - Secure API proxy via Firebase Functions with Mapbox Geocoding & OSM fallback
import { Place } from '../types';
import { functions } from './firebase';
import { httpsCallable } from 'firebase/functions';
import { getDistanceFromCoords as getDistanceMeters } from '../utils/geo';
import { placeCorrectionService } from './placeCorrectionService';

// Mapbox Geocoding Access Token for rooftop-accurate address search & autocomplete
// Google Places & Geocoding API Configuration for rooftop-accurate address search & autocomplete
export const getActiveGoogleKey = (): string => {
    const envKey =
        (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string) ||
        (import.meta.env.VITE_GOOGLE_PLACES_API_KEY as string);
    if (envKey && envKey.trim().length > 0) {
        return envKey.trim();
    }
    if (typeof window !== 'undefined' && window.localStorage) {
        const stored =
            window.localStorage.getItem('myway_google_maps_key') ||
            window.localStorage.getItem('myway_google_places_key');
        if (stored && stored.trim().length > 0) return stored.trim();
    }
    return '';
};

let googleMapsLoaderPromise: Promise<boolean> | null = null;
let googleMapsAuthFailed = false;

// Attach gm_authFailure handler to suppress full-screen error overlays and switch immediately to fallback
if (typeof window !== 'undefined') {
    const origAuthFailure = (window as any).gm_authFailure;
    (window as any).gm_authFailure = () => {
        console.warn('⚠️ [Google Maps] API key auth failed (InvalidKeyMapError). Switching to high-accuracy local engine.');
        googleMapsAuthFailed = true;
        try {
            const key = getActiveGoogleKey();
            if (key) sessionStorage.setItem('myway_google_maps_invalid_' + key, 'true');
        } catch { }
        if (typeof origAuthFailure === 'function') origAuthFailure();
    };
}

export const loadGoogleMapsSDK = (apiKey: string): Promise<boolean> => {
    if (typeof window === 'undefined' || !apiKey || googleMapsAuthFailed) return Promise.resolve(false);
    try {
        if (sessionStorage.getItem('myway_google_maps_invalid_' + apiKey) === 'true') {
            googleMapsAuthFailed = true;
            return Promise.resolve(false);
        }
    } catch { }
    if ((window as any).google?.maps?.places) return Promise.resolve(true);
    if (googleMapsLoaderPromise) return googleMapsLoaderPromise;

    googleMapsLoaderPromise = new Promise<boolean>((resolve) => {
        const existingScript = document.querySelector('script[src*="maps.googleapis.com/maps/api/js"]');
        if (existingScript) {
            existingScript.addEventListener('load', () => resolve(!googleMapsAuthFailed));
            existingScript.addEventListener('error', () => {
                googleMapsAuthFailed = true;
                resolve(false);
            });
            if ((window as any).google?.maps?.places) return resolve(!googleMapsAuthFailed);
            return;
        }

        const script = document.createElement('script');
        script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places,geocoding&loading=async`;
        script.async = true;
        script.defer = true;
        script.onload = () => {
            setTimeout(() => resolve(!googleMapsAuthFailed), 50);
        };
        script.onerror = () => {
            googleMapsAuthFailed = true;
            resolve(false);
        };
        document.head.appendChild(script);
    });

    return googleMapsLoaderPromise;
};

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

// Coordinate validation and defaulting (Yadkin Road / Cottonade neighborhood)
const DEFAULT_COORDS = { lat: 35.105, lng: -78.966 };

const getValidLocation = (location?: { lat: number; lng: number }): { lat: number; lng: number } => {
    if (!location || (location.lat === 0 && location.lng === 0) || isNaN(location.lat) || isNaN(location.lng)) {
        if (typeof window !== 'undefined' && window.localStorage) {
            const saved = window.localStorage.getItem('myway_last_known_location');
            if (saved) {
                try {
                    const parsed = JSON.parse(saved);
                    if (parsed && typeof parsed.lat === 'number' && typeof parsed.lng === 'number' && parsed.lat !== 0 && parsed.lng !== 0) {
                        return parsed;
                    }
                } catch (e) {
                    // Ignore
                }
            }
        }
        return DEFAULT_COORDS;
    }
    return location;
};

// Helper to map search queries to specific Overpass POI categories (generic category keywords only)
const mapQueryToOverpassType = (query: string): string | null => {
    const q = query.toLowerCase().trim();
    if (['barber', 'barbershop', 'haircut', 'hairdresser', 'salon'].includes(q)) return 'hairdresser';
    if (['coffee', 'cafe', 'cafes', 'coffee shop'].includes(q)) return 'cafe';
    if (['gas', 'fuel', 'petrol', 'gas station', 'gas stations'].includes(q)) return 'gas_station';
    if (['food', 'restaurant', 'restaurants', 'dining', 'diner', 'eats', 'fast food', 'fastfood'].includes(q)) return 'restaurant';
    if (['grocery', 'supermarket', 'supermarkets', 'grocery store'].includes(q)) return 'grocery_or_supermarket';
    if (['pharmacy', 'pharmacies', 'drugstore'].includes(q)) return 'pharmacy';
    if (['gym', 'gyms', 'fitness'].includes(q)) return 'gym';
    if (['bar', 'bars', 'pub', 'pubs'].includes(q)) return 'bar';
    return null;
};

// In-memory LRU Cache for geocoding queries (max 50 entries, 15-minute TTL)
interface CacheEntry {
    results: Place[];
    timestamp: number;
}
const GEOCODE_CACHE = new Map<string, CacheEntry>();
const MAX_CACHE_SIZE = 50;
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

function getCacheKey(query: string, loc: { lat: number; lng: number }, type?: string): string {
    const latBucket = Math.round(loc.lat * 100) / 100;
    const lngBucket = Math.round(loc.lng * 100) / 100;
    return `${query.toLowerCase().trim()}_${latBucket}_${lngBucket}_${type || 'all'}`;
}

function getCachedResults(key: string): Place[] | null {
    const entry = GEOCODE_CACHE.get(key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
        GEOCODE_CACHE.delete(key);
        return null;
    }
    // Refresh LRU order
    GEOCODE_CACHE.delete(key);
    GEOCODE_CACHE.set(key, entry);
    return entry.results;
}

function setCachedResults(key: string, results: Place[]): void {
    if (GEOCODE_CACHE.size >= MAX_CACHE_SIZE) {
        const firstKey = GEOCODE_CACHE.keys().next().value;
        if (firstKey) GEOCODE_CACHE.delete(firstKey);
    }
    GEOCODE_CACHE.set(key, { results, timestamp: Date.now() });
}

export function clearGeocodeCache(): void {
    GEOCODE_CACHE.clear();
}

export function setMapboxToken(token: string): void {
    if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem('myway_mapbox_token', token.trim());
        clearGeocodeCache();
    }
}

// Secure search via Firebase Functions with automatic OSM / Photon fallback
const searchViaProxy = async (
    location: { lat: number; lng: number },
    query: string,
    type?: string
): Promise<Place[]> => {
    const validLoc = getValidLocation(location);
    const detectedType = type || mapQueryToOverpassType(query) || undefined;
    const cacheKey = getCacheKey(query, validLoc, detectedType);

    const cached = getCachedResults(cacheKey);
    if (cached) {
        console.log(`⚡ [PlacesService Cache HIT] Returned ${cached.length} places for "${query}"`);
        return cached;
    }

    console.log(`🔍 [PlacesService] searchViaProxy — (${validLoc.lat.toFixed(4)}, ${validLoc.lng.toFixed(4)}) | query: "${query}" | type: ${type || 'none'} | detectedType: ${detectedType || 'none'}`);
    let results: Place[] = [];

    const isDevLocal = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

    if (!isDevLocal) {
        try {
            const searchPlaces = httpsCallable<
                { query: string; lat: number; lng: number; type?: string },
                { places: Place[] }
            >(functions, 'searchPlaces');

            const result = await searchPlaces({
                query,
                lat: validLoc.lat,
                lng: validLoc.lng,
                type: detectedType
            });

            results = result.data.places.map(place => ({
                ...place,
                radius: 0.15, // 150m display circle — cosmetic only, not a geofence
                brandColor: '#6366f1'
            }));
            console.log("🔌 [PlacesService] Proxy called successfully");
        } catch (error) {
            console.warn("🔌 [PlacesService] Proxy unavailable, using Overpass/Photon fallback:", error);
            results = await searchViaOSM(validLoc, query, detectedType);
        }
    } else {
        // In local development, use high-speed direct Photon / OSM provider
        results = await searchViaOSM(validLoc, query, detectedType);
    }

    // 1. Proximity and relevance sorting
    const qLower = query.toLowerCase().replace(/['s]/g, '').trim();

    // Deduplicate overlapping results within 100 meters
    const uniqueResults: Place[] = [];
    for (const p of results) {
        if (!p.location || isNaN(p.location.lat) || isNaN(p.location.lng)) continue;
        const isDuplicate = uniqueResults.some(u => 
            getDistanceMeters(u.location.lat, u.location.lng, p.location.lat, p.location.lng) < 100 ||
            (u.name.toLowerCase() === p.name.toLowerCase() && u.description?.toLowerCase() === p.description?.toLowerCase())
        );
        if (!isDuplicate) uniqueResults.push(p);
    }

    const queryHouseNum = query.trim().match(/^(\d+[a-zA-Z]?)\b/)?.[1];

    // Sort strictly with local proximity priority, prioritizing exact house number matches:
    uniqueResults.sort((a, b) => {
        if (queryHouseNum) {
            const aHasNum = (a.name + ' ' + (a.description || '')).toLowerCase().includes(queryHouseNum.toLowerCase());
            const bHasNum = (b.name + ' ' + (b.description || '')).toLowerCase().includes(queryHouseNum.toLowerCase());
            if (aHasNum && !bHasNum) return -1;
            if (!aHasNum && bHasNum) return 1;
        }
        const distA = getDistanceMeters(validLoc.lat, validLoc.lng, a.location.lat, a.location.lng);
        const distB = getDistanceMeters(validLoc.lat, validLoc.lng, b.location.lat, b.location.lng);
        return distA - distB;
    });

    results = uniqueResults.slice(0, 20);

    // Cache the validated & sorted results
    setCachedResults(cacheKey, results);

    // Log final results with distances
    results.forEach((r, i) => {
        const dist = getDistanceMeters(validLoc.lat, validLoc.lng, r.location.lat, r.location.lng);
        const distMi = (dist / 1609.34).toFixed(1);
        console.log(`  📍 #${i + 1}: "${r.name}" (${r.description}) at (${r.location.lat.toFixed(4)}, ${r.location.lng.toFixed(4)}) — ${distMi} mi away`);
    });

    // Apply user & community precision location corrections and photos
    results = placeCorrectionService.applyCorrectionsToPlaces(results);

    return results;
};

// Helper to parse cuisine types, food keywords, and brand names
const getCuisineAndCategoryPatterns = (rawQuery: string) => {
    const q = rawQuery.toLowerCase().trim();
    // Strip common non-discriminative words
    const stripped = q.replace(/\b(food|foods|restaurant|restaurants|place|places|near me|nearby|takeout|take out|delivery|shop|store)\b/gi, '').trim();
    const core = stripped || q;

    if (q.includes('chinese') || q.includes('dim sum')) {
        return {
            cuisinePattern: 'chinese|asian',
            namePattern: 'chinese|china|wok|hunan|szechuan|mandarin|panda|peking|dragon|asian|oriental|great wall',
            searchCore: 'chinese restaurant'
        };
    }
    if (q.includes('mexican') || q.includes('taco') || q.includes('burrito')) {
        return {
            cuisinePattern: 'mexican|tex-mex|tacos',
            namePattern: 'mexican|taco|burrito|cantina|taqueria|chipotle|el cazador|san jose',
            searchCore: 'mexican restaurant'
        };
    }
    if (q.includes('pizza') || q.includes('italian') || q.includes('pasta')) {
        return {
            cuisinePattern: 'pizza|italian',
            namePattern: 'pizza|pizzeria|italian|pasta|marcos|domino|papa john|pizza hut|olive garden',
            searchCore: 'pizza'
        };
    }
    if (q.includes('japanese') || q.includes('sushi') || q.includes('ramen') || q.includes('hibachi')) {
        return {
            cuisinePattern: 'japanese|sushi|ramen',
            namePattern: 'sushi|japanese|ramen|hibachi|tokyo|kyoto|teriyaki',
            searchCore: 'japanese sushi'
        };
    }
    if (q.includes('thai')) {
        return {
            cuisinePattern: 'thai',
            namePattern: 'thai|pad thai|bangkok|siam',
            searchCore: 'thai restaurant'
        };
    }
    if (q.includes('indian') || q.includes('curry')) {
        return {
            cuisinePattern: 'indian',
            namePattern: 'indian|curry|tandoor|masala|bombay|taj',
            searchCore: 'indian restaurant'
        };
    }
    if (q.includes('burger') || q.includes('fast food')) {
        return {
            cuisinePattern: 'burger|fast_food',
            namePattern: 'burger|mcdonald|wendy|burger king|hardee|five guys|cook out|culver|sonic',
            searchCore: 'burger fast food'
        };
    }
    if (q.includes('coffee') || q.includes('cafe')) {
        return {
            cuisinePattern: 'coffee_shop|coffee',
            namePattern: 'starbucks|dunkin|coffee|cafe|espresso',
            searchCore: 'coffee shop'
        };
    }
    if (q.includes('seafood')) {
        return {
            cuisinePattern: 'seafood',
            namePattern: 'seafood|fish|crab|shrimp|oyster',
            searchCore: 'seafood restaurant'
        };
    }
    if (q.includes('bbq') || q.includes('barbecue')) {
        return {
            cuisinePattern: 'bbq|barbecue',
            namePattern: 'bbq|barbecue|smokehouse|ribs',
            searchCore: 'bbq restaurant'
        };
    }

    const words = core.split(/\s+/).filter(w => w.length >= 2);
    const regex = words.length > 0 ? words.map(w => w.replace(/['s]/g, '')).join('.*') : core.replace(/['s]/g, '');

    return {
        cuisinePattern: regex,
        namePattern: regex,
        searchCore: core
    };
};

// Search via OSM (Photon for lightning-fast POIs/autocomplete, Nominatim for addresses, Overpass for categories & local businesses)
const searchViaOSM = async (
    location: { lat: number; lng: number },
    query: string,
    type?: string
): Promise<Place[]> => {
    // 1. If explicit category requested without specific query (e.g., category button clicked)
    if (type && type !== 'all' && (!query || query.toLowerCase() === type.replace('_', ' '))) {
        const results = await searchViaOverpass(location, type, false);
        if (results && results.length > 0) return results;
    }

    // 2. Specific text search (e.g. "chinese food", "golden china", "123 Main St", "MCDONALDS")
    if (query && query.trim().length > 0) {
        const qTrim = query.trim();
        const isAddressQuery = /^\d+\s+[a-zA-Z]/i.test(qTrim) || /\b(dr|drive|st|street|rd|road|ave|avenue|blvd|ln|lane|ct|court|hwy|highway|pkwy)\b/i.test(qTrim);
        const patterns = getCuisineAndCategoryPatterns(qTrim);

        // Address searches use dedicated geocoders (Photon & Nominatim). Overpass is only queried for business / category POIs to prevent 429 rate-limiting.
        const [photonDirect, photonCore, overpassResults, nominatimResults] = await Promise.all([
            searchViaPhoton(location, qTrim).catch(() => [] as Place[]),
            (!isAddressQuery && patterns.searchCore !== qTrim) ? searchViaPhoton(location, patterns.searchCore).catch(() => [] as Place[]) : Promise.resolve([] as Place[]),
            !isAddressQuery ? searchViaOverpass(location, qTrim, true).catch(() => [] as Place[]) : Promise.resolve([] as Place[]),
            searchViaNominatim(location, qTrim).catch(() => [] as Place[])
        ]);

        const combined = [...nominatimResults, ...photonDirect, ...photonCore, ...overpassResults];
        if (combined.length > 0) {
            return combined;
        }
    }

    // 3. Fallback to Overpass category search if category was detected
    if (type && type !== 'all') {
        const results = await searchViaOverpass(location, type, false);
        if (results && results.length > 0) return results;
    }

    return [];
};

// Photon (Komoot) OpenStreetMap Geocoder — Sub-100ms, CORS-enabled, proximity-biased
const searchViaPhoton = async (
    location: { lat: number; lng: number },
    query: string
): Promise<Place[]> => {
    const validLoc = getValidLocation(location);
    try {
        const encoded = encodeURIComponent(query.trim());
        // Enforce 35-mile bounding box around user to prevent cross-country/worldwide false positives
        const minLon = validLoc.lng - 0.5;
        const minLat = validLoc.lat - 0.5;
        const maxLon = validLoc.lng + 0.5;
        const maxLat = validLoc.lat + 0.5;
        const url = `https://photon.komoot.io/api/?q=${encoded}&lat=${validLoc.lat}&lon=${validLoc.lng}&bbox=${minLon},${minLat},${maxLon},${maxLat}&limit=15`;
        console.log(`⚡ [Photon] Querying: ${url}`);

        const response = await fetch(url, { signal: AbortSignal.timeout(3500) });
        if (!response.ok) return [];

        const data = await response.json();
        const features = data.features || [];

        // Strictly prioritize local results within 40 miles
        const localFeatures = features.filter((f: any) => {
            const coords = f.geometry?.coordinates || [0, 0];
            const dist = getDistanceMeters(validLoc.lat, validLoc.lng, coords[1], coords[0]);
            return dist < 65000;
        });
        const targetFeatures = localFeatures.length > 0 ? localFeatures : features;

        return targetFeatures.map((f: any, i: number) => {
            const props = f.properties || {};
            const coords = f.geometry?.coordinates || [0, 0];
            const lng = coords[0];
            const lat = coords[1];

            const streetAddr = (props.housenumber && props.street) ? `${props.housenumber} ${props.street}` : (props.street || '');
            // Determine venue/business name vs street address
            let displayName = props.name;
            if (!displayName || /^\d+$/.test(displayName)) {
                displayName = streetAddr || props.street || 'Nearby';
            }

            const parts: string[] = [];
            if (streetAddr) {
                parts.push(streetAddr);
            } else if (displayName && !/^\d+$/.test(displayName) && displayName !== 'Nearby') {
                parts.push(displayName);
            }
            if (props.city || props.district) parts.push(props.city || props.district);
            if (props.state) parts.push(props.state);
            if (props.postcode) parts.push(props.postcode);
            const cleanAddress = parts.length > 0 ? parts.join(', ') : (props.name || 'Nearby');

            const osmValue = (props.osm_value || props.type || '').toLowerCase();
            let placeType: Place['type'] = 'search_result';
            if (osmValue === 'fuel') placeType = 'gas';
            else if (osmValue === 'cafe') placeType = 'coffee';
            else if (osmValue === 'restaurant' || osmValue === 'fast_food') placeType = 'food';

            let icon = '📍';
            if (osmValue === 'fuel') icon = '⛽';
            else if (osmValue === 'cafe') icon = '☕';
            else if (osmValue === 'restaurant' || osmValue === 'fast_food') icon = '🍔';
            
            const nLower = (props.name || '').toLowerCase();
            if (nLower.includes('taco') || nLower.includes('burrito') || nLower.includes('mexican')) icon = '🌮';
            else if (nLower.includes('pizza')) icon = '🍕';
            else if (nLower.includes('chinese') || nLower.includes('wok') || nLower.includes('asian') || nLower.includes('dragon') || nLower.includes('panda')) icon = '🥡';
            else if (nLower.includes('sushi') || nLower.includes('ramen') || nLower.includes('japanese')) icon = '🍣';
            else if (nLower.includes('mcdonald') || nLower.includes('burger') || nLower.includes('wendy') || nLower.includes('jack in the box') || nLower.includes('sonic') || nLower.includes('cook out') || nLower.includes('cookout')) icon = '🍔';
            else if (nLower.includes('bojangles') || nLower.includes('chick-fil-a') || nLower.includes('kfc') || nLower.includes('popeyes') || nLower.includes('chicken')) icon = '🍗';
            else if (nLower.includes('coffee') || nLower.includes('starbucks') || nLower.includes('dunkin')) icon = '☕';
            else if (nLower.includes('fuel') || nLower.includes('gas') || nLower.includes('shell') || nLower.includes('exxon') || nLower.includes('chevron') || nLower.includes('bp') || nLower.includes('speedway') || nLower.includes('sheetz') || nLower.includes('circle k') || nLower.includes('wawa')) icon = '⛽';
            else if (nLower.includes('food lion') || nLower.includes('carlie c') || nLower.includes('harris teeter') || nLower.includes('publix') || nLower.includes('piggly wiggly') || nLower.includes('lowes foods') || nLower.includes('fresh market') || nLower.includes('lidl') || nLower.includes('aldi') || nLower.includes('trader joe') || nLower.includes('whole foods') || nLower.includes('walmart') || nLower.includes('target') || nLower.includes('costco') || nLower.includes('kroger') || nLower.includes('market') || nLower.includes('grocery') || nLower.includes('supermarket')) icon = '🛒';
            else if (nLower.includes('pharmacy') || nLower.includes('walgreens') || nLower.includes('cvs')) icon = '💊';
            else if (nLower.includes('bank') || nLower.includes('atm') || nLower.includes('chase') || nLower.includes('wells fargo') || nLower.includes('bank of america')) icon = '🏦';



            return {
                id: `photon-${props.osm_id || i}`,
                name: displayName,
                type: placeType,
                icon,
                location: { lat, lng },
                radius: 0.15,
                brandColor: '#6366f1',
                description: cleanAddress
            };
        });
    } catch (err) {
        console.warn('[Photon] Search failed, attempting fallbacks:', err);
        return [];
    }
};

const OVERPASS_MIRRORS = [
    'https://overpass.kumi.systems/api/interpreter',
    'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
    'https://overpass-api.de/api/interpreter'
];

// Overpass API fallback — returns up to 35 nearby places using multi-mirror radius searches or name matching
const searchViaOverpass = async (
    location: { lat: number; lng: number },
    typeOrQuery: string,
    isNameQuery: boolean = false
): Promise<Place[]> => {
    let amenityQuery = '';
    if (isNameQuery) {
        const patterns = getCuisineAndCategoryPatterns(typeOrQuery);
        amenityQuery = `(
            nw["cuisine"~"${patterns.cuisinePattern}",i](around:25000, {{lat}}, {{lng}});
            nw["name"~"${patterns.namePattern}",i](around:25000, {{lat}}, {{lng}});
            nw["brand"~"${patterns.namePattern}",i](around:25000, {{lat}}, {{lng}});
            nw["shop"~"${patterns.namePattern}",i](around:25000, {{lat}}, {{lng}});
        );`;
    } else if (typeOrQuery === 'gas_station') {
        amenityQuery = 'nw["amenity"="fuel"](around:8000, {{lat}}, {{lng}});';
    } else if (typeOrQuery === 'cafe') {
        amenityQuery = 'nw["amenity"="cafe"](around:8000, {{lat}}, {{lng}});';
    } else if (typeOrQuery === 'restaurant') {
        amenityQuery = 'nw["amenity"~"restaurant|fast_food"](around:8000, {{lat}}, {{lng}});';
    } else if (typeOrQuery === 'grocery_or_supermarket') {
        amenityQuery = 'nw["shop"~"supermarket|grocery"](around:8000, {{lat}}, {{lng}});';
    } else if (typeOrQuery === 'hairdresser') {
        amenityQuery = 'nw["shop"="hairdresser"](around:8000, {{lat}}, {{lng}});';
    } else if (typeOrQuery === 'pharmacy') {
        amenityQuery = 'nw["amenity"="pharmacy"](around:8000, {{lat}}, {{lng}});';
    } else if (typeOrQuery === 'gym') {
        amenityQuery = 'nw["leisure"="fitness_centre"](around:8000, {{lat}}, {{lng}});';
    } else if (typeOrQuery === 'bar') {
        amenityQuery = 'nw["amenity"~"bar|pub"](around:8000, {{lat}}, {{lng}});';
    }

    if (!amenityQuery) return [];

    const query = amenityQuery
        .replaceAll('{{lat}}', location.lat.toString())
        .replaceAll('{{lng}}', location.lng.toString());

    const overpassQL = `[out:json][timeout:6];${query}out center 35;`;

    for (const mirror of OVERPASS_MIRRORS) {
        try {
            const url = `${mirror}?data=${encodeURIComponent(overpassQL)}`;
            const response = await fetch(url, {
                headers: { 'User-Agent': 'MyWay-GPS-Dev/1.0' },
                signal: AbortSignal.timeout(3500)
            });

            if (!response.ok) continue;

            const data = await response.json();
            const elements = data.elements || [];
            if (elements.length === 0) continue;

            return elements.map((el: any, i: number) => {
                const tags = el.tags || {};
                
                const addrParts: string[] = [];
                if (tags['addr:housenumber']) addrParts.push(tags['addr:housenumber']);
                if (tags['addr:street']) addrParts.push(tags['addr:street']);
                if (tags['addr:city']) addrParts.push(tags['addr:city']);
                if (tags['addr:state']) addrParts.push(tags['addr:state']);
                if (tags['addr:postcode']) addrParts.push(tags['addr:postcode']);
                const cleanAddress = addrParts.length > 0 ? addrParts.join(', ') : (tags['addr:full'] || 'Nearby');

                const amenity = tags.amenity || tags.shop || tags.leisure || '';
                let placeType: Place['type'] = 'other';
                if (amenity === 'fuel') placeType = 'gas';
                else if (amenity === 'cafe') placeType = 'coffee';
                else if (amenity === 'restaurant' || amenity === 'fast_food') placeType = 'food';

                let icon = '📍';
                if (amenity === 'fuel') icon = '⛽';
                else if (amenity === 'cafe') icon = '☕';
                else if (amenity === 'restaurant' || amenity === 'fast_food') icon = '🍔';
                else if (amenity.includes('supermarket') || amenity.includes('grocery')) icon = '🛒';
                else if (amenity === 'hairdresser') icon = '💈';
                else if (amenity === 'pharmacy') icon = '💊';
                else if (amenity.includes('fitness')) icon = '💪';
                else if (amenity.includes('bar') || amenity.includes('pub')) icon = '🍺';

                const nLower = (tags.name || '').toLowerCase();
                if (nLower.includes('chinese') || nLower.includes('wok') || nLower.includes('asian') || nLower.includes('sino') || nLower.includes('panda')) icon = '🥡';
                else if (nLower.includes('taco') || nLower.includes('mexican')) icon = '🌮';
                else if (nLower.includes('pizza')) icon = '🍕';
                else if (nLower.includes('sushi') || nLower.includes('japanese') || nLower.includes('ramen')) icon = '🍣';

                return {
                    id: `overpass-${el.id || i}`,
                    name: tags.name || (
                        typeOrQuery === 'gas_station' ? 'Gas Station' : 
                        typeOrQuery === 'cafe' ? 'Coffee Shop' : 
                        typeOrQuery === 'restaurant' ? 'Restaurant' : 
                        typeOrQuery === 'hairdresser' ? 'Barber / Salon' : 
                        typeOrQuery === 'grocery_or_supermarket' ? 'Grocery Store' : 
                        typeOrQuery === 'pharmacy' ? 'Pharmacy' : 
                        typeOrQuery === 'gym' ? 'Gym / Fitness' : 
                        typeOrQuery
                    ),
                    type: placeType,
                    icon,
                    location: {
                        lat: el.lat ?? el.center?.lat ?? 0,
                        lng: el.lon ?? el.center?.lon ?? 0
                    },
                    radius: 0.15,
                    brandColor: '#6366f1',
                    description: cleanAddress
                };
            });
        } catch {
            // Try next mirror
            continue;
        }
    }
    return [];
};

const normalizeKeyPart = (str: string): string => {
    return (str || '')
        .toLowerCase()
        .replace(/\.\.\./g, '')
        .replace(/\bdrive\b/g, 'dr')
        .replace(/\bstreet\b/g, 'st')
        .replace(/\broad\b/g, 'rd')
        .replace(/\bavenue\b/g, 'ave')
        .replace(/\bboulevard\b/g, 'blvd')
        .replace(/\blane\b/g, 'ln')
        .replace(/\bcourt\b/g, 'ct')
        .replace(/\bparkway\b/g, 'pkwy')
        .replace(/\bhighway\b/g, 'hwy')
        .replace(/[^a-z0-9\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
};

export const deduplicatePlaces = (places: Place[]): Place[] => {
    const unique: Place[] = [];
    const seenKeys = new Set<string>();

    for (const place of places) {
        const rawName = (place as any).title || place.name || '';
        const fullAddr = (place.address || place.description || '');

        // Extract leading house number from name or address to keep specific addresses distinct
        const houseMatch = (rawName + ' ' + fullAddr).match(/\b(\d+[a-zA-Z]?)\s+([a-zA-Z0-9\s]+)/);
        const houseNum = houseMatch ? houseMatch[1] : '';

        const name = normalizeKeyPart(rawName);
        const parts = fullAddr.split(',').map(s => s.trim()).filter(Boolean);
        const streetPart = normalizeKeyPart(parts[0] || '');

        let cityPart = '';
        for (let i = 1; i < parts.length; i++) {
            const p = parts[i].toLowerCase().trim();
            if (/^(fayetteville|raleigh|durham|charlotte|hope mills|spring lake|cary|greensboro|wilmington|winston-salem|lumberton)$/i.test(p)) {
                cityPart = p;
                break;
            }
        }
        if (!cityPart && parts.length > 2) {
            cityPart = parts[parts.length - 3].toLowerCase().trim();
        }
        cityPart = normalizeKeyPart(cityPart);

        let key: string;
        // If it has an exact house number, ensure the key keeps the house number distinct from generic road segments
        if (houseNum) {
            key = `${houseNum}|${name || streetPart}|${cityPart}`;
        } else if (!name || name === streetPart || streetPart.includes(name) || name.includes(streetPart)) {
            key = `road|${name || streetPart}|${cityPart}`;
        } else {
            key = `venue|${name}|${streetPart}|${cityPart}`;
        }

        if (!seenKeys.has(key)) {
            seenKeys.add(key);
            unique.push(place);
        }
    }

    // Pass 2: If a specific house number exists for a street, remove generic "road-only" pins for that same street
    const specificRoads = new Set<string>();
    
    for (const place of unique) {
        const rawName = (place as any).title || place.name || '';
        const fullAddr = (place.address || place.description || '');
        const houseMatch = (rawName + ' ' + fullAddr).match(/\b(\d+[a-zA-Z]?)\s+([a-zA-Z0-9\s]+)/);
        
        if (houseMatch) {
            const parts = fullAddr.split(',').map(s => s.trim()).filter(Boolean);
            const rawStreetPart = parts[0] || '';
            const strippedStreet = rawStreetPart.replace(new RegExp(`^\\b${houseMatch[1]}\\b`, 'i'), '').trim();
            const baseStreet = normalizeKeyPart(strippedStreet);
            if (baseStreet) specificRoads.add(baseStreet);
        }
    }

    if (specificRoads.size > 0) {
        return unique.filter(place => {
            const rawName = (place as any).title || place.name || '';
            const fullAddr = (place.address || place.description || '');
            const houseMatch = (rawName + ' ' + fullAddr).match(/\b(\d+[a-zA-Z]?)\s+([a-zA-Z0-9\s]+)/);
            
            // Keep if it has a house number (specific address or venue)
            if (houseMatch) return true;
            
            // If it DOES NOT have a house number, check if it's a generic road
            const name = normalizeKeyPart(rawName);
            const parts = fullAddr.split(',').map(s => s.trim()).filter(Boolean);
            const streetPart = normalizeKeyPart(parts[0] || '');
            
            const isRoadOnly = !name || name === streetPart || streetPart.includes(name) || name.includes(streetPart);
            
            if (isRoadOnly) {
                const baseStreet = name || streetPart;
                // If we already have a specific house pin for this street, drop the generic road pin!
                if (specificRoads.has(baseStreet)) {
                    return false;
                }
            }
            
            return true;
        });
    }

    return unique;
};

// Nominatim fallback — returns real geocoded places (no API key needed)
const searchViaNominatim = async (
    location: { lat: number; lng: number },
    query: string
): Promise<Place[]> => {
    const validLoc = getValidLocation(location);
    try {
        const normalizedQuery = query
            .replace(/\bdrive\b/ig, 'Dr')
            .replace(/\bstreet\b/ig, 'St')
            .replace(/\broad\b/ig, 'Rd')
            .replace(/\bavenue\b/ig, 'Ave')
            .replace(/\bboulevard\b/ig, 'Blvd')
            .replace(/\blane\b/ig, 'Ln')
            .replace(/\bcourt\b/ig, 'Ct')
            .replace(/\bparkway\b/ig, 'Pkwy');

        let searchQuery = normalizedQuery.toLowerCase().trim();
        if (searchQuery === 'coffee shop') {
            searchQuery = 'cafe';
        } else if (searchQuery === 'grocery store' || searchQuery === 'grocery') {
            searchQuery = 'supermarket';
        }
        const encoded = encodeURIComponent(searchQuery);
        // Bounded viewbox anchored strictly to live user location
        const viewbox = `${validLoc.lng - 0.5},${validLoc.lat + 0.5},${validLoc.lng + 0.5},${validLoc.lat - 0.5}`;

        const response = await fetch(
            `https://nominatim.openstreetmap.org/search?format=json&q=${encoded}&viewbox=${viewbox}&bounded=1&limit=25&addressdetails=1&countrycodes=us`,
            { 
                headers: { 'User-Agent': 'MyWay-GPS/1.0' },
                signal: AbortSignal.timeout(4500) 
            }
        );
        const results = await response.json();

        const houseMatch = normalizedQuery.trim().match(/^(\d+[a-zA-Z]?)\s+(.+)$/i);
        const queryHouseNum = houseMatch ? houseMatch[1] : '';

        const mappedResults: Place[] = (results || []).map((r: any, i: number) => {
            const addr = r.address || {};
            const roadName = addr.road || r.name || (r.display_name ? r.display_name.split(',')[0] : 'Unknown Place');
            
            // STRICT VERIFICATION: ONLY use house number if explicitly verified by Nominatim/OSM
            // NEVER synthesize or force-prepend queryHouseNum onto an unverified road centerline!
            const verifiedHouseNum = addr.house_number || '';
            const displayName = verifiedHouseNum ? `${verifiedHouseNum} ${roadName}` : roadName;

            const city = addr.city || addr.town || addr.village || addr.hamlet || 'Fayetteville';
            const state = addr.state || 'NC';
            const cleanAddress = `${displayName}, ${city}, ${state}`;

            let placeType: Place['type'] = 'search_result';
            if (r.type === 'fuel') placeType = 'gas';
            else if (r.type === 'cafe') placeType = 'coffee';
            else if (r.type === 'restaurant' || r.type === 'fast_food') placeType = 'food';

            let icon = '📍';
            if (r.type === 'university') icon = '🏫';
            else if (r.type === 'restaurant' || r.type === 'fast_food') icon = '🍔';
            else if (r.type === 'fuel') icon = '⛽';
            else if (r.type === 'cafe') icon = '☕';

            return {
                id: `nominatim-${r.place_id || i}`,
                name: displayName,
                location: {
                    lat: parseFloat(r.lat),
                    lng: parseFloat(r.lon)
                },
                address: cleanAddress,
                description: cleanAddress,
                type: placeType,
                icon,
                rating: 4.5,
                source: 'nominatim'
            };
        });

        return deduplicatePlaces(mappedResults);
    } catch (e) {
        console.warn("🔌 [Nominatim] Search failed:", e);
        return [];
    }
};

// Main export: Uses proxy with automatic OSM fallback
export const searchNearbyPlaces = async (
    location?: { lat: number; lng: number } | null,
    type: 'gas_station' | 'cafe' | 'restaurant' | 'grocery_or_supermarket' | 'all' = 'all',
    radius: number = 5000
): Promise<Place[]> => {
    const validLoc = getValidLocation(location || undefined);
    const query = type === 'all' ? 'places' : type.replace('_', ' ');
    return searchViaProxy(validLoc, query, type === 'all' ? undefined : type);
};

// Free-text search for addresses and place names using Google Places API (Rooftop accuracy & local proximity bias)
export const searchPlacesText = async (
    query: string,
    location?: { lat: number; lng: number } | null
): Promise<Place[]> => {
    if (!query || query.trim().length === 0) return [];

    const validLoc = getValidLocation(location || undefined);
    const queryHouseMatch = query.trim().match(/^(\d+[a-zA-Z]?)\s+/);
    const queryHouseNum = queryHouseMatch ? queryHouseMatch[1] : '';
    const cacheKey = getCacheKey(query.trim(), validLoc, 'google_places');

    const cached = getCachedResults(cacheKey);
    if (cached) {
        return cached;
    }

    const apiKey = getActiveGoogleKey();

    // 1. Primary: Google Places Autocomplete API with parallel place_id rooftop Geocoding
    if (apiKey && !googleMapsAuthFailed) {
        try {
            await loadGoogleMapsSDK(apiKey);
            // A. Check if Google Maps JavaScript SDK is available in window
            if (!googleMapsAuthFailed && typeof window !== 'undefined' && (window as any).google?.maps) {
                const google = (window as any).google;
                const geocoder = google.maps.Geocoder ? new google.maps.Geocoder() : null;

                let preds: any[] = [];

                // Modern: Support AutocompleteSuggestion (New Places API) to avoid deprecation warnings
                if (google.maps.places?.AutocompleteSuggestion?.fetchAutocompleteSuggestions) {
                    try {
                        const res = await google.maps.places.AutocompleteSuggestion.fetchAutocompleteSuggestions({
                            input: query.trim(),
                            locationBias: new google.maps.Circle({
                                center: new google.maps.LatLng(validLoc.lat, validLoc.lng),
                                radius: 25000
                            })
                        });
                        if (Array.isArray(res?.suggestions)) {
                            preds = res.suggestions.map((s: any) => ({
                                place_id: s.placePrediction?.placeId,
                                description: s.placePrediction?.text?.text,
                                structured_formatting: {
                                    main_text: s.placePrediction?.structuredFormat?.mainText?.text
                                },
                                types: s.placePrediction?.types || []
                            })).filter((p: any) => Boolean(p.place_id));
                        }
                    } catch {
                        // Fallback to AutocompleteService below
                    }
                }

                // Classic: Support AutocompleteService
                if (preds.length === 0 && google.maps.places?.AutocompleteService) {
                    const autocomplete = new google.maps.places.AutocompleteService();
                    preds = await new Promise<any[]>((resolve) => {
                        try {
                            autocomplete.getPlacePredictions(
                                {
                                    input: query.trim(),
                                    locationBias: new google.maps.Circle({
                                        center: new google.maps.LatLng(validLoc.lat, validLoc.lng),
                                        radius: 25000
                                    })
                                },
                                (predictions: any[], status: string) => {
                                    if ((status === 'OK' || status === google.maps.places.PlacesServiceStatus.OK) && Array.isArray(predictions)) {
                                        resolve(predictions);
                                    } else {
                                        resolve([]);
                                    }
                                }
                            );
                        } catch {
                            resolve([]);
                        }
                    });
                }

                    if (preds.length > 0) {
                        const resolved = await Promise.all(
                            preds.slice(0, 8).map(async (pred: any): Promise<Place | null> => {
                                return new Promise((resResolve) => {
                                    geocoder.geocode({ placeId: pred.place_id }, (results: any[], status: string) => {
                                        if (status === 'OK' && results?.[0]?.geometry?.location) {
                                            const r = results[0];
                                            const loc = r.geometry.location;
                                            const lat = typeof loc.lat === 'function' ? loc.lat() : loc.lat;
                                            const lng = typeof loc.lng === 'function' ? loc.lng() : loc.lng;

                                            const streetNumberComp = r.address_components?.find((c: any) => c.types?.includes('street_number'));
                                            const isRooftop = r.geometry?.location_type === 'ROOFTOP';
                                            const hasVerifiedHouseNum = Boolean(streetNumberComp?.long_name || streetNumberComp?.short_name) && isRooftop;
                                            const isRouteOnly = (r.types?.includes('route') || r.geometry?.location_type === 'GEOMETRIC_CENTER' || r.geometry?.location_type === 'RANGE_INTERPOLATED' || r.geometry?.location_type === 'APPROXIMATE') && !hasVerifiedHouseNum;

                                            let mainText = pred.structured_formatting?.main_text || pred.description?.split(',')[0] || '';
                                            let formattedAddress = r.formatted_address || pred.description || mainText;

                                            // If search query started with a house number, but API only matched the road:
                                            // Format strictly as the verified road/street, never a fabricated numbered address
                                            if (queryHouseNum && isRouteOnly) {
                                                const routeComp = r.address_components?.find((c: any) => c.types?.includes('route'));
                                                mainText = routeComp?.long_name || mainText.replace(/^\d+[a-zA-Z]?\s+/, '');
                                                formattedAddress = formattedAddress.replace(/^\d+[a-zA-Z]?\s+/, '');
                                            }

                                            const types = [...(pred.types || []), ...(r.types || [])];
                                            let placeType: Place['type'] = 'search_result';
                                            let icon = '📍';
                                            if (types.includes('gas_station')) { placeType = 'gas'; icon = '⛽'; }
                                            else if (types.includes('cafe') || types.includes('coffee')) { placeType = 'coffee'; icon = '☕'; }
                                            else if (types.includes('restaurant') || types.includes('food')) { placeType = 'food'; icon = '🍔'; }
                                            else if (types.includes('grocery_or_supermarket') || types.includes('supermarket')) { placeType = 'grocery'; icon = '🛒'; }
                                            else if (types.includes('pharmacy') || types.includes('drugstore')) { placeType = 'pharmacy'; icon = '💊'; }
                                            else if (types.includes('hospital')) { placeType = 'hospital'; icon = '🏥'; }
                                            else if (types.includes('bank') || types.includes('atm')) { icon = '🏦'; }

                                            resResolve({
                                                id: `google-${pred.place_id}`,
                                                name: mainText,
                                                location: { lat, lng },
                                                radius: 0.15,
                                                type: placeType,
                                                icon,
                                                brandColor: '#4285F4',
                                                description: formattedAddress,
                                                address: formattedAddress,
                                                rating: 4.5
                                            });
                                        } else {
                                            resResolve(null);
                                        }
                                    });
                                });
                            })
                        );

                        const validMapped = resolved.filter((p): p is Place => p !== null);
                        if (validMapped.length > 0) {
                            const uniquePlaces = deduplicatePlaces(validMapped);
                            setCachedResults(cacheKey, uniquePlaces);
                            return uniquePlaces;
                        }
                    }
                }

            // B. Direct Google Places Autocomplete REST API (routed via local proxy in dev to avoid CORS)
            const apiBase = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
                ? '/maps-api'
                : 'https://maps.googleapis.com';

            const encoded = encodeURIComponent(query.trim());
            const autocompleteUrl = `${apiBase}/maps/api/place/autocomplete/json?input=${encoded}&location=${validLoc.lat},${validLoc.lng}&radius=25000&types=address|establishment&key=${apiKey}`;

            let autoResponse = await fetch(autocompleteUrl, { signal: AbortSignal.timeout(4500) });
            let autoData = autoResponse.ok ? await autoResponse.json() : null;

            // If strictbounds returned 0 results, widen location bias
            if (!autoData || autoData.status !== 'OK' || !Array.isArray(autoData.predictions) || autoData.predictions.length === 0) {
                const wideAutocompleteUrl = `${apiBase}/maps/api/place/autocomplete/json?input=${encoded}&location=${validLoc.lat},${validLoc.lng}&radius=50000&key=${apiKey}`;
                const wideResponse = await fetch(wideAutocompleteUrl, { signal: AbortSignal.timeout(4500) });
                if (wideResponse.ok) {
                    autoData = await wideResponse.json();
                }
            }

            if (autoData?.status === 'OK' && Array.isArray(autoData.predictions) && autoData.predictions.length > 0) {
                // Resolve place_id to exact rooftop coordinates using parallel Geocoding API calls
                const resolvedPlaces = await Promise.all(
                    autoData.predictions.slice(0, 8).map(async (pred: any): Promise<Place | null> => {
                        try {
                            const geoUrl = `${apiBase}/maps/api/geocode/json?place_id=${encodeURIComponent(pred.place_id)}&key=${apiKey}`;
                            const geoRes = await fetch(geoUrl, { signal: AbortSignal.timeout(4000) });
                            if (!geoRes.ok) return null;
                            const geoData = await geoRes.json();
                            if (geoData.status !== 'OK' || !geoData.results?.[0]) return null;

                            const res = geoData.results[0];
                            const loc = res.geometry?.location;
                            if (!loc) return null;

                            const streetNumberComp = res.address_components?.find((c: any) => c.types?.includes('street_number'));
                            const isRooftop = res.geometry?.location_type === 'ROOFTOP';
                            const hasVerifiedHouseNum = Boolean(streetNumberComp?.long_name || streetNumberComp?.short_name) && isRooftop;
                            const isRouteOnly = (res.types?.includes('route') || res.geometry?.location_type === 'GEOMETRIC_CENTER' || res.geometry?.location_type === 'RANGE_INTERPOLATED' || res.geometry?.location_type === 'APPROXIMATE') && !hasVerifiedHouseNum;

                            let mainText = pred.structured_formatting?.main_text || pred.description?.split(',')[0] || '';
                            let formattedAddress = res.formatted_address || pred.description || mainText;

                            if (queryHouseNum && isRouteOnly) {
                                const routeComp = res.address_components?.find((c: any) => c.types?.includes('route'));
                                mainText = routeComp?.long_name || mainText.replace(/^\d+[a-zA-Z]?\s+/, '');
                                formattedAddress = formattedAddress.replace(/^\d+[a-zA-Z]?\s+/, '');
                            }

                            const types = [...(pred.types || []), ...(res.types || [])];
                            let placeType: Place['type'] = 'search_result';
                            let icon = '📍';
                            if (types.includes('gas_station')) { placeType = 'gas'; icon = '⛽'; }
                            else if (types.includes('cafe') || types.includes('coffee')) { placeType = 'coffee'; icon = '☕'; }
                            else if (types.includes('restaurant') || types.includes('food')) { placeType = 'food'; icon = '🍔'; }
                            else if (types.includes('grocery_or_supermarket') || types.includes('supermarket')) { placeType = 'grocery'; icon = '🛒'; }
                            else if (types.includes('pharmacy') || types.includes('drugstore')) { placeType = 'pharmacy'; icon = '💊'; }
                            else if (types.includes('hospital')) { placeType = 'hospital'; icon = '🏥'; }
                            else if (types.includes('bank') || types.includes('atm')) { icon = '🏦'; }

                            return {
                                id: `google-${pred.place_id}`,
                                name: mainText,
                                location: { lat: loc.lat, lng: loc.lng },
                                radius: 0.15,
                                type: placeType,
                                icon,
                                brandColor: '#4285F4',
                                description: formattedAddress,
                                address: formattedAddress,
                                rating: 4.5
                            };
                        } catch {
                            return null;
                        }
                    })
                );

                const validMapped = resolvedPlaces.filter((p): p is Place => p !== null);
                if (validMapped.length > 0) {
                    const uniquePlaces = deduplicatePlaces(validMapped);
                    setCachedResults(cacheKey, uniquePlaces);
                    return uniquePlaces;
                }
            }

            // C. Fallback: Raw Geocoding API query with strict rectangular bounds (NO location/radius)
            const minLat = validLoc.lat - 0.35;
            const minLng = validLoc.lng - 0.35;
            const maxLat = validLoc.lat + 0.35;
            const maxLng = validLoc.lng + 0.35;
            const bounds = `${minLat},${minLng}|${maxLat},${maxLng}`;
            const geocodeUrl = `${apiBase}/maps/api/geocode/json?address=${encoded}&bounds=${bounds}&key=${apiKey}`;

            const geoResponse = await fetch(geocodeUrl, { signal: AbortSignal.timeout(4500) });
            if (geoResponse.ok) {
                const geoData = await geoResponse.json();
                if (geoData.status === 'OK' && Array.isArray(geoData.results) && geoData.results.length > 0) {
                    const mappedResults: Place[] = geoData.results.map((place: any, index: number): Place => {
                        const loc = place.geometry?.location;
                        const lat = loc?.lat ?? validLoc.lat;
                        const lng = loc?.lng ?? validLoc.lng;

                        const streetNumberComp = place.address_components?.find((c: any) => c.types?.includes('street_number'));
                        const isRooftop = place.geometry?.location_type === 'ROOFTOP';
                        const hasVerifiedHouseNum = Boolean(streetNumberComp?.long_name || streetNumberComp?.short_name) && isRooftop;
                        const isRouteOnly = (place.types?.includes('route') || place.geometry?.location_type === 'GEOMETRIC_CENTER' || place.geometry?.location_type === 'RANGE_INTERPOLATED' || place.geometry?.location_type === 'APPROXIMATE') && !hasVerifiedHouseNum;

                        let formattedAddr = place.formatted_address || '';
                        let displayName = formattedAddr.split(',')[0] || '';

                        if (queryHouseNum && isRouteOnly) {
                            const routeComp = place.address_components?.find((c: any) => c.types?.includes('route'));
                            displayName = routeComp?.long_name || displayName.replace(/^\d+[a-zA-Z]?\s+/, '');
                            formattedAddr = formattedAddr.replace(/^\d+[a-zA-Z]?\s+/, '');
                        }

                        return {
                            id: `google-geo-${place.place_id || index}`,
                            name: displayName,
                            location: { lat, lng },
                            radius: 0.15,
                            type: 'search_result',
                            icon: '📍',
                            brandColor: '#4285F4',
                            description: formattedAddr,
                            address: formattedAddr,
                            rating: 4.5
                        };
                    });

                    const uniquePlaces = deduplicatePlaces(mappedResults);
                    setCachedResults(cacheKey, uniquePlaces);
                    return uniquePlaces;
                }
            }
        } catch (err) {
            console.warn('[Google Places Autocomplete] API request error, falling back to proxy search:', err);
        }
    } else {
        console.warn('⚠️ [Google Places Autocomplete] VITE_GOOGLE_MAPS_API_KEY not configured in .env file.');
    }

    // 2. Fallback: Proxy search via Firebase Functions / OSM if Google key is unavailable or restricted
    const fallbackResults = await searchViaProxy(validLoc, query);
    const uniqueFallbackPlaces = deduplicatePlaces(fallbackResults);

    if (uniqueFallbackPlaces.length > 0) {
        setCachedResults(cacheKey, uniqueFallbackPlaces);
    }
    return uniqueFallbackPlaces;
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

/**
 * Search maintenance and auto repair facilities along a route corridor
 * for Predictive Ambient Maintenance.
 */
export const searchMaintenanceAlongRoute = async (
    routeGeometry: Array<{ lat: number; lng: number } | [number, number]> | undefined,
    category: string = 'oil_change',
    userLocation?: { lat: number; lng: number } | null
): Promise<Place[]> => {
    if (!routeGeometry || routeGeometry.length === 0) {
        const center = userLocation || DEFAULT_COORDS;
        const query = category === 'oil_change' ? 'oil change' : category === 'tires' ? 'tire shop' : category === 'brakes' ? 'brake repair' : 'auto repair';
        return searchViaProxy(center, query);
    }

    // Convert routeGeometry to normalized {lat, lng} array
    const normalizedCoords: Array<{ lat: number; lng: number }> = routeGeometry.map(pt => {
        if (Array.isArray(pt)) return { lng: pt[0], lat: pt[1] };
        return { lat: (pt as any).lat, lng: (pt as any).lng };
    });

    // Sample 3 corridor anchor points along route (e.g. 25%, 50%, 75%)
    const samplePoints: Array<{ lat: number; lng: number }> = [];
    const step = Math.max(1, Math.floor(normalizedCoords.length / 4));
    for (let i = 0; i < normalizedCoords.length; i += step) {
        samplePoints.push(normalizedCoords[i]);
    }
    if (samplePoints.length === 0 && userLocation) samplePoints.push(userLocation);

    const query = category === 'oil_change' 
        ? 'oil change auto repair' 
        : category === 'tires' 
        ? 'tire shop' 
        : category === 'brakes' 
        ? 'brake repair auto service' 
        : 'auto repair mechanic';

    const icon = category === 'oil_change' ? '🛢️' : category === 'tires' ? '🛞' : category === 'brakes' ? '🛑' : '🔧';
    const categoryTitle = category === 'oil_change' ? 'Oil Change' : category === 'tires' ? 'Tire Rotation' : category === 'brakes' ? 'Brake Service' : 'Auto Maintenance';
    const defaultDeal = category === 'oil_change' ? '$15 Off Full Synthetic' : category === 'tires' ? 'Free Rotation & Balance Check' : 'Free Brake Inspection';

    try {
        const searchPromises = samplePoints.slice(0, 3).map(pt => searchViaProxy(pt, query).catch(() => []));
        const allResultsArrays = await Promise.all(searchPromises);
        const allResults = allResultsArrays.flat();

        // Deduplicate places by name and proximity
        const seen = new Set<string>();
        const uniquePlaces: Place[] = [];

        for (const p of allResults) {
            const key = p.name.toLowerCase().replace(/[^a-z0-9]/g, '');
            if (!seen.has(key)) {
                seen.add(key);

                // Compute exact minimum distance to route corridor
                let minMeters = Infinity;
                for (const coord of normalizedCoords) {
                    const d = getDistanceMeters(p.location.lat, p.location.lng, coord.lat, coord.lng);
                    if (d < minMeters) minMeters = d;
                }

                const detourMiles = Math.round((minMeters / 1609.34) * 2 * 10) / 10;
                const detourMinutes = Math.max(1, Math.round(detourMiles * 2.2));

                uniquePlaces.push({
                    ...p,
                    type: 'maintenance' as any,
                    icon,
                    brandColor: '#f59e0b',
                    rating: p.rating || 4.8,
                    detourMiles,
                    detourMinutes,
                    deal: p.deal || defaultDeal,
                    maintenanceCategory: categoryTitle,
                    description: p.description ? `🔧 ${p.description}` : `🔧 Top-rated for ${categoryTitle} • +${detourMinutes} min detour`
                });
            }
            if (uniquePlaces.length >= 8) break;
        }

        // Sort by fastest detour time
        uniquePlaces.sort((a, b) => (a.detourMinutes || 0) - (b.detourMinutes || 0));

        return uniquePlaces;
    } catch (e) {
        console.warn('[PlacesService] Failed to search maintenance along route:', e);
        return [];
    }
};
