// Google Places Service - Secure API proxy via Firebase Functions with high-performance OSM / Photon fallback
import { Place } from '../types';
import { functions } from './firebase';
import { httpsCallable } from 'firebase/functions';
import { getDistanceFromCoords as getDistanceMeters } from '../utils/geo';

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

    // Sort strictly with local proximity priority (closest stores first):
    uniqueResults.sort((a, b) => {
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
        const patterns = getCuisineAndCategoryPatterns(query);
        // Query Photon, Nominatim, and Overpass concurrently
        const [photonDirect, photonCore, overpassResults, nominatimResults] = await Promise.all([
            searchViaPhoton(location, query).catch(() => [] as Place[]),
            patterns.searchCore !== query ? searchViaPhoton(location, patterns.searchCore).catch(() => [] as Place[]) : Promise.resolve([] as Place[]),
            searchViaOverpass(location, query.trim(), true).catch(() => [] as Place[]),
            searchViaNominatim(location, query).catch(() => [] as Place[])
        ]);

        const combined = [...overpassResults, ...photonDirect, ...photonCore, ...nominatimResults];
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
        const url = `https://photon.komoot.io/api/?q=${encoded}&lat=${validLoc.lat}&lon=${validLoc.lng}&limit=15`;
        console.log(`⚡ [Photon] Querying: ${url}`);

        const response = await fetch(url, { signal: AbortSignal.timeout(3500) });
        if (!response.ok) return [];

        const data = await response.json();
        const features = data.features || [];

        return features.map((f: any, i: number) => {
            const props = f.properties || {};
            const coords = f.geometry?.coordinates || [0, 0];
            const lng = coords[0];
            const lat = coords[1];

            const streetAddr = (props.housenumber && props.street) ? `${props.housenumber} ${props.street}` : (props.street || '');
            const parts: string[] = [];
            if (streetAddr) parts.push(streetAddr);
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

            // Determine venue/business name vs street address
            let displayName = props.name;
            if (!displayName || /^\d+$/.test(displayName)) {
                displayName = streetAddr || query.trim();
            }

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

// Overpass API fallback — returns up to 25 nearby places using radius searches or name matching
const searchViaOverpass = async (
    location: { lat: number; lng: number },
    typeOrQuery: string,
    isNameQuery: boolean = false
): Promise<Place[]> => {
    try {
        console.log(`🗺️ [Overpass] Query center: (${location.lat}, ${location.lng}) | ${isNameQuery ? 'name' : 'type'}: ${typeOrQuery}`);

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
            amenityQuery = 'nw["amenity"="fuel"](around:5000, {{lat}}, {{lng}});';
        } else if (typeOrQuery === 'cafe') {
            amenityQuery = 'nw["amenity"="cafe"](around:5000, {{lat}}, {{lng}});';
        } else if (typeOrQuery === 'restaurant') {
            amenityQuery = 'nw["amenity"~"restaurant|fast_food"](around:5000, {{lat}}, {{lng}});';
        } else if (typeOrQuery === 'grocery_or_supermarket') {
            amenityQuery = 'nw["shop"~"supermarket|grocery"](around:5000, {{lat}}, {{lng}});';
        } else if (typeOrQuery === 'hairdresser') {
            amenityQuery = 'nw["shop"="hairdresser"](around:5000, {{lat}}, {{lng}});';
        } else if (typeOrQuery === 'pharmacy') {
            amenityQuery = 'nw["amenity"="pharmacy"](around:5000, {{lat}}, {{lng}});';
        } else if (typeOrQuery === 'gym') {
            amenityQuery = 'nw["leisure"="fitness_centre"](around:5000, {{lat}}, {{lng}});';
        } else if (typeOrQuery === 'bar') {
            amenityQuery = 'nw["amenity"~"bar|pub"](around:5000, {{lat}}, {{lng}});';
        }

        if (!amenityQuery) return [];

        const query = amenityQuery
            .replaceAll('{{lat}}', location.lat.toString())
            .replaceAll('{{lng}}', location.lng.toString());

        const overpassQL = `[out:json];${query}out center 15;`;
        console.log(`🗺️ [Overpass] Final QL: ${overpassQL}`);
        const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(overpassQL)}`;

        const response = await fetch(url, {
            headers: { 'User-Agent': 'MyWay-GPS-Dev/1.0' },
            signal: AbortSignal.timeout(4000)
        });

        if (!response.ok) {
            throw new Error(`Overpass API status ${response.status}`);
        }

        const data = await response.json();
        const elements = data.elements || [];

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
    } catch (err) {
        console.warn('[Overpass] Search failed, falling back to Nominatim:', err);
        return [];
    }
};

// Nominatim fallback — returns real geocoded places (no API key needed)
const searchViaNominatim = async (
    location: { lat: number; lng: number },
    query: string
): Promise<Place[]> => {
    const validLoc = getValidLocation(location);
    try {
        let searchQuery = query.toLowerCase().trim();
        if (searchQuery === 'coffee shop') {
            searchQuery = 'cafe';
        } else if (searchQuery === 'grocery store' || searchQuery === 'grocery') {
            searchQuery = 'supermarket';
        }
        const encoded = encodeURIComponent(searchQuery);
        // Biased viewbox (0.75° ≈ 80km radius) + country code
        const viewbox = `${validLoc.lng - 0.75},${validLoc.lat + 0.75},${validLoc.lng + 0.75},${validLoc.lat - 0.75}`;
        const countryParam = '&countrycodes=us';

        const response = await fetch(
            `https://nominatim.openstreetmap.org/search?format=json&q=${encoded}&viewbox=${viewbox}&bounded=0${countryParam}&limit=25&addressdetails=1`,
            { 
                headers: { 'User-Agent': 'MyWay-GPS/1.0' },
                signal: AbortSignal.timeout(4500) 
            }
        );
        const results = await response.json();

        return (results || []).map((r: any, i: number) => {
            const addr = r.address || {};
            const streetAddr = (addr.house_number && addr.road)
                ? `${addr.house_number} ${addr.road}`
                : (addr.road || r.name || r.display_name?.split(',')[0]);

            const parts: string[] = [];
            if (addr.road) parts.push(addr.house_number ? `${addr.house_number} ${addr.road}` : addr.road);
            if (addr.city || addr.town || addr.village || addr.hamlet) parts.push(addr.city || addr.town || addr.village || addr.hamlet);
            if (addr.state) parts.push(addr.state);
            if (addr.postcode) parts.push(addr.postcode);
            const cleanAddress = parts.length > 0 ? parts.join(', ') : (r.display_name || '');

            let placeType: Place['type'] = 'search_result';
            if (r.type === 'fuel') placeType = 'gas';
            else if (r.type === 'cafe') placeType = 'coffee';
            else if (r.type === 'restaurant' || r.type === 'fast_food') placeType = 'food';

            let icon = '📍';
            if (r.type === 'university') icon = '🏫';
            else if (r.type === 'restaurant' || r.type === 'fast_food') icon = '🍔';
            else if (r.type === 'fuel') icon = '⛽';
            else if (r.type === 'cafe') icon = '☕';

            const rawName = r.name || addr.shop || addr.amenity || addr.leisure;
            let displayName = rawName;
            if (!displayName || /^\d+$/.test(displayName)) {
                displayName = streetAddr || query.trim();
            }

            const nLower = displayName.toLowerCase();
            if (nLower.includes('taco') || nLower.includes('burrito') || nLower.includes('mexican')) icon = '🌮';
            else if (nLower.includes('pizza')) icon = '🍕';
            else if (nLower.includes('mcdonald') || nLower.includes('burger')) icon = '🍔';
            else if (nLower.includes('coffee') || nLower.includes('starbucks')) icon = '☕';
            else if (nLower.includes('fuel') || nLower.includes('gas') || nLower.includes('shell') || nLower.includes('exxon')) icon = '⛽';

            return {
                id: `nominatim-${r.place_id || i}`,
                name: displayName,
                type: placeType,
                icon,
                location: {
                    lat: parseFloat(r.lat),
                    lng: parseFloat(r.lon)
                },
                radius: 0.15,
                brandColor: '#6366f1',
                description: cleanAddress
            };
        });
    } catch (err) {
        console.error('[Nominatim] Search failed:', err);
        return [];
    }
};

// Main export: Uses proxy with automatic OSM fallback
export const searchNearbyPlaces = async (
    location: { lat: number; lng: number },
    type: 'gas_station' | 'cafe' | 'restaurant' | 'grocery_or_supermarket' | 'all' = 'all',
    radius: number = 5000
): Promise<Place[]> => {
    const query = type === 'all' ? 'places' : type.replace('_', ' ');
    return searchViaProxy(location, query, type === 'all' ? undefined : type);
};

// Free-text search for addresses and place names (used by main search bar)
export const searchPlacesText = async (
    query: string,
    location: { lat: number; lng: number }
): Promise<Place[]> => {
    return searchViaProxy(location, query);
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
