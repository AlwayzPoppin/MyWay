/**
 * GTA V Radar Blip Icons Service
 * 
 * Generates authentic Grand Theft Auto V radar minimap blips for places,
 * player markers, safehouses, and navigation waypoints.
 */

export const GTA_RADAR_COLORS = {
    radarBg: '#1e2530',
    radarBorder: '#0b0f14',
    freewayYellow: '#f59e0b',
    waypointGold: '#facc15',
    safehouseWhite: '#ffffff',
    missionPurple: '#a855f7',
    policeBlue: '#3b82f6',
    healthGreen: '#22c55e'
};

/**
 * Returns an authentic GTA V Minimap Blip SVG HTML based on place type / name
 */
export const getGTAPlaceBlipHtml = (type?: string, name?: string): string => {
    const t = (type || '').toLowerCase();
    const n = (name || '').toLowerCase();

    // 1. Home / Safehouse
    if (t === 'home' || n.includes('home') || n.includes('safehouse') || n.includes('apartment') || n.includes('house')) {
        return `
            <div style="
                width: 32px; height: 32px;
                background: #111827;
                border: 2px solid #ffffff;
                border-radius: 6px;
                box-shadow: 0 4px 12px rgba(0,0,0,0.8), 0 0 8px rgba(255,255,255,0.4);
                display: flex; align-items: center; justify-content: center;
                cursor: pointer;
            ">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="#ffffff">
                    <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/>
                </svg>
            </div>
        `;
    }

    // 2. Gas Station / Fuel
    if (t === 'gas' || t === 'gas_station' || n.includes('gas') || n.includes('fuel') || n.includes('shell') || n.includes('bp') || n.includes('exxon') || n.includes('citgo') || n.includes('chevron')) {
        return `
            <div style="
                width: 32px; height: 32px;
                background: #111827;
                border: 2px solid #fbbf24;
                border-radius: 6px;
                box-shadow: 0 4px 12px rgba(0,0,0,0.8), 0 0 8px rgba(251,191,36,0.5);
                display: flex; align-items: center; justify-content: center;
                cursor: pointer;
            ">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="#fbbf24">
                    <path d="M19.77 7.23l.01-.01-3.72-3.72L15 4.56l2.11 2.11c-.94.36-1.61 1.26-1.61 2.33 0 1.38 1.12 2.5 2.5 2.5.36 0 .69-.08 1-.22v5.72c0 .55-.45 1-1 1s-1-.45-1-1V14c0-1.1-.9-2-2-2h-1V5c0-1.1-.9-2-2-2H6c-1.1 0-2 .9-2 2v16h10v-7.5h1.5v5c0 1.38 1.12 2.5 2.5 2.5s2.5-1.12 2.5-2.5V9c0-.69-.28-1.32-.73-1.77zM12 10H6V5h6v5zm6 0c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1z"/>
                </svg>
            </div>
        `;
    }

    // 3. Restaurant / Food / Burgers / Diner
    if (t === 'food' || t === 'restaurant' || n.includes('food') || n.includes('burger') || n.includes('china') || n.includes('wok') || n.includes('taco') || n.includes('pizza') || n.includes('mcdonald') || n.includes('wendy') || n.includes('diner') || n.includes('grill')) {
        return `
            <div style="
                width: 32px; height: 32px;
                background: #111827;
                border: 2px solid #f97316;
                border-radius: 6px;
                box-shadow: 0 4px 12px rgba(0,0,0,0.8), 0 0 8px rgba(249,115,22,0.5);
                display: flex; align-items: center; justify-content: center;
                cursor: pointer;
            ">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="#f97316">
                    <path d="M11 9H9V2H7v7H5V2H3v7c0 2.12 1.66 3.84 3.75 3.97V22h2.5v-9.03C11.34 12.84 13 11.12 13 9V2h-2v7zm5-3v8h2.5v8H21V2c-2.76 0-5 2.24-5 4z"/>
                </svg>
            </div>
        `;
    }

    // 4. Cafe / Coffee
    if (t === 'coffee' || t === 'cafe' || n.includes('coffee') || n.includes('starbucks') || n.includes('dunkin') || n.includes('cafe')) {
        return `
            <div style="
                width: 32px; height: 32px;
                background: #111827;
                border: 2px solid #38bdf8;
                border-radius: 6px;
                box-shadow: 0 4px 12px rgba(0,0,0,0.8), 0 0 8px rgba(56,189,248,0.5);
                display: flex; align-items: center; justify-content: center;
                cursor: pointer;
            ">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="#38bdf8">
                    <path d="M20 3H4v10c0 2.21 1.79 4 4 4h6c2.21 0 4-1.79 4-4v-3h2c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 5h-2V5h2v3zM4 19h16v2H4z"/>
                </svg>
            </div>
        `;
    }

    // 5. Barber / Salon / Hair
    if (t === 'hairdresser' || n.includes('barber') || n.includes('salon') || n.includes('hair') || n.includes('cuts') || n.includes('fade')) {
        return `
            <div style="
                width: 32px; height: 32px;
                background: #111827;
                border: 2px solid #e2e8f0;
                border-radius: 6px;
                box-shadow: 0 4px 12px rgba(0,0,0,0.8), 0 0 8px rgba(226,232,240,0.4);
                display: flex; align-items: center; justify-content: center;
                cursor: pointer;
            ">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="#ffffff">
                    <path d="M9.64 7.64c.23-.5.36-1.05.36-1.64 0-2.21-1.79-4-4-4S2 3.79 2 6s1.79 4 4 4c.59 0 1.14-.13 1.64-.36L10 12l-2.36 2.36C7.14 14.13 6.59 14 6 14c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4c0-.59-.13-1.14-.36-1.64L12 14l7 7h3v-1L9.64 7.64zM6 8c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm0 12c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm6-7.5c-.28 0-.5-.22-.5-.5s.22-.5.5-.5.5.22.5.5-.22.5-.5.5zM19 3l-6 6 2 2 7-7V3h-3z"/>
                </svg>
            </div>
        `;
    }

    // 6. Medical / Pharmacy / Hospital
    if (t === 'pharmacy' || n.includes('pharmacy') || n.includes('hospital') || n.includes('clinic') || n.includes('walgreens') || n.includes('cvs') || n.includes('urgent')) {
        return `
            <div style="
                width: 32px; height: 32px;
                background: #111827;
                border: 2px solid #ef4444;
                border-radius: 6px;
                box-shadow: 0 4px 12px rgba(0,0,0,0.8), 0 0 8px rgba(239,68,68,0.5);
                display: flex; align-items: center; justify-content: center;
                cursor: pointer;
            ">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="#ef4444">
                    <path d="M19 10.5h-5.5V5h-3v5.5H5v3h5.5V19h3v-5.5H19z"/>
                </svg>
            </div>
        `;
    }

    // 7. Gym / Fitness
    if (t === 'gym' || n.includes('gym') || n.includes('fitness') || n.includes('workout') || n.includes('planet fitness')) {
        return `
            <div style="
                width: 32px; height: 32px;
                background: #111827;
                border: 2px solid #a855f7;
                border-radius: 6px;
                box-shadow: 0 4px 12px rgba(0,0,0,0.8), 0 0 8px rgba(168,85,247,0.5);
                display: flex; align-items: center; justify-content: center;
                cursor: pointer;
            ">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="#a855f7">
                    <path d="M20.57 14.86L22 13.43 20.57 12 17 15.57 8.43 7 12 3.43 10.57 2 9.14 3.43 7.71 2 5.57 4.14 4.14 2.71 2.71 4.14l1.43 1.43L2 7.71l1.43 1.43L2 10.57 3.43 12 7 8.43 15.57 17 12 20.57 13.43 22l1.43-1.43L16.29 22l2.14-2.14 1.43 1.43 1.43-1.43-1.43-1.43L22 16.29z"/>
                </svg>
            </div>
        `;
    }

    // 8. Supermarket / Grocery / Store
    if (t === 'supermarket' || t === 'grocery_or_supermarket' || n.includes('walmart') || n.includes('target') || n.includes('grocery') || n.includes('market') || n.includes('food lion') || n.includes('kroger') || n.includes('publix')) {
        return `
            <div style="
                width: 32px; height: 32px;
                background: #111827;
                border: 2px solid #10b981;
                border-radius: 6px;
                box-shadow: 0 4px 12px rgba(0,0,0,0.8), 0 0 8px rgba(160,185,129,0.5);
                display: flex; align-items: center; justify-content: center;
                cursor: pointer;
            ">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="#10b981">
                    <path d="M7 18c-1.1 0-1.99.9-1.99 2S5.9 22 7 22s2-.9 2-2-.9-2-2-2zM1 2v2h2l3.6 7.59-1.35 2.45c-.16.28-.25.61-.25.96 0 1.1.9 2 2 2h12v-2H7.42c-.14 0-.25-.11-.25-.25l.03-.12.9-1.63h7.45c.75 0 1.41-.41 1.75-1.03l3.58-6.49c.08-.14.12-.31.12-.48 0-.55-.45-1-1-1H5.21l-.94-2H1zm16 16c-1.1 0-1.99.9-1.99 2s.89 2 1.99 2 2-.9 2-2-.9-2-2-2z"/>
                </svg>
            </div>
        `;
    }

    // 9. Default GTA Waypoint Diamond / Dot Blip
    return `
        <div style="
            width: 28px; height: 28px;
            background: #111827;
            border: 2px solid #facc15;
            border-radius: 6px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.8), 0 0 8px rgba(250,204,21,0.5);
            display: flex; align-items: center; justify-content: center;
            cursor: pointer;
        ">
            <div style="width: 10px; height: 10px; background: #facc15; transform: rotate(45deg); border-radius: 1px;"></div>
        </div>
    `;
};

/**
 * Returns the iconic GTA V Navigation Destination Pin (Vibrant Golden Diamond Crosshair)
 */
export const getGTADestinationPinHtml = (): string => {
    return `
        <div style="position: relative; width: 44px; height: 44px; display: flex; align-items: center; justify-content: center;">
            <div style="
                position: absolute; width: 44px; height: 44px;
                border: 2px solid #facc15;
                border-radius: 50%;
                animation: pulse 2s infinite ease-out;
                opacity: 0.8;
            "></div>
            <div style="
                width: 28px; height: 28px;
                background: #111827;
                border: 3px solid #facc15;
                box-shadow: 0 0 16px rgba(250,204,21,0.9), 0 4px 12px rgba(0,0,0,0.9);
                transform: rotate(45deg);
                display: flex; align-items: center; justify-content: center;
            ">
                <div style="width: 10px; height: 10px; background: #facc15; border-radius: 1px;"></div>
            </div>
        </div>
    `;
};
