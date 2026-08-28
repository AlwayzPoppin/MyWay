import { Location, RouteStep } from '../types';

export interface TollFacility {
    name: string;
    pattern: RegExp;
    typicalCost: number;
    state?: string;
    description?: string;
}

export interface TollAnalysis {
    hasTolls: boolean;
    estimatedTolls: number;
    tollCostEstimate: string;
    tollSummary: string;
    tollPlazas: Array<{ name: string; cost: number }>;
    tollFree: boolean;
}

/**
 * Curated database of major North American toll roads, turnpikes, express lanes, and toll bridges/tunnels
 */
export const KNOWN_TOLL_FACILITIES: TollFacility[] = [
    // --- New Jersey ---
    { name: 'New Jersey Turnpike (I-95)', pattern: /new jersey turnpike|nj turnpike/i, typicalCost: 19.50, state: 'NJ' },
    { name: 'Garden State Parkway', pattern: /garden state parkway/i, typicalCost: 10.50, state: 'NJ' },
    { name: 'Atlantic City Expressway', pattern: /atlantic city expressway/i, typicalCost: 4.75, state: 'NJ' },

    // --- New York ---
    { name: 'NYC Crossing (Verrazzano/GWB/Lincoln/Holland/Goethals)', pattern: /verrazzano|george washington bridge|lincoln tunnel|holland tunnel|goethals bridge|outerbridge|bayonne bridge/i, typicalCost: 17.60, state: 'NY' },
    { name: 'NYC East River Crossing (RFK/Whitestone/Throgs Neck)', pattern: /triborough|rfk bridge|whitestone bridge|throgs neck bridge|queens midtown|hugh l\. carey|brooklyn-battery/i, typicalCost: 10.17, state: 'NY' },
    { name: 'Gov. Mario M. Cuomo (Tappan Zee) Bridge', pattern: /mario m\. cuomo|tappan zee/i, typicalCost: 7.75, state: 'NY' },
    { name: 'New York State Thruway (I-87/I-90)', pattern: /new york (state )?thruway|nys thruway/i, typicalCost: 14.00, state: 'NY' },

    // --- Delaware & Maryland ---
    { name: 'Delaware Memorial Bridge & DE Turnpike', pattern: /delaware memorial bridge|delaware turnpike/i, typicalCost: 9.00, state: 'DE' },
    { name: 'JFK Memorial Hwy & MD I-95 Toll', pattern: /john f\. kennedy memorial highway|jfk memorial hwy/i, typicalCost: 8.00, state: 'MD' },
    { name: 'Baltimore Harbor / Fort McHenry Tunnel', pattern: /baltimore harbor tunnel|fort mchenry tunnel|i-895 toll/i, typicalCost: 4.00, state: 'MD' },
    { name: 'Chesapeake Bay Bridge (US 50/301)', pattern: /chesapeake bay bridge|william preston lane/i, typicalCost: 4.00, state: 'MD' },
    { name: 'Chesapeake Bay Bridge-Tunnel (US 13)', pattern: /chesapeake bay bridge-tunnel|bay bridge-tunnel/i, typicalCost: 18.00, state: 'VA' },

    // --- Virginia & DC ---
    { name: 'Dulles Toll Road & Greenway', pattern: /dulles toll road|dulles greenway/i, typicalCost: 6.00, state: 'VA' },
    { name: 'Virginia Express Lanes (I-95/I-495/I-66)', pattern: /express lanes|i-95 express|i-495 express|i-66 express/i, typicalCost: 5.50, state: 'VA' },
    { name: 'Pocahontas Parkway / Richmond Tollway', pattern: /pocahontas parkway|richmond-petersburg turnpike|powhite parkway/i, typicalCost: 4.50, state: 'VA' },

    // --- North Carolina ---
    { name: 'Triangle Expressway (NC 540) & Monroe Expressway', pattern: /triangle expressway|nc 540 toll|monroe expressway|nc 74 toll/i, typicalCost: 4.25, state: 'NC' },

    // --- Pennsylvania ---
    { name: 'Pennsylvania Turnpike (I-76/I-276/I-476)', pattern: /pennsylvania turnpike|penna turnpike|pa turnpike/i, typicalCost: 22.00, state: 'PA' },

    // --- Florida ---
    { name: "Florida's Turnpike (Mainline)", pattern: /florida('s)? turnpike|ronald reagan turnpike/i, typicalCost: 15.00, state: 'FL' },
    { name: 'Suncoast Parkway & Veterans Expwy', pattern: /suncoast parkway|veterans expressway/i, typicalCost: 6.00, state: 'FL' },
    { name: 'Alligator Alley (I-75 Toll)', pattern: /alligator alley|everglades parkway/i, typicalCost: 3.50, state: 'FL' },

    // --- Midwest ---
    { name: 'Ohio Turnpike (I-80/I-90)', pattern: /ohio turnpike/i, typicalCost: 14.50, state: 'OH' },
    { name: 'Indiana Toll Road (I-80/I-90)', pattern: /indiana toll road/i, typicalCost: 12.00, state: 'IN' },
    { name: 'Chicago Skyway & Illinois Tollway', pattern: /chicago skyway|illinois tollway|tri-state tollway|jane addams memorial tollway|reagan memorial tollway/i, typicalCost: 7.50, state: 'IL' },

    // --- Texas & Central ---
    { name: 'Texas Tollways (NTTA / TxTag / HCTRA)', pattern: /dallas north tollway|george bush turnpike|sam houston tollway|hardy toll road|grand parkway|sh 130/i, typicalCost: 6.00, state: 'TX' },
    { name: 'Kansas Turnpike', pattern: /kansas turnpike/i, typicalCost: 6.00, state: 'KS' },

    // --- West Coast ---
    { name: 'SF Bay Area Bridges (Golden Gate/Bay Bridge)', pattern: /golden gate bridge|san francisco-oakland bay bridge|san mateo-hayward bridge|dumbarton bridge|richmond-san rafael/i, typicalCost: 8.00, state: 'CA' },
    { name: 'California Toll Roads (SR 73/241/133/91)', pattern: /the toll roads|sr 73 toll|sr 241 toll|91 express lanes/i, typicalCost: 8.50, state: 'CA' },
    { name: 'WA Bridges (SR 520 / Tacoma Narrows)', pattern: /evergreen point floating bridge|sr 520 bridge|tacoma narrows bridge/i, typicalCost: 5.00, state: 'WA' },

    // --- Generic Keyword Fallback ---
    { name: 'Toll Road / Express Lane', pattern: /\b(toll|tollway|turnpike|tolls|ezpass|e-zpass|sunpass|txtag)\b/i, typicalCost: 4.50 }
];

/**
 * Checks an individual navigation step for toll indicators
 */
export function detectStepToll(instruction: string, streetNames: string[] = []): { isToll: boolean; tollName?: string; estimatedCost?: number } {
    const combinedText = `${instruction} ${streetNames.join(' ')}`.toLowerCase();

    for (const facility of KNOWN_TOLL_FACILITIES) {
        if (facility.pattern.test(combinedText)) {
            return {
                isToll: true,
                tollName: facility.name,
                estimatedCost: facility.typicalCost
            };
        }
    }

    return { isToll: false };
}

/**
 * Analyzes an entire route to calculate toll presence, estimated costs, and toll road summary
 */
export function analyzeRouteTolls(steps: RouteStep[]): TollAnalysis {
    const detectedPlazas: Array<{ name: string; cost: number }> = [];
    let totalTolls = 0;

    for (const step of steps) {
        const text = `${step.instruction} ${step.tollName || ''}`;
        for (const facility of KNOWN_TOLL_FACILITIES) {
            if (facility.pattern.test(text)) {
                // Deduplicate per toll facility
                if (!detectedPlazas.some(d => d.name === facility.name)) {
                    detectedPlazas.push({ name: facility.name, cost: facility.typicalCost });
                    totalTolls += facility.typicalCost;
                    step.isToll = true;
                    step.tollName = facility.name;
                    step.estimatedToll = facility.typicalCost;
                }
            }
        }
    }

    const hasTolls = totalTolls > 0;
    const tollFree = !hasTolls;
    const tollCostEstimate = hasTolls ? `$${totalTolls.toFixed(2)}` : 'No Tolls';

    let tollSummary = '🟢 Toll-Free Route';
    if (hasTolls) {
        const names = detectedPlazas.slice(0, 3).map(p => p.name.split('(')[0].trim());
        const extraCount = detectedPlazas.length - 3;
        tollSummary = `${names.join(', ')}${extraCount > 0 ? ` +${extraCount} more` : ''}`;
    }

    return {
        hasTolls,
        estimatedTolls: parseFloat(totalTolls.toFixed(2)),
        tollCostEstimate,
        tollSummary,
        tollPlazas: detectedPlazas,
        tollFree
    };
}

/**
 * Generates alternative corridor waypoints for long and medium trips to discover
 * Toll-Free, Scenic/Inland, and Coastal route variants when standard OSRM returns only 1 route.
 */
export function generateAlternativeCorridors(start: Location, end: Location): Array<{ name: string; type: 'fastest' | 'toll_free' | 'scenic' | 'shortest'; waypoints: Location[] }> {
    const dLat = end.lat - start.lat;
    const dLng = end.lng - start.lng;
    const distDeg = Math.sqrt(dLat * dLat + dLng * dLng);

    const corridors: Array<{ name: string; type: 'fastest' | 'toll_free' | 'scenic' | 'shortest'; waypoints: Location[] }> = [];

    // For trips over ~80 miles (distDeg > 1.2)
    if (distDeg > 1.2) {
        // 1. East Coast Northbound (e.g. NC/VA/DC to MD/DE/PA/NJ/NY/NE)
        if (dLat > 1.5 && start.lng > -82.0 && end.lng > -82.0) {
            // Toll-Free Corridor via I-295 (NJ) / US-1 (Bypassing NJ Turnpike & Delaware Tolls)
            corridors.push({
                name: 'Toll-Free Route (via I-295 & US-1)',
                type: 'toll_free',
                waypoints: [
                    { lat: 39.75, lng: -75.50 }, // I-295 Delaware/NJ junction
                    { lat: 40.25, lng: -74.75 }  // I-295 Trenton / US-1
                ]
            });

            // Inland Scenic Corridor via I-81 / I-78 (Harrisburg / Allentown / US-15)
            corridors.push({
                name: 'Inland Route (via I-81 & I-78)',
                type: 'scenic',
                waypoints: [
                    { lat: 38.03, lng: -78.48 }, // Charlottesville / US-29
                    { lat: 40.26, lng: -76.88 }  // Harrisburg / I-81
                ]
            });

            // Coastal Corridor via US-13 (Eastern Shore / Delmarva)
            if (start.lat < 37.0) {
                corridors.push({
                    name: 'Coastal Corridor (via US-13)',
                    type: 'shortest',
                    waypoints: [
                        { lat: 37.50, lng: -75.80 }, // Delmarva Peninsula
                        { lat: 38.75, lng: -75.50 }  // Dover, DE
                    ]
                });
            }
        }
        // 2. East Coast Southbound (e.g. NY/NJ/PA/DC/VA/NC to SC/GA/FL)
        else if (dLat < -1.5 && start.lng > -84.0 && end.lng > -84.0) {
            // Inland Fuel-Saver Corridor via I-77 / I-26 / I-75 (Columbia, SC / Macon, GA / Valdosta)
            corridors.push({
                name: 'Inland Alternate (via I-77 & I-75)',
                type: 'toll_free',
                waypoints: [
                    { lat: 34.00, lng: -81.03 }, // Columbia, SC
                    { lat: 32.84, lng: -83.63 }  // Macon, GA (I-75 Corridor)
                ]
            });

            // Western Scenic Corridor via I-85 & I-75 (Charlotte / Atlanta / Macon)
            corridors.push({
                name: 'Western Corridor (via I-85 & I-75)',
                type: 'scenic',
                waypoints: [
                    { lat: 35.22, lng: -80.84 }, // Charlotte, NC
                    { lat: 33.75, lng: -84.38 }  // Atlanta, GA
                ]
            });
        }
        // 3. Generic Inland/Secondary Highway Corridors (Land-Bounded)
        else {
            const midLat = (start.lat + end.lat) / 2;
            const midLng = (start.lng + end.lng) / 2;
            
            // Bias perpendicular offset towards land (West of Atlantic Coast or East of Pacific Coast)
            let perpLat = -dLng * 0.15;
            let perpLng = dLat * 0.15;

            // Prevent ocean snapping on East Coast (bias Westward: more negative lng)
            if (midLng > -82.0 && perpLng > 0) {
                perpLng = -Math.abs(perpLng);
            }
            // Prevent ocean snapping on West Coast (bias Eastward: more positive lng)
            if (midLng < -118.0 && perpLng < 0) {
                perpLng = Math.abs(perpLng);
            }

            corridors.push({
                name: 'Inland Alternate',
                type: 'toll_free',
                waypoints: [{ lat: midLat + perpLat, lng: midLng + perpLng }]
            });

            corridors.push({
                name: 'Secondary Highway Alternate',
                type: 'scenic',
                waypoints: [{ lat: midLat - (perpLat * 0.5), lng: midLng - (Math.abs(perpLng) * 0.5) }]
            });
        }
    }
    // For medium-distance trips (~15 to 80 miles)
    else if (distDeg > 0.25) {
        const midLat = (start.lat + end.lat) / 2;
        const midLng = (start.lng + end.lng) / 2;
        let perpLat = -dLng * 0.10;
        let perpLng = dLat * 0.10;

        // Ensure inland offset
        if (midLng > -82.0 && perpLng > 0) perpLng = -Math.abs(perpLng);
        if (midLng < -118.0 && perpLng < 0) perpLng = Math.abs(perpLng);

        corridors.push({
            name: 'Local Highway Bypass',
            type: 'toll_free',
            waypoints: [{ lat: midLat + perpLat, lng: midLng + perpLng }]
        });
    }

    return corridors;
}
