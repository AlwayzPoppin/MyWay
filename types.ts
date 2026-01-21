
export interface Location {
  lat: number;
  lng: number;
  label?: string;
}

export interface RouteStep {
  instruction: string;
  distance: string;
  endLocation?: Location; // Coordinates for the end of this step
}

export interface IncidentReport {
  id: string;
  type: 'police' | 'hazard' | 'traffic' | 'safety_alert';
  location: Location;
  timestamp: string;
  reporterId: string;
}

export interface NavigationRoute {
  destinationName: string;
  destinationLoc: Location;
  startLoc?: Location; // Start location for navigation engine
  steps: RouteStep[];
  totalDistance: string;
  totalTime: string;
  safetyAdvisory?: string;
}

export interface CircleTask {
  id: string;
  title: string;
  location: Location;
  assigneeId?: string;
  isCompleted: boolean;
  category: 'errand' | 'pickup' | 'dropoff';
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
  status: 'Moving' | 'Stationary' | 'Driving' | 'Offline' | 'Arrived';
  currentPlace?: string;
  safetyScore: number;
  pathHistory: Location[];
  driveEvents: { type: 'hard_brake' | 'rapid_accel' | 'speeding'; count: number }[];
  destination?: string;
  isGhostMode?: boolean;
  sosActive?: boolean;
  membershipTier: 'free' | 'gold' | 'platinum';
  wayType?: 'HisWay' | 'HerWay' | 'NoWay';
}

export interface Place {
  id: string;
  name: string;
  location: Location;
  radius: number;
  type: 'home' | 'work' | 'school' | 'gym' | 'gas' | 'food' | 'coffee' | 'other' | 'search_result' | 'sponsored';
  icon: string;
  brandColor?: string;
  deal?: string;
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
