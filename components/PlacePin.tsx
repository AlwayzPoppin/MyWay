import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
    Home,
    Briefcase,
    GraduationCap,
    Dumbbell,
    Fuel,
    Utensils,
    Coffee,
    ShoppingCart,
    Pill,
    Hospital,
    Shield,
    Flame,
    MapPin,
    Car,
    Wrench,
    Landmark,
    Hotel,
    Hammer,
    Sparkles,
    LucideIcon
} from 'lucide-react';
import { Place } from '../types';
import { getDistanceMeters, getDistanceFromCoords } from '../utils/geo';

/**
 * Check if a place represents a Home or Residential location
 */
export function isHomePlace(place: Partial<Place> | null | undefined): boolean {
    if (!place) return false;
    const typeLower = (place.type || '').toLowerCase();
    const catLower = (place.category || '').toLowerCase();
    const nameLower = (place.name || '').trim().toLowerCase();
    const iconLower = (place.icon || '').toLowerCase();

    return (
        typeLower === 'home' ||
        typeLower === 'residential' ||
        catLower === 'home' ||
        catLower === 'residential' ||
        nameLower === 'home' ||
        nameLower === 'my home' ||
        Boolean((place as any).tags?.some((t: string) => t.toLowerCase() === 'home')) ||
        iconLower === '🏠' ||
        iconLower === 'home'
    );
}

/**
 * Get curated theme color for a place category
 */
export function getPlaceColor(place: Partial<Place>): string {
    if (place.brandColor) return place.brandColor;
    if ((place as any).color) return (place as any).color;
    if (isHomePlace(place)) return '#8b5cf6'; // Purple

    const type = (place.type || '').toLowerCase();
    const cat = (place.category || '').toLowerCase();

    if (type === 'parked_vehicle' || cat === 'parked_vehicle') return '#06b6d4'; // Cyan for Parked Vehicle
    if (type === 'work' || cat === 'work' || type === 'office') return '#3b82f6'; // Blue
    if (type === 'school' || cat === 'school' || type === 'education') return '#f59e0b'; // Amber
    if (type === 'gym' || cat === 'gym' || type === 'fitness') return '#ec4899'; // Pink
    if (type === 'gas' || cat === 'gas' || type === 'fuel') return '#f97316'; // Orange
    if (type === 'food' || cat === 'food' || type === 'restaurant') return '#ef4444'; // Red
    if (type === 'coffee' || cat === 'coffee' || type === 'cafe') return '#a855f7'; // Purple
    if (type === 'fire_station' || cat === 'fire_station') return '#dc2626'; // Deep Red
    if (type === 'hospital' || cat === 'hospital' || type === 'emergency' || cat === 'emergency') return '#e11d48'; // Rose
    if (type === 'police' || cat === 'police') return '#2563eb'; // Deep Blue
    if (type === 'grocery' || cat === 'grocery' || type === 'supermarket') return '#10b981'; // Emerald
    if (type === 'pharmacy' || cat === 'pharmacy') return '#06b6d4'; // Cyan
    if (type === 'maintenance' || type === 'mechanic' || cat.includes('auto') || cat.includes('repair') || cat.includes('oil') || cat.includes('service') || cat.includes('parts')) return '#0284c7'; // Sky Blue
    if (cat.includes('bank') || cat.includes('atm')) return '#059669'; // Emerald Green
    if (cat.includes('hotel') || cat.includes('lodging')) return '#6366f1'; // Indigo
    if (cat.includes('hardware') || cat.includes('home improvement')) return '#ea580c'; // Rust Orange
    if (cat.includes('barber') || cat.includes('salon')) return '#8b5cf6'; // Purple

    return '#8b5cf6'; // Default Purple
}

/**
 * Map place types, categories, and emojis to Lucide React SVG icon components
 */
export function getPlaceLucideIcon(place: Partial<Place>): LucideIcon {
    if (isHomePlace(place)) return Home;

    const iconStr = (place.icon || '').toLowerCase();
    const type = (place.type || '').toLowerCase();
    const cat = (place.category || '').toLowerCase();
    const name = (place.name || '').toLowerCase();

    // Parked Vehicle
    if (type === 'parked_vehicle' || cat === 'parked_vehicle' || iconStr === '🚗' || iconStr === 'car' || name.includes('parked vehicle')) {
        return Car;
    }

    // Work / Office
    if (iconStr === '💼' || iconStr === 'work' || type === 'work' || cat === 'work' || type === 'office') {
        return Briefcase;
    }

    // School / University
    if (iconStr === '🏫' || iconStr === 'school' || type === 'school' || cat === 'school' || type === 'education' || type === 'college') {
        return GraduationCap;
    }

    // Gym / Fitness
    if (iconStr === '💪' || iconStr === '🏋️' || iconStr === 'gym' || type === 'gym' || cat === 'gym' || type === 'fitness') {
        return Dumbbell;
    }

    // Gas / Fuel
    if (iconStr === '⛽' || iconStr === 'gas' || type === 'gas' || cat === 'gas' || type === 'fuel') {
        return Fuel;
    }

    // Food / Restaurant
    if (iconStr === '🍔' || iconStr === 'food' || type === 'food' || cat === 'food' || type === 'restaurant' || type === 'dining' || iconStr === '🍕' || iconStr === '🌮' || iconStr === '🍗' || iconStr === '🥡' || iconStr === '🍣') {
        return Utensils;
    }

    // Coffee / Cafe
    if (iconStr === '☕' || iconStr === 'coffee' || type === 'coffee' || cat === 'coffee' || type === 'cafe') {
        return Coffee;
    }

    // Auto Service & Parts / Mechanic
    if (iconStr === '🔧' || iconStr === 'wrench' || iconStr === '🚿' || type === 'maintenance' || type === 'mechanic' || cat.includes('auto') || cat.includes('repair') || cat.includes('parts')) {
        return Wrench;
    }

    // Grocery / Supermarket
    if (iconStr === '🛒' || iconStr === 'grocery' || type === 'grocery' || cat === 'grocery' || type === 'supermarket') {
        return ShoppingCart;
    }

    // Pharmacy / Medical
    if (iconStr === '💊' || iconStr === 'pharmacy' || type === 'pharmacy' || cat === 'pharmacy') {
        return Pill;
    }

    // Hospital / Emergency / Urgent Care
    if (iconStr === '🏥' || iconStr === 'hospital' || type === 'hospital' || cat === 'hospital' || type === 'emergency' || cat === 'emergency') {
        return Hospital;
    }

    // Bank / ATM
    if (iconStr === '🏦' || cat.includes('bank') || cat.includes('atm')) {
        return Landmark;
    }

    // Hotel / Lodging
    if (iconStr === '🏨' || cat.includes('hotel') || cat.includes('lodging')) {
        return Hotel;
    }

    // Home Improvement / Hardware
    if (iconStr === '🔨' || cat.includes('hardware') || cat.includes('home improvement')) {
        return Hammer;
    }

    // Barber / Salon
    if (iconStr === '💈' || cat.includes('barber') || cat.includes('salon')) {
        return Sparkles;
    }

    // Police
    if (iconStr === '🚓' || iconStr === 'police' || type === 'police' || cat === 'police') {
        return Shield;
    }

    // Fire Station
    if (iconStr === '🚒' || iconStr === 'fire_station' || type === 'fire_station' || cat === 'fire_station') {
        return Flame;
    }

    return MapPin;
}

/**
 * Returns crisp SVG markup for the place icon, ready to embed in MapLibre HTML markers
 */
export function getPlaceIconSvg(
    place: Partial<Place>,
    isSelected: boolean = false,
    className: string = 'w-4 h-4 text-white'
): string {
    const IconComp = getPlaceLucideIcon(place);
    const size = isSelected ? 18 : 16;
    return renderToStaticMarkup(
        React.createElement(IconComp, {
            size,
            color: '#ffffff',
            className: `${className} shrink-0`,
            strokeWidth: 2.2,
        })
    );
}

/**
 * Resolves the cleanest street address snippet (e.g. "5610 Carson Dr")
 * from place properties, userProfile home addresses, nearby saved places,
 * or cached reverse-geocoded data.
 */
export function resolvePlaceAddressSnippet(
    place: Partial<Place>,
    userProfile?: any,
    savedPlaces?: Place[],
    cachedAddresses?: Map<string, string>
): string {
    if (!place) return '';

    // 1. Direct place properties
    const directCandidates = [
        place.address,
        (place as any).street,
        (place as any).formattedAddress,
        (place as any).subtitle,
        (place as any).road,
        place.location?.label,
        (place.location as any)?.address,
        place.description
    ];

    for (const cand of directCandidates) {
        if (typeof cand === 'string' && cand.trim().length > 0) {
            // Clean common prefixes like "Home - ", "Home: "
            const cleaned = cand.replace(/^(?:home|work|office|school)\s*[-:–—·]\s*/i, '').trim();
            const firstPart = cleaned.split(',')[0]?.trim();
            if (firstPart && firstPart.length > 0) {
                return firstPart;
            }
        }
    }

    // Combined house number + street name fallback
    if (place.houseNumber && ((place as any).street || (place as any).road)) {
        const st = ((place as any).street || (place as any).road || '').trim();
        if (st) {
            return `${place.houseNumber.trim()} ${st}`;
        }
    }

    // 2. User profile Home address fallback ONLY if this represents the user's primary home
    const isHome = isHomePlace(place);
    if (isHome && userProfile?.preciseHomeLocation) {
        const phLoc = userProfile.preciseHomeLocation;
        const isNearProfileHome = !place.location || (
            typeof phLoc.lat === 'number' && typeof phLoc.lng === 'number' &&
            typeof place.location.lat === 'number' && typeof place.location.lng === 'number' &&
            getDistanceFromCoords(place.location.lat, place.location.lng, phLoc.lat, phLoc.lng) < 60
        );
        if (isNearProfileHome) {
            const profileHomeCandidates = [
                (userProfile?.preciseHomeLocation as any)?.address,
                (userProfile?.homeLocation as any)?.address,
                (userProfile as any)?.homeAddress
            ];
            for (const cand of profileHomeCandidates) {
                if (typeof cand === 'string' && cand.trim().length > 0) {
                    const cleaned = cand.replace(/^(?:home|work|office|school)\s*[-:–—·]\s*/i, '').trim();
                    const firstPart = cleaned.split(',')[0]?.trim();
                    if (firstPart && firstPart.length > 0) {
                        return firstPart;
                    }
                }
            }
        }
    }

    // 3. Proximity matching against saved places with addresses (strictly within 35m)
    if (place.location && typeof place.location.lat === 'number' && typeof place.location.lng === 'number' && savedPlaces && savedPlaces.length > 0) {
        for (const sp of savedPlaces) {
            if (!sp || sp.id === place.id) continue;
            const spAddr = sp.address || (sp as any).street || (sp as any).formattedAddress || sp.description;
            if (spAddr && sp.location && typeof sp.location.lat === 'number' && typeof sp.location.lng === 'number') {
                const dist = getDistanceFromCoords(place.location.lat, place.location.lng, sp.location.lat, sp.location.lng);
                if (dist < 35) {
                    const cleaned = spAddr.replace(/^(?:home|work|office|school)\s*[-:–—·]\s*/i, '').trim();
                    const firstPart = cleaned.split(',')[0]?.trim();
                    if (firstPart) return firstPart;
                }
            }
        }
    }

    // 4. In-memory cached reverse-geocoded address
    if (place.id && cachedAddresses && cachedAddresses.has(place.id)) {
        const cached = cachedAddresses.get(place.id);
        if (cached) {
            const firstPart = cached.split(',')[0]?.trim();
            if (firstPart) return firstPart;
        }
    }

    return '';
}

/**
 * Formats the combined marker label following the standard pattern:
 * "${displayName}${displayAddress ? ` · ${displayAddress}` : ''}"
 * If displayName already equals or contains the address snippet, avoids duplication.
 */
export function formatPlaceMarkerLabel(placeName?: string | null, addressSnippet?: string | null): string {
    const cleanName = (placeName || '').trim() || 'Saved Place';
    if (!addressSnippet || !addressSnippet.trim()) {
        return cleanName;
    }
    const cleanSnippet = addressSnippet.trim();

    // 1. Direct or lowercase substring match
    const lowerName = cleanName.toLowerCase();
    const lowerSnippet = cleanSnippet.toLowerCase();
    if (lowerName === lowerSnippet || lowerName.includes(lowerSnippet) || lowerSnippet.includes(lowerName)) {
        return cleanName;
    }

    // 2. Normalized alphanumeric match (ignores punctuation/spaces/abbreviations)
    const normPlaceName = lowerName.replace(/[^a-z0-9]/g, '');
    const normSnippet = lowerSnippet.replace(/[^a-z0-9]/g, '');
    if (normPlaceName === normSnippet || normPlaceName.includes(normSnippet) || normSnippet.includes(normPlaceName)) {
        return cleanName;
    }

    // 3. Word token prefix match (e.g. "417 Santa Fe Drive" and "417 Santa Fe")
    const nameWords = lowerName.split(/\s+/).filter(Boolean);
    const snippetWords = lowerSnippet.split(/\s+/).filter(Boolean);
    if (nameWords.length >= 2 && snippetWords.length >= 2) {
        if (nameWords[0] === snippetWords[0] && nameWords[1] === snippetWords[1]) {
            return cleanName;
        }
    }

    return `${cleanName} · ${cleanSnippet}`;
}

export interface PlacePinProps {
    place: Partial<Place>;
    isSelected?: boolean;
    className?: string;
    showLabel?: boolean;
    onClick?: (e: React.MouseEvent) => void;
}

/**
 * PlacePin Component
 * Renders consistent SVG place badges and pills across React UI overlays and Map views.
 */
export const PlacePin: React.FC<PlacePinProps> = ({
    place,
    isSelected = false,
    className = '',
    showLabel = true,
    onClick,
}) => {
    const isHome = isHomePlace(place);
    const placeColor = getPlaceColor(place);
    const IconComp = getPlaceLucideIcon(place);
    const iconSize = isSelected ? 18 : 16;
    const displayName = place.name || (place as any).title || (isHome ? 'Home' : 'Place');
    const directAddress = place.address || (place as any).formattedAddress || (place as any).street || '';
    const addressSnippet = resolvePlaceAddressSnippet(place) || directAddress;
    const displayLabel = formatPlaceMarkerLabel(displayName, addressSnippet);

    return (
        <div
            onClick={onClick}
            className={`relative inline-flex flex-col items-center cursor-pointer transition-transform select-none ${className}`}
        >
            {/* Pill Container */}
            <div
                className="relative flex items-center justify-center gap-1.5 px-2.5 rounded-full border border-white shadow-md transition-all"
                style={{
                    backgroundColor: placeColor,
                    height: isSelected ? '40px' : '36px',
                    minWidth: '40px',
                    borderWidth: isSelected ? '3px' : '2.5px',
                    borderColor: '#ffffff',
                    boxShadow: isSelected
                        ? `0 6px 20px rgba(0,0,0,0.5), 0 0 14px ${placeColor}`
                        : '0 4px 14px rgba(0,0,0,0.35)',
                }}
            >
                <IconComp
                    size={iconSize}
                    color="#ffffff"
                    className="w-4 h-4 text-white shrink-0"
                    strokeWidth={2.2}
                />
                {showLabel && (isHome || place.isSaved) && (
                    <span className="text-[13px] font-bold text-white whitespace-nowrap leading-none tracking-tight">
                        {displayLabel}
                    </span>
                )}
            </div>

            {/* Needle Pointer */}
            <svg
                width="14"
                height="9"
                viewBox="0 0 14 9"
                className="block -mt-[2.5px] z-[1] drop-shadow-[0_2px_4px_rgba(0,0,0,0.45)] overflow-visible"
            >
                <polygon points="1,0 7,8 13,0" fill={placeColor} />
                <polyline
                    points="1,0 7,8 13,0"
                    fill="none"
                    stroke="#ffffff"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                />
            </svg>
        </div>
    );
};

export default PlacePin;
