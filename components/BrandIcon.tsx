import React, { ReactNode } from 'react';
import { getBrandMeta } from '../services/brandLogoService';
import { 
    MapPin, 
    Home, 
    Briefcase, 
    GraduationCap, 
    Dumbbell, 
    Utensils, 
    Coffee, 
    Fuel 
} from 'lucide-react';

interface BrandIconProps {
    placeName?: string;
    defaultIcon?: string | ReactNode;
    className?: string;
    size?: 'sm' | 'md' | 'lg' | 'xl';
}

const BrandIcon: React.FC<BrandIconProps> = ({
    placeName,
    defaultIcon = '📍',
    className = '',
    size = 'md'
}) => {
    const brand = getBrandMeta(placeName);

    const sizeClasses = {
        sm: 'w-6 h-6 text-sm rounded-lg',
        md: 'w-8 h-8 text-lg rounded-xl',
        lg: 'w-10 h-10 text-xl rounded-2xl',
        xl: 'w-12 h-12 text-2xl rounded-2xl'
    }[size];

    if (brand) {
        return (
            <div
                className={`shrink-0 flex items-center justify-center p-1.5 shadow-md border overflow-hidden transition-transform ${sizeClasses} ${className}`}
                style={{
                    backgroundColor: brand.bg,
                    borderColor: brand.border
                }}
                title={brand.name}
            >
                <div
                    className="w-full h-full flex items-center justify-center pointer-events-none"
                    dangerouslySetInnerHTML={{ __html: brand.svg }}
                />
            </div>
        );
    }

    const renderIcon = () => {
        if (React.isValidElement(defaultIcon)) {
            return defaultIcon;
        }
        const iconStr = typeof defaultIcon === 'string' ? defaultIcon : '';
        const iconClasses = size === 'sm' ? 'w-3.5 h-3.5' : size === 'lg' ? 'w-5 h-5' : size === 'xl' ? 'w-6 h-6' : 'w-4 h-4';

        switch (iconStr) {
            case '🏠':
            case 'home':
            case 'residential':
                return <Home className={`${iconClasses} text-indigo-400 shrink-0`} />;
            case '💼':
            case 'work':
                return <Briefcase className={`${iconClasses} text-indigo-400 shrink-0`} />;
            case '🏫':
            case 'school':
                return <GraduationCap className={`${iconClasses} text-indigo-400 shrink-0`} />;
            case '🏋️':
            case 'gym':
                return <Dumbbell className={`${iconClasses} text-indigo-400 shrink-0`} />;
            case '🍔':
            case 'food':
                return <Utensils className={`${iconClasses} text-indigo-400 shrink-0`} />;
            case '☕':
            case 'coffee':
                return <Coffee className={`${iconClasses} text-indigo-400 shrink-0`} />;
            case '⛽':
            case 'gas':
                return <Fuel className={`${iconClasses} text-indigo-400 shrink-0`} />;
            default:
                return <MapPin className={`${iconClasses} text-indigo-400 shrink-0`} />;
        }
    };

    return (
        <span
            className={`shrink-0 flex items-center justify-center bg-white/5 border border-white/10 ${sizeClasses} ${className}`}
        >
            {renderIcon()}
        </span>
    );
};

export default BrandIcon;
