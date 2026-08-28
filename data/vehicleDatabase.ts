/**
 * Comprehensive Vehicle Database for MyWay GPS
 * Over 40+ makes and hundreds of popular models with smart defaults
 * (MPG, Fuel Type, Tank Capacity, Body Type)
 */

export interface VehicleModelInfo {
    model: string;
    fuelType: 'gasoline' | 'premium' | 'diesel' | 'hybrid' | 'electric';
    mpg: number;
    tankCapacityGal?: number;
    bodyType?: 'sedan' | 'suv' | 'truck' | 'coupe' | 'van' | 'wagon' | 'hatchback' | 'ev';
}

export interface VehicleMakeInfo {
    make: string;
    country: 'USA' | 'Japan' | 'Germany' | 'South Korea' | 'Sweden' | 'UK' | 'Italy' | 'Other';
    category: 'popular' | 'american' | 'asian' | 'european' | 'luxury' | 'electric';
    icon?: string;
    models: VehicleModelInfo[];
}

export const VEHICLE_DATABASE: VehicleMakeInfo[] = [
    {
        make: 'Toyota',
        country: 'Japan',
        category: 'popular',
        models: [
            { model: 'Camry', fuelType: 'gasoline', mpg: 32, tankCapacityGal: 15.8, bodyType: 'sedan' },
            { model: 'Camry Hybrid', fuelType: 'hybrid', mpg: 52, tankCapacityGal: 13.0, bodyType: 'sedan' },
            { model: 'Corolla', fuelType: 'gasoline', mpg: 35, tankCapacityGal: 13.2, bodyType: 'sedan' },
            { model: 'Corolla Hybrid', fuelType: 'hybrid', mpg: 50, tankCapacityGal: 11.4, bodyType: 'sedan' },
            { model: 'Corolla Cross', fuelType: 'gasoline', mpg: 32, tankCapacityGal: 12.4, bodyType: 'suv' },
            { model: 'RAV4', fuelType: 'gasoline', mpg: 30, tankCapacityGal: 14.5, bodyType: 'suv' },
            { model: 'RAV4 Hybrid', fuelType: 'hybrid', mpg: 40, tankCapacityGal: 14.5, bodyType: 'suv' },
            { model: 'RAV4 Prime (PHEV)', fuelType: 'hybrid', mpg: 94, tankCapacityGal: 14.5, bodyType: 'suv' },
            { model: 'Highlander', fuelType: 'gasoline', mpg: 25, tankCapacityGal: 17.9, bodyType: 'suv' },
            { model: 'Highlander Hybrid', fuelType: 'hybrid', mpg: 36, tankCapacityGal: 17.1, bodyType: 'suv' },
            { model: 'Grand Highlander', fuelType: 'gasoline', mpg: 24, tankCapacityGal: 17.2, bodyType: 'suv' },
            { model: 'Tacoma', fuelType: 'gasoline', mpg: 23, tankCapacityGal: 18.2, bodyType: 'truck' },
            { model: 'Tundra', fuelType: 'gasoline', mpg: 20, tankCapacityGal: 22.5, bodyType: 'truck' },
            { model: 'Prius', fuelType: 'hybrid', mpg: 57, tankCapacityGal: 11.3, bodyType: 'hatchback' },
            { model: 'Prius Prime', fuelType: 'hybrid', mpg: 127, tankCapacityGal: 10.6, bodyType: 'hatchback' },
            { model: 'Sienna (Hybrid)', fuelType: 'hybrid', mpg: 36, tankCapacityGal: 18.0, bodyType: 'van' },
            { model: '4Runner', fuelType: 'gasoline', mpg: 17, tankCapacityGal: 23.0, bodyType: 'suv' },
            { model: 'Venza', fuelType: 'hybrid', mpg: 39, tankCapacityGal: 14.5, bodyType: 'suv' },
            { model: 'Crown', fuelType: 'hybrid', mpg: 41, tankCapacityGal: 14.5, bodyType: 'sedan' },
            { model: 'Sequoia', fuelType: 'hybrid', mpg: 22, tankCapacityGal: 22.5, bodyType: 'suv' },
            { model: 'bZ4X (EV)', fuelType: 'electric', mpg: 119, tankCapacityGal: 71.4, bodyType: 'ev' },
            { model: 'GR86', fuelType: 'premium', mpg: 25, tankCapacityGal: 13.2, bodyType: 'coupe' },
            { model: 'GR Supra', fuelType: 'premium', mpg: 28, tankCapacityGal: 13.7, bodyType: 'coupe' },
            { model: 'Avalon', fuelType: 'gasoline', mpg: 26, tankCapacityGal: 14.5, bodyType: 'sedan' },
            { model: 'Land Cruiser', fuelType: 'hybrid', mpg: 23, tankCapacityGal: 17.9, bodyType: 'suv' },
            { model: 'Yaris', fuelType: 'gasoline', mpg: 35, tankCapacityGal: 11.1, bodyType: 'hatchback' },
            { model: 'Matrix', fuelType: 'gasoline', mpg: 29, tankCapacityGal: 13.2, bodyType: 'hatchback' },
        ]
    },
    {
        make: 'Honda',
        country: 'Japan',
        category: 'popular',
        models: [
            { model: 'Civic', fuelType: 'gasoline', mpg: 36, tankCapacityGal: 12.4, bodyType: 'sedan' },
            { model: 'Civic Hybrid', fuelType: 'hybrid', mpg: 49, tankCapacityGal: 10.6, bodyType: 'sedan' },
            { model: 'Civic Type R', fuelType: 'premium', mpg: 24, tankCapacityGal: 12.4, bodyType: 'hatchback' },
            { model: 'Accord', fuelType: 'gasoline', mpg: 32, tankCapacityGal: 14.8, bodyType: 'sedan' },
            { model: 'Accord Hybrid', fuelType: 'hybrid', mpg: 48, tankCapacityGal: 12.8, bodyType: 'sedan' },
            { model: 'CR-V', fuelType: 'gasoline', mpg: 30, tankCapacityGal: 14.0, bodyType: 'suv' },
            { model: 'CR-V Hybrid', fuelType: 'hybrid', mpg: 40, tankCapacityGal: 14.0, bodyType: 'suv' },
            { model: 'HR-V', fuelType: 'gasoline', mpg: 28, tankCapacityGal: 14.0, bodyType: 'suv' },
            { model: 'Pilot', fuelType: 'gasoline', mpg: 22, tankCapacityGal: 18.5, bodyType: 'suv' },
            { model: 'Passport', fuelType: 'gasoline', mpg: 21, tankCapacityGal: 19.5, bodyType: 'suv' },
            { model: 'Odyssey', fuelType: 'gasoline', mpg: 22, tankCapacityGal: 19.5, bodyType: 'van' },
            { model: 'Ridgeline', fuelType: 'gasoline', mpg: 21, tankCapacityGal: 19.5, bodyType: 'truck' },
            { model: 'Prologue (EV)', fuelType: 'electric', mpg: 107, tankCapacityGal: 85.0, bodyType: 'ev' },
            { model: 'Fit', fuelType: 'gasoline', mpg: 36, tankCapacityGal: 10.6, bodyType: 'hatchback' },
            { model: 'Insight', fuelType: 'hybrid', mpg: 52, tankCapacityGal: 10.6, bodyType: 'sedan' },
            { model: 'Element', fuelType: 'gasoline', mpg: 22, tankCapacityGal: 15.9, bodyType: 'suv' },
            { model: 'CR-Z', fuelType: 'hybrid', mpg: 37, tankCapacityGal: 10.6, bodyType: 'coupe' },
            { model: 'S2000', fuelType: 'premium', mpg: 21, tankCapacityGal: 13.2, bodyType: 'coupe' },
        ]
    },
    {
        make: 'Ford',
        country: 'USA',
        category: 'popular',
        models: [
            { model: 'F-150', fuelType: 'gasoline', mpg: 21, tankCapacityGal: 26.0, bodyType: 'truck' },
            { model: 'F-150 PowerBoost Hybrid', fuelType: 'hybrid', mpg: 25, tankCapacityGal: 30.6, bodyType: 'truck' },
            { model: 'F-150 Lightning (EV)', fuelType: 'electric', mpg: 70, tankCapacityGal: 98.0, bodyType: 'ev' },
            { model: 'F-250 Super Duty', fuelType: 'diesel', mpg: 16, tankCapacityGal: 34.0, bodyType: 'truck' },
            { model: 'F-350 Super Duty', fuelType: 'diesel', mpg: 15, tankCapacityGal: 48.0, bodyType: 'truck' },
            { model: 'Explorer', fuelType: 'gasoline', mpg: 24, tankCapacityGal: 17.9, bodyType: 'suv' },
            { model: 'Escape', fuelType: 'gasoline', mpg: 30, tankCapacityGal: 14.8, bodyType: 'suv' },
            { model: 'Escape Hybrid', fuelType: 'hybrid', mpg: 41, tankCapacityGal: 14.3, bodyType: 'suv' },
            { model: 'Mustang', fuelType: 'gasoline', mpg: 25, tankCapacityGal: 16.0, bodyType: 'coupe' },
            { model: 'Mustang GT (V8)', fuelType: 'premium', mpg: 18, tankCapacityGal: 16.0, bodyType: 'coupe' },
            { model: 'Mustang Mach-E (EV)', fuelType: 'electric', mpg: 103, tankCapacityGal: 72.0, bodyType: 'ev' },
            { model: 'Bronco', fuelType: 'gasoline', mpg: 20, tankCapacityGal: 20.8, bodyType: 'suv' },
            { model: 'Bronco Sport', fuelType: 'gasoline', mpg: 26, tankCapacityGal: 16.0, bodyType: 'suv' },
            { model: 'Edge', fuelType: 'gasoline', mpg: 23, tankCapacityGal: 18.5, bodyType: 'suv' },
            { model: 'Maverick (Gas)', fuelType: 'gasoline', mpg: 26, tankCapacityGal: 16.5, bodyType: 'truck' },
            { model: 'Maverick (Hybrid)', fuelType: 'hybrid', mpg: 42, tankCapacityGal: 13.8, bodyType: 'truck' },
            { model: 'Expedition', fuelType: 'gasoline', mpg: 19, tankCapacityGal: 23.2, bodyType: 'suv' },
            { model: 'Ranger', fuelType: 'gasoline', mpg: 23, tankCapacityGal: 18.0, bodyType: 'truck' },
            { model: 'Transit Cargo Van', fuelType: 'gasoline', mpg: 17, tankCapacityGal: 25.0, bodyType: 'van' },
            { model: 'Transit Connect', fuelType: 'gasoline', mpg: 26, tankCapacityGal: 15.8, bodyType: 'van' },
            { model: 'Fusion', fuelType: 'gasoline', mpg: 27, tankCapacityGal: 16.5, bodyType: 'sedan' },
            { model: 'Fusion Hybrid', fuelType: 'hybrid', mpg: 42, tankCapacityGal: 14.0, bodyType: 'sedan' },
            { model: 'Focus', fuelType: 'gasoline', mpg: 31, tankCapacityGal: 12.4, bodyType: 'sedan' },
            { model: 'Fiesta', fuelType: 'gasoline', mpg: 32, tankCapacityGal: 12.4, bodyType: 'hatchback' },
            { model: 'Taurus', fuelType: 'gasoline', mpg: 21, tankCapacityGal: 19.0, bodyType: 'sedan' },
            { model: 'EcoSport', fuelType: 'gasoline', mpg: 25, tankCapacityGal: 13.8, bodyType: 'suv' },
            { model: 'Flex', fuelType: 'gasoline', mpg: 19, tankCapacityGal: 18.6, bodyType: 'suv' },
            { model: 'Crown Victoria', fuelType: 'gasoline', mpg: 19, tankCapacityGal: 19.0, bodyType: 'sedan' },
        ]
    },
    {
        make: 'Chevrolet',
        country: 'USA',
        category: 'popular',
        models: [
            { model: 'Silverado 1500', fuelType: 'gasoline', mpg: 20, tankCapacityGal: 24.0, bodyType: 'truck' },
            { model: 'Silverado Duramax Diesel', fuelType: 'diesel', mpg: 26, tankCapacityGal: 24.0, bodyType: 'truck' },
            { model: 'Silverado 2500HD', fuelType: 'diesel', mpg: 16, tankCapacityGal: 36.0, bodyType: 'truck' },
            { model: 'Silverado EV', fuelType: 'electric', mpg: 67, tankCapacityGal: 200.0, bodyType: 'ev' },
            { model: 'Equinox', fuelType: 'gasoline', mpg: 28, tankCapacityGal: 14.9, bodyType: 'suv' },
            { model: 'Equinox EV', fuelType: 'electric', mpg: 108, tankCapacityGal: 85.0, bodyType: 'ev' },
            { model: 'Malibu', fuelType: 'gasoline', mpg: 32, tankCapacityGal: 15.8, bodyType: 'sedan' },
            { model: 'Tahoe', fuelType: 'gasoline', mpg: 17, tankCapacityGal: 24.0, bodyType: 'suv' },
            { model: 'Tahoe Diesel', fuelType: 'diesel', mpg: 24, tankCapacityGal: 24.0, bodyType: 'suv' },
            { model: 'Suburban', fuelType: 'gasoline', mpg: 17, tankCapacityGal: 28.0, bodyType: 'suv' },
            { model: 'Traverse', fuelType: 'gasoline', mpg: 21, tankCapacityGal: 19.4, bodyType: 'suv' },
            { model: 'Colorado', fuelType: 'gasoline', mpg: 21, tankCapacityGal: 21.4, bodyType: 'truck' },
            { model: 'Blazer', fuelType: 'gasoline', mpg: 25, tankCapacityGal: 19.4, bodyType: 'suv' },
            { model: 'Blazer EV', fuelType: 'electric', mpg: 103, tankCapacityGal: 85.0, bodyType: 'ev' },
            { model: 'Trailblazer', fuelType: 'gasoline', mpg: 31, tankCapacityGal: 13.2, bodyType: 'suv' },
            { model: 'Trax', fuelType: 'gasoline', mpg: 30, tankCapacityGal: 13.2, bodyType: 'suv' },
            { model: 'Corvette Stingray', fuelType: 'premium', mpg: 19, tankCapacityGal: 18.5, bodyType: 'coupe' },
            { model: 'Corvette E-Ray', fuelType: 'hybrid', mpg: 21, tankCapacityGal: 18.5, bodyType: 'coupe' },
            { model: 'Corvette Z06', fuelType: 'premium', mpg: 15, tankCapacityGal: 18.5, bodyType: 'coupe' },
            { model: 'Camaro', fuelType: 'gasoline', mpg: 22, tankCapacityGal: 19.0, bodyType: 'coupe' },
            { model: 'Bolt EV', fuelType: 'electric', mpg: 120, tankCapacityGal: 65.0, bodyType: 'ev' },
            { model: 'Bolt EUV', fuelType: 'electric', mpg: 115, tankCapacityGal: 65.0, bodyType: 'ev' },
            { model: 'Impala', fuelType: 'gasoline', mpg: 22, tankCapacityGal: 18.5, bodyType: 'sedan' },
            { model: 'Cruze', fuelType: 'gasoline', mpg: 32, tankCapacityGal: 13.7, bodyType: 'sedan' },
            { model: 'Sonic', fuelType: 'gasoline', mpg: 31, tankCapacityGal: 12.2, bodyType: 'hatchback' },
            { model: 'Spark', fuelType: 'gasoline', mpg: 33, tankCapacityGal: 9.0, bodyType: 'hatchback' },
            { model: 'Express Van', fuelType: 'gasoline', mpg: 14, tankCapacityGal: 31.0, bodyType: 'van' },
        ]
    },
    {
        make: 'Tesla',
        country: 'USA',
        category: 'electric',
        models: [
            { model: 'Model 3 Standard Range', fuelType: 'electric', mpg: 132, tankCapacityGal: 60.0, bodyType: 'ev' },
            { model: 'Model 3 Long Range / Performance', fuelType: 'electric', mpg: 125, tankCapacityGal: 82.0, bodyType: 'ev' },
            { model: 'Model Y Long Range', fuelType: 'electric', mpg: 122, tankCapacityGal: 75.0, bodyType: 'ev' },
            { model: 'Model Y Performance', fuelType: 'electric', mpg: 111, tankCapacityGal: 75.0, bodyType: 'ev' },
            { model: 'Model S Long Range / Plaid', fuelType: 'electric', mpg: 120, tankCapacityGal: 100.0, bodyType: 'ev' },
            { model: 'Model X Long Range / Plaid', fuelType: 'electric', mpg: 102, tankCapacityGal: 100.0, bodyType: 'ev' },
            { model: 'Cybertruck Dual Motor', fuelType: 'electric', mpg: 85, tankCapacityGal: 123.0, bodyType: 'ev' },
            { model: 'Cybertruck Cyberbeast', fuelType: 'electric', mpg: 78, tankCapacityGal: 123.0, bodyType: 'ev' },
        ]
    },
    {
        make: 'Hyundai',
        country: 'South Korea',
        category: 'popular',
        models: [
            { model: 'Elantra', fuelType: 'gasoline', mpg: 36, tankCapacityGal: 12.4, bodyType: 'sedan' },
            { model: 'Elantra Hybrid', fuelType: 'hybrid', mpg: 54, tankCapacityGal: 11.1, bodyType: 'sedan' },
            { model: 'Elantra N', fuelType: 'premium', mpg: 23, tankCapacityGal: 12.4, bodyType: 'sedan' },
            { model: 'Sonata', fuelType: 'gasoline', mpg: 31, tankCapacityGal: 15.9, bodyType: 'sedan' },
            { model: 'Sonata Hybrid', fuelType: 'hybrid', mpg: 52, tankCapacityGal: 13.2, bodyType: 'sedan' },
            { model: 'Tucson', fuelType: 'gasoline', mpg: 28, tankCapacityGal: 14.3, bodyType: 'suv' },
            { model: 'Tucson Hybrid', fuelType: 'hybrid', mpg: 38, tankCapacityGal: 13.7, bodyType: 'suv' },
            { model: 'Tucson Plug-In Hybrid', fuelType: 'hybrid', mpg: 80, tankCapacityGal: 11.1, bodyType: 'suv' },
            { model: 'Santa Fe', fuelType: 'gasoline', mpg: 24, tankCapacityGal: 17.7, bodyType: 'suv' },
            { model: 'Santa Fe Hybrid', fuelType: 'hybrid', mpg: 34, tankCapacityGal: 17.7, bodyType: 'suv' },
            { model: 'Palisade', fuelType: 'gasoline', mpg: 21, tankCapacityGal: 18.8, bodyType: 'suv' },
            { model: 'Kona', fuelType: 'gasoline', mpg: 31, tankCapacityGal: 12.4, bodyType: 'suv' },
            { model: 'Kona Electric', fuelType: 'electric', mpg: 116, tankCapacityGal: 64.8, bodyType: 'ev' },
            { model: 'Venue', fuelType: 'gasoline', mpg: 31, tankCapacityGal: 11.9, bodyType: 'suv' },
            { model: 'Ioniq 5 (EV)', fuelType: 'electric', mpg: 114, tankCapacityGal: 77.4, bodyType: 'ev' },
            { model: 'Ioniq 5 N (EV)', fuelType: 'electric', mpg: 88, tankCapacityGal: 84.0, bodyType: 'ev' },
            { model: 'Ioniq 6 (EV)', fuelType: 'electric', mpg: 140, tankCapacityGal: 77.4, bodyType: 'ev' },
            { model: 'Santa Cruz', fuelType: 'gasoline', mpg: 23, tankCapacityGal: 17.7, bodyType: 'truck' },
            { model: 'Accent', fuelType: 'gasoline', mpg: 36, tankCapacityGal: 11.9, bodyType: 'sedan' },
            { model: 'Veloster', fuelType: 'gasoline', mpg: 29, tankCapacityGal: 13.2, bodyType: 'hatchback' },
        ]
    },
    {
        make: 'Kia',
        country: 'South Korea',
        category: 'popular',
        models: [
            { model: 'Forte', fuelType: 'gasoline', mpg: 34, tankCapacityGal: 14.0, bodyType: 'sedan' },
            { model: 'K5 (Optima)', fuelType: 'gasoline', mpg: 31, tankCapacityGal: 15.8, bodyType: 'sedan' },
            { model: 'K4', fuelType: 'gasoline', mpg: 34, tankCapacityGal: 14.0, bodyType: 'sedan' },
            { model: 'Sportage', fuelType: 'gasoline', mpg: 28, tankCapacityGal: 14.3, bodyType: 'suv' },
            { model: 'Sportage Hybrid', fuelType: 'hybrid', mpg: 43, tankCapacityGal: 13.7, bodyType: 'suv' },
            { model: 'Sorento', fuelType: 'gasoline', mpg: 26, tankCapacityGal: 17.7, bodyType: 'suv' },
            { model: 'Sorento Hybrid', fuelType: 'hybrid', mpg: 37, tankCapacityGal: 17.7, bodyType: 'suv' },
            { model: 'Telluride', fuelType: 'gasoline', mpg: 21, tankCapacityGal: 18.8, bodyType: 'suv' },
            { model: 'Soul', fuelType: 'gasoline', mpg: 30, tankCapacityGal: 14.3, bodyType: 'hatchback' },
            { model: 'Seltos', fuelType: 'gasoline', mpg: 31, tankCapacityGal: 13.2, bodyType: 'suv' },
            { model: 'Carnival (Sedona)', fuelType: 'gasoline', mpg: 22, tankCapacityGal: 19.0, bodyType: 'van' },
            { model: 'Carnival Hybrid', fuelType: 'hybrid', mpg: 33, tankCapacityGal: 19.0, bodyType: 'van' },
            { model: 'EV6', fuelType: 'electric', mpg: 117, tankCapacityGal: 77.4, bodyType: 'ev' },
            { model: 'EV9', fuelType: 'electric', mpg: 89, tankCapacityGal: 99.8, bodyType: 'ev' },
            { model: 'Niro Hybrid', fuelType: 'hybrid', mpg: 53, tankCapacityGal: 11.1, bodyType: 'suv' },
            { model: 'Niro EV', fuelType: 'electric', mpg: 113, tankCapacityGal: 64.8, bodyType: 'ev' },
            { model: 'Rio', fuelType: 'gasoline', mpg: 36, tankCapacityGal: 11.9, bodyType: 'sedan' },
            { model: 'Stinger', fuelType: 'premium', mpg: 24, tankCapacityGal: 15.9, bodyType: 'sedan' },
        ]
    },
    {
        make: 'Nissan',
        country: 'Japan',
        category: 'popular',
        models: [
            { model: 'Altima', fuelType: 'gasoline', mpg: 32, tankCapacityGal: 16.0, bodyType: 'sedan' },
            { model: 'Sentra', fuelType: 'gasoline', mpg: 33, tankCapacityGal: 12.4, bodyType: 'sedan' },
            { model: 'Versa', fuelType: 'gasoline', mpg: 35, tankCapacityGal: 10.8, bodyType: 'sedan' },
            { model: 'Rogue', fuelType: 'gasoline', mpg: 33, tankCapacityGal: 14.5, bodyType: 'suv' },
            { model: 'Pathfinder', fuelType: 'gasoline', mpg: 23, tankCapacityGal: 18.5, bodyType: 'suv' },
            { model: 'Kicks', fuelType: 'gasoline', mpg: 33, tankCapacityGal: 10.8, bodyType: 'suv' },
            { model: 'Murano', fuelType: 'gasoline', mpg: 23, tankCapacityGal: 19.0, bodyType: 'suv' },
            { model: 'Frontier', fuelType: 'gasoline', mpg: 20, tankCapacityGal: 21.0, bodyType: 'truck' },
            { model: 'Titan', fuelType: 'gasoline', mpg: 17, tankCapacityGal: 26.0, bodyType: 'truck' },
            { model: 'Armada', fuelType: 'gasoline', mpg: 16, tankCapacityGal: 26.0, bodyType: 'suv' },
            { model: 'Ariya (EV)', fuelType: 'electric', mpg: 101, tankCapacityGal: 87.0, bodyType: 'ev' },
            { model: 'Leaf (EV)', fuelType: 'electric', mpg: 111, tankCapacityGal: 60.0, bodyType: 'ev' },
            { model: 'Maxima', fuelType: 'premium', mpg: 24, tankCapacityGal: 18.0, bodyType: 'sedan' },
            { model: 'Z (370Z / 400Z)', fuelType: 'premium', mpg: 22, tankCapacityGal: 16.4, bodyType: 'coupe' },
            { model: 'GT-R', fuelType: 'premium', mpg: 18, tankCapacityGal: 19.5, bodyType: 'coupe' },
            { model: 'Rogue Sport', fuelType: 'gasoline', mpg: 28, tankCapacityGal: 14.5, bodyType: 'suv' },
            { model: 'NV200 Compact Cargo', fuelType: 'gasoline', mpg: 25, tankCapacityGal: 14.5, bodyType: 'van' },
            { model: 'Juke', fuelType: 'gasoline', mpg: 29, tankCapacityGal: 13.2, bodyType: 'suv' },
        ]
    },
    {
        make: 'Jeep',
        country: 'USA',
        category: 'popular',
        models: [
            { model: 'Grand Cherokee', fuelType: 'gasoline', mpg: 22, tankCapacityGal: 23.0, bodyType: 'suv' },
            { model: 'Grand Cherokee 4xe (PHEV)', fuelType: 'hybrid', mpg: 56, tankCapacityGal: 19.0, bodyType: 'suv' },
            { model: 'Wrangler (4-Door)', fuelType: 'gasoline', mpg: 20, tankCapacityGal: 21.5, bodyType: 'suv' },
            { model: 'Wrangler 4xe (PHEV)', fuelType: 'hybrid', mpg: 49, tankCapacityGal: 17.2, bodyType: 'suv' },
            { model: 'Gladiator', fuelType: 'gasoline', mpg: 19, tankCapacityGal: 22.0, bodyType: 'truck' },
            { model: 'Cherokee', fuelType: 'gasoline', mpg: 24, tankCapacityGal: 15.8, bodyType: 'suv' },
            { model: 'Compass', fuelType: 'gasoline', mpg: 27, tankCapacityGal: 13.5, bodyType: 'suv' },
            { model: 'Renegade', fuelType: 'gasoline', mpg: 26, tankCapacityGal: 12.7, bodyType: 'suv' },
            { model: 'Wagoneer', fuelType: 'gasoline', mpg: 19, tankCapacityGal: 26.5, bodyType: 'suv' },
            { model: 'Grand Wagoneer', fuelType: 'premium', mpg: 16, tankCapacityGal: 26.5, bodyType: 'suv' },
            { model: 'Patriot', fuelType: 'gasoline', mpg: 24, tankCapacityGal: 13.5, bodyType: 'suv' },
            { model: 'Liberty', fuelType: 'gasoline', mpg: 18, tankCapacityGal: 19.5, bodyType: 'suv' },
        ]
    },
    {
        make: 'Subaru',
        country: 'Japan',
        category: 'popular',
        models: [
            { model: 'Outback', fuelType: 'gasoline', mpg: 28, tankCapacityGal: 18.5, bodyType: 'wagon' },
            { model: 'Forester', fuelType: 'gasoline', mpg: 29, tankCapacityGal: 16.6, bodyType: 'suv' },
            { model: 'Crosstrek', fuelType: 'gasoline', mpg: 30, tankCapacityGal: 16.6, bodyType: 'suv' },
            { model: 'Crosstrek Hybrid', fuelType: 'hybrid', mpg: 35, tankCapacityGal: 13.2, bodyType: 'suv' },
            { model: 'Impreza', fuelType: 'gasoline', mpg: 30, tankCapacityGal: 16.6, bodyType: 'hatchback' },
            { model: 'Legacy', fuelType: 'gasoline', mpg: 30, tankCapacityGal: 18.5, bodyType: 'sedan' },
            { model: 'Ascent', fuelType: 'gasoline', mpg: 23, tankCapacityGal: 19.3, bodyType: 'suv' },
            { model: 'WRX', fuelType: 'premium', mpg: 22, tankCapacityGal: 16.6, bodyType: 'sedan' },
            { model: 'BRZ', fuelType: 'premium', mpg: 25, tankCapacityGal: 13.2, bodyType: 'coupe' },
            { model: 'Solterra (EV)', fuelType: 'electric', mpg: 104, tankCapacityGal: 72.8, bodyType: 'ev' },
            { model: 'Baja', fuelType: 'gasoline', mpg: 21, tankCapacityGal: 16.9, bodyType: 'truck' },
        ]
    },
    {
        make: 'BMW',
        country: 'Germany',
        category: 'european',
        models: [
            { model: '3 Series (330i)', fuelType: 'premium', mpg: 29, tankCapacityGal: 15.6, bodyType: 'sedan' },
            { model: '3 Series (330e PHEV)', fuelType: 'hybrid', mpg: 75, tankCapacityGal: 10.6, bodyType: 'sedan' },
            { model: '5 Series (530i / 540i)', fuelType: 'premium', mpg: 27, tankCapacityGal: 18.0, bodyType: 'sedan' },
            { model: '7 Series', fuelType: 'premium', mpg: 25, tankCapacityGal: 19.5, bodyType: 'sedan' },
            { model: 'X1', fuelType: 'premium', mpg: 28, tankCapacityGal: 14.3, bodyType: 'suv' },
            { model: 'X3', fuelType: 'premium', mpg: 25, tankCapacityGal: 17.2, bodyType: 'suv' },
            { model: 'X5', fuelType: 'premium', mpg: 23, tankCapacityGal: 21.9, bodyType: 'suv' },
            { model: 'X5 xDrive50e (PHEV)', fuelType: 'hybrid', mpg: 58, tankCapacityGal: 18.2, bodyType: 'suv' },
            { model: 'X7', fuelType: 'premium', mpg: 22, tankCapacityGal: 21.9, bodyType: 'suv' },
            { model: '4 Series Gran Coupe', fuelType: 'premium', mpg: 28, tankCapacityGal: 15.6, bodyType: 'coupe' },
            { model: '2 Series Gran Coupe', fuelType: 'premium', mpg: 28, tankCapacityGal: 13.2, bodyType: 'sedan' },
            { model: 'i4 (EV)', fuelType: 'electric', mpg: 109, tankCapacityGal: 83.9, bodyType: 'ev' },
            { model: 'iX (EV)', fuelType: 'electric', mpg: 86, tankCapacityGal: 111.5, bodyType: 'ev' },
            { model: 'i7 (EV)', fuelType: 'electric', mpg: 89, tankCapacityGal: 105.7, bodyType: 'ev' },
            { model: 'M3 / M4', fuelType: 'premium', mpg: 19, tankCapacityGal: 15.6, bodyType: 'sedan' },
            { model: 'M5', fuelType: 'premium', mpg: 17, tankCapacityGal: 18.0, bodyType: 'sedan' },
        ]
    },
    {
        make: 'Mercedes-Benz',
        country: 'Germany',
        category: 'european',
        models: [
            { model: 'C-Class (C 300)', fuelType: 'premium', mpg: 29, tankCapacityGal: 17.4, bodyType: 'sedan' },
            { model: 'E-Class (E 350 / E 450)', fuelType: 'premium', mpg: 27, tankCapacityGal: 17.4, bodyType: 'sedan' },
            { model: 'S-Class (S 500 / S 580)', fuelType: 'premium', mpg: 23, tankCapacityGal: 22.2, bodyType: 'sedan' },
            { model: 'GLC 300', fuelType: 'premium', mpg: 26, tankCapacityGal: 16.4, bodyType: 'suv' },
            { model: 'GLE 350 / GLE 450', fuelType: 'premium', mpg: 23, tankCapacityGal: 22.5, bodyType: 'suv' },
            { model: 'GLS 450 / GLS 580', fuelType: 'premium', mpg: 20, tankCapacityGal: 23.8, bodyType: 'suv' },
            { model: 'CLA 250', fuelType: 'premium', mpg: 29, tankCapacityGal: 13.5, bodyType: 'coupe' },
            { model: 'GLA 250', fuelType: 'premium', mpg: 28, tankCapacityGal: 13.5, bodyType: 'suv' },
            { model: 'GLB 250', fuelType: 'premium', mpg: 27, tankCapacityGal: 13.5, bodyType: 'suv' },
            { model: 'A-Class (A 220)', fuelType: 'premium', mpg: 30, tankCapacityGal: 13.5, bodyType: 'sedan' },
            { model: 'EQE Sedan / SUV (EV)', fuelType: 'electric', mpg: 96, tankCapacityGal: 90.6, bodyType: 'ev' },
            { model: 'EQS Sedan / SUV (EV)', fuelType: 'electric', mpg: 97, tankCapacityGal: 108.4, bodyType: 'ev' },
            { model: 'Sprinter Cargo Van', fuelType: 'diesel', mpg: 19, tankCapacityGal: 24.5, bodyType: 'van' },
            { model: 'Metris Passenger / Cargo', fuelType: 'premium', mpg: 21, tankCapacityGal: 18.5, bodyType: 'van' },
            { model: 'G-Class (G 550 / G 63)', fuelType: 'premium', mpg: 14, tankCapacityGal: 26.4, bodyType: 'suv' },
        ]
    },
    {
        make: 'Ram',
        country: 'USA',
        category: 'american',
        models: [
            { model: '1500 (V6 eTorque)', fuelType: 'gasoline', mpg: 22, tankCapacityGal: 26.0, bodyType: 'truck' },
            { model: '1500 (V8 HEMI)', fuelType: 'gasoline', mpg: 18, tankCapacityGal: 26.0, bodyType: 'truck' },
            { model: '1500 EcoDiesel', fuelType: 'diesel', mpg: 26, tankCapacityGal: 26.0, bodyType: 'truck' },
            { model: '1500 REV (EV)', fuelType: 'electric', mpg: 70, tankCapacityGal: 168.0, bodyType: 'ev' },
            { model: '2500 Heavy Duty (Cummins)', fuelType: 'diesel', mpg: 16, tankCapacityGal: 32.0, bodyType: 'truck' },
            { model: '3500 Heavy Duty', fuelType: 'diesel', mpg: 15, tankCapacityGal: 32.0, bodyType: 'truck' },
            { model: 'ProMaster Cargo Van', fuelType: 'gasoline', mpg: 18, tankCapacityGal: 24.0, bodyType: 'van' },
            { model: 'ProMaster EV', fuelType: 'electric', mpg: 65, tankCapacityGal: 110.0, bodyType: 'ev' },
            { model: 'ProMaster City', fuelType: 'gasoline', mpg: 24, tankCapacityGal: 16.0, bodyType: 'van' },
        ]
    },
    {
        make: 'GMC',
        country: 'USA',
        category: 'american',
        models: [
            { model: 'Sierra 1500', fuelType: 'gasoline', mpg: 20, tankCapacityGal: 24.0, bodyType: 'truck' },
            { model: 'Sierra Duramax Diesel', fuelType: 'diesel', mpg: 26, tankCapacityGal: 24.0, bodyType: 'truck' },
            { model: 'Sierra 2500HD', fuelType: 'diesel', mpg: 16, tankCapacityGal: 36.0, bodyType: 'truck' },
            { model: 'Sierra EV', fuelType: 'electric', mpg: 67, tankCapacityGal: 200.0, bodyType: 'ev' },
            { model: 'Terrain', fuelType: 'gasoline', mpg: 26, tankCapacityGal: 14.9, bodyType: 'suv' },
            { model: 'Acadia', fuelType: 'gasoline', mpg: 21, tankCapacityGal: 19.4, bodyType: 'suv' },
            { model: 'Yukon / Yukon Denali', fuelType: 'gasoline', mpg: 17, tankCapacityGal: 24.0, bodyType: 'suv' },
            { model: 'Yukon XL', fuelType: 'gasoline', mpg: 16, tankCapacityGal: 28.0, bodyType: 'suv' },
            { model: 'Canyon', fuelType: 'gasoline', mpg: 20, tankCapacityGal: 21.4, bodyType: 'truck' },
            { model: 'Hummer EV SUV / Pickup', fuelType: 'electric', mpg: 53, tankCapacityGal: 212.0, bodyType: 'ev' },
            { model: 'Savana Cargo Van', fuelType: 'gasoline', mpg: 14, tankCapacityGal: 31.0, bodyType: 'van' },
        ]
    },
    {
        make: 'Dodge',
        country: 'USA',
        category: 'american',
        models: [
            { model: 'Charger (V6)', fuelType: 'gasoline', mpg: 23, tankCapacityGal: 18.5, bodyType: 'sedan' },
            { model: 'Charger (V8 HEMI / Scat Pack)', fuelType: 'premium', mpg: 18, tankCapacityGal: 18.5, bodyType: 'sedan' },
            { model: 'Charger Daytona (EV)', fuelType: 'electric', mpg: 90, tankCapacityGal: 100.5, bodyType: 'ev' },
            { model: 'Challenger (V6)', fuelType: 'gasoline', mpg: 23, tankCapacityGal: 18.5, bodyType: 'coupe' },
            { model: 'Challenger (V8 HEMI / Hellcat)', fuelType: 'premium', mpg: 16, tankCapacityGal: 18.5, bodyType: 'coupe' },
            { model: 'Durango (V6 / V8)', fuelType: 'gasoline', mpg: 21, tankCapacityGal: 24.6, bodyType: 'suv' },
            { model: 'Hornet', fuelType: 'gasoline', mpg: 24, tankCapacityGal: 13.5, bodyType: 'suv' },
            { model: 'Hornet R/T (PHEV)', fuelType: 'hybrid', mpg: 77, tankCapacityGal: 11.2, bodyType: 'suv' },
            { model: 'Grand Caravan', fuelType: 'gasoline', mpg: 20, tankCapacityGal: 20.0, bodyType: 'van' },
            { model: 'Journey', fuelType: 'gasoline', mpg: 21, tankCapacityGal: 20.5, bodyType: 'suv' },
            { model: 'Dart', fuelType: 'gasoline', mpg: 31, tankCapacityGal: 14.2, bodyType: 'sedan' },
        ]
    },
    {
        make: 'Mazda',
        country: 'Japan',
        category: 'asian',
        models: [
            { model: 'CX-5', fuelType: 'gasoline', mpg: 28, tankCapacityGal: 15.3, bodyType: 'suv' },
            { model: 'CX-30', fuelType: 'gasoline', mpg: 29, tankCapacityGal: 12.7, bodyType: 'suv' },
            { model: 'CX-50', fuelType: 'gasoline', mpg: 27, tankCapacityGal: 15.8, bodyType: 'suv' },
            { model: 'CX-50 Hybrid', fuelType: 'hybrid', mpg: 38, tankCapacityGal: 14.5, bodyType: 'suv' },
            { model: 'CX-90', fuelType: 'premium', mpg: 25, tankCapacityGal: 19.6, bodyType: 'suv' },
            { model: 'CX-90 PHEV', fuelType: 'hybrid', mpg: 56, tankCapacityGal: 18.5, bodyType: 'suv' },
            { model: 'Mazda3 Sedan / Hatchback', fuelType: 'gasoline', mpg: 31, tankCapacityGal: 13.2, bodyType: 'sedan' },
            { model: 'MX-5 Miata', fuelType: 'premium', mpg: 30, tankCapacityGal: 11.9, bodyType: 'coupe' },
            { model: 'Mazda6', fuelType: 'gasoline', mpg: 29, tankCapacityGal: 16.4, bodyType: 'sedan' },
            { model: 'CX-9', fuelType: 'gasoline', mpg: 23, tankCapacityGal: 19.5, bodyType: 'suv' },
            { model: 'CX-3', fuelType: 'gasoline', mpg: 31, tankCapacityGal: 12.7, bodyType: 'suv' },
        ]
    },
    {
        make: 'Lexus',
        country: 'Japan',
        category: 'luxury',
        models: [
            { model: 'RX 350', fuelType: 'premium', mpg: 25, tankCapacityGal: 17.8, bodyType: 'suv' },
            { model: 'RX 350h / 500h (Hybrid)', fuelType: 'hybrid', mpg: 36, tankCapacityGal: 17.2, bodyType: 'suv' },
            { model: 'ES 350', fuelType: 'gasoline', mpg: 26, tankCapacityGal: 15.9, bodyType: 'sedan' },
            { model: 'ES 300h (Hybrid)', fuelType: 'hybrid', mpg: 44, tankCapacityGal: 13.2, bodyType: 'sedan' },
            { model: 'NX 250 / 350', fuelType: 'premium', mpg: 28, tankCapacityGal: 14.5, bodyType: 'suv' },
            { model: 'NX 350h / 450h+ (Hybrid)', fuelType: 'hybrid', mpg: 39, tankCapacityGal: 14.5, bodyType: 'suv' },
            { model: 'GX 550', fuelType: 'premium', mpg: 17, tankCapacityGal: 21.1, bodyType: 'suv' },
            { model: 'IS 300 / 350 / 500', fuelType: 'premium', mpg: 25, tankCapacityGal: 17.4, bodyType: 'sedan' },
            { model: 'TX 350 / 500h', fuelType: 'premium', mpg: 23, tankCapacityGal: 17.8, bodyType: 'suv' },
            { model: 'UX 250h / 300h', fuelType: 'hybrid', mpg: 43, tankCapacityGal: 10.6, bodyType: 'suv' },
            { model: 'LX 600', fuelType: 'premium', mpg: 19, tankCapacityGal: 21.1, bodyType: 'suv' },
            { model: 'RZ 450e (EV)', fuelType: 'electric', mpg: 102, tankCapacityGal: 71.4, bodyType: 'ev' },
            { model: 'LS 500', fuelType: 'premium', mpg: 22, tankCapacityGal: 21.7, bodyType: 'sedan' },
            { model: 'RC 300 / 350 / F', fuelType: 'premium', mpg: 24, tankCapacityGal: 17.4, bodyType: 'coupe' },
            { model: 'LC 500 / 500h', fuelType: 'premium', mpg: 19, tankCapacityGal: 21.7, bodyType: 'coupe' },
            { model: 'CT 200h', fuelType: 'hybrid', mpg: 42, tankCapacityGal: 11.9, bodyType: 'hatchback' },
        ]
    },
    {
        make: 'Volkswagen',
        country: 'Germany',
        category: 'european',
        models: [
            { model: 'Jetta', fuelType: 'gasoline', mpg: 35, tankCapacityGal: 13.2, bodyType: 'sedan' },
            { model: 'Jetta GLI', fuelType: 'premium', mpg: 30, tankCapacityGal: 13.2, bodyType: 'sedan' },
            { model: 'Tiguan', fuelType: 'gasoline', mpg: 26, tankCapacityGal: 15.3, bodyType: 'suv' },
            { model: 'Atlas', fuelType: 'gasoline', mpg: 22, tankCapacityGal: 18.6, bodyType: 'suv' },
            { model: 'Atlas Cross Sport', fuelType: 'gasoline', mpg: 22, tankCapacityGal: 18.6, bodyType: 'suv' },
            { model: 'Taos', fuelType: 'gasoline', mpg: 31, tankCapacityGal: 13.2, bodyType: 'suv' },
            { model: 'Golf GTI', fuelType: 'premium', mpg: 28, tankCapacityGal: 13.2, bodyType: 'hatchback' },
            { model: 'Golf R', fuelType: 'premium', mpg: 24, tankCapacityGal: 14.5, bodyType: 'hatchback' },
            { model: 'ID.4 (EV)', fuelType: 'electric', mpg: 107, tankCapacityGal: 82.0, bodyType: 'ev' },
            { model: 'ID. Buzz (EV)', fuelType: 'electric', mpg: 85, tankCapacityGal: 91.0, bodyType: 'ev' },
            { model: 'Passat', fuelType: 'gasoline', mpg: 28, tankCapacityGal: 18.5, bodyType: 'sedan' },
            { model: 'Beetle', fuelType: 'gasoline', mpg: 29, tankCapacityGal: 14.5, bodyType: 'coupe' },
            { model: 'Arteon', fuelType: 'premium', mpg: 26, tankCapacityGal: 17.4, bodyType: 'sedan' },
        ]
    },
    {
        make: 'Audi',
        country: 'Germany',
        category: 'luxury',
        models: [
            { model: 'A4', fuelType: 'premium', mpg: 28, tankCapacityGal: 15.3, bodyType: 'sedan' },
            { model: 'Q5', fuelType: 'premium', mpg: 25, tankCapacityGal: 18.5, bodyType: 'suv' },
            { model: 'Q5 PHEV', fuelType: 'hybrid', mpg: 60, tankCapacityGal: 14.3, bodyType: 'suv' },
            { model: 'A3 / S3', fuelType: 'premium', mpg: 32, tankCapacityGal: 13.2, bodyType: 'sedan' },
            { model: 'Q7', fuelType: 'premium', mpg: 21, tankCapacityGal: 22.5, bodyType: 'suv' },
            { model: 'Q3', fuelType: 'premium', mpg: 25, tankCapacityGal: 15.9, bodyType: 'suv' },
            { model: 'A6 / S6', fuelType: 'premium', mpg: 26, tankCapacityGal: 19.3, bodyType: 'sedan' },
            { model: 'Q8', fuelType: 'premium', mpg: 20, tankCapacityGal: 22.5, bodyType: 'suv' },
            { model: 'A5 / S5 Sportback', fuelType: 'premium', mpg: 27, tankCapacityGal: 15.3, bodyType: 'coupe' },
            { model: 'Q4 e-tron (EV)', fuelType: 'electric', mpg: 103, tankCapacityGal: 82.0, bodyType: 'ev' },
            { model: 'Q8 e-tron (EV)', fuelType: 'electric', mpg: 81, tankCapacityGal: 114.0, bodyType: 'ev' },
            { model: 'e-tron GT (EV)', fuelType: 'electric', mpg: 85, tankCapacityGal: 93.4, bodyType: 'ev' },
            { model: 'A8 / S8', fuelType: 'premium', mpg: 22, tankCapacityGal: 21.7, bodyType: 'sedan' },
            { model: 'TT / TTS', fuelType: 'premium', mpg: 26, tankCapacityGal: 14.5, bodyType: 'coupe' },
        ]
    },
    {
        make: 'Volvo',
        country: 'Sweden',
        category: 'european',
        models: [
            { model: 'XC90', fuelType: 'premium', mpg: 24, tankCapacityGal: 18.8, bodyType: 'suv' },
            { model: 'XC90 Recharge (PHEV)', fuelType: 'hybrid', mpg: 66, tankCapacityGal: 18.8, bodyType: 'suv' },
            { model: 'XC60', fuelType: 'premium', mpg: 25, tankCapacityGal: 18.8, bodyType: 'suv' },
            { model: 'XC60 Recharge (PHEV)', fuelType: 'hybrid', mpg: 63, tankCapacityGal: 18.8, bodyType: 'suv' },
            { model: 'XC40', fuelType: 'premium', mpg: 26, tankCapacityGal: 14.2, bodyType: 'suv' },
            { model: 'EX40 / XC40 Recharge (EV)', fuelType: 'electric', mpg: 98, tankCapacityGal: 82.0, bodyType: 'ev' },
            { model: 'EX30 (EV)', fuelType: 'electric', mpg: 110, tankCapacityGal: 69.0, bodyType: 'ev' },
            { model: 'EX90 (EV)', fuelType: 'electric', mpg: 84, tankCapacityGal: 111.0, bodyType: 'ev' },
            { model: 'S60 / V60', fuelType: 'premium', mpg: 30, tankCapacityGal: 15.9, bodyType: 'sedan' },
            { model: 'S90 / V90', fuelType: 'premium', mpg: 26, tankCapacityGal: 15.9, bodyType: 'sedan' },
        ]
    },
    {
        make: 'Acura',
        country: 'Japan',
        category: 'luxury',
        models: [
            { model: 'MDX', fuelType: 'premium', mpg: 22, tankCapacityGal: 18.5, bodyType: 'suv' },
            { model: 'MDX Type S', fuelType: 'premium', mpg: 19, tankCapacityGal: 18.5, bodyType: 'suv' },
            { model: 'RDX', fuelType: 'premium', mpg: 24, tankCapacityGal: 17.1, bodyType: 'suv' },
            { model: 'TLX', fuelType: 'premium', mpg: 25, tankCapacityGal: 15.8, bodyType: 'sedan' },
            { model: 'TLX Type S', fuelType: 'premium', mpg: 21, tankCapacityGal: 15.8, bodyType: 'sedan' },
            { model: 'Integra', fuelType: 'premium', mpg: 33, tankCapacityGal: 12.4, bodyType: 'hatchback' },
            { model: 'Integra Type S', fuelType: 'premium', mpg: 24, tankCapacityGal: 12.4, bodyType: 'hatchback' },
            { model: 'ZDX (EV)', fuelType: 'electric', mpg: 95, tankCapacityGal: 102.0, bodyType: 'ev' },
            { model: 'ILX', fuelType: 'premium', mpg: 28, tankCapacityGal: 13.2, bodyType: 'sedan' },
            { model: 'TSX', fuelType: 'premium', mpg: 26, tankCapacityGal: 18.5, bodyType: 'sedan' },
            { model: 'TL', fuelType: 'premium', mpg: 23, tankCapacityGal: 18.5, bodyType: 'sedan' },
            { model: 'NSX (Hybrid)', fuelType: 'premium', mpg: 21, tankCapacityGal: 15.6, bodyType: 'coupe' },
        ]
    },
    {
        make: 'Cadillac',
        country: 'USA',
        category: 'luxury',
        models: [
            { model: 'Escalade / Escalade ESV', fuelType: 'premium', mpg: 16, tankCapacityGal: 24.0, bodyType: 'suv' },
            { model: 'Escalade Diesel', fuelType: 'diesel', mpg: 23, tankCapacityGal: 24.0, bodyType: 'suv' },
            { model: 'Escalade IQ (EV)', fuelType: 'electric', mpg: 65, tankCapacityGal: 200.0, bodyType: 'ev' },
            { model: 'XT5', fuelType: 'premium', mpg: 24, tankCapacityGal: 19.4, bodyType: 'suv' },
            { model: 'XT4', fuelType: 'premium', mpg: 26, tankCapacityGal: 15.9, bodyType: 'suv' },
            { model: 'XT6', fuelType: 'premium', mpg: 23, tankCapacityGal: 19.0, bodyType: 'suv' },
            { model: 'CT5 / CT5-V', fuelType: 'premium', mpg: 27, tankCapacityGal: 17.0, bodyType: 'sedan' },
            { model: 'CT4 / CT4-V', fuelType: 'premium', mpg: 27, tankCapacityGal: 17.0, bodyType: 'sedan' },
            { model: 'Lyriq (EV)', fuelType: 'electric', mpg: 92, tankCapacityGal: 102.0, bodyType: 'ev' },
            { model: 'Optiq (EV)', fuelType: 'electric', mpg: 100, tankCapacityGal: 85.0, bodyType: 'ev' },
            { model: 'CTS / CTS-V', fuelType: 'premium', mpg: 24, tankCapacityGal: 18.0, bodyType: 'sedan' },
            { model: 'ATS', fuelType: 'premium', mpg: 25, tankCapacityGal: 16.0, bodyType: 'sedan' },
            { model: 'SRX', fuelType: 'gasoline', mpg: 19, tankCapacityGal: 21.0, bodyType: 'suv' },
        ]
    },
    {
        make: 'Chrysler',
        country: 'USA',
        category: 'american',
        models: [
            { model: 'Pacifica', fuelType: 'gasoline', mpg: 22, tankCapacityGal: 19.0, bodyType: 'van' },
            { model: 'Pacifica Plug-In Hybrid', fuelType: 'hybrid', mpg: 82, tankCapacityGal: 16.5, bodyType: 'van' },
            { model: '300 (V6 / V8)', fuelType: 'gasoline', mpg: 23, tankCapacityGal: 18.5, bodyType: 'sedan' },
            { model: 'Voyager', fuelType: 'gasoline', mpg: 22, tankCapacityGal: 19.0, bodyType: 'van' },
            { model: 'Town & Country', fuelType: 'gasoline', mpg: 20, tankCapacityGal: 20.0, bodyType: 'van' },
            { model: '200', fuelType: 'gasoline', mpg: 28, tankCapacityGal: 15.8, bodyType: 'sedan' },
            { model: 'PT Cruiser', fuelType: 'gasoline', mpg: 23, tankCapacityGal: 15.0, bodyType: 'wagon' },
        ]
    },
    {
        make: 'Buick',
        country: 'USA',
        category: 'american',
        models: [
            { model: 'Encore GX', fuelType: 'gasoline', mpg: 30, tankCapacityGal: 13.2, bodyType: 'suv' },
            { model: 'Envision', fuelType: 'gasoline', mpg: 26, tankCapacityGal: 15.9, bodyType: 'suv' },
            { model: 'Enclave', fuelType: 'gasoline', mpg: 21, tankCapacityGal: 19.4, bodyType: 'suv' },
            { model: 'Envista', fuelType: 'gasoline', mpg: 30, tankCapacityGal: 13.2, bodyType: 'suv' },
            { model: 'Encore', fuelType: 'gasoline', mpg: 27, tankCapacityGal: 14.0, bodyType: 'suv' },
            { model: 'Regal / Regal TourX', fuelType: 'gasoline', mpg: 26, tankCapacityGal: 16.3, bodyType: 'sedan' },
            { model: 'LaCrosse', fuelType: 'gasoline', mpg: 24, tankCapacityGal: 17.0, bodyType: 'sedan' },
            { model: 'Verano', fuelType: 'gasoline', mpg: 25, tankCapacityGal: 15.6, bodyType: 'sedan' },
            { model: 'Lucerne', fuelType: 'gasoline', mpg: 19, tankCapacityGal: 18.5, bodyType: 'sedan' },
            { model: 'LeSabre', fuelType: 'gasoline', mpg: 22, tankCapacityGal: 17.5, bodyType: 'sedan' },
        ]
    },
    {
        make: 'Lincoln',
        country: 'USA',
        category: 'luxury',
        models: [
            { model: 'Navigator / Navigator L', fuelType: 'premium', mpg: 18, tankCapacityGal: 23.6, bodyType: 'suv' },
            { model: 'Aviator', fuelType: 'premium', mpg: 21, tankCapacityGal: 20.2, bodyType: 'suv' },
            { model: 'Corsair', fuelType: 'gasoline', mpg: 25, tankCapacityGal: 16.2, bodyType: 'suv' },
            { model: 'Corsair Grand Touring (PHEV)', fuelType: 'hybrid', mpg: 78, tankCapacityGal: 11.1, bodyType: 'suv' },
            { model: 'Nautilus', fuelType: 'gasoline', mpg: 24, tankCapacityGal: 20.0, bodyType: 'suv' },
            { model: 'Nautilus Hybrid', fuelType: 'hybrid', mpg: 30, tankCapacityGal: 19.8, bodyType: 'suv' },
            { model: 'MKZ / MKZ Hybrid', fuelType: 'gasoline', mpg: 24, tankCapacityGal: 16.5, bodyType: 'sedan' },
            { model: 'MKX', fuelType: 'gasoline', mpg: 20, tankCapacityGal: 18.0, bodyType: 'suv' },
            { model: 'Town Car', fuelType: 'gasoline', mpg: 19, tankCapacityGal: 19.0, bodyType: 'sedan' },
        ]
    },
    {
        make: 'Infiniti',
        country: 'Japan',
        category: 'luxury',
        models: [
            { model: 'Q50', fuelType: 'premium', mpg: 23, tankCapacityGal: 20.0, bodyType: 'sedan' },
            { model: 'QX60', fuelType: 'premium', mpg: 23, tankCapacityGal: 18.5, bodyType: 'suv' },
            { model: 'QX50', fuelType: 'premium', mpg: 26, tankCapacityGal: 16.0, bodyType: 'suv' },
            { model: 'QX55', fuelType: 'premium', mpg: 25, tankCapacityGal: 16.0, bodyType: 'suv' },
            { model: 'QX80', fuelType: 'premium', mpg: 17, tankCapacityGal: 23.8, bodyType: 'suv' },
            { model: 'Q60', fuelType: 'premium', mpg: 22, tankCapacityGal: 20.0, bodyType: 'coupe' },
            { model: 'G37 / G35', fuelType: 'premium', mpg: 21, tankCapacityGal: 20.0, bodyType: 'sedan' },
            { model: 'FX35 / FX37', fuelType: 'premium', mpg: 19, tankCapacityGal: 23.8, bodyType: 'suv' },
        ]
    },
    {
        make: 'Genesis',
        country: 'South Korea',
        category: 'luxury',
        models: [
            { model: 'GV70', fuelType: 'premium', mpg: 24, tankCapacityGal: 17.4, bodyType: 'suv' },
            { model: 'Electrified GV70 (EV)', fuelType: 'electric', mpg: 91, tankCapacityGal: 77.4, bodyType: 'ev' },
            { model: 'GV80', fuelType: 'premium', mpg: 22, tankCapacityGal: 21.1, bodyType: 'suv' },
            { model: 'G70', fuelType: 'premium', mpg: 25, tankCapacityGal: 15.8, bodyType: 'sedan' },
            { model: 'G80', fuelType: 'premium', mpg: 25, tankCapacityGal: 19.3, bodyType: 'sedan' },
            { model: 'Electrified G80 (EV)', fuelType: 'electric', mpg: 97, tankCapacityGal: 87.2, bodyType: 'ev' },
            { model: 'G90', fuelType: 'premium', mpg: 21, tankCapacityGal: 19.3, bodyType: 'sedan' },
            { model: 'GV60 (EV)', fuelType: 'electric', mpg: 101, tankCapacityGal: 77.4, bodyType: 'ev' },
        ]
    },
    {
        make: 'Rivian',
        country: 'USA',
        category: 'electric',
        models: [
            { model: 'R1T Dual-Motor', fuelType: 'electric', mpg: 78, tankCapacityGal: 135.0, bodyType: 'ev' },
            { model: 'R1T Tri-Motor / Quad-Motor', fuelType: 'electric', mpg: 70, tankCapacityGal: 149.0, bodyType: 'ev' },
            { model: 'R1S Dual-Motor', fuelType: 'electric', mpg: 78, tankCapacityGal: 135.0, bodyType: 'ev' },
            { model: 'R1S Tri-Motor / Quad-Motor', fuelType: 'electric', mpg: 71, tankCapacityGal: 149.0, bodyType: 'ev' },
            { model: 'Commercial Delivery Van (EDV)', fuelType: 'electric', mpg: 65, tankCapacityGal: 100.0, bodyType: 'ev' },
            { model: 'R2 (Upcoming)', fuelType: 'electric', mpg: 105, tankCapacityGal: 80.0, bodyType: 'ev' },
            { model: 'R3 / R3X (Upcoming)', fuelType: 'electric', mpg: 110, tankCapacityGal: 70.0, bodyType: 'ev' },
        ]
    },
    {
        make: 'Lucid',
        country: 'USA',
        category: 'electric',
        models: [
            { model: 'Air Pure (EV)', fuelType: 'electric', mpg: 140, tankCapacityGal: 88.0, bodyType: 'ev' },
            { model: 'Air Touring / Grand Touring (EV)', fuelType: 'electric', mpg: 130, tankCapacityGal: 118.0, bodyType: 'ev' },
            { model: 'Air Sapphire (EV)', fuelType: 'electric', mpg: 105, tankCapacityGal: 118.0, bodyType: 'ev' },
            { model: 'Gravity SUV (EV)', fuelType: 'electric', mpg: 110, tankCapacityGal: 120.0, bodyType: 'ev' },
        ]
    },
    {
        make: 'Polestar',
        country: 'Sweden',
        category: 'electric',
        models: [
            { model: 'Polestar 2 Single Motor', fuelType: 'electric', mpg: 115, tankCapacityGal: 82.0, bodyType: 'ev' },
            { model: 'Polestar 2 Dual Motor', fuelType: 'electric', mpg: 106, tankCapacityGal: 78.0, bodyType: 'ev' },
            { model: 'Polestar 3 (EV)', fuelType: 'electric', mpg: 90, tankCapacityGal: 111.0, bodyType: 'ev' },
            { model: 'Polestar 4 (EV)', fuelType: 'electric', mpg: 102, tankCapacityGal: 100.0, bodyType: 'ev' },
        ]
    },
    {
        make: 'Mini',
        country: 'UK',
        category: 'european',
        models: [
            { model: 'Cooper Hardtop 2-Door / 4-Door', fuelType: 'premium', mpg: 33, tankCapacityGal: 11.6, bodyType: 'hatchback' },
            { model: 'Cooper S Hardtop', fuelType: 'premium', mpg: 31, tankCapacityGal: 11.6, bodyType: 'hatchback' },
            { model: 'Cooper SE (EV)', fuelType: 'electric', mpg: 110, tankCapacityGal: 32.6, bodyType: 'ev' },
            { model: 'Countryman', fuelType: 'premium', mpg: 28, tankCapacityGal: 14.5, bodyType: 'suv' },
            { model: 'Countryman ALL4 (EV)', fuelType: 'electric', mpg: 95, tankCapacityGal: 66.5, bodyType: 'ev' },
            { model: 'Clubman', fuelType: 'premium', mpg: 29, tankCapacityGal: 13.2, bodyType: 'wagon' },
            { model: 'Cooper Convertible', fuelType: 'premium', mpg: 31, tankCapacityGal: 11.6, bodyType: 'coupe' },
        ]
    },
    {
        make: 'Mitsubishi',
        country: 'Japan',
        category: 'asian',
        models: [
            { model: 'Outlander', fuelType: 'gasoline', mpg: 27, tankCapacityGal: 14.5, bodyType: 'suv' },
            { model: 'Outlander PHEV', fuelType: 'hybrid', mpg: 64, tankCapacityGal: 14.8, bodyType: 'suv' },
            { model: 'Outlander Sport', fuelType: 'gasoline', mpg: 26, tankCapacityGal: 16.6, bodyType: 'suv' },
            { model: 'Eclipse Cross', fuelType: 'gasoline', mpg: 26, tankCapacityGal: 15.8, bodyType: 'suv' },
            { model: 'Mirage', fuelType: 'gasoline', mpg: 39, tankCapacityGal: 9.2, bodyType: 'hatchback' },
            { model: 'Mirage G4', fuelType: 'gasoline', mpg: 37, tankCapacityGal: 9.2, bodyType: 'sedan' },
            { model: 'Lancer / Evolution', fuelType: 'gasoline', mpg: 27, tankCapacityGal: 15.5, bodyType: 'sedan' },
            { model: 'Galant', fuelType: 'gasoline', mpg: 24, tankCapacityGal: 17.7, bodyType: 'sedan' },
        ]
    },
    {
        make: 'Land Rover',
        country: 'UK',
        category: 'luxury',
        models: [
            { model: 'Range Rover', fuelType: 'premium', mpg: 21, tankCapacityGal: 23.8, bodyType: 'suv' },
            { model: 'Range Rover Sport', fuelType: 'premium', mpg: 22, tankCapacityGal: 23.8, bodyType: 'suv' },
            { model: 'Defender 90 / 110 / 130', fuelType: 'premium', mpg: 20, tankCapacityGal: 23.8, bodyType: 'suv' },
            { model: 'Discovery', fuelType: 'premium', mpg: 21, tankCapacityGal: 23.8, bodyType: 'suv' },
            { model: 'Discovery Sport', fuelType: 'premium', mpg: 20, tankCapacityGal: 17.7, bodyType: 'suv' },
            { model: 'Range Rover Velar', fuelType: 'premium', mpg: 23, tankCapacityGal: 21.6, bodyType: 'suv' },
            { model: 'Range Rover Evoque', fuelType: 'premium', mpg: 22, tankCapacityGal: 17.7, bodyType: 'suv' },
        ]
    },
    {
        make: 'Porsche',
        country: 'Germany',
        category: 'luxury',
        models: [
            { model: 'Macan / Macan S', fuelType: 'premium', mpg: 21, tankCapacityGal: 19.8, bodyType: 'suv' },
            { model: 'Macan EV', fuelType: 'electric', mpg: 95, tankCapacityGal: 100.0, bodyType: 'ev' },
            { model: 'Cayenne', fuelType: 'premium', mpg: 19, tankCapacityGal: 23.7, bodyType: 'suv' },
            { model: 'Cayenne E-Hybrid', fuelType: 'hybrid', mpg: 45, tankCapacityGal: 19.8, bodyType: 'suv' },
            { model: '911 Carrera / Turbo / GT3', fuelType: 'premium', mpg: 20, tankCapacityGal: 16.9, bodyType: 'coupe' },
            { model: 'Taycan / Taycan Cross Turismo (EV)', fuelType: 'electric', mpg: 88, tankCapacityGal: 93.4, bodyType: 'ev' },
            { model: 'Panamera', fuelType: 'premium', mpg: 21, tankCapacityGal: 21.1, bodyType: 'sedan' },
            { model: '718 Cayman / Boxster', fuelType: 'premium', mpg: 24, tankCapacityGal: 14.3, bodyType: 'coupe' },
        ]
    },
    {
        make: 'Jaguar',
        country: 'UK',
        category: 'luxury',
        models: [
            { model: 'F-PACE', fuelType: 'premium', mpg: 24, tankCapacityGal: 21.7, bodyType: 'suv' },
            { model: 'E-PACE', fuelType: 'premium', mpg: 23, tankCapacityGal: 17.7, bodyType: 'suv' },
            { model: 'I-PACE (EV)', fuelType: 'electric', mpg: 85, tankCapacityGal: 90.0, bodyType: 'ev' },
            { model: 'XF', fuelType: 'premium', mpg: 26, tankCapacityGal: 19.5, bodyType: 'sedan' },
            { model: 'F-TYPE', fuelType: 'premium', mpg: 20, tankCapacityGal: 18.5, bodyType: 'coupe' },
            { model: 'XE', fuelType: 'premium', mpg: 28, tankCapacityGal: 16.6, bodyType: 'sedan' },
            { model: 'XJ', fuelType: 'premium', mpg: 21, tankCapacityGal: 21.7, bodyType: 'sedan' },
        ]
    },
    {
        make: 'Alfa Romeo',
        country: 'Italy',
        category: 'european',
        models: [
            { model: 'Giulia', fuelType: 'premium', mpg: 27, tankCapacityGal: 15.3, bodyType: 'sedan' },
            { model: 'Giulia Quadrifoglio', fuelType: 'premium', mpg: 20, tankCapacityGal: 15.3, bodyType: 'sedan' },
            { model: 'Stelvio', fuelType: 'premium', mpg: 25, tankCapacityGal: 16.9, bodyType: 'suv' },
            { model: 'Tonale (PHEV)', fuelType: 'hybrid', mpg: 77, tankCapacityGal: 11.2, bodyType: 'suv' },
        ]
    },
    {
        make: 'Fiat',
        country: 'Italy',
        category: 'european',
        models: [
            { model: '500e (EV)', fuelType: 'electric', mpg: 116, tankCapacityGal: 42.0, bodyType: 'ev' },
            { model: '500X', fuelType: 'premium', mpg: 26, tankCapacityGal: 12.7, bodyType: 'suv' },
            { model: '500 / 500c / Abarth', fuelType: 'premium', mpg: 31, tankCapacityGal: 10.5, bodyType: 'hatchback' },
            { model: '124 Spider', fuelType: 'premium', mpg: 30, tankCapacityGal: 11.9, bodyType: 'coupe' },
            { model: '500L', fuelType: 'gasoline', mpg: 25, tankCapacityGal: 13.2, bodyType: 'wagon' },
        ]
    },
    {
        make: 'Scion',
        country: 'Japan',
        category: 'asian',
        models: [
            { model: 'tC', fuelType: 'gasoline', mpg: 26, tankCapacityGal: 14.5, bodyType: 'coupe' },
            { model: 'xB', fuelType: 'gasoline', mpg: 24, tankCapacityGal: 14.0, bodyType: 'wagon' },
            { model: 'FR-S', fuelType: 'premium', mpg: 28, tankCapacityGal: 13.2, bodyType: 'coupe' },
            { model: 'xD', fuelType: 'gasoline', mpg: 29, tankCapacityGal: 11.1, bodyType: 'hatchback' },
            { model: 'xA', fuelType: 'gasoline', mpg: 31, tankCapacityGal: 11.9, bodyType: 'hatchback' },
            { model: 'iM', fuelType: 'gasoline', mpg: 31, tankCapacityGal: 14.0, bodyType: 'hatchback' },
            { model: 'iA', fuelType: 'gasoline', mpg: 35, tankCapacityGal: 11.6, bodyType: 'sedan' },
        ]
    },
    {
        make: 'Pontiac',
        country: 'USA',
        category: 'american',
        models: [
            { model: 'Grand Prix', fuelType: 'gasoline', mpg: 22, tankCapacityGal: 17.0, bodyType: 'sedan' },
            { model: 'G6', fuelType: 'gasoline', mpg: 25, tankCapacityGal: 16.0, bodyType: 'sedan' },
            { model: 'Vibe', fuelType: 'gasoline', mpg: 29, tankCapacityGal: 13.2, bodyType: 'hatchback' },
            { model: 'Bonneville', fuelType: 'gasoline', mpg: 20, tankCapacityGal: 18.5, bodyType: 'sedan' },
            { model: 'Firebird / Trans Am', fuelType: 'gasoline', mpg: 19, tankCapacityGal: 16.8, bodyType: 'coupe' },
            { model: 'G8 / GTO', fuelType: 'premium', mpg: 17, tankCapacityGal: 19.3, bodyType: 'sedan' },
            { model: 'Torrent', fuelType: 'gasoline', mpg: 20, tankCapacityGal: 16.6, bodyType: 'suv' },
            { model: 'Solstice', fuelType: 'gasoline', mpg: 23, tankCapacityGal: 13.0, bodyType: 'coupe' },
        ]
    },
    {
        make: 'Saturn',
        country: 'USA',
        category: 'american',
        models: [
            { model: 'Vue', fuelType: 'gasoline', mpg: 23, tankCapacityGal: 16.5, bodyType: 'suv' },
            { model: 'Ion', fuelType: 'gasoline', mpg: 28, tankCapacityGal: 13.2, bodyType: 'sedan' },
            { model: 'Aura', fuelType: 'gasoline', mpg: 26, tankCapacityGal: 16.0, bodyType: 'sedan' },
            { model: 'Outlook', fuelType: 'gasoline', mpg: 19, tankCapacityGal: 22.0, bodyType: 'suv' },
            { model: 'Astra', fuelType: 'gasoline', mpg: 27, tankCapacityGal: 14.0, bodyType: 'hatchback' },
            { model: 'Sky', fuelType: 'gasoline', mpg: 23, tankCapacityGal: 13.0, bodyType: 'coupe' },
            { model: 'SL / SL1 / SL2', fuelType: 'gasoline', mpg: 31, tankCapacityGal: 12.1, bodyType: 'sedan' },
        ]
    },
    {
        make: 'Mercury',
        country: 'USA',
        category: 'american',
        models: [
            { model: 'Grand Marquis', fuelType: 'gasoline', mpg: 19, tankCapacityGal: 19.0, bodyType: 'sedan' },
            { model: 'Mariner / Mariner Hybrid', fuelType: 'gasoline', mpg: 23, tankCapacityGal: 15.0, bodyType: 'suv' },
            { model: 'Milan / Milan Hybrid', fuelType: 'gasoline', mpg: 27, tankCapacityGal: 16.5, bodyType: 'sedan' },
            { model: 'Mountaineer', fuelType: 'gasoline', mpg: 17, tankCapacityGal: 22.5, bodyType: 'suv' },
            { model: 'Sable', fuelType: 'gasoline', mpg: 21, tankCapacityGal: 20.0, bodyType: 'sedan' },
            { model: 'Cougar', fuelType: 'gasoline', mpg: 23, tankCapacityGal: 15.5, bodyType: 'coupe' },
            { model: 'Villager', fuelType: 'gasoline', mpg: 19, tankCapacityGal: 20.0, bodyType: 'van' },
        ]
    },
    {
        make: 'Saab',
        country: 'Sweden',
        category: 'european',
        models: [
            { model: '9-3 Sedan / Aero', fuelType: 'premium', mpg: 24, tankCapacityGal: 16.4, bodyType: 'sedan' },
            { model: '9-5 Sedan / Wagon', fuelType: 'premium', mpg: 22, tankCapacityGal: 18.5, bodyType: 'sedan' },
            { model: '9-7X', fuelType: 'gasoline', mpg: 16, tankCapacityGal: 22.0, bodyType: 'suv' },
        ]
    },
    {
        make: 'Suzuki',
        country: 'Japan',
        category: 'asian',
        models: [
            { model: 'Grand Vitara', fuelType: 'gasoline', mpg: 21, tankCapacityGal: 17.4, bodyType: 'suv' },
            { model: 'SX4', fuelType: 'gasoline', mpg: 26, tankCapacityGal: 11.9, bodyType: 'hatchback' },
            { model: 'Kizashi', fuelType: 'gasoline', mpg: 26, tankCapacityGal: 16.6, bodyType: 'sedan' },
            { model: 'XL7', fuelType: 'gasoline', mpg: 19, tankCapacityGal: 18.7, bodyType: 'suv' },
        ]
    },
    {
        make: 'Maserati',
        country: 'Italy',
        category: 'luxury',
        models: [
            { model: 'Ghibli', fuelType: 'premium', mpg: 20, tankCapacityGal: 21.1, bodyType: 'sedan' },
            { model: 'Levante', fuelType: 'premium', mpg: 19, tankCapacityGal: 21.1, bodyType: 'suv' },
            { model: 'Grecale', fuelType: 'premium', mpg: 24, tankCapacityGal: 16.9, bodyType: 'suv' },
            { model: 'Grecale Folgore (EV)', fuelType: 'electric', mpg: 85, tankCapacityGal: 105.0, bodyType: 'ev' },
            { model: 'Quattroporte', fuelType: 'premium', mpg: 18, tankCapacityGal: 21.1, bodyType: 'sedan' },
            { model: 'GranTurismo / Folgore', fuelType: 'premium', mpg: 21, tankCapacityGal: 18.5, bodyType: 'coupe' },
        ]
    }
];

/**
 * Get all available makes alphabetically
 */
export const getAllMakes = (): string[] => {
    return VEHICLE_DATABASE.map(v => v.make).sort((a, b) => a.localeCompare(b));
};

/**
 * Get models for a specific make
 */
export const getModelsForMake = (makeName: string): VehicleModelInfo[] => {
    const found = VEHICLE_DATABASE.find(
        v => v.make.toLowerCase() === makeName.trim().toLowerCase()
    );
    return found ? found.models : [];
};

/**
 * Find default model info for a make + model combination
 */
export const findModelDefaults = (makeName: string, modelName: string): VehicleModelInfo | undefined => {
    const models = getModelsForMake(makeName);
    if (!models.length) return undefined;
    return models.find(
        m => m.model.toLowerCase() === modelName.trim().toLowerCase()
    );
};
