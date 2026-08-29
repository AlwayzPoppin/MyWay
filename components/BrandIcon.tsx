import React from 'react';
import { getBrandMeta } from '../services/brandLogoService';

interface BrandIconProps {
    placeName?: string;
    defaultIcon?: string;
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

    return (
        <span
            className={`shrink-0 flex items-center justify-center bg-white/5 border border-white/10 ${sizeClasses} ${className}`}
        >
            {defaultIcon}
        </span>
    );
};

export default BrandIcon;
