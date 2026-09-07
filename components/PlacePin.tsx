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
    LucideIcon
} from 'lucide-react';
import { Place } from '../types';

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
        Boolean(place.tags?.some(t => t.toLowerCase() === 'home')) ||
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
    if (iconStr === '🍔' || iconStr === 'food' || type === 'food' || cat === 'food' || type === 'restaurant' || type === 'dining') {
        return Utensils;
    }

    // Coffee / Cafe
    if (iconStr === '☕' || iconStr === 'coffee' || type === 'coffee' || cat === 'coffee' || type === 'cafe') {
        return Coffee;
    }

    // Grocery / Supermarket
    if (iconStr === '🛒' || iconStr === 'grocery' || type === 'grocery' || cat === 'grocery' || type === 'supermarket') {
        return ShoppingCart;
    }

    // Pharmacy / Medical
    if (iconStr === '💊' || iconStr === 'pharmacy' || type === 'pharmacy' || cat === 'pharmacy') {
        return Pill;
    }

    // Hospital / Emergency
    if (iconStr === '🏥' || iconStr === 'hospital' || type === 'hospital' || cat === 'hospital' || type === 'emergency' || cat === 'emergency') {
        return Hospital;
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
                {isHome && showLabel && (
                    <span className="text-[13px] font-bold text-white whitespace-nowrap leading-none tracking-tight">
                        Home
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
