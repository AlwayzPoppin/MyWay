
export interface Location {
  lat: number;
  lng: number;
  label?: string;
}

export type LaneDirection = 'straight' | 'slight_right' | 'right' | 'slight_left' | 'left' | 'uturn';

export interface LaneGuidance {
  direction: LaneDirection;
  isValid: boolean; // whether this lane is suitable for the current maneuver
  isActive?: boolean; // currently recommended lane
}

export type CongestionLevel = 'low' | 'moderate' | 'heavy' | 'severe';

export interface TrafficSegment {
  coordinates: [number, number][]; // [[lng, lat], ...]
  congestion: CongestionLevel; // 'low' (green/blue), 'moderate' (amber), 'heavy' (orange/red), 'severe' (dark crimson)
  speedMph?: number;
  lengthMeters?: number;
  annotationIndex?: number;
}

export type TrafficControlType = 'stop_sign' | 'traffic_light' | 'railroad_crossing' | 'speed_camera' | 'crosswalk';

export interface TrafficControlPoint {
  id: string;
  type: TrafficControlType;
  location: Location;
  name?: string;
  bearing?: number;
}

export interface RouteStep {
  instruction: string;
  distance: string;
  endLocation?: Location; // Coordinates for the end of this step
  speedLimit?: number; // Speed limit in MPH
  hasCamera?: boolean; // Safety or speed camera nearby
  lanes?: LaneGuidance[]; // Lane guidance indicators for multi-lane maneuvers
  isToll?: boolean; // Step is on a toll road, bridge, or turnpike
  tollName?: string; // e.g. "NJ Turnpike", "Verrazzano-Narrows Bridge"
  estimatedToll?: number; // e.g. 19.50
  congestion?: CongestionLevel;
  trafficControl?: TrafficControlType; // Stop sign, traffic light, railroad crossing, etc.
}

export type IncidentType = 'police' | 'hazard' | 'shoulder' | 'construction' | 'traffic' | 'safety_alert';

export interface IncidentReport {
  id: string;
  type: IncidentType;
  location: Location;
  timestamp: string;
  reporterId: string;
  reporterName?: string;
  reporterAvatar?: string;
  details?: string;
  upvotes?: number;
  upvoterIds?: string[];
  downvotes?: number;
  downvoterIds?: string[];
  expiresAt?: number;
  verified?: boolean;
}

export interface RouteWaypoint {
  id: string;
  name: string;
  location: Location;
  order: number;
  isStop?: boolean;
}

export interface RouteLeg {
  distance: string;
  distanceMeters: number;
  duration: string;
  durationSeconds: number;
  steps: RouteStep[];
  targetWaypoint: RouteWaypoint;
  summary?: string;
}

export interface NavigationRoute {
  id?: string;
  destinationName: string;
  destinationLoc: Location;
  startLoc?: Location; // Start location for navigation engine
  steps: RouteStep[];
  totalDistance: string;
  totalTime: string;
  durationMinutes?: number;
  totalDurationSec?: number;
  distanceMeters?: number;
  routeType?: 'fastest' | 'shortest' | 'eco' | 'toll_free' | 'scenic';
  routeLabel?: string; // e.g. "Fastest Route", "Toll-Free (Save $50.60)", "Shortest Distance", "Eco Fuel Saver"
  summary?: string; // e.g. "via I-95 N & NJ Turnpike", "via I-295 & US-1"
  fuelEstimateGal?: number; // e.g. 0.28 gallons
  fuelCostEstimate?: string; // e.g. "$68.66"
  hasTolls?: boolean;
  estimatedTolls?: number; // e.g. 50.60
  tollCostEstimate?: string; // e.g. "$50.60 tolls" or "No Tolls"
  tollSummary?: string; // e.g. "NJ Turnpike, DE Memorial Bridge, Verrazzano Bridge"
  totalEstimatedTripCost?: string; // e.g. "$119.26 (Gas + Tolls)"
  savingsLabel?: string; // e.g. "Save $50.60 in tolls", "Save 12.1 mi"
  safetyAdvisory?: string;
  routeGeometry?: [number, number][]; // Full road-following polyline [[lng,lat], ...] from OSRM
  trafficSegments?: TrafficSegment[]; // Visual live traffic congestion polyline segments
  congestionLevel?: CongestionLevel; // Predominant route congestion
  trafficControls?: TrafficControlPoint[]; // Stop signs, traffic lights, railroad crossings along route
  destinationImageUrl?: string; // Storefront / entrance photo URL or Data URI
  destinationEntranceNotes?: string; // Entrance / parking guidance notes
  destinationEntranceType?: EntranceType; // Drive-thru, parking, main door, curbside
  waypoints?: RouteWaypoint[]; // Ordered intermediate waypoints/stops
  legs?: RouteLeg[]; // Individual route legs connecting start -> stop1 -> stop2 -> destination
  currentLegIndex?: number; // Active leg index during navigation
}

export interface CircleTask {
  id: string;
  title: string;
  location: Location;
  assigneeId?: string;
  isCompleted: boolean;
  category: 'errand' | 'pickup' | 'dropoff';
}

export interface CurrentTrip {
  destinationName: string;
  totalTime: string;
  totalDistance: string;
  etaTimestamp?: number;
  destinationCoords?: Location;
}

export type PrivacyMode = 'exact' | 'blurred' | 'status_only' | 'frozen';

export interface CrashImpactMetadata {
  speed: number; // Speed in MPH at impact
  gForce: number; // G-force magnitude (e.g. 4.5G)
  deceleration?: number; // Deceleration in m/s²
  severity?: 'moderate' | 'severe' | 'critical';
}

export interface FamilyMember {
  id: string;
  name: string;
  role: string;
  avatar: string;
  location: Location;
  accuracy?: number;
  signalQuality?: 'excellent' | 'good' | 'poor';
  heading?: number;
  battery: number;
  speed: number;
  lastUpdated: string;
  status: 'Moving' | 'Stationary' | 'Driving' | 'Walking' | 'Offline' | 'Arrived';
  currentPlace?: string;
  safetyScore: number;
  pathHistory: Location[];
  driveEvents: { type: 'hard_brake' | 'rapid_accel' | 'speeding'; count: number }[];
  destination?: string;
  currentTrip?: CurrentTrip | null;
  isGhostMode?: boolean;
  privacyMode?: PrivacyMode;
  blurredRadiusMeters?: number;
  sosActive?: boolean;
  impact?: CrashImpactMetadata;
  locationStale?: boolean; // Audit Fix: Flag for E2EE key exchange pending (shows last known location)
  membershipTier: 'free' | 'gold' | 'platinum';
  circleId?: string;
  circleName?: string;
  circleColor?: string;
  circleBadges?: { id: string; name: string; color: string }[];
}

export type EntranceType = 'drive_thru' | 'parking' | 'main_door' | 'curbside' | 'general';

export interface Place {
  id: string;
  name: string;
  location: Location;
  radius: number;
  type: 'home' | 'work' | 'school' | 'gym' | 'gas' | 'food' | 'coffee' | 'other' | 'search_result' | 'sponsored' | 'maintenance' | 'mechanic' | 'emergency' | 'hospital' | 'police' | 'fire_station' | 'pharmacy' | 'grocery';
  icon: string;
  brandColor?: string;
  isAmbient?: boolean; // Ambient Waze-style always-visible POI on map (gas, fire, hospital, police, etc.)
  deal?: string;
  description?: string; // Full address string (e.g., "123 Main St, City, State, USA")
  address?: string; // Optional alias for address string
  rating?: number;
  detourMinutes?: number;
  detourMiles?: number;
  maintenanceCategory?: string; // e.g. "Oil Change", "Tire Rotation", "Brake Inspection"
  imageUrl?: string; // Storefront / entrance photo URL or Data URI
  isCorrected?: boolean; // User-verified / corrected entrance location
  entranceType?: EntranceType; // Specific entrance category (drive-thru, parking, main door, curbside)
  entranceNotes?: string; // e.g. "East side drive-thru entrance"
  correctedAt?: number; // Timestamp of the correction
  submitterId?: string; // Member ID who verified the pin
  submitterName?: string; // Display name (e.g. "Mom", "Alex")
  submitterAvatar?: string; // Submitter avatar URL or icon
  helpfulCount?: number; // Total "Helpful" upvotes
  helpfulUserIds?: string[]; // IDs of members who upvoted
  originalLocation?: Location; // Location prior to correction
}

export interface ArrivalTripData {
  destinationName: string;
  destinationLoc: Location;
  destinationPlace: Place;
  totalDistance?: string;
  totalTime?: string;
  safetyScore?: number;
  arrivedAt: number;
}

export interface PrivacyZone {
  id: string;
  name: string;
  location: Location;
  radius: number;
}

export interface SmartDevice {
  id: string;
  name: string;
  type: 'thermostat' | 'light' | 'garage' | 'lock' | 'camera';
  value: string | number | boolean;
  unit?: string;
  room: string;
}

export interface HomeState {
  devices: SmartDevice[];
  securityMode: 'armed' | 'disarmed' | 'stay';
}

export interface GroundingLink {
  title: string;
  uri: string;
}

export interface ChatMessage {
  id: string;
  senderId: string;
  text: string;
  timestamp: string;
  isAI?: boolean;
  groundingLinks?: GroundingLink[];
}

export interface DailyInsight {
  title: string;
  description: string;
  category: 'safety' | 'efficiency' | 'reminder' | 'offer';
}

export interface Reward {
  id: string;
  brand: string;
  title: string;
  code: string;
  expiry: string;
  icon: string;
}

export interface Vehicle {
  id: string;
  name: string; // e.g. "My 2023 Honda Civic"
  make: string;
  model: string;
  year?: number;
  fuelType: 'gasoline' | 'premium' | 'diesel' | 'hybrid' | 'electric';
  mpg: number; // Combined MPG (or MPGe for EV)
  tankCapacityGal?: number;
  isPrimary?: boolean;
}

export interface TripPoint {
  lat: number;
  lng: number;
  speed: number;
  heading: number;
  timestamp: number;
}

export interface Trip {
  id: string;
  userId: string;
  startTime: number;
  endTime?: number;
  startLocation: Location;
  endLocation?: Location;
  destinationName?: string;
  path: TripPoint[];
  totalDistanceMiles: number;
  maxSpeedMph: number;
  avgSpeedMph: number;
  driveEvents: { type: 'hard_brake' | 'rapid_accel' | 'speeding'; timestamp: number; location: Location }[];
  safetyScore: number;
  isActive: boolean;
  fuelGallons?: number;
  fuelCost?: number;
  moneySaved?: number;
  vehicleName?: string;
}
