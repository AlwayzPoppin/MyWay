// Google Places Service - Secure API proxy via Firebase Functions with Mapbox Geocoding & OSM fallback
import { Place } from '../types';
import { functions } from './firebase';
import { httpsCallable } from 'firebase/functions';
import { getDistanceFromCoords as getDistanceMeters } from '../utils/geo';
import { placeCorrectionService } from './placeCorrectionService';
import { communityBuildingService } from './communityBuildingService';
import { contributionService, applyCommunityPinsToPlaces } from './contributionService';

// Mapbox Geocoding Access Token for rooftop-accurate address search & autocomplete
// Google Places & Geocoding API Configuration for rooftop-accurate address search & autocomplete
declare const google: any;

export const getGoogleApiBase = (): string =>
    typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
        ? '/maps-api'
        : 'https://maps.googleapis.com';

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

export const ensureGoogleMapsLoaded = async (): Promise<boolean> => {
    const key = getActiveGoogleKey();
    if (!key) return false;
    return loadGoogleMapsSDK(key);
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

export const GAS_AND_CONVENIENCE_BRANDS = [
    '7-eleven', '7 eleven', '7eleven', 'seven eleven',
    'circle k', 'circlek', 'kangaroo express',
    'wawa', 'sheetz', 'speedway', 'quiktrip', 'qt',
    'racetrac', 'buc-ee', 'casey', 'cumberland farms',
    'royal farms', 'pilot', 'flying j', 'loves travel',
    'love\'s', 'murphy usa', 'murphy express', 'scotchman',
    'fastrip', 'family fare', 'bp', 'shell', 'exxon',
    'mobil', 'chevron', 'texaco', 'citgo', 'marathon',
    'sunoco', 'valero', 'phillips 66', 'conoco', 'sinclair',
    'sam\'s club gas', 'costco gas', 'kroger fuel'
];

export const FAST_FOOD_AND_BURGER_BRANDS = [
    'mcdonald', 'burger king', 'wendy', 'chick-fil-a', 'chickfila',
    'taco bell', 'kfc', 'popeyes', 'bojangles', 'subway',
    'domino', 'pizza hut', 'papa john', 'little caesar', 'chipotle',
    'sonic', 'cook out', 'cookout', 'culver', 'five guys',
    'jack in the box', 'hardee', 'carl\'s jr', 'carls jr', 'arby',
    'dairy queen', 'panda express', 'ihop', 'denny', 'waffle house',
    'cracker barrel', 'golden corral', 'applebee', 'chili\'s', 'chilis',
    'olive garden', 'red lobster', 'outback'
];

export const PHARMACY_BRANDS = [
    'walgreens', 'cvs', 'rite aid', 'duane reade', 'pharmacy', 'drugstore'
];

export const AUTO_SERVICE_BRANDS = [
    'jiffy lube', 'valvoline', 'take 5', 'firestone', 'goodyear',
    'discount tire', 'pep boys', 'midas', 'meineke', 'autozone',
    'advance auto', 'o\'reilly auto', 'oreilly auto', 'napa auto',
    'carquest', 'safelite', 'maaco', 'aamco', 'express oil'
];

export const SUPERMARKET_BRANDS = [
    'walmart', 'target', 'costco', 'sam\'s club', 'sams club', 'bj\'s', 'bjs',
    'food lion', 'harris teeter', 'kroger', 'publix', 'aldi', 'lidl',
    'trader joe', 'whole foods', 'piggly wiggly', 'lowes foods', 'carlie c',
    'sprouts', 'safeway', 'heb', 'meijer', 'wegmans', 'winco'
];

export const HOME_IMPROVEMENT_BRANDS = [
    'home depot', 'lowe\'s', 'lowes', 'ace hardware', 'harbor freight',
    'tractor supply', 'menards', 'true value'
];

export const BANK_BRANDS = [
    'wells fargo', 'bank of america', 'chase', 'citibank', 'pnc',
    'truist', 'first citizens', 'td bank', 'us bank', 'capital one',
    'navy federal', 'state employees credit union', 'secu'
];

export const GYM_BRANDS = [
    'planet fitness', 'la fitness', 'anytime fitness', 'crunch fitness',
    'gold\'s gym', 'equinox', 'ymca', 'orangetheory', 'f45', 'crossfit'
];

export const HOTEL_BRANDS = [
    'hotel', 'motel', 'inn', 'suites', 'marriott', 'hilton', 'holiday inn',
    'hampton inn', 'comfort inn', 'best western', 'hyatt', 'courtyard',
    'fairfield', 'la quinta', 'super 8', 'motel 6', 'days inn', 'extended stay'
];

export const COFFEE_BRANDS = [
    'starbucks', 'dunkin', 'dutch bros', 'peet', 'caribou coffee',
    'tim horton', 'scooter', 'biggby', 'black rifle coffee'
];

/**
 * Safely checks if a brand/term exists in the place name using word-boundary matching.
 * Prevents substring collisions like "Cinnabon" matching "inn", "Headquarters" matching "qt",
 * or "Subpoena" matching "bp".
 */
export function matchesWordBoundary(text: string, term: string): boolean {
    if (!text || !term) return false;
    const cleanText = text.replace(/[\u2018\u2019`]/g, "'").trim();
    const cleanTerm = term.replace(/[\u2018\u2019`]/g, "'").trim();
    const escaped = cleanTerm.replace(/[-[\]{}()*+?.,\\^$|#]/g, '\\$&');
    const pattern = new RegExp(`(^|[^a-zA-Z0-9])${escaped}('?s)?([^a-zA-Z0-9]|$)`, 'i');
    return pattern.test(cleanText);
}

export const isGasOrConvenienceBrand = (name?: string): boolean => {
    if (!name) return false;
    return GAS_AND_CONVENIENCE_BRANDS.some(b => matchesWordBoundary(name, b));
};

export const resolvePlaceCategory = (
    name: string,
    types: string[] = [],
    osmProps: { osmValue?: string; amenity?: string; shop?: string } = {}
): { placeType: Place['type']; icon: string; category?: string } => {
    const rawName = name || '';
    const nLower = rawName.toLowerCase().replace(/[\u2018\u2019`]/g, "'").trim();
    const osmVal = (osmProps.osmValue || osmProps.amenity || osmProps.shop || '').toLowerCase().trim();

    // ─────────────────────────────────────────────────────────────────────────
    // 1. EXACT / WORD-BOUNDARY BRAND & DEPARTMENT MATCHING (IDENTITY FIRST)
    // ─────────────────────────────────────────────────────────────────────────

    // A. Big-Box Department Checks (Walmart Auto Care, Costco Tire Center, etc.)
    // Specific service departments MUST be classified as maintenance/pharmacy/gas
    // BEFORE parent-place big box protection applies!
    const isBigBoxBrand = ['walmart', 'target', 'costco', "sam's club", 'sams club', "bj's", 'bjs', 'meijer'].some(
        b => matchesWordBoundary(nLower, b)
    );

    if (isBigBoxBrand) {
        if (
            matchesWordBoundary(nLower, 'auto care') ||
            matchesWordBoundary(nLower, 'tire') ||
            matchesWordBoundary(nLower, 'tire & lube') ||
            matchesWordBoundary(nLower, 'tire center') ||
            matchesWordBoundary(nLower, 'lube') ||
            matchesWordBoundary(nLower, 'car care')
        ) {
            return {
                placeType: 'maintenance',
                icon: '🔧',
                category: 'Auto Care / Tire'
            };
        }

        if (
            matchesWordBoundary(nLower, 'gas') ||
            matchesWordBoundary(nLower, 'gasoline') ||
            matchesWordBoundary(nLower, 'fuel')
        ) {
            return {
                placeType: 'gas',
                icon: '⛽',
                category: 'Gas Station'
            };
        }

        if (
            matchesWordBoundary(nLower, 'pharmacy') ||
            matchesWordBoundary(nLower, 'drugstore') ||
            matchesWordBoundary(nLower, 'rx')
        ) {
            return {
                placeType: 'pharmacy',
                icon: '💊',
                category: 'Pharmacy'
            };
        }

        // Parent-place big box protection: general Walmart Supercenters/Targets are department stores
        return {
            placeType: 'grocery',
            icon: '🛒',
            category: 'Department Store'
        };
    }

    // B. Specific Automotive Service Brands (Jiffy Lube, AutoZone, Firestone, etc.)
    const isAutoBrand = AUTO_SERVICE_BRANDS.some(b => matchesWordBoundary(nLower, b));
    if (isAutoBrand) {
        let cat = 'Auto Service';
        let ic = '🔧';
        if (matchesWordBoundary(nLower, 'parts') || matchesWordBoundary(nLower, 'auto parts')) {
            cat = 'Auto Parts';
        } else if (matchesWordBoundary(nLower, 'wash') || matchesWordBoundary(nLower, 'car wash')) {
            cat = 'Car Wash';
            ic = '🚿';
        } else if (matchesWordBoundary(nLower, 'tire') || matchesWordBoundary(nLower, 'tires')) {
            cat = 'Tire Service';
        } else if (matchesWordBoundary(nLower, 'oil') || matchesWordBoundary(nLower, 'lube')) {
            cat = 'Oil Change';
        }
        return {
            placeType: 'maintenance',
            icon: ic,
            category: cat
        };
    }

    // C. Specific Pharmacy Brands (Walgreens, CVS, Rite Aid, etc.)
    // Checked before convenience store so Walgreens is never labeled a generic bodega
    const isPharmacyBrand = PHARMACY_BRANDS.some(b => matchesWordBoundary(nLower, b));
    if (isPharmacyBrand) {
        return {
            placeType: 'pharmacy',
            icon: '💊',
            category: 'Pharmacy'
        };
    }

    // D. Specific Fast Food, Pizza, Mexican & Restaurant Brands (McDonald's, Wendy's, Domino's, etc.)
    // Checked before Coffee/Cafe so McDonald's McCafé never gets labeled Coffee Shop
    const isFastFoodBrand = FAST_FOOD_AND_BURGER_BRANDS.some(b => matchesWordBoundary(nLower, b));
    if (isFastFoodBrand) {
        let foodIcon = '🍔';
        let foodCategory = 'Fast Food';
        if (matchesWordBoundary(nLower, 'pizza') || ['domino', 'pizza hut', 'papa john', 'little caesar'].some(b => matchesWordBoundary(nLower, b))) {
            foodIcon = '🍕';
            foodCategory = 'Pizza';
        } else if (matchesWordBoundary(nLower, 'taco') || matchesWordBoundary(nLower, 'burrito') || matchesWordBoundary(nLower, 'chipotle') || matchesWordBoundary(nLower, 'taco bell')) {
            foodIcon = '🌮';
            foodCategory = 'Mexican';
        } else if (['bojangles', 'chick-fil-a', 'chickfila', 'kfc', 'popeyes', 'zaxby', 'raising cane'].some(b => matchesWordBoundary(nLower, b))) {
            foodIcon = '🍗';
            foodCategory = 'Chicken & Fast Food';
        } else if (matchesWordBoundary(nLower, 'panera')) {
            foodIcon = '🥖';
            foodCategory = 'Bakery & Cafe';
        } else if (matchesWordBoundary(nLower, 'subway') || matchesWordBoundary(nLower, 'jersey mike') || matchesWordBoundary(nLower, 'jimmy john') || matchesWordBoundary(nLower, 'firehouse subs')) {
            foodIcon = '🥪';
            foodCategory = 'Sub & Sandwich';
        }
        return {
            placeType: 'food',
            icon: foodIcon,
            category: foodCategory
        };
    }

    // E. Specific Coffee Brands (Starbucks, Dunkin', Dutch Bros, etc.)
    const isCoffeeBrand = COFFEE_BRANDS.some(b => matchesWordBoundary(nLower, b));
    if (isCoffeeBrand) {
        return {
            placeType: 'coffee',
            icon: '☕',
            category: matchesWordBoundary(nLower, 'dunkin') ? 'Coffee & Donuts' : 'Coffee Shop'
        };
    }

    // F. Specific Gas & Convenience Brands (7-Eleven, Circle K, Wawa, Sheetz, BP, etc.)
    const isGasBrand = isGasOrConvenienceBrand(nLower);
    if (isGasBrand) {
        return {
            placeType: 'gas',
            icon: '⛽',
            category: 'Gas & Convenience'
        };
    }

    // G. Specific Supermarket / Grocery Brands (Food Lion, Publix, Kroger, Aldi, etc.)
    const isSupermarketBrand = SUPERMARKET_BRANDS.some(b => matchesWordBoundary(nLower, b));
    if (isSupermarketBrand) {
        return {
            placeType: 'grocery',
            icon: '🛒',
            category: 'Supermarket'
        };
    }

    // H. Specific Home Improvement Brands (Home Depot, Lowe's, Ace Hardware, etc.)
    const isHomeBrand = HOME_IMPROVEMENT_BRANDS.some(b => matchesWordBoundary(nLower, b));
    if (isHomeBrand) {
        return {
            placeType: 'search_result',
            icon: '🔨',
            category: 'Home Improvement'
        };
    }

    // I. Specific Bank Brands (Wells Fargo, Chase, PNC, etc.)
    const isBankBrand = BANK_BRANDS.some(b => matchesWordBoundary(nLower, b));
    if (isBankBrand) {
        return {
            placeType: 'search_result',
            icon: '🏦',
            category: 'Bank & ATM'
        };
    }

    // J. Specific Gym Brands (Planet Fitness, LA Fitness, etc.)
    const isGymBrand = GYM_BRANDS.some(b => matchesWordBoundary(nLower, b));
    if (isGymBrand) {
        return {
            placeType: 'gym',
            icon: '💪',
            category: 'Gym & Fitness'
        };
    }

    // K. Specific Hotel Brands (Holiday Inn, Marriott, Hilton, etc.)
    const isHotelBrand = HOTEL_BRANDS.some(b => matchesWordBoundary(nLower, b));
    if (isHotelBrand) {
        return {
            placeType: 'search_result',
            icon: '🏨',
            category: 'Hotel / Lodging'
        };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 2. EXPLICIT PROVIDER TYPES (Google types / OSM tags)
    // ─────────────────────────────────────────────────────────────────────────

    // Explicit Gas Station / Fuel
    if (types.includes('gas_station') || osmVal === 'fuel') {
        return {
            placeType: 'gas',
            icon: '⛽',
            category: 'Gas Station'
        };
    }

    // Explicit Pharmacy / Drugstore
    if (types.includes('pharmacy') || types.includes('drugstore') || osmVal === 'pharmacy') {
        return {
            placeType: 'pharmacy',
            icon: '💊',
            category: 'Pharmacy'
        };
    }

    // Explicit Hospital, Emergency Room, or Urgent Care
    if (
        types.includes('hospital') ||
        osmVal === 'hospital' ||
        osmVal === 'clinic' ||
        matchesWordBoundary(nLower, 'urgent care') ||
        matchesWordBoundary(nLower, 'emergency room') ||
        matchesWordBoundary(nLower, 'emergency department') ||
        matchesWordBoundary(nLower, 'er')
    ) {
        const isUrgent = matchesWordBoundary(nLower, 'urgent care') || matchesWordBoundary(nLower, 'walk-in') || matchesWordBoundary(nLower, 'clinic');
        return {
            placeType: 'hospital',
            icon: '🏥',
            category: isUrgent ? 'Urgent Care' : 'Hospital / ER'
        };
    }

    // Explicit Automotive Repair, Parts & Wash
    if (
        types.includes('car_repair') ||
        types.includes('auto_parts_store') ||
        types.includes('car_wash') ||
        osmVal.includes('car_repair') ||
        osmVal === 'car_wash'
    ) {
        let cat = 'Auto Service';
        let ic = '🔧';
        if (types.includes('auto_parts_store') || matchesWordBoundary(nLower, 'parts')) {
            cat = 'Auto Parts';
        } else if (types.includes('car_wash') || osmVal === 'car_wash' || matchesWordBoundary(nLower, 'wash')) {
            cat = 'Car Wash';
            ic = '🚿';
        }
        return {
            placeType: 'maintenance',
            icon: ic,
            category: cat
        };
    }

    // Explicit Supermarket / Grocery
    if (
        types.includes('grocery_or_supermarket') ||
        types.includes('supermarket') ||
        osmVal.includes('supermarket') ||
        osmVal.includes('grocery')
    ) {
        return {
            placeType: 'grocery',
            icon: '🛒',
            category: 'Supermarket'
        };
    }

    // Explicit Coffee / Cafe
    if (types.includes('cafe') || types.includes('coffee') || osmVal === 'cafe' || matchesWordBoundary(nLower, 'coffee') || matchesWordBoundary(nLower, 'espresso')) {
        return {
            placeType: 'coffee',
            icon: '☕',
            category: 'Coffee Shop'
        };
    }

    // Explicit Restaurant / Dining
    if (
        types.includes('restaurant') ||
        types.includes('meal_takeaway') ||
        types.includes('meal_delivery') ||
        osmVal === 'restaurant' ||
        osmVal === 'fast_food'
    ) {
        let foodIcon = '🍔';
        let foodCategory = 'Food & Dining';
        if (matchesWordBoundary(nLower, 'pizza')) { foodIcon = '🍕'; foodCategory = 'Pizza'; }
        else if (matchesWordBoundary(nLower, 'taco') || matchesWordBoundary(nLower, 'burrito') || matchesWordBoundary(nLower, 'mexican')) { foodIcon = '🌮'; foodCategory = 'Mexican'; }
        else if (matchesWordBoundary(nLower, 'chinese') || matchesWordBoundary(nLower, 'wok') || matchesWordBoundary(nLower, 'asian') || matchesWordBoundary(nLower, 'panda')) { foodIcon = '🥡'; foodCategory = 'Asian Dining'; }
        else if (matchesWordBoundary(nLower, 'sushi') || matchesWordBoundary(nLower, 'ramen') || matchesWordBoundary(nLower, 'japanese')) { foodIcon = '🍣'; foodCategory = 'Japanese'; }
        else if (matchesWordBoundary(nLower, 'burger')) { foodIcon = '🍔'; foodCategory = 'Burgers & Fries'; }
        else if (matchesWordBoundary(nLower, 'bakery')) { foodIcon = '🥖'; foodCategory = 'Bakery'; }

        return {
            placeType: 'food',
            icon: foodIcon,
            category: foodCategory
        };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 3. PARENT-PLACE PROTECTION FOR BIG-BOX / DEPARTMENT STORES
    // ─────────────────────────────────────────────────────────────────────────
    if (types.includes('department_store') || osmVal === 'department_store') {
        return {
            placeType: 'grocery',
            icon: '🛒',
            category: 'Department Store'
        };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 4. GENERIC CATEGORY FALLBACK
    // ─────────────────────────────────────────────────────────────────────────
    if (types.includes('food')) {
        return {
            placeType: 'food',
            icon: '🍔',
            category: 'Food & Dining'
        };
    }

    if (types.includes('convenience_store') || osmVal === 'convenience' || matchesWordBoundary(nLower, 'dollar')) {
        return {
            placeType: 'grocery',
            icon: '🏪',
            category: matchesWordBoundary(nLower, 'dollar') ? 'Discount Store' : 'Convenience Store'
        };
    }

    if (types.includes('gym') || osmVal === 'fitness_centre' || matchesWordBoundary(nLower, 'gym') || matchesWordBoundary(nLower, 'fitness')) {
        return {
            placeType: 'gym',
            icon: '💪',
            category: 'Gym & Fitness'
        };
    }

    if (types.includes('bank') || (types.includes('atm') && types.includes('finance')) || osmVal === 'bank') {
        return {
            placeType: 'search_result',
            icon: '🏦',
            category: 'Bank & ATM'
        };
    }

    if (types.includes('hair_care') || osmVal === 'hairdresser' || matchesWordBoundary(nLower, 'barber') || matchesWordBoundary(nLower, 'salon')) {
        return {
            placeType: 'search_result',
            icon: '💈',
            category: 'Barber / Salon'
        };
    }

    if (types.includes('hardware_store') || osmVal === 'hardware') {
        return {
            placeType: 'search_result',
            icon: '🔨',
            category: 'Home Improvement'
        };
    }

    if (types.includes('lodging') || osmVal === 'hotel' || osmVal === 'motel' || matchesWordBoundary(nLower, 'hotel') || matchesWordBoundary(nLower, 'motel')) {
        return {
            placeType: 'search_result',
            icon: '🏨',
            category: 'Hotel / Lodging'
        };
    }

    return {
        placeType: 'search_result',
        icon: '📍'
    };
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
    results = await applyCommunityPinsToPlaces(results);

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
            const isStreetOrHighway = osmValue === 'highway' || props.type === 'street' || props.osm_key === 'highway';
            const hasVerifiedHouseNum = Boolean(props.housenumber) && !isStreetOrHighway;

            const { placeType, icon, category } = resolvePlaceCategory(
                displayName,
                [],
                { osmValue, shop: props.osm_key === 'shop' ? props.osm_value : undefined }
            );

            return {
                id: `photon-${props.osm_id || i}`,
                name: displayName,
                type: placeType,
                category,
                icon,
                location: { lat, lng },
                radius: 0.15,
                brandColor: '#6366f1',
                address: cleanAddress,
                description: cleanAddress,
                houseNumber: hasVerifiedHouseNum ? String(props.housenumber) : undefined,
                isRooftop: hasVerifiedHouseNum,
                geocodePrecision: hasVerifiedHouseNum ? 'rooftop' : 'street'
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
        amenityQuery = `(
            nw["amenity"="fuel"](around:8000, {{lat}}, {{lng}});
            nw["shop"="convenience"]["fuel"="yes"](around:8000, {{lat}}, {{lng}});
            nw["shop"="convenience"]["name"~"7-Eleven|Circle K|Wawa|Sheetz|Speedway|QuikTrip|RaceTrac|Buc-ee|Casey|Pilot|Love|Murphy|Exxon|Shell|BP|Valero",i](around:8000, {{lat}}, {{lng}});
        );`;
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
                const pName = tags.name || (
                    typeOrQuery === 'gas_station' ? 'Gas Station' : 
                    typeOrQuery === 'cafe' ? 'Coffee Shop' : 
                    typeOrQuery === 'restaurant' ? 'Restaurant' : 
                    typeOrQuery === 'hairdresser' ? 'Barber / Salon' : 
                    typeOrQuery === 'grocery_or_supermarket' ? 'Grocery Store' : 
                    typeOrQuery === 'pharmacy' ? 'Pharmacy' : 
                    typeOrQuery === 'gym' ? 'Gym / Fitness' : 
                    typeOrQuery
                );
                
                const { placeType, icon: pIcon, category } = resolvePlaceCategory(
                    pName,
                    [amenity],
                    { osmValue: amenity, amenity: tags.amenity, shop: tags.shop }
                );

                return {
                    id: `overpass-${el.id || i}`,
                    name: pName,
                    type: placeType,
                    category,
                    icon: pIcon,
                    location: {
                        lat: el.lat ?? el.center?.lat ?? 0,
                        lng: el.lon ?? el.center?.lon ?? 0
                    },
                    radius: 0.15,
                    brandColor: '#6366f1',
                    address: cleanAddress !== 'Nearby' ? cleanAddress : undefined,
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
            // NEVER synthesize or force-prepend queryHouseNum onto an unverified road centerline or intersection!
            const verifiedHouseNum = addr.house_number || '';
            const isIntersection = r.addresstype === 'intersection' || r.type === 'intersection';
            const isStreetOrRoad = r.class === 'highway' || r.addresstype === 'road' || !verifiedHouseNum;
            const hasVerifiedHouseNum = Boolean(verifiedHouseNum) && !isStreetOrRoad;
            const displayName = hasVerifiedHouseNum ? `${verifiedHouseNum} ${roadName}` : roadName;

            const city = addr.city || addr.town || addr.village || addr.hamlet || 'Fayetteville';
            const state = addr.state || 'NC';
            const cleanAddress = `${displayName}, ${city}, ${state}`;

            const { placeType, icon: pIcon, category } = resolvePlaceCategory(
                displayName,
                [r.type, r.class],
                { osmValue: r.type }
            );

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
                category,
                icon: pIcon,
                rating: 4.5,
                source: 'nominatim',
                houseNumber: hasVerifiedHouseNum ? verifiedHouseNum : undefined,
                isRooftop: hasVerifiedHouseNum,
                geocodePrecision: hasVerifiedHouseNum ? 'rooftop' : (isIntersection ? 'intersection' : 'street')
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
                                            const isIntersection = r.types?.includes('intersection');
                                            const isRouteOnly = (r.types?.includes('route') || r.geometry?.location_type === 'GEOMETRIC_CENTER' || r.geometry?.location_type === 'RANGE_INTERPOLATED' || r.geometry?.location_type === 'APPROXIMATE') && !hasVerifiedHouseNum;

                                            let mainText = pred.structured_formatting?.main_text || pred.description?.split(',')[0] || '';
                                            let formattedAddress = r.formatted_address || pred.description || mainText;

                                            // NEVER synthesize or force-prepend queryHouseNum onto an unverified road centerline or intersection!
                                            if (!hasVerifiedHouseNum) {
                                                const routeComp = r.address_components?.find((c: any) => c.types?.includes('route'));
                                                if (isRouteOnly || isIntersection) {
                                                    mainText = routeComp?.long_name || mainText.replace(/^\d+[a-zA-Z]?\s+/, '');
                                                    formattedAddress = formattedAddress.replace(/^\d+[a-zA-Z]?\s+/, '');
                                                }
                                            }

                                            const types = [...(pred.types || []), ...(r.types || [])];
                                            const { placeType, icon: pIcon, category } = resolvePlaceCategory(mainText, types);

                                            resResolve({
                                                id: `google-${pred.place_id}`,
                                                name: mainText,
                                                location: { lat, lng },
                                                radius: 0.15,
                                                type: placeType,
                                                category,
                                                icon: pIcon,
                                                brandColor: '#4285F4',
                                                description: formattedAddress,
                                                address: formattedAddress,
                                                rating: 4.5,
                                                houseNumber: hasVerifiedHouseNum ? (streetNumberComp?.long_name || streetNumberComp?.short_name) : undefined,
                                                isRooftop: hasVerifiedHouseNum,
                                                geocodePrecision: hasVerifiedHouseNum ? 'rooftop' : (isIntersection ? 'intersection' : 'street')
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
                            const correctedMapped = placeCorrectionService.applyCorrectionsToPlaces(validMapped);
                            const verifiedPlaces = await applyCommunityPinsToPlaces(correctedMapped);
                            const uniquePlaces = deduplicatePlaces(verifiedPlaces);
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
                            const isIntersection = res.types?.includes('intersection');
                            const isRouteOnly = (res.types?.includes('route') || res.geometry?.location_type === 'GEOMETRIC_CENTER' || res.geometry?.location_type === 'RANGE_INTERPOLATED' || res.geometry?.location_type === 'APPROXIMATE') && !hasVerifiedHouseNum;

                            let mainText = pred.structured_formatting?.main_text || pred.description?.split(',')[0] || '';
                            let formattedAddress = res.formatted_address || pred.description || mainText;

                            if (!hasVerifiedHouseNum && (isRouteOnly || isIntersection)) {
                                const routeComp = res.address_components?.find((c: any) => c.types?.includes('route'));
                                mainText = routeComp?.long_name || mainText.replace(/^\d+[a-zA-Z]?\s+/, '');
                                formattedAddress = formattedAddress.replace(/^\d+[a-zA-Z]?\s+/, '');
                            }

                            const types = [...(pred.types || []), ...(res.types || [])];
                            const { placeType, icon: pIcon, category } = resolvePlaceCategory(mainText, types);

                            return {
                                id: `google-${pred.place_id}`,
                                name: mainText,
                                location: { lat: loc.lat, lng: loc.lng },
                                radius: 0.15,
                                type: placeType,
                                category,
                                icon: pIcon,
                                brandColor: '#4285F4',
                                description: formattedAddress,
                                address: formattedAddress,
                                rating: 4.5,
                                houseNumber: hasVerifiedHouseNum ? (streetNumberComp?.long_name || streetNumberComp?.short_name) : undefined,
                                isRooftop: hasVerifiedHouseNum,
                                geocodePrecision: hasVerifiedHouseNum ? 'rooftop' : (isIntersection ? 'intersection' : 'street')
                            };
                        } catch {
                            return null;
                        }
                    })
                );

                const validMapped = resolvedPlaces.filter((p): p is Place => p !== null);
                if (validMapped.length > 0) {
                    const correctedMapped = placeCorrectionService.applyCorrectionsToPlaces(validMapped);
                    const verifiedPlaces = await applyCommunityPinsToPlaces(correctedMapped);
                    const uniquePlaces = deduplicatePlaces(verifiedPlaces);
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
                        const isIntersection = place.types?.includes('intersection');
                        const isRouteOnly = (place.types?.includes('route') || place.geometry?.location_type === 'GEOMETRIC_CENTER' || place.geometry?.location_type === 'RANGE_INTERPOLATED' || place.geometry?.location_type === 'APPROXIMATE') && !hasVerifiedHouseNum;

                        let formattedAddr = place.formatted_address || '';
                        let displayName = formattedAddr.split(',')[0] || '';

                        if (!hasVerifiedHouseNum && (isRouteOnly || isIntersection)) {
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
                            rating: 4.5,
                            houseNumber: hasVerifiedHouseNum ? (streetNumberComp?.long_name || streetNumberComp?.short_name) : undefined,
                            isRooftop: hasVerifiedHouseNum,
                            geocodePrecision: hasVerifiedHouseNum ? 'rooftop' : (isIntersection ? 'intersection' : 'street')
                        };
                    });

                    const correctedMapped = placeCorrectionService.applyCorrectionsToPlaces(mappedResults);
                    const verifiedPlaces = await applyCommunityPinsToPlaces(correctedMapped);
                    const uniquePlaces = deduplicatePlaces(verifiedPlaces);
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
    const correctedFallback = placeCorrectionService.applyCorrectionsToPlaces(fallbackResults);
    const verifiedFallback = await applyCommunityPinsToPlaces(correctedFallback);
    const uniqueFallbackPlaces = deduplicatePlaces(verifiedFallback);

    if (uniqueFallbackPlaces.length > 0) {
        setCachedResults(cacheKey, uniqueFallbackPlaces);
    }
    return uniqueFallbackPlaces;
};

export { applyCommunityPinsToPlaces };

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

/**
 * Search gas stations or EV charging stations along a route corridor.
 * Returns sorted list of stations with detour minutes and miles computed.
 */
export const searchGasStationsAlongRoute = async (
    routeGeometry: Array<{ lat: number; lng: number } | [number, number]> | undefined,
    userLocation?: { lat: number; lng: number } | null,
    isEv: boolean = false
): Promise<Place[]> => {
    const query = isEv ? 'EV charging station' : 'gas station';
    const icon = isEv ? '⚡' : '⛽';
    const brandColor = isEv ? '#10b981' : '#f59e0b';

    if (!routeGeometry || routeGeometry.length === 0) {
        const center = userLocation || DEFAULT_COORDS;
        const results = await searchViaProxy(center, query);
        return results.map(p => ({
            ...p,
            type: (isEv ? 'charging_station' : 'gas_station') as any,
            icon,
            brandColor
        }));
    }

    // Convert routeGeometry to normalized {lat, lng} array
    const normalizedCoords: Array<{ lat: number; lng: number }> = routeGeometry.map(pt => {
        if (Array.isArray(pt)) return { lng: pt[0], lat: pt[1] };
        return { lat: (pt as any).lat, lng: (pt as any).lng };
    });

    // Sample corridor anchor points along route (user location/start, 25%, 50%, 75%)
    const samplePoints: Array<{ lat: number; lng: number }> = [];
    if (userLocation) samplePoints.push(userLocation);
    const step = Math.max(1, Math.floor(normalizedCoords.length / 4));
    for (let i = 0; i < normalizedCoords.length; i += step) {
        samplePoints.push(normalizedCoords[i]);
    }

    try {
        const apiKey = getActiveGoogleKey();

        // 1. Google Places corridor search (if API key available)
        const googlePromises = (apiKey && !googleMapsAuthFailed)
            ? samplePoints.slice(0, 4).map(async (pt) => {
                try {
                    const gUrl = `${getGoogleApiBase()}/maps/api/place/nearbysearch/json?location=${pt.lat},${pt.lng}&radius=3500&type=${isEv ? 'charging_station' : 'gas_station'}&key=${apiKey}`;
                    const res = await fetch(gUrl, { signal: AbortSignal.timeout(3500) });
                    if (!res.ok) return [];
                    const data = await res.json();
                    if (!Array.isArray(data.results)) return [];
                    return data.results.map((r: any): Place => ({
                        id: `google-${r.place_id}`,
                        name: r.name,
                        location: { lat: r.geometry?.location?.lat, lng: r.geometry?.location?.lng },
                        radius: 0.15,
                        type: (isEv ? 'charging_station' : 'gas_station') as any,
                        icon,
                        brandColor,
                        rating: r.rating || 4.5,
                        address: r.vicinity || r.formatted_address,
                        description: r.vicinity || r.formatted_address,
                        category: isGasOrConvenienceBrand(r.name) ? 'Gas & Convenience' : 'Gas Station'
                    }));
                } catch {
                    return [];
                }
            })
            : [];

        // 2. High-speed OSM / Proxy corridor searches
        const osmPromises = samplePoints.slice(0, 4).map(pt => searchViaProxy(pt, query).catch(() => []));

        const [googleArrays, osmArrays] = await Promise.all([
            Promise.all(googlePromises),
            Promise.all(osmPromises)
        ]);
        const allResults = [...googleArrays.flat(), ...osmArrays.flat()];

        const seen = new Set<string>();
        const uniquePlaces: Place[] = [];

        for (const p of allResults) {
            if (!p.location || isNaN(p.location.lat) || isNaN(p.location.lng)) continue;

            const latKey = p.location.lat.toFixed(3);
            const lngKey = p.location.lng.toFixed(3);
            const coordKey = `${latKey}_${lngKey}`;
            const nameKey = p.name.toLowerCase().replace(/[^a-z0-9]/g, '');

            if (seen.has(nameKey) || seen.has(coordKey)) continue;
            seen.add(nameKey);
            seen.add(coordKey);

            // Compute exact minimum distance to route corridor
            let minMeters = Infinity;
            for (const coord of normalizedCoords) {
                const d = getDistanceMeters(p.location.lat, p.location.lng, coord.lat, coord.lng);
                if (d < minMeters) minMeters = d;
            }

            // Keep within 4 miles of the route corridor
            if (minMeters > 6400) continue;

            const detourMiles = Math.round((minMeters / 1609.34) * 2 * 10) / 10;
            const detourMinutes = Math.max(0, Math.round(detourMiles * 2.2));

            uniquePlaces.push({
                ...p,
                type: (isEv ? 'charging_station' : 'gas_station') as any,
                icon,
                brandColor,
                rating: p.rating || 4.5,
                detourMiles,
                detourMinutes,
                description: p.address || `${p.name} • +${detourMinutes} min detour`
            });

            if (uniquePlaces.length >= 20) break;
        }

        // Sort by fastest detour time (0 min detour first!)
        uniquePlaces.sort((a, b) => (a.detourMinutes || 0) - (b.detourMinutes || 0));

        // Enrich top 5 stations with real street addresses and brand names if missing
        await Promise.all(uniquePlaces.slice(0, 5).map(async (station) => {
            const hasValidAddress = station.address &&
                station.address !== 'Nearby' &&
                station.address !== station.name &&
                !/^\s*-?\d+\.\d+/.test(station.address) &&
                /\b(st|rd|ave|dr|blvd|hwy|pkwy|ln|way|ct|cir|ter|road|street|avenue|drive|boulevard|highway|parkway|lane)\b/i.test(station.address) &&
                station.address.length > 5;

            if (!hasValidAddress && station.location) {
                try {
                    const rev = await reverseGeocode(station.location);
                    if (rev) {
                        if (rev.address && !rev.address.startsWith('Location (') && !/^\s*-?\d+\.\d+/.test(rev.address)) {
                            const parts = rev.address.split(',');
                            const cleanStreet = parts.length >= 2
                                ? `${parts[0].trim()}, ${parts[1].trim()}`
                                : rev.address;
                            station.address = cleanStreet;
                            station.description = cleanStreet;
                        }
                        if ((station.name === 'Gas Station' || station.name === 'Nearby') && rev.name && rev.name !== 'Gas Station' && !rev.name.startsWith('Location (')) {
                            station.name = rev.name;
                        }
                    }
                } catch (err) {
                    console.debug('[PlacesService] Failed to reverse geocode station:', err);
                }
            }
        }));

        return uniquePlaces;
    } catch (e) {
        console.warn('[PlacesService] Failed to search gas stations along route:', e);
        return [];
    }
};

/**
 * Reverse-geocode geographic coordinates into a high-accuracy Place representation
 * Tier 1: Local community buildings cache (0ms instant lookup)
 * Tier 2: Google Maps Geocoder (SDK or REST)
 * Tier 3: Photon Fast OpenStreetMap reverse geocoder (instant sub-200ms)
 * Tier 4: Nominatim OpenStreetMap reverse geocoder fallback
 */
export async function reverseGeocode(
    coordinates: { lat: number; lng: number }
): Promise<Place | null> {
    if (!coordinates || typeof coordinates.lat !== 'number' || typeof coordinates.lng !== 'number') {
        return null;
    }

    const { lat, lng } = coordinates;

    // --- Tier 1: Local Community Buildings Lookup (~25m radius) ---
    try {
        const buildings = communityBuildingService.getAllBuildings();
        let closestBuilding: any = null;
        let minDistanceMeters = 25; // 25m proximity threshold for building footprints

        for (const b of buildings) {
            if (b && b.coordinates && typeof b.coordinates.lat === 'number' && typeof b.coordinates.lng === 'number') {
                const dist = getDistanceMeters(lat, lng, b.coordinates.lat, b.coordinates.lng);
                if (dist < minDistanceMeters) {
                    minDistanceMeters = dist;
                    closestBuilding = b;
                }
            }
        }

        if (closestBuilding) {
            const hn = closestBuilding.houseNumber || '';
            const addr = closestBuilding.address || `Building ${hn}`;
            return {
                id: `community-${closestBuilding.id || `${lat.toFixed(5)}_${lng.toFixed(5)}`}`,
                name: addr,
                address: addr,
                description: addr,
                location: closestBuilding.coordinates,
                radius: 0.15,
                houseNumber: hn,
                isRooftop: true,
                geocodePrecision: 'rooftop',
                type: 'search_result',
                icon: '📍',
                brandColor: '#6366f1'
            };
        }
    } catch (e) {
        console.debug('[PlacesService] Tier 1 community reverse geocode error:', e);
    }

    // --- Tier 2: Google Maps Geocoder (SDK or REST) ---
    const apiKey = getActiveGoogleKey();
    if (apiKey && !googleMapsAuthFailed) {
        try {
            await ensureGoogleMapsLoaded();
            if (typeof google !== 'undefined' && google.maps?.Geocoder) {
                const geocoder = new google.maps.Geocoder();
                const result = await new Promise<any>((resolve) => {
                    geocoder.geocode({ location: { lat, lng } }, (results, status) => {
                        if (status === 'OK' && results && results.length > 0) {
                            resolve(results[0]);
                        } else {
                            resolve(null);
                        }
                    });
                });

                if (result) {
                    const streetNumberComp = result.address_components?.find((c: any) => c.types?.includes('street_number'));
                    const routeComp = result.address_components?.find((c: any) => c.types?.includes('route'));
                    const isRooftop = result.geometry?.location_type === 'ROOFTOP';
                    const hasVerifiedHouseNum = Boolean(streetNumberComp?.long_name || streetNumberComp?.short_name) && isRooftop;
                    const resLoc = result.geometry?.location;
                    const resLat = typeof resLoc.lat === 'function' ? resLoc.lat() : resLoc.lat;
                    const resLng = typeof resLoc.lng === 'function' ? resLoc.lng() : resLoc.lng;

                    let displayName = result.formatted_address?.split(',')[0] || '';
                    if (!hasVerifiedHouseNum && routeComp) {
                        displayName = routeComp.long_name;
                    }

                    return {
                        id: `google-rev-${result.place_id || `${lat.toFixed(5)}_${lng.toFixed(5)}`}`,
                        name: displayName || result.formatted_address,
                        address: result.formatted_address,
                        description: result.formatted_address,
                        location: { lat: resLat, lng: resLng },
                        radius: 0.15,
                        houseNumber: hasVerifiedHouseNum ? (streetNumberComp?.long_name || streetNumberComp?.short_name) : undefined,
                        isRooftop: hasVerifiedHouseNum,
                        geocodePrecision: hasVerifiedHouseNum ? 'rooftop' : 'street',
                        type: 'search_result',
                        icon: '📍',
                        brandColor: '#4285F4'
                    };
                }
            }
        } catch (err) {
            console.debug('[PlacesService] Google SDK reverse geocode error:', err);
        }

        // REST fallback if SDK failed
        try {
            const apiBase = getGoogleApiBase();
            const url = `${apiBase}/maps/api/geocode/json?latlng=${lat},${lng}&key=${apiKey}`;
            const res = await fetch(url, { signal: AbortSignal.timeout(3500) });
            if (res.ok) {
                const data = await res.json();
                if (data.status === 'OK' && data.results && data.results.length > 0) {
                    const r = data.results[0];
                    const streetNumberComp = r.address_components?.find((c: any) => c.types?.includes('street_number'));
                    const routeComp = r.address_components?.find((c: any) => c.types?.includes('route'));
                    const isRooftop = r.geometry?.location_type === 'ROOFTOP';
                    const hasVerifiedHouseNum = Boolean(streetNumberComp?.long_name || streetNumberComp?.short_name) && isRooftop;
                    const loc = r.geometry?.location || { lat, lng };

                    let displayName = r.formatted_address?.split(',')[0] || '';
                    if (!hasVerifiedHouseNum && routeComp) {
                        displayName = routeComp.long_name;
                    }

                    return {
                        id: `google-rev-${r.place_id || `${lat.toFixed(5)}_${lng.toFixed(5)}`}`,
                        name: displayName || r.formatted_address,
                        address: r.formatted_address,
                        description: r.formatted_address,
                        location: { lat: loc.lat, lng: loc.lng },
                        radius: 0.15,
                        houseNumber: hasVerifiedHouseNum ? (streetNumberComp?.long_name || streetNumberComp?.short_name) : undefined,
                        isRooftop: hasVerifiedHouseNum,
                        geocodePrecision: hasVerifiedHouseNum ? 'rooftop' : 'street',
                        type: 'search_result',
                        icon: '📍',
                        brandColor: '#4285F4'
                    };
                }
            }
        } catch (err) {
            console.debug('[PlacesService] Google REST reverse geocode error:', err);
        }
    }

    // --- Tier 3: Photon Fast OpenStreetMap Reverse Geocoder (sub-200ms) ---
    try {
        const photonUrl = `https://photon.komoot.io/reverse?lat=${lat}&lon=${lng}`;
        const pRes = await fetch(photonUrl, { signal: AbortSignal.timeout(2500) });
        if (pRes.ok) {
            const pData = await pRes.json();
            const feat = pData.features?.[0];
            if (feat && feat.properties) {
                const props = feat.properties;
                const hn = props.housenumber;
                const road = props.street || '';
                const streetPart = hn && road ? `${hn} ${road}` : (road || '');
                const cityState = [props.city || props.district, props.state].filter(Boolean).join(', ');
                const cleanAddr = [streetPart, cityState].filter(Boolean).join(', ');
                const brandOrVenue = (props.name && !/^\d+$/.test(props.name)) ? props.name : '';
                const cleanName = brandOrVenue || streetPart || cityState || 'Nearby';

                if (cleanAddr) {
                    return {
                        id: `photon-rev-${props.osm_id || `${lat.toFixed(5)}_${lng.toFixed(5)}`}`,
                        name: cleanName,
                        address: cleanAddr,
                        description: cleanAddr,
                        location: {
                            lat: feat.geometry?.coordinates?.[1] || lat,
                            lng: feat.geometry?.coordinates?.[0] || lng
                        },
                        radius: 0.15,
                        houseNumber: hn || undefined,
                        isRooftop: Boolean(hn),
                        geocodePrecision: hn ? 'rooftop' : 'street',
                        type: 'search_result',
                        icon: '📍',
                        brandColor: '#6366f1'
                    };
                }
            }
        }
    } catch (e) {
        console.debug('[PlacesService] Photon reverse geocode error:', e);
    }

    // --- Tier 4: Nominatim Fallback ---
    try {
        const nomUrl = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1`;
        const nomRes = await fetch(nomUrl, { 
            headers: { 'Accept': 'application/json', 'User-Agent': 'MyWay-GPS/1.0' },
            signal: AbortSignal.timeout(3500)
        });
        if (nomRes.ok) {
            const nomData = await nomRes.json();
            if (nomData && nomData.address) {
                const addr = nomData.address;
                const hn = addr.house_number;
                const road = addr.road || addr.pedestrian || addr.suburb || addr.neighbourhood || '';
                const brandOrVenue = nomData.name || addr.amenity || addr.shop || '';
                const cleanName = brandOrVenue || (hn && road ? `${hn} ${road}` : (road || nomData.display_name?.split(',')[0] || 'Unknown Location'));
                const cityState = [addr.city || addr.town || addr.village || addr.hamlet, addr.state].filter(Boolean).join(', ');
                const streetPart = hn && road ? `${hn} ${road}` : (road || '');
                const cleanAddr = [streetPart, cityState].filter(Boolean).join(', ') || nomData.display_name;

                return {
                    id: `nominatim-rev-${nomData.place_id || `${lat.toFixed(5)}_${lng.toFixed(5)}`}`,
                    name: cleanName,
                    address: cleanAddr,
                    description: cleanAddr,
                    location: {
                        lat: parseFloat(nomData.lat) || lat,
                        lng: parseFloat(nomData.lon) || lng
                    },
                    radius: 0.15,
                    houseNumber: hn || undefined,
                    isRooftop: Boolean(hn),
                    geocodePrecision: hn ? 'rooftop' : 'street',
                    type: 'search_result',
                    icon: '📍',
                    brandColor: '#6366f1'
                };
            }
        }
    } catch (e) {
        console.debug('[PlacesService] Nominatim reverse geocode error:', e);
    }

    // Fallback: Return a coordinate-derived generic place
    return {
        id: `coord-${lat.toFixed(5)}_${lng.toFixed(5)}`,
        name: `Location (${lat.toFixed(4)}, ${lng.toFixed(4)})`,
        address: `${lat.toFixed(6)}, ${lng.toFixed(6)}`,
        description: `Coordinates: ${lat.toFixed(6)}, ${lng.toFixed(6)}`,
        location: { lat, lng },
        radius: 0.15,
        type: 'search_result',
        icon: '📍',
        brandColor: '#6366f1'
    };
}
