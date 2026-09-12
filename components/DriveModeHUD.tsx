
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { NavigationRoute, FamilyMember, Location, IncidentReport, IncidentType, Place } from '../types';
import { speechService } from '../services/speechService';
import { audioService } from '../services/audioService';
import { BetterRouteSuggestion, UpcomingTollAlert, LeaderDivertedPrompt, AmbientMaintenanceAdvisory } from '../hooks/useNavigation';
import { convoyService, ConvoyMember, ConvoySession } from '../services/convoyService';
import { maintenanceAlertService } from '../services/maintenanceAlertService';
import { vehicleFuelService, LiveFuelSnapshot, LowFuelAlert } from '../services/vehicleFuelService';
import { incidentService } from '../services/incidentService';
import { getDistanceMeters } from '../utils/geo';
import { searchCoffeeShops, searchGasStations, searchGroceryStores, searchPlacesText, searchRestaurants } from '../services/placesService';
import IncidentReporter from './IncidentReporter';
import {
  OctagonAlert,
  TrafficCone,
  TrainFront,
  Camera,
  Flag,
  Signpost,
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
  Car,
  HardHat,
  Gauge,
  ThumbsUp,
  Check,
  CheckCircle2,
  Maximize2,
  SquareParking,
  Package,
  DoorOpen,
  GitFork,
  Zap,
  Navigation,
  Wrench,
  Plus,
  CreditCard,
  Users,
  Route,
  RefreshCw,
  Volume2,
  VolumeX,
  Crosshair,
  ChevronDown,
  ChevronUp,
  Lightbulb,
  Coffee,
  XCircle,
  X,
  Fuel,
  Disc,
  CloudRain,
  ArrowUp,
  CornerUpLeft,
  CornerUpRight,
  RotateCcw
} from 'lucide-react';

const renderAdvisoryIcon = (iconName?: string, type?: string, className: string = "w-4 h-4") => {
  if (iconName === 'wrench') return <Wrench className={className} />;
  if (iconName === 'oil' || iconName === 'oil_change') return <Fuel className={className} />;
  if (iconName === 'tire' || iconName === 'tires' || iconName === 'disc') return <Disc className={className} />;
  if (iconName === 'brakes') return <OctagonAlert className={className} />;
  if (type === 'weather') return <CloudRain className={className} />;
  if (type === 'traffic') return <Car className={className} />;
  if (type === 'crime') return <ShieldAlert className={className} />;
  return <AlertTriangle className={className} />;
};

const getRouteRoadNames = (route: NavigationRoute): string[] => {
  const seen = new Set<string>();
  const addRoad = (candidate?: string) => {
    const road = candidate?.replace(/^via\s+/i, '').replace(/[.,;]+$/, '').trim();
    const normalized = road?.toLowerCase();
    if (!road || !normalized || road.length < 2 || normalized.includes('destination') || normalized.includes('the route') || seen.has(normalized)) return;
    seen.add(normalized);
  };

  // OSRM leg summaries contain the most useful high-level road names.  They
  // should be preferred over every individual maneuver in the route.
  const summaryRoads = route.summary?.replace(/^via\s+/i, '').split(/\s*\/\s*|\s*,\s*|\s+&\s+/) || [];
  summaryRoads.forEach(addRoad);

  route.steps.forEach(step => {
    const match = step.instruction?.match(/(?:onto|on|toward)\s+(.+?)(?:\s+(?:then|and)\s+|$)/i);
    addRoad(match?.[1]);
  });

  return Array.from(seen).map(normalized => {
    const fromSummary = summaryRoads.find(road => road.trim().toLowerCase() === normalized);
    const fromStep = route.steps
      .map(step => step.instruction?.match(/(?:onto|on|toward)\s+(.+?)(?:\s+(?:then|and)\s+|$)/i)?.[1])
      .find(road => road?.trim().toLowerCase() === normalized);
    return (fromSummary || fromStep || normalized).replace(/[.,;]+$/, '').trim();
  }).slice(0, 3);
};

interface DriveModeHUDProps {
  route: NavigationRoute;
  speed: number;
  onCancel: () => void;
  theme: 'light' | 'dark';
  stepIndex: number;
  safetyScore?: number;
  sessionPoints?: number;
  isMobile?: boolean;
  betterRouteSuggestion?: BetterRouteSuggestion | null;
  alternativeRoutes?: NavigationRoute[];
  onRecalculateRoutes?: () => void;
  isRecalculatingRoutes?: boolean;
  onSwitchRoute?: (route: NavigationRoute) => void;
  onDismissReroute?: () => void;
  upcomingTollAlert?: UpcomingTollAlert | null;
  onTakeTollFreeExit?: () => void;
  onDismissTollAlert?: () => void;
  leaderDivertedPrompt?: LeaderDivertedPrompt | null;
  onFollowLeader?: () => void;
  onKeepOriginalRoute?: () => void;
  ambientMaintenanceAdvisory?: AmbientMaintenanceAdvisory | null;
  onSelectMaintenanceStop?: (place: Place) => void;
  onDismissMaintenanceAdvisory?: () => void;
  members?: FamilyMember[];
  userLocation?: Location | null;
  currentUserId?: string;
  remainingDistanceMeters?: number;
  remainingDurationSeconds?: number;
  distanceToNextStep?: number;
  isCameraFree?: boolean;
  onRecenter?: () => void;
  liveFuelSnapshot?: LiveFuelSnapshot | null;
  lowFuelAlert?: LowFuelAlert | null;
  onSelectGasStationStop?: (place: Place) => void;
  onAddStop?: (place: Place) => void;
  onDismissLowFuelAlert?: () => void;
}

const renderLaneIcon = (direction: string, isValid: boolean) => {
  const strokeColor = isValid ? '#38bdf8' : '#94a3b8';
  const strokeWidth = isValid ? 3.5 : 2;

  switch (direction) {
    case 'left':
      return (
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
          <path d="M19 19V11a4 4 0 0 0-4-4H5" />
          <polyline points="9 3 5 7 9 11" />
        </svg>
      );
    case 'slight_left':
      return (
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
          <path d="M17 20v-6a5 5 0 0 0-2-4L8 4" />
          <polyline points="13 3 7 4 8 10" />
        </svg>
      );
    case 'right':
      return (
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 19V11a4 4 0 0 1 4-4h10" />
          <polyline points="15 3 19 7 15 11" />
        </svg>
      );
    case 'slight_right':
      return (
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
          <path d="M7 20v-6a5 5 0 0 1 2-4l7-6" />
          <polyline points="11 3 17 4 16 10" />
        </svg>
      );
    case 'uturn':
      return (
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 19V9a6 6 0 0 0-12 0v10" />
          <polyline points="10 15 6 19 2 15" />
        </svg>
      );
    case 'straight':
    default:
      return (
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" y1="19" x2="12" y2="5" />
          <polyline points="6 11 12 5 18 11" />
        </svg>
      );
  }
};

export interface JunctionExitInfo {
  isExitOrRamp: boolean;
  exitCode: string;
  targetName: string;
  laneAdvice: string;
}

export const detectJunctionOrExit = (step?: { instruction?: string; distance?: string }): JunctionExitInfo | null => {
  if (!step || !step.instruction) return null;
  const text = step.instruction.toLowerCase();

  const isExit = text.includes('exit');
  const isRamp = text.includes('ramp') || text.includes('off-ramp');
  const isForkOrMerge = text.includes('fork') || text.includes('merge') || text.includes('interchange') || text.includes('junction');
  const isHighwayTransition = (text.includes('fwy') || text.includes('freeway') || text.includes('highway') || text.includes('outer loop') || text.includes('expressway')) && (text.includes('onto') || text.includes('toward') || text.includes('merge') || text.includes('turn'));

  if (!isExit && !isRamp && !isForkOrMerge && !isHighwayTransition) return null;

  // Extract exit number if present (e.g. Exit 12A, Exit 4)
  const exitNumMatch = step.instruction.match(/exit\s+([0-9]+[a-z]?)/i);
  let exitCode = 'HIGHWAY EXIT';
  if (exitNumMatch) {
    exitCode = `EXIT ${exitNumMatch[1].toUpperCase()}`;
  } else if (isRamp) {
    exitCode = text.includes('on-ramp') ? 'ON-RAMP' : 'OFF-RAMP';
  } else if (isForkOrMerge) {
    exitCode = text.includes('merge') ? 'FREEWAY MERGE' : 'JUNCTION';
  } else if (isHighwayTransition) {
    exitCode = text.includes('merge') ? 'FREEWAY MERGE' : 'HIGHWAY CORRIDOR';
  }

  // Extract destination highway or street name
  let targetName = '';
  const towardMatch = step.instruction.match(/(?:toward|onto|to)\s+([^,]+)/i);
  if (towardMatch && towardMatch[1]) {
    targetName = towardMatch[1].trim();
  } else {
    targetName = step.instruction.replace(/^(take the exit|take exit|take the ramp|merge onto|at the fork)/i, '').trim();
  }

  // Format lane advice
  let laneAdvice = 'PREPARE TO EXIT';
  if (text.includes('right') || text.includes('slight right')) {
    laneAdvice = 'USE RIGHT LANES';
  } else if (text.includes('left') || text.includes('slight left')) {
    laneAdvice = 'USE LEFT LANES';
  }

  return {
    isExitOrRamp: true,
    exitCode,
    targetName: targetName.slice(0, 32),
    laneAdvice
  };
};

export interface SpeedometerWidgetProps {
  speed: number;
  currentSpeedLimit: number;
  isSpeeding: boolean;
  isSevereSpeeding: boolean;
  hasCameraNearby?: boolean;
}

/**
 * Low-pass exponential moving average (EMA) filter on requestAnimationFrame
 * v(t) = v(t-1) + alpha * (v_target - v(t-1)) with alpha ~ 0.22
 * Eliminates discrete 1Hz GPS pulse stepping and provides buttery-smooth deceleration (e.g. 20 -> 15 -> 10 -> 4 -> 0 MPH).
 */
const useEasedSpeed = (targetSpeed: number): number => {
  const [easedSpeed, setEasedSpeed] = useState(targetSpeed);
  const targetRef = useRef(targetSpeed);
  targetRef.current = targetSpeed;

  useEffect(() => {
    let rafId: number;
    const tick = () => {
      setEasedSpeed(prev => {
        const target = targetRef.current;
        const diff = target - prev;
        if (Math.abs(diff) < 0.18) {
          return target;
        }
        return prev + diff * 0.22;
      });
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, []);

  return Math.round(easedSpeed);
};

export interface SpeedometerDialProps {
  speed: number;
  isSpeeding: boolean;
  isSevereSpeeding: boolean;
  className?: string;
}

export const SpeedometerDial: React.FC<SpeedometerDialProps> = React.memo(({
  speed,
  isSpeeding,
  isSevereSpeeding,
  className
}) => {
  const displaySpeed = useEasedSpeed(speed);

  return (
    <div className={`relative shrink-0 pointer-events-auto ${className || ''}`}>
      <div className="bg-white border-4 border-purple-500 rounded-2xl w-14 h-14 sm:w-16 sm:h-16 flex flex-col items-center justify-center shadow-lg">
        <span className={`font-black text-xl sm:text-2xl leading-none transition-colors duration-300 ${
          isSevereSpeeding ? 'text-red-600' : isSpeeding ? 'text-amber-600' : 'text-gray-900'
        }`}>{displaySpeed}</span>
        <span className="font-bold text-gray-900 uppercase text-[7px] sm:text-[8px] tracking-wider mt-0.5">MPH</span>
        <svg className="absolute inset-0 w-full h-full -rotate-90 pointer-events-none">
          <circle
            cx="32" cy="32" r="28"
            fill="none" stroke="currentColor" strokeWidth="2.5"
            strokeDasharray="176"
            strokeDashoffset={176 - (176 * (Math.min(displaySpeed, 80) / 80))}
            className={`${
              isSevereSpeeding ? 'text-red-500' : isSpeeding ? 'text-amber-500' : 'text-purple-500'
            } transition-all duration-500`}
          />
        </svg>
      </div>
    </div>
  );
});

export interface SpeedLimitWidgetProps {
  currentSpeedLimit: number;
  isSpeeding: boolean;
  isSevereSpeeding: boolean;
  hasCameraNearby?: boolean;
  className?: string;
}

export const SpeedLimitWidget: React.FC<SpeedLimitWidgetProps> = React.memo(({
  currentSpeedLimit,
  isSpeeding,
  isSevereSpeeding,
  hasCameraNearby,
  className
}) => {
  return (
    <div className={`flex items-center gap-1 shrink-0 pointer-events-auto ${className || ''}`}>
      <div className={`relative shrink-0 rounded-xl border-2 flex flex-col items-center justify-center w-10 h-14 sm:w-11 sm:h-16 p-0.5 transition-all duration-300 ${
        isSevereSpeeding
          ? 'bg-red-50 border-red-600 ring-2 ring-red-500 shadow-[0_0_20px_rgba(239,68,68,0.75)] animate-pulse'
          : isSpeeding
          ? 'bg-amber-50 border-amber-500 ring-1.5 ring-amber-400 shadow-[0_0_14px_rgba(245,158,11,0.65)]'
          : 'bg-white border-black shadow-lg'
      }`}>
        <span className={`font-black uppercase tracking-tighter text-[5px] sm:text-[6px] leading-tight ${
          isSevereSpeeding ? 'text-red-700' : isSpeeding ? 'text-amber-900' : 'text-black'
        }`}>SPEED</span>
        <span className={`font-black uppercase tracking-tighter text-[5px] sm:text-[6px] leading-tight ${
          isSevereSpeeding ? 'text-red-700' : isSpeeding ? 'text-amber-900' : 'text-black'
        }`}>LIMIT</span>
        <span className={`font-black text-base sm:text-lg tracking-tight leading-none mt-0.5 ${
          isSevereSpeeding ? 'text-red-600' : isSpeeding ? 'text-amber-600 font-black' : 'text-black'
        }`}>
          {currentSpeedLimit}
        </span>
      </div>

      {hasCameraNearby && (
        <div className="h-14 sm:h-16 px-1.5 rounded-xl bg-amber-500/20 border border-amber-500/40 text-[8px] sm:text-[9px] font-black text-amber-300 flex flex-col items-center justify-center gap-0.5 shadow-md animate-pulse shrink-0">
          <Camera className="w-3 h-3 text-amber-300 shrink-0" />
          <span className="leading-none text-center text-[7px]">CAM</span>
        </div>
      )}
    </div>
  );
});

export const SpeedometerWidget: React.FC<SpeedometerWidgetProps> = React.memo((props) => {
  return (
    <div className="flex items-center gap-2 shrink-0 transform-gpu will-change-transform">
      <SpeedometerDial speed={props.speed} isSpeeding={props.isSpeeding} isSevereSpeeding={props.isSevereSpeeding} />
      <SpeedLimitWidget currentSpeedLimit={props.currentSpeedLimit} isSpeeding={props.isSpeeding} isSevereSpeeding={props.isSevereSpeeding} hasCameraNearby={props.hasCameraNearby} />
    </div>
  );
});

const CompactSpeedGauge: React.FC<SpeedometerWidgetProps> = ({ speed, currentSpeedLimit, isSpeeding, isSevereSpeeding, hasCameraNearby }) => {
  const displaySpeed = useEasedSpeed(speed);
  const accent = isSevereSpeeding ? 'border-red-500 text-red-600 ring-red-400/50' : isSpeeding ? 'border-amber-500 text-amber-600 ring-amber-400/40' : 'border-slate-300 text-slate-900 ring-transparent';
  return (
    <div className={`relative w-14 h-14 rounded-full bg-white border-[3px] ring-2 ${accent} flex flex-col items-center justify-center shadow-sm shrink-0`}>
      <span className="font-black text-xl leading-none">{displaySpeed}</span>
      <span className="text-[7px] font-black tracking-wide text-slate-500">MPH</span>
      <span className={`absolute -right-2 -bottom-1 min-w-7 h-7 px-1 rounded-md bg-white border-2 flex items-center justify-center text-[11px] font-black shadow-sm ${isSevereSpeeding ? 'border-red-600 text-red-700 animate-pulse' : isSpeeding ? 'border-amber-500 text-amber-700' : 'border-slate-900 text-slate-900'}`}>
        {currentSpeedLimit}
      </span>
      {hasCameraNearby && <Camera className="absolute -left-1 -top-1 w-3.5 h-3.5 text-amber-500 fill-amber-100" />}
    </div>
  );
};

export interface TripSummaryCardProps {
  activeStop: any;
  currentLegIdx: number;
  totalStops: number;
  displayEta: string;
  displayDist: string;
  hasWaypoints: boolean;
  route: any;
  safetyScore: number;
  sessionPoints?: number;
  className?: string;
  onClick?: () => void;
}

export const TripSummaryCard: React.FC<TripSummaryCardProps> = React.memo(({
  activeStop,
  currentLegIdx,
  totalStops,
  displayEta,
  displayDist,
  hasWaypoints,
  route,
  safetyScore,
  sessionPoints,
  className,
  onClick
}) => {
  const parsedMinutes = Number.parseInt(displayEta, 10);
  const arrivalTime = Number.isFinite(parsedMinutes)
    ? new Date(Date.now() + Math.max(0, parsedMinutes) * 60_000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : '';
  return (
    <div 
      onClick={onClick}
      className={`bg-white border border-gray-100 rounded-2xl px-3.5 sm:px-4 py-2 shadow-lg hover:shadow-xl transition-all shrink-0 transform-gpu will-change-transform h-14 sm:h-16 flex flex-col justify-center ${className || 'w-auto'}`}
    >
      <div className="flex items-center justify-between gap-3 sm:gap-4">
        <div className="flex flex-col gap-0.5">
          <div className="flex gap-2.5 sm:gap-4 items-center">
            <div>
              <p className="font-bold text-gray-500 uppercase tracking-wider text-[7px] sm:text-[8px] leading-tight">
                {activeStop ? `To stop ${currentLegIdx + 1} of ${totalStops}` : 'Arrival time'}
              </p>
              <p className="font-black text-gray-950 text-lg sm:text-xl tracking-tight leading-none">{arrivalTime || displayEta}</p>
            </div>
            <div className="w-px h-5 sm:h-6 bg-gray-200" />
            <div>
              <p className="font-bold text-gray-500 uppercase tracking-wider text-[7px] sm:text-[8px] leading-tight">
                {activeStop ? 'This stop' : 'Distance left'}
              </p>
              <p className="font-black text-gray-900 text-sm sm:text-base tracking-tight leading-none">{displayEta} · {displayDist}</p>
            </div>
          </div>
          {hasWaypoints && (
            <div className="flex items-center gap-1 text-[7px] sm:text-[8px] font-bold text-gray-500">
              <Flag className="w-2.5 h-2.5 text-amber-500 fill-amber-500/20 shrink-0" />
              <span>Trip: <span className="text-gray-900 font-black">{route.totalTime}</span> • <span className="text-gray-900 font-black">{route.totalDistance}</span></span>
            </div>
          )}
        </div>

      </div>
    </div>
  );
});

/** Compact interactive fuel gauge widget for the drive HUD bottom bar */
const FuelGaugeWidget: React.FC<{ snapshot: LiveFuelSnapshot; theme?: 'light' | 'dark'; onOpenGasStations?: () => void }> = React.memo(({ snapshot, theme = 'dark', onOpenGasStations }) => {
  const [showDetails, setShowDetails] = useState(false);
  const hasLevel = snapshot.percentRemaining !== null;
  const pct = snapshot.percentRemaining ?? 100;
  const isDark = theme === 'dark';
  const isEv = snapshot.fuelType === 'electric';

  const barColor = pct <= 15 ? '#ef4444' : pct <= 30 ? '#f59e0b' : '#10b981';
  const barBg = isDark
    ? (pct <= 15 ? 'rgba(239,68,68,0.25)' : pct <= 30 ? 'rgba(245,158,11,0.25)' : 'rgba(16,185,129,0.25)')
    : (pct <= 15 ? 'rgba(239,68,68,0.15)' : pct <= 30 ? 'rgba(245,158,11,0.12)' : 'rgba(16,185,129,0.12)');
  const textColor = pct <= 15 ? 'text-red-500' : pct <= 30 ? 'text-amber-500' : 'text-emerald-500';

  return (
    <>
      <div 
        onClick={() => setShowDetails(!showDetails)}
        className={`rounded-2xl shadow-md px-2.5 py-1.5 flex flex-col gap-0.5 min-w-0 h-14 sm:h-16 justify-center cursor-pointer transition-all active:scale-95 ${
          isDark
            ? 'bg-slate-900/95 border border-white/10 text-white hover:bg-slate-900'
            : 'bg-white border border-gray-100 text-slate-900 hover:bg-slate-50'
        }`}
        title="Tap to view live fuel telemetry & driving habits"
      >
        {/* Top Row: Tank Bar or Burned Header */}
        {hasLevel ? (
          <div className="flex items-center gap-1.5">
            {isEv ? <Zap className={`w-3 h-3 shrink-0 ${textColor}`} /> : <Fuel className={`w-3 h-3 shrink-0 ${textColor}`} />}
            <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: barBg }}>
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{ width: `${Math.max(4, pct)}%`, background: barColor }}
              />
            </div>
            <span className={`text-[9px] font-black tabular-nums ${textColor} whitespace-nowrap`}>
              {snapshot.gallonsRemaining !== null ? `${snapshot.gallonsRemaining} ${isEv ? 'kWh' : 'gal'}` : ''}
            </span>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-1.5">
            <div className="flex items-center gap-1">
              {isEv ? <Zap className="w-3 h-3 shrink-0 text-amber-500" /> : <Fuel className="w-3 h-3 shrink-0 text-amber-500" />}
              <span className={`text-[8px] font-bold uppercase tracking-wider ${isDark ? 'text-slate-400' : 'text-gray-500'}`}>
                Trip Burn
              </span>
            </div>
            <span className={`text-[10px] font-black tabular-nums whitespace-nowrap ${isDark ? 'text-slate-200' : 'text-gray-800'}`}>
              {snapshot.gallonsBurned.toFixed(2)} {isEv ? 'kWh' : 'gal'}
            </span>
          </div>
        )}

        {/* Dynamic Habit / Idle Indicator or Stats row */}
        {snapshot.isPenaltyActive ? (
          <div className="flex items-center justify-between gap-1 animate-pulse">
            <span className="text-[8px] font-black px-1.5 py-0.2 rounded bg-rose-500/20 text-rose-400 border border-rose-500/30 truncate">
              {snapshot.penaltyType === 'rapid_accel' ? '⚡ Heavy Engine Load (+25%)' : '⚠️ Momentum Waste (+15%)'}
            </span>
            <span className="text-[9px] font-black text-rose-400 tabular-nums">
              ${snapshot.costSoFar.toFixed(2)}
            </span>
          </div>
        ) : snapshot.isIdling ? (
          <div className="flex items-center justify-between gap-1">
            <span className="text-[8px] font-black px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-400 border border-amber-500/30 truncate">
              ⏳ Red Light Idle ({snapshot.idleSeconds}s)
            </span>
            <span className={`text-[9px] font-black tabular-nums ${isDark ? 'text-slate-300' : 'text-gray-700'}`}>
              ${snapshot.costSoFar.toFixed(2)}
            </span>
          </div>
        ) : (
          <div className={`flex items-center gap-1 sm:gap-1.5 text-[8px] sm:text-[9px] font-bold whitespace-nowrap ${
            isDark ? 'text-slate-400' : 'text-gray-500'
          }`}>
            <span className={`font-black tabular-nums ${isDark ? 'text-white' : 'text-gray-900'}`}>
              ${snapshot.costSoFar.toFixed(2)}
            </span>
            <span className={`w-px h-2 ${isDark ? 'bg-white/10' : 'bg-gray-200'}`} />
            <span className={snapshot.effectiveTripMpg < 20 ? 'text-amber-500 font-black' : isDark ? 'text-slate-300' : 'text-gray-600'}>
              {snapshot.effectiveTripMpg} {isEv ? 'MPGe' : 'MPG'}
            </span>
            {snapshot.predictedRangeMiles !== null ? (
              <>
                <span className={`w-px h-2 ${isDark ? 'bg-white/10' : 'bg-gray-200'}`} />
                <span className={`tabular-nums ${pct <= 15 ? 'text-red-500 font-bold' : isDark ? 'text-slate-300' : 'text-gray-500'}`}>
                  {snapshot.predictedRangeMiles} mi left
                </span>
              </>
            ) : null}
          </div>
        )}
      </div>

      {/* Expanded Live In-Drive Fuel & Habit Telemetry Modal */}
      {showDetails && (
        <div 
          onClick={(e) => {
            e.stopPropagation();
            setShowDetails(false);
          }}
          className="fixed inset-0 z-[220] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-150 pointer-events-auto"
        >
          <div 
            onClick={(e) => e.stopPropagation()}
            className={`w-full max-w-sm rounded-3xl p-4 sm:p-5 border shadow-2xl space-y-3.5 ${
              isDark ? 'bg-slate-900 border-white/15 text-white' : 'bg-white border-slate-200 text-slate-900'
            }`}
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-white/10 pb-2.5">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-emerald-500/20 text-emerald-400">
                  {isEv ? <Zap className="w-5 h-5" /> : <Fuel className="w-5 h-5" />}
                </div>
                <div>
                  <h3 className="text-sm font-black">Live Fuel Telemetry</h3>
                  <p className="text-[10px] text-slate-400 truncate">
                    {snapshot.vehicleName || 'Active Vehicle'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowDetails(false)}
                className="w-7 h-7 rounded-xl bg-white/10 hover:bg-white/20 text-slate-400 hover:text-white flex items-center justify-center text-xs"
              >
                ✕
              </button>
            </div>

            {/* Main Stats Grid */}
            <div className="grid grid-cols-2 gap-2">
              <div className={`p-2.5 rounded-xl border ${isDark ? 'bg-white/5 border-white/5' : 'bg-slate-50 border-slate-200'}`}>
                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Trip Burn</p>
                <p className="text-lg font-black mt-0.5 text-emerald-400">
                  {snapshot.gallonsBurned.toFixed(2)} <span className="text-xs">{isEv ? 'kWh' : 'gal'}</span>
                </p>
                <p className="text-[10px] text-slate-400">Cost: ${snapshot.costSoFar.toFixed(2)}</p>
              </div>

              <div className={`p-2.5 rounded-xl border ${isDark ? 'bg-white/5 border-white/5' : 'bg-slate-50 border-slate-200'}`}>
                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Effective Trip MPG</p>
                <p className="text-lg font-black mt-0.5 text-indigo-400">
                  {snapshot.effectiveTripMpg} <span className="text-xs">{isEv ? 'MPGe' : 'MPG'}</span>
                </p>
                <p className="text-[10px] text-slate-400">{snapshot.milesDriven} miles driven</p>
              </div>
            </div>

            {/* Tank Status & Range */}
            {hasLevel && (
              <div className={`p-3 rounded-xl border ${isDark ? 'bg-white/5 border-white/5' : 'bg-slate-50 border-slate-200'}`}>
                <div className="flex items-center justify-between text-xs font-bold mb-1.5">
                  <span>Tank Level: {pct}%</span>
                  <span className={textColor}>{snapshot.gallonsRemaining} {isEv ? 'kWh' : 'gal'} remaining</span>
                </div>
                <div className="h-2 rounded-full overflow-hidden mb-2" style={{ background: barBg }}>
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${Math.max(4, pct)}%`, background: barColor }}
                  />
                </div>
                {snapshot.predictedRangeMiles !== null && (
                  <p className="text-[11px] font-bold text-slate-300">
                    Estimated Range: <span className="text-emerald-400 font-black">~{snapshot.predictedRangeMiles} miles</span> (Safe reserve: ~{Math.round(snapshot.predictedRangeMiles * 0.9)} mi)
                  </p>
                )}
              </div>
            )}

            {/* Driving Habit & Idle Breakdown */}
            <div className={`p-3 rounded-xl border space-y-1.5 text-xs ${isDark ? 'bg-white/5 border-white/5' : 'bg-slate-50 border-slate-200'}`}>
              <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Driving Habits Impact</p>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Stopped / Red Light Idle:</span>
                <span className="font-bold">{snapshot.idleSeconds}s</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Aggressive Throttle / Braking Penalty:</span>
                <span className="font-bold text-amber-400">
                  {snapshot.behaviorPenaltyGallons > 0 ? `+${(snapshot.behaviorPenaltyGallons).toFixed(3)} gal burned` : '0 gal (Smooth)'}
                </span>
              </div>
            </div>

            {pct <= 15 && onOpenGasStations && (
              <button
                type="button"
                onClick={() => {
                  setShowDetails(false);
                  onOpenGasStations();
                }}
                className="w-full py-2 rounded-xl bg-amber-500 hover:bg-amber-400 active:scale-95 text-slate-950 font-black text-xs shadow-md transition-all flex items-center justify-center gap-1.5 cursor-pointer"
              >
                {isEv ? <Zap className="w-4 h-4" /> : <Fuel className="w-4 h-4" />}
                <span>Find {isEv ? 'Charging Stations' : 'Gas Stations'} Along Route</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setShowDetails(false)}
              className="w-full py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-black text-xs shadow-md transition-all cursor-pointer"
            >
              Back to Navigation HUD
            </button>
          </div>
        </div>
      )}
    </>
  );
});

const DriveModeHUD: React.FC<DriveModeHUDProps> = React.memo(({
  route,
  speed,
  onCancel,
  theme,
  stepIndex,
  safetyScore,
  sessionPoints,
  isMobile = false,
  betterRouteSuggestion,
  alternativeRoutes = [],
  onRecalculateRoutes,
  isRecalculatingRoutes = false,
  onSwitchRoute,
  onDismissReroute,
  upcomingTollAlert,
  onTakeTollFreeExit,
  onDismissTollAlert,
  leaderDivertedPrompt,
  onFollowLeader,
  onKeepOriginalRoute,
  ambientMaintenanceAdvisory,
  onSelectMaintenanceStop,
  onDismissMaintenanceAdvisory,
  members = [],
  userLocation,
  currentUserId = '',
  remainingDistanceMeters,
  remainingDurationSeconds,
  distanceToNextStep,
  isCameraFree = false,
  onRecenter,
  liveFuelSnapshot,
  lowFuelAlert,
  onSelectGasStationStop,
  onAddStop,
  onDismissLowFuelAlert
}) => {
  const [showDetails, setShowDetails] = useState(!isMobile);
  const [isAlternativesModalOpen, setIsAlternativesModalOpen] = useState(false);
  const [isGasStationsDrawerOpen, setIsGasStationsDrawerOpen] = useState(false);
  const [advisoryDismissed, setAdvisoryDismissed] = useState(false);
  const [advisoryExpanded, setAdvisoryExpanded] = useState(false);
  const [isVoiceMuted, setIsVoiceMuted] = useState(() => speechService.getIsMuted());
  const [isAddStopDrawerOpen, setIsAddStopDrawerOpen] = useState(false);
  const [stopQuery, setStopQuery] = useState('');
  const [stopResults, setStopResults] = useState<Place[]>([]);
  const [isSearchingStops, setIsSearchingStops] = useState(false);

  // Multi-Vehicle Convoy State
  const [activeConvoy, setActiveConvoy] = useState<ConvoySession | null>(() => convoyService.getActiveConvoy());
  const [isConvoyDrawerOpen, setIsConvoyDrawerOpen] = useState(false);

  // 1-Tap Road Incident Reporting & Approaching Hazards
  const [isIncidentReporterOpen, setIsIncidentReporterOpen] = useState(false);
  const [activeIncidents, setActiveIncidents] = useState<IncidentReport[]>(() => incidentService.getActiveIncidents());
  const [dismissedIncidentIds, setDismissedIncidentIds] = useState<Set<string>>(new Set());

  // Final 150-Foot Storefront Approach Card State
  const [isStorefrontCardDismissed, setIsStorefrontCardDismissed] = useState(false);
  const [hasAnnouncedStorefront, setHasAnnouncedStorefront] = useState(false);
  const [isStorefrontLightboxOpen, setIsStorefrontLightboxOpen] = useState(false);

  useEffect(() => {
    setIsStorefrontCardDismissed(false);
    setHasAnnouncedStorefront(false);
    setIsStorefrontLightboxOpen(false);
  }, [route?.id, route?.destinationName]);

  useEffect(() => {
    return speechService.onMuteChange(setIsVoiceMuted);
  }, []);

  useEffect(() => {
    return convoyService.subscribe(setActiveConvoy);
  }, []);

  useEffect(() => {
    return incidentService.subscribe(setActiveIncidents);
  }, []);

  const approachingIncident = useMemo(() => {
    if (!userLocation) return null;
    return activeIncidents.find(inc => {
      if (dismissedIncidentIds.has(inc.id)) return false;
      if (inc.reporterId === currentUserId) return false;
      const dist = getDistanceMeters(userLocation, inc.location);
      return dist <= 500 && dist >= 25;
    }) || null;
  }, [activeIncidents, userLocation, dismissedIncidentIds, currentUserId]);

  // Distance to final destination
  const distanceToDestinationMeters = useMemo(() => {
    if (!userLocation || !route?.destinationLoc) return null;
    return getDistanceMeters(userLocation, route.destinationLoc);
  }, [userLocation, route?.destinationLoc]);

  // Final 150-200 foot Storefront Approach Card Trigger
  const isApproachingStorefront = useMemo(() => {
    if (isStorefrontCardDismissed) return false;
    const hasPhotoOrNotes = !!(route.destinationImageUrl || route.destinationEntranceNotes);
    if (!hasPhotoOrNotes) return false;

    // Within ~200 feet (approx 62 meters)
    if (distanceToDestinationMeters !== null && distanceToDestinationMeters <= 65) {
      return true;
    }

    // Or on the final step and distance is under 200 ft
    if (stepIndex >= (route.steps?.length || 1) - 1) {
      const lastStep = route.steps?.[stepIndex];
      if (lastStep?.distance && lastStep.distance.includes('ft')) {
        const feet = parseFloat(lastStep.distance.replace(/[^0-9.]/g, '')) || 0;
        return feet <= 200;
      }
    }

    return false;
  }, [distanceToDestinationMeters, isStorefrontCardDismissed, route.destinationImageUrl, route.destinationEntranceNotes, stepIndex, route.steps]);

  // Voice announcement when entering final 150-ft entrance corridor
  useEffect(() => {
    if (isApproachingStorefront && !hasAnnouncedStorefront) {
      setHasAnnouncedStorefront(true);
      const entranceLabel = route.destinationEntranceType === 'drive_thru' ? 'drive-thru lane' :
        route.destinationEntranceType === 'parking' ? 'parking lot entrance' :
        route.destinationEntranceType === 'curbside' ? 'curbside pickup area' :
        route.destinationEntranceType === 'main_door' ? 'main entrance' : 'entrance';

      const prompt = `Approaching ${entranceLabel}.${route.destinationEntranceNotes ? ` Note: ${route.destinationEntranceNotes}` : ''}`;
      if (!isVoiceMuted) {
        speechService.speak(prompt, { chime: 'turn' });
      }
    }
  }, [isApproachingStorefront, hasAnnouncedStorefront, route.destinationEntranceType, route.destinationEntranceNotes, isVoiceMuted]);

  const convoyTelemetry = useMemo(() => {
    return convoyService.getConvoyTelemetry(userLocation || null, speed, currentUserId, members);
  }, [userLocation, speed, currentUserId, members, activeConvoy]);

  const advisory = useMemo(() => {
    // 1. Query vehicle maintenance health for critical overdue or due soon items
    try {
      const activeVehicle = vehicleFuelService.getActiveVehicle();
      if (activeVehicle) {
        const health = maintenanceAlertService.getVehicleHealth(activeVehicle);
        if (health.overallStatus === 'overdue' && health.items.length > 0) {
          const overdueItems = health.items.filter(i => i.status === 'overdue');
          const primaryItem = overdueItems[0] || health.items[0];
          return {
            type: 'warning' as const,
            severity: 'high' as const,
            title: `Vehicle Alert: ${primaryItem.title}`,
            description: `Service overdue by ${Math.abs(Math.round(primaryItem.milesRemaining)).toLocaleString()} mi. Schedule maintenance soon.`,
            icon: primaryItem.category || 'wrench'
          };
        } else if (health.overallStatus === 'due_soon' && health.items.length > 0) {
          const dueSoonItems = health.items.filter(i => i.status === 'due_soon');
          if (dueSoonItems.length > 0) {
            const primaryItem = dueSoonItems[0];
            return {
              type: 'warning' as const,
              severity: 'medium' as const,
              title: `Service Due Soon: ${primaryItem.title}`,
              description: `${Math.round(primaryItem.milesRemaining).toLocaleString()} mi remaining until recommended service.`,
              icon: primaryItem.category || 'wrench'
            };
          }
        }
      }
    } catch (err) {
      console.warn('[DriveModeHUD] Failed to check vehicle maintenance health:', err);
    }

    // 2. Fall back to navigation route safety advisory if available
    if (route?.safetyAdvisory) {
      return {
        type: 'weather' as const,
        severity: 'medium' as const,
        title: 'Safety Advisory',
        description: route.safetyAdvisory,
        icon: 'warning'
      };
    }

    return null;
  }, [route?.safetyAdvisory]);

  const steps = route?.steps || [];
  const currentStep = steps[stepIndex] || steps[0] || { instruction: 'Navigating...', distance: '0 ft' };

  // Audit #5: Parse distance for color coding (Green = far, Amber = approaching, Red = turn now)
  const parseDistanceMeters = (dist: string): number => {
    const num = parseFloat(dist.replace(/[^0-9.]/g, '')) || 0;
    if (dist.toLowerCase().includes('mi')) return num * 1609;
    if (dist.toLowerCase().includes('km')) return num * 1000;
    if (dist.toLowerCase().includes('ft')) return num * 0.3048;
    return num; // assume meters
  };
  const isLastStep = stepIndex >= steps.length - 1;
  let dynamicManeuverDistanceStr = currentStep.distance;
  let dynamicManeuverMeters = parseDistanceMeters(currentStep.distance);

  if (isLastStep) {
    // Arrival maneuver: consume exact remaining road distance to synchronize with bottom card
    if (typeof remainingDistanceMeters === 'number' && Number.isFinite(remainingDistanceMeters)) {
      dynamicManeuverMeters = remainingDistanceMeters;
      if (remainingDistanceMeters <= 5) {
        dynamicManeuverDistanceStr = '0 ft';
      } else if (remainingDistanceMeters >= 1609.34) {
        dynamicManeuverDistanceStr = `${(remainingDistanceMeters / 1609.34).toFixed(1)} mi`;
      } else {
        dynamicManeuverDistanceStr = `${Math.round(remainingDistanceMeters * 3.28084)} ft`;
      }
    }
  } else if (typeof distanceToNextStep === 'number' && Number.isFinite(distanceToNextStep) && distanceToNextStep >= 0) {
    dynamicManeuverMeters = distanceToNextStep;
    if (distanceToNextStep >= 1609.34) {
      dynamicManeuverDistanceStr = `${(distanceToNextStep / 1609.34).toFixed(1)} mi`;
    } else {
      dynamicManeuverDistanceStr = `${Math.round(distanceToNextStep * 3.28084)} ft`;
    }
  }

  const distMeters = dynamicManeuverMeters;
  const nextStep = steps[stepIndex + 1];
  const nextStepMeters = nextStep?.distance ? parseDistanceMeters(nextStep.distance) : Infinity;
  // A second maneuver matters before the first turn only when it follows
  // closely enough to affect lane choice. Showing it all the time made the
  // banner taller without improving driving decisions.
  const showThenManeuver = !!nextStep && nextStepMeters <= 245;
  const thenManeuverText = nextStep?.instruction.toLowerCase() || '';
  const ThenManeuverIcon = thenManeuverText.includes('u-turn') || thenManeuverText.includes('uturn') ? RotateCcw : thenManeuverText.includes('left') ? CornerUpLeft : thenManeuverText.includes('right') ? CornerUpRight : ArrowUp;
  const isImmediateManeuver = distMeters <= 100;
  const distColor = distMeters > 500 ? 'text-emerald-400' : distMeters > 100 ? 'text-amber-400' : 'text-red-400';
  const distBorder = distMeters > 500 ? 'from-indigo-500 to-purple-600' : distMeters > 100 ? 'from-amber-500 to-orange-600' : 'from-red-500 to-rose-600';

  const totalSteps = steps.length;
  const progress = totalSteps > 0 ? ((stepIndex + 1) / totalSteps) * 100 : 0;
  const currentSpeedLimit = currentStep.speedLimit || 35;
  const isSpeeding = speed > currentSpeedLimit;
  const isSevereSpeeding = speed >= currentSpeedLimit + 10;
  const hasCameraNearby = currentStep.hasCamera;
  const maneuverText = currentStep.instruction.toLowerCase();
  const ManeuverIcon = maneuverText.includes('u-turn') || maneuverText.includes('uturn')
    ? RotateCcw
    : maneuverText.includes('left')
      ? CornerUpLeft
      : maneuverText.includes('right')
        ? CornerUpRight
        : ArrowUp;

  // Highway Junction & Off-Ramp Detection
  const junctionInfo = useMemo(() => {
    const currentInfo = detectJunctionOrExit(currentStep);
    if (currentInfo) return currentInfo;

    const nextStep = steps[stepIndex + 1];
    if (nextStep && distMeters <= 1600) {
      const nextInfo = detectJunctionOrExit(nextStep);
      if (nextInfo) {
        return {
          ...nextInfo,
          laneAdvice: `UPCOMING • ${nextInfo.laneAdvice}`
        };
      }
    }
    return null;
  }, [currentStep, steps, stepIndex, distMeters]);

  // Multi-Stop Waypoint & Leg Tracking
  const currentLegIdx = route?.currentLegIndex || 0;
  const hasWaypoints = !!(route?.waypoints && route.waypoints.length > 0);
  const activeStop = hasWaypoints && currentLegIdx < route.waypoints!.length
    ? route.waypoints![currentLegIdx]
    : null;
  const activeLeg = hasWaypoints && route.legs && route.legs[currentLegIdx]
    ? route.legs[currentLegIdx]
    : null;
  const totalStops = (route.waypoints?.length || 0) + 1;
  const visibleStopNumber = Math.min(currentLegIdx + 1, totalStops);

  const findStops = async (query: string, category?: 'gas' | 'coffee' | 'food' | 'grocery') => {
    if (!userLocation || (!category && !query.trim())) return;
    setIsSearchingStops(true);
    try {
      const results = category === 'gas'
        ? await searchGasStations(userLocation)
        : category === 'coffee'
          ? await searchCoffeeShops(userLocation)
          : category === 'food'
            ? await searchRestaurants(userLocation)
            : category === 'grocery'
              ? await searchGroceryStores(userLocation)
              : await searchPlacesText(query.trim(), userLocation);
      setStopResults(results.filter(place => place?.location).slice(0, 6));
    } catch (error) {
      console.warn('[DriveModeHUD] Stop search failed:', error);
      setStopResults([]);
    } finally {
      setIsSearchingStops(false);
    }
  };

  const addStop = (place: Place) => {
    if (!onAddStop) return;
    onAddStop(place);
    setIsAddStopDrawerOpen(false);
    setStopResults([]);
    setStopQuery('');
  };

  const displayEta = typeof remainingDurationSeconds === 'number' && Number.isFinite(remainingDurationSeconds)
    ? `${Math.max(0, Math.ceil(remainingDurationSeconds / 60))} min`
    : (activeLeg?.duration || route.totalTime);
  const displayDist = typeof remainingDistanceMeters === 'number' && Number.isFinite(remainingDistanceMeters)
    ? (remainingDistanceMeters >= 1609.34
      ? `${(remainingDistanceMeters / 1609.34).toFixed(1)} mi`
      : `${Math.max(0, Math.round(remainingDistanceMeters * 3.28084))} ft`)
    : (activeLeg?.distance || route.totalDistance);

  return (
    <div className="absolute inset-0 z-[100] pointer-events-none overflow-hidden">
      {/* Top-Center Turn Banner & Navigation Alerts Stack */}
      <div 
        className="absolute top-4 left-1/2 transform -translate-x-1/2 z-40 pointer-events-none w-full max-w-lg px-3 sm:px-4 flex flex-col items-center"
        style={{
          paddingTop: 'max(calc(env(safe-area-inset-top, 0px)), 0px)'
        }}
      >
        {/* TOP SECTION: Turn Banner & In-Drive Alerts Stack */}
        <div className="w-full flex flex-col gap-2 shrink-0 pointer-events-auto landscape:mt-1">
          {/* Top Navigation Bar - Clean Default Light Skin Card */}
          <div className="w-full bg-white border border-gray-100 shadow-xl flex flex-col overflow-hidden relative z-30 transform-gpu will-change-transform rounded-2xl p-3.5 landscape:p-2.5 landscape:rounded-xl">
            {/* Primary Maneuver Row: Turn Icon + Instruction Details */}
            <div className="flex items-center w-full gap-3">
              {/* Next Turn Icon — color shifts with distance */}
              <div className={`bg-gradient-to-br ${distBorder} flex items-center justify-center text-white shadow-lg shrink-0 transition-all duration-500 ${isImmediateManeuver ? 'w-[72px] h-[72px] sm:w-20 sm:h-20' : 'w-16 h-16 sm:w-[72px] sm:h-[72px]'} rounded-2xl`}>
                <ManeuverIcon className="w-10 h-10 sm:w-11 sm:h-11" strokeWidth={3.5} aria-label="Next maneuver" />
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`font-black tracking-tighter text-gray-950 ${isImmediateManeuver ? 'text-4xl sm:text-5xl' : 'text-3xl sm:text-4xl'} leading-none`}>{dynamicManeuverDistanceStr}</span>

                  {/* Upcoming Traffic Control Badge (Stop Sign, Traffic Light, Rail Crossing) */}
                  {currentStep.trafficControl && (
                    <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full border shadow-sm animate-in fade-in zoom-in-95 duration-300 ${
                      currentStep.trafficControl === 'stop_sign'
                        ? 'bg-red-50 border-red-200 text-red-700'
                        : currentStep.trafficControl === 'traffic_light'
                        ? 'bg-amber-50 border-amber-200 text-amber-800'
                        : currentStep.trafficControl === 'railroad_crossing'
                        ? 'bg-yellow-50 border-yellow-200 text-yellow-800'
                        : 'bg-purple-50 border-purple-200 text-purple-800'
                    }`}>
                      <span className="flex items-center">
                        {currentStep.trafficControl === 'stop_sign' ? <OctagonAlert className="w-3.5 h-3.5 text-red-600" /> :
                         currentStep.trafficControl === 'traffic_light' ? <TrafficCone className="w-3.5 h-3.5 text-amber-600" /> :
                         currentStep.trafficControl === 'railroad_crossing' ? <TrainFront className="w-3.5 h-3.5 text-yellow-600" /> :
                         <Camera className="w-3.5 h-3.5 text-purple-600" />}
                      </span>
                      <span className="text-[10px] font-black uppercase tracking-wider">
                        {currentStep.trafficControl === 'stop_sign' ? 'Stop Sign' :
                         currentStep.trafficControl === 'traffic_light' ? 'Traffic Light' :
                         currentStep.trafficControl === 'railroad_crossing' ? 'Rail Crossing' : 'Camera'}
                      </span>
                    </div>
                  )}
                </div>
                <p className="font-black text-gray-950 truncate text-base sm:text-lg leading-tight mt-1">{currentStep.instruction}</p>

                {/* Active Multi-Stop Waypoint Indicator */}
                {hasWaypoints && (
                  <div className="flex items-center gap-1.5 mt-1.5 px-2.5 py-1 rounded-xl bg-amber-50 border border-amber-200 shadow-sm w-fit max-w-full">
                    <span className="w-4 h-4 rounded-md bg-amber-500 text-white font-black text-[9px] flex items-center justify-center shrink-0 shadow-sm">
                      {activeStop ? currentLegIdx + 1 : <Flag className="w-2.5 h-2.5 text-white fill-white" />}
                    </span>
                    <span className="text-[10px] font-black uppercase tracking-wider text-amber-900 truncate">
                      {activeStop
                        ? `STOP ${visibleStopNumber} OF ${totalStops}: ${activeStop.name}${activeLeg?.distance ? ` (${activeLeg.distance})` : ''}`
                        : `STOP ${totalStops} OF ${totalStops}: ${route.destinationName}`}
                    </span>
                  </div>
                )}

                {/* Highway Junction & Off-Ramp Amber Signboard HUD with Dynamic Beacon Pulse */}
                {junctionInfo && (
                  <div className="flex items-center gap-2 mt-2 px-2.5 py-1.5 rounded-xl bg-orange-50 border border-orange-200 shadow-sm animate-in fade-in slide-in-from-top-1 duration-300 w-fit max-w-full">
                    {/* Dynamic Amber Beacon Pulse */}
                    <div className="relative flex items-center justify-center shrink-0 w-5 h-5">
                      <div className="absolute w-4 h-4 rounded-full bg-orange-500 opacity-50 animate-ping" />
                      <div className="relative w-2.5 h-2.5 rounded-full bg-amber-500 shadow-sm" />
                    </div>

                    {/* Exit Badge */}
                    <div className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-orange-500 text-white font-black text-[10px] tracking-wider uppercase shrink-0 shadow-sm">
                      <Signpost className="w-3 h-3 text-white" />
                      <span>{junctionInfo.exitCode}</span>
                    </div>

                    {/* Destination Highway / Corridor & Lane Advice */}
                    <div className="flex items-center gap-2 min-w-0 flex-1 overflow-hidden">
                      {junctionInfo.targetName && (
                        <span className="text-xs font-black text-gray-900 uppercase tracking-tight truncate">
                          {junctionInfo.targetName}
                        </span>
                      )}
                      <span className="text-[9px] font-extrabold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-200 shrink-0 uppercase tracking-wider">
                        {junctionInfo.laneAdvice}
                      </span>
                    </div>
                  </div>
                )}

                {/* Visual Lane Guidance Arrows Strip */}
                {currentStep.lanes && currentStep.lanes.length > 0 && (
                  <div className="flex items-center gap-1.5 mt-2 p-1.5 bg-gray-50 rounded-2xl border border-gray-100 w-fit shadow-sm animate-in fade-in slide-in-from-top-1 duration-300">
                    {currentStep.lanes.map((lane, lIdx) => (
                      <div
                        key={lIdx}
                        title={lane.isValid ? "Recommended Lane" : "Other Lane"}
                        className={`rounded-xl flex items-center justify-center transition-all w-6 h-6 ${
                          lane.isValid
                            ? 'bg-purple-100 border-2 border-purple-500 text-purple-700 shadow-sm scale-105'
                            : 'bg-gray-200/60 border border-gray-200 text-gray-400 opacity-60'
                        }`}
                      >
                        {renderLaneIcon(lane.direction, lane.isValid)}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Secondary Next Maneuver Preview — Integrated Cleanly with Distinct Divider */}
            {showThenManeuver && nextStep && (
              <div className="flex items-center gap-2.5 mt-3 pt-2.5 border-t border-gray-100 text-gray-600 w-full animate-in fade-in duration-300">
                <span className="text-[9px] font-black text-purple-700 bg-purple-50 border border-purple-200 px-2 py-0.5 rounded-md uppercase tracking-wider shrink-0 shadow-xs flex items-center gap-1">
                  <ThenManeuverIcon className="w-3 h-3" strokeWidth={3} /> Then
                </span>
                <p className="text-sm font-black text-gray-800 truncate flex-1">
                  {nextStep.instruction}
                </p>
                {nextStep.distance && (
                  <span className="text-xs font-black text-gray-600 shrink-0">
                    in {nextStep.distance}
                  </span>
                )}
              </div>
            )}

            {/* Progress Indicator */}
            <div className="absolute bottom-0 left-0 h-1 bg-purple-600 transition-all duration-500" style={{ width: `${progress}%` }} />
          </div>

          {/* Crowd-Sourced Road Incident Ahead: Interactive Confirmation Banner */}
          {approachingIncident && (
            <div className="w-full relative z-30 animate-in slide-in-from-top duration-300">
              <div className="bg-slate-950/95 backdrop-blur-2xl border-2 border-amber-500/60 rounded-2xl p-3 shadow-[0_15px_40px_rgba(245,158,11,0.3)] flex items-center justify-between gap-2.5 w-full">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <div className="w-9 h-9 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center border border-amber-400/40 shrink-0 shadow-inner">
                    {approachingIncident.type === 'police' ? <ShieldAlert className="w-4 h-4 text-blue-400" /> :
                     approachingIncident.type === 'hazard' ? <AlertTriangle className="w-4 h-4 text-amber-400" /> :
                     approachingIncident.type === 'shoulder' ? <Car className="w-4 h-4 text-orange-400" /> :
                     approachingIncident.type === 'construction' ? <HardHat className="w-4 h-4 text-yellow-400" /> :
                     approachingIncident.type === 'traffic' ? <Gauge className="w-4 h-4 text-red-400" /> :
                     <ShieldAlert className="w-4 h-4 text-amber-400" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <h4 className="text-[11px] font-black text-white uppercase tracking-wider truncate">
                        {approachingIncident.type === 'police' ? 'Police Trap' :
                         approachingIncident.type === 'hazard' ? 'Road Hazard' :
                         approachingIncident.type === 'shoulder' ? 'Vehicle Shoulder' :
                         approachingIncident.type === 'construction' ? 'Work Zone' : 'Traffic Slow'}
                      </h4>
                      <span className="text-[10px] font-bold text-amber-400">
                        ({(getDistanceMeters(userLocation || { lat: 0, lng: 0 }, approachingIncident.location) * 0.000621371).toFixed(1)} mi)
                      </span>
                    </div>
                    <p className="text-[10px] text-slate-300 truncate">Is this still there?</p>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      incidentService.upvoteIncident(approachingIncident.id, currentUserId || 'driver');
                      setDismissedIncidentIds(prev => new Set(prev).add(approachingIncident.id));
                    }}
                    className="px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-[10px] font-black shadow-md active:scale-95 transition-all flex items-center gap-1 cursor-pointer"
                  >
                    <ThumbsUp className="w-3 h-3" />
                    <span>Yes</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      incidentService.clearIncident(approachingIncident.id, currentUserId || 'driver');
                      setDismissedIncidentIds(prev => new Set(prev).add(approachingIncident.id));
                    }}
                    className="px-2 py-1.5 bg-white/10 hover:bg-white/20 text-slate-300 rounded-xl text-[10px] font-bold active:scale-95 transition-all flex items-center gap-0.5 cursor-pointer"
                  >
                    <Check className="w-3 h-3 text-emerald-400" />
                    <span>Clear</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Final 150-Foot Storefront Approach Card */}
          {isApproachingStorefront && (
            <div className="w-full relative z-30 animate-in slide-in-from-top zoom-in-95 duration-300">
              <div className="bg-slate-950/95 backdrop-blur-2xl border-2 border-emerald-500/70 rounded-2xl p-3 shadow-[0_15px_45px_rgba(16,185,129,0.35)] flex flex-col gap-2 w-full">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="flex h-2 w-2 relative">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                    </span>
                    <span className="text-[10px] font-black uppercase tracking-wider text-emerald-300 flex items-center gap-1">
                      <Flag className="w-3 h-3 text-emerald-400 fill-emerald-400/20" />
                      <span>Approaching Entrance</span>
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {distanceToDestinationMeters !== null && (
                      <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-mono text-[9px] font-black border border-emerald-500/30">
                        {Math.round(distanceToDestinationMeters * 3.28084)} ft
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => setIsStorefrontCardDismissed(true)}
                      className="w-5 h-5 rounded-full bg-white/10 hover:bg-white/20 text-slate-300 flex items-center justify-center transition-all cursor-pointer"
                      title="Dismiss approach card"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-2.5">
                  {route.destinationImageUrl && (
                    <div 
                      onClick={() => setIsStorefrontLightboxOpen(true)}
                      className="relative w-16 h-14 rounded-xl overflow-hidden border border-emerald-400/60 shadow-md shrink-0 group cursor-pointer"
                    >
                      <img
                        src={route.destinationImageUrl}
                        alt={route.destinationName}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                      />
                    </div>
                  )}

                  <div className="flex-1 min-w-0">
                    <h4 className="text-xs font-black text-white truncate">
                      {route.destinationName}
                    </h4>
                    {route.destinationEntranceNotes ? (
                      <p className="text-[10px] font-bold text-amber-300 truncate mt-0.5">
                        {route.destinationEntranceNotes}
                      </p>
                    ) : (
                      <p className="text-[10px] text-slate-300 truncate">
                        Look for building entrance.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Hive-Mind Convoy Leader Diverted Countdown */}
          {leaderDivertedPrompt && (
            <div className="w-full relative z-30 animate-in slide-in-from-top-4 duration-300">
              <div className="bg-gradient-to-r from-purple-950/95 via-slate-900/98 to-indigo-950/95 backdrop-blur-2xl border-2 border-purple-500/60 rounded-2xl p-3 shadow-[0_20px_50px_rgba(168,85,247,0.4)] flex flex-col gap-2.5 w-full relative overflow-hidden">
                <div 
                  className="absolute top-0 left-0 h-1 bg-gradient-to-r from-purple-500 via-pink-500 to-indigo-500 transition-all duration-1000 ease-linear"
                  style={{ width: `${(leaderDivertedPrompt.timeRemainingSeconds / 10) * 100}%` }}
                />

                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-8 h-8 rounded-xl bg-purple-500/20 border border-purple-500/40 flex items-center justify-center shrink-0">
                    <GitFork className="w-4 h-4 text-purple-300" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[10px] font-black text-purple-300 uppercase tracking-wider">
                        Leader Diverted
                      </span>
                      <span className="text-[8px] font-black px-1.5 py-0.2 rounded-full bg-purple-500/30 text-purple-200 border border-purple-400/40 animate-pulse">
                        {leaderDivertedPrompt.timeRemainingSeconds}s
                      </span>
                    </div>
                    <p className="text-[11px] font-bold text-slate-100 truncate">
                      {leaderDivertedPrompt.leaderName}: {leaderDivertedPrompt.reason}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 pt-1 border-t border-white/10">
                  <button
                    type="button"
                    onClick={onFollowLeader}
                    className="py-2 px-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 active:scale-95 text-white font-black text-[10px] rounded-xl shadow-md transition-all flex items-center justify-center gap-1 cursor-pointer"
                  >
                    <Zap className="w-3 h-3 fill-current" />
                    <span>Follow Leader</span>
                  </button>
                  <button
                    type="button"
                    onClick={onKeepOriginalRoute}
                    className="py-2 px-2 bg-white/10 hover:bg-white/20 active:scale-95 text-slate-300 font-bold text-[10px] rounded-xl border border-white/10 transition-all flex items-center justify-center gap-1 cursor-pointer"
                  >
                    <Navigation className="w-3 h-3" />
                    <span>Keep Route</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Predictive Commute Maintenance Advisory */}
          {ambientMaintenanceAdvisory && (
            <div className="w-full relative z-30 animate-in slide-in-from-top-3 duration-300">
              <div className="bg-gradient-to-r from-amber-950/95 via-slate-900/98 to-orange-950/95 backdrop-blur-2xl border-2 border-amber-500/60 rounded-2xl p-3 shadow-[0_15px_40px_rgba(245,158,11,0.35)] flex items-center justify-between gap-2.5 w-full">
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                  <div className="w-8 h-8 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center shrink-0">
                    <Wrench className="w-4 h-4 text-amber-400" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] font-black text-amber-400 uppercase tracking-wider">
                        {ambientMaintenanceAdvisory.item.title}
                      </span>
                      <span className="text-[8px] font-bold px-1 rounded bg-amber-500/20 text-amber-300">
                        {Math.round(ambientMaintenanceAdvisory.item.milesRemaining)} mi
                      </span>
                    </div>
                    <p className="text-[11px] font-bold text-slate-200 truncate">
                      {ambientMaintenanceAdvisory.recommendedPlace.name}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => onSelectMaintenanceStop && onSelectMaintenanceStop(ambientMaintenanceAdvisory.recommendedPlace)}
                    className="px-2.5 py-1.5 bg-amber-500 hover:bg-amber-400 active:scale-95 text-slate-950 font-black text-[10px] rounded-xl shadow-md transition-all flex items-center gap-1 cursor-pointer"
                  >
                    <Plus className="w-3 h-3" />
                    <span>Add</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onDismissMaintenanceAdvisory && onDismissMaintenanceAdvisory()}
                    className="w-7 h-7 rounded-xl bg-white/10 hover:bg-white/20 text-slate-300 text-xs font-bold transition-all flex items-center justify-center cursor-pointer"
                    title="Dismiss"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Low Fuel / Low Battery Critical Alert */}
          {lowFuelAlert && (
            <div className="w-full relative z-30 animate-in slide-in-from-top-3 duration-300">
              <div className={`backdrop-blur-2xl border-2 rounded-2xl p-3 shadow-xl flex items-center justify-between gap-2.5 w-full ${
                lowFuelAlert.severity === 'critical'
                  ? 'bg-gradient-to-r from-rose-950/98 via-slate-900/98 to-amber-950/98 border-rose-500/70 shadow-[0_15px_40px_rgba(244,63,94,0.35)]'
                  : 'bg-gradient-to-r from-amber-950/98 via-slate-900/98 to-orange-950/98 border-amber-500/70 shadow-[0_15px_40px_rgba(245,158,11,0.35)]'
              }`}>
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                  <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 border animate-pulse ${
                    lowFuelAlert.severity === 'critical'
                      ? 'bg-rose-500/20 border-rose-500/50 text-rose-400'
                      : 'bg-amber-500/20 border-amber-500/50 text-amber-400'
                  }`}>
                    {lowFuelAlert.fuelType === 'electric' ? <Zap className="w-4 h-4" /> : <Fuel className="w-4 h-4" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className={`text-[10px] font-black uppercase tracking-wider ${
                        lowFuelAlert.severity === 'critical' ? 'text-rose-400' : 'text-amber-400'
                      }`}>
                        {lowFuelAlert.title}
                      </span>
                      <span className={`text-[8px] font-black px-1.5 py-0.5 rounded ${
                        lowFuelAlert.severity === 'critical' ? 'bg-rose-500/30 text-rose-200' : 'bg-amber-500/30 text-amber-200'
                      }`}>
                        {lowFuelAlert.percentRemaining}% ({lowFuelAlert.gallonsRemaining} {lowFuelAlert.fuelType === 'electric' ? 'kWh' : 'gal'})
                      </span>
                    </div>
                    <p className="text-[11px] font-bold text-slate-100 truncate">
                      {lowFuelAlert.message}
                    </p>
                    <p className="text-[9px] text-slate-400 truncate">
                      {lowFuelAlert.subtext}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  {lowFuelAlert.recommendedGasStation ? (
                    <button
                      type="button"
                      onClick={() => onSelectGasStationStop && onSelectGasStationStop(lowFuelAlert.recommendedGasStation!)}
                      className="px-2.5 py-1.5 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 active:scale-95 text-slate-950 font-black text-[10px] rounded-xl shadow-md transition-all flex items-center gap-1 cursor-pointer"
                      title={`Add ${lowFuelAlert.recommendedGasStation.name} as stop`}
                    >
                      <Plus className="w-3 h-3" />
                      <span className="truncate max-w-[90px]">{lowFuelAlert.recommendedGasStation.name.split(' ')[0]}</span>
                      <span className="text-[9px] opacity-80">(+{lowFuelAlert.recommendedGasStation.detourMinutes || 1}m)</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setIsGasStationsDrawerOpen(true)}
                      className="px-2.5 py-1.5 bg-amber-500 hover:bg-amber-400 active:scale-95 text-slate-950 font-black text-[10px] rounded-xl shadow-md transition-all flex items-center gap-1 cursor-pointer"
                    >
                      <Fuel className="w-3 h-3" />
                      <span>{lowFuelAlert.fuelType === 'electric' ? 'Find Charging' : 'Find Gas'}</span>
                    </button>
                  )}

                  {lowFuelAlert.gasStations && lowFuelAlert.gasStations.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setIsGasStationsDrawerOpen(true)}
                      className="w-7 h-7 rounded-xl bg-white/10 hover:bg-white/20 text-slate-300 text-xs font-bold transition-all flex items-center justify-center cursor-pointer"
                      title="View all nearby stations"
                    >
                      <ChevronDown className="w-3.5 h-3.5" />
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => onDismissLowFuelAlert && onDismissLowFuelAlert()}
                    className="w-7 h-7 rounded-xl bg-white/10 hover:bg-white/20 text-slate-300 text-xs font-bold transition-all flex items-center justify-center cursor-pointer"
                    title="Dismiss"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Dynamic In-Drive Reroute Option */}
          {betterRouteSuggestion && (
            <div className="w-full relative z-30 animate-in slide-in-from-top-3 duration-300">
              <div className="bg-gradient-to-r from-emerald-950/95 via-slate-900/98 to-indigo-950/95 backdrop-blur-2xl border-2 border-emerald-500/50 rounded-2xl p-3 shadow-[0_15px_40px_rgba(16,185,129,0.35)] flex items-center justify-between gap-2.5 w-full">
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                  <div className="w-8 h-8 rounded-xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center shrink-0">
                    <Zap className="w-4 h-4 text-amber-400 fill-amber-400/20" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <span className="text-[10px] font-black text-emerald-400 uppercase tracking-wider">
                      {betterRouteSuggestion.savingsLabel}
                    </span>
                    <p className="text-[11px] font-bold text-slate-200 truncate">
                      {betterRouteSuggestion.reason}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => onSwitchRoute && onSwitchRoute(betterRouteSuggestion.route)}
                    className="px-2.5 py-1.5 bg-emerald-500 hover:bg-emerald-400 active:scale-95 text-slate-950 font-black text-[10px] rounded-xl shadow-md transition-all flex items-center gap-1 cursor-pointer"
                  >
                    <GitFork className="w-3 h-3" />
                    <span>Switch</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onDismissReroute && onDismissReroute()}
                    className="w-7 h-7 rounded-xl bg-white/10 hover:bg-white/20 text-slate-300 text-xs font-bold transition-all flex items-center justify-center cursor-pointer"
                    title="Dismiss"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Dynamic Toll Avoidance Alert */}
          {upcomingTollAlert && (
            <div className="w-full relative z-30 animate-in slide-in-from-top-3 duration-300">
              <div className="bg-gradient-to-r from-rose-950/95 via-slate-900/98 to-amber-950/95 backdrop-blur-2xl border-2 border-rose-500/50 rounded-2xl p-3 shadow-[0_15px_40px_rgba(244,63,94,0.35)] flex items-center justify-between gap-2.5 w-full">
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                  <div className="w-8 h-8 rounded-xl bg-rose-500/20 border border-rose-500/40 flex items-center justify-center shrink-0">
                    <CreditCard className="w-4 h-4 text-rose-400" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <span className="text-[10px] font-black text-rose-400 uppercase tracking-wider">
                      Toll Plaza (~${upcomingTollAlert.estimatedToll.toFixed(2)})
                    </span>
                    <p className="text-[11px] font-bold text-slate-200 truncate">
                      {upcomingTollAlert.tollName}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => onTakeTollFreeExit && onTakeTollFreeExit()}
                    className="px-2.5 py-1.5 bg-gradient-to-r from-emerald-500 to-teal-500 text-slate-950 font-black text-[10px] rounded-xl shadow-md transition-all flex items-center gap-1 cursor-pointer"
                  >
                    <Signpost className="w-3 h-3" />
                    <span>Exit</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onDismissTollAlert && onDismissTollAlert()}
                    className="w-7 h-7 rounded-xl bg-white/10 hover:bg-white/20 text-slate-300 text-xs font-bold transition-all flex items-center justify-center cursor-pointer"
                    title="Dismiss"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Convoy Telemetry Pill */}
          {(activeConvoy || convoyTelemetry.length > 0) && (
            <div className="w-full relative z-30 animate-in slide-in-from-top-2 duration-300">
              <div 
                onClick={() => setIsConvoyDrawerOpen(true)}
                className="bg-gradient-to-r from-purple-950/95 via-slate-900/98 to-indigo-950/95 backdrop-blur-2xl border-2 border-purple-500/50 rounded-2xl p-2.5 shadow-[0_12px_35px_rgba(168,85,247,0.3)] flex items-center justify-between gap-2.5 w-full cursor-pointer hover:border-purple-400 transition-all group"
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <div className="w-7 h-7 rounded-xl bg-purple-500/20 border border-purple-500/30 flex items-center justify-center text-purple-300 shrink-0">
                    <Users className="w-3.5 h-3.5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <span className="text-[10px] font-black uppercase tracking-wider text-purple-300">
                      {activeConvoy ? 'Convoy Active' : 'Nearby Circle'}
                    </span>
                    {convoyTelemetry.length > 0 && (
                      <p className="text-[10px] text-slate-300 truncate">
                        {convoyTelemetry[0].name}: {convoyTelemetry[0].distanceToUserMiles.toFixed(1)} mi ({convoyTelemetry[0].speed} MPH)
                      </p>
                    )}
                  </div>
                </div>

                <span className="px-2 py-1 rounded-lg bg-purple-600 text-white text-[9px] font-black shrink-0">
                  View ({convoyTelemetry.length})
                </span>
              </div>
            </div>
          )}

          {/* Road Advisory Banner */}
          {advisory && !advisoryDismissed && (
            <div className="w-full relative z-25 animate-in slide-in-from-top duration-300">
              <div className={`p-3 rounded-2xl border backdrop-blur-xl shadow-xl w-full flex items-start justify-between gap-2
                ${advisory.severity === 'high' ? 'bg-red-950/90 border-red-500/50 shadow-[0_10px_30px_rgba(239,68,68,0.3)]' :
                  advisory.severity === 'medium' ? 'bg-amber-950/90 border-amber-500/50 shadow-[0_10px_30px_rgba(245,158,11,0.3)]' :
                    'bg-slate-950/90 border-indigo-500/40 shadow-[0_10px_30px_rgba(99,102,241,0.3)]'}
              `}>
                <div className="flex items-start gap-2 min-w-0 flex-1">
                  <div className={`w-7 h-7 rounded-xl flex items-center justify-center shrink-0 border ${
                    advisory.severity === 'high' ? 'bg-red-500/20 border-red-400/40 text-red-300' :
                    advisory.severity === 'medium' ? 'bg-amber-500/20 border-amber-400/40 text-amber-300' :
                    'bg-indigo-500/20 border-indigo-400/40 text-indigo-300'
                  }`}>
                    {renderAdvisoryIcon(advisory.icon, advisory.type, "w-3.5 h-3.5")}
                  </div>
                  <div className="min-w-0 flex-1">
                    <h4 className="text-white font-bold uppercase tracking-wider text-[9px] leading-tight mb-0.5">{advisory.title}</h4>
                    <p className="text-slate-300 text-[10px] leading-snug">{advisory.description}</p>
                  </div>
                </div>
                <button 
                  type="button"
                  onClick={() => setAdvisoryDismissed(true)} 
                  className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/10 transition-colors cursor-pointer shrink-0"
                  title="Dismiss advisory"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Floating Recenter Map Button (when camera is moved away from vehicle) */}
      {isCameraFree && (
        <div className="absolute bottom-[calc(10rem+env(safe-area-inset-bottom,0px))] lg:bottom-28 left-1/2 transform -translate-x-1/2 z-40 pointer-events-auto animate-in fade-in zoom-in duration-200">
          <button
            type="button"
            onClick={onRecenter}
            className="flex items-center gap-2.5 px-5 py-2.5 bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white rounded-full shadow-2xl border-2 border-white/40 font-black text-xs uppercase tracking-wider active:scale-95 transition-all cursor-pointer ring-4 ring-indigo-500/30 backdrop-blur-md"
          >
            <Crosshair className="w-4 h-4 text-white animate-spin" style={{ animationDuration: '4s' }} />
            <span>Recenter Map</span>
          </button>
        </div>
      )}

      {/* Mobile summary and controls fit within the viewport without scrolling. */}
      <div 
        className="drive-hud-bottom absolute z-40 pointer-events-none"
      >
        {/* 1. Compact driving cluster: current speed and the posted limit stay together. */}
        <div className="drive-hud-speed-cluster pointer-events-auto">
          <CompactSpeedGauge
            speed={speed}
            currentSpeedLimit={currentSpeedLimit}
            isSpeeding={isSpeeding}
            isSevereSpeeding={isSevereSpeeding}
            hasCameraNearby={hasCameraNearby}
          />
        </div>

        {/* 2. Live Fuel Gauge */}
        {liveFuelSnapshot && (
          <div className="drive-hud-fuel-gauge pointer-events-auto">
            <FuelGaugeWidget
              snapshot={liveFuelSnapshot}
              theme={theme}
              onOpenGasStations={() => setIsGasStationsDrawerOpen(true)}
            />
          </div>
        )}

        {/* 3. The Main ETA/Trip Summary Card (w-auto so it fits naturally) */}
        <div className="drive-hud-summary w-auto shrink-0 pointer-events-auto">
          <TripSummaryCard
            activeStop={activeStop}
            currentLegIdx={currentLegIdx}
            totalStops={totalStops}
            displayEta={displayEta}
            displayDist={displayDist}
            hasWaypoints={hasWaypoints}
            route={route}
            safetyScore={safetyScore}
            sessionPoints={sessionPoints}
            className="drive-hud-summary-card bg-transparent border-0 shadow-none hover:shadow-none px-2 sm:px-3"
            onClick={() => setShowDetails(!showDetails)}
          />
        </div>

        {/* Recenter is available only through the floating recovery control after the driver moves the map. */}

        {/* 4. Add an in-drive stop without cancelling the active destination. */}
        <button
          type="button"
          onClick={() => setIsAddStopDrawerOpen(true)}
          title="Add a stop"
          aria-label="Add a stop"
          className="w-14 h-14 sm:w-16 sm:h-16 shrink-0 rounded-2xl border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-600 hover:text-white hover:border-indigo-600 flex flex-col items-center justify-center shadow-md transition-all active:scale-95 cursor-pointer pointer-events-auto"
        >
          <Plus className="w-5 h-5 sm:w-6 sm:h-6" strokeWidth={3} />
          <span className="text-[8px] sm:text-[9px] font-black uppercase tracking-wide mt-0.5">Stop</span>
        </button>

        {/* 5. Choose another route — a route glyph reads as navigation choice, not replay. */}
        <button
          type="button"
          onClick={() => {
            setIsAlternativesModalOpen(prev => !prev);
            if (!isAlternativesModalOpen && onRecalculateRoutes) {
              onRecalculateRoutes();
            }
          }}
          title="Choose another route"
          aria-label="Choose another route"
          className={`w-14 h-14 sm:w-16 sm:h-16 shrink-0 rounded-2xl border flex items-center justify-center shadow-md transition-all active:scale-95 cursor-pointer pointer-events-auto ${
            isAlternativesModalOpen || isRecalculatingRoutes
              ? 'bg-purple-600 text-white border-purple-500 shadow-[0_0_20px_rgba(168,85,247,0.4)]'
              : 'bg-white border-gray-100 text-gray-700 hover:bg-gray-50 hover:text-gray-900'
          }`}
        >
          {isRecalculatingRoutes
            ? <RefreshCw className="w-5 h-5 sm:w-6 sm:h-6 animate-spin" />
            : <Route className="w-5 h-5 sm:w-6 sm:h-6" />}
        </button>

        {/* 6. Mute Button (Speaker) */}
        <button
          type="button"
          onClick={() => {
            const next = speechService.toggleMuted();
            setIsVoiceMuted(next);
            if (next) {
              // Explicitly and instantly cancel any ongoing speech utterance and flush TTS queue
              if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
                try {
                  window.speechSynthesis.cancel();
                } catch {}
              }
              audioService.cancel();
            }
          }}
          title={isVoiceMuted ? "Unmute voice guidance" : "Mute voice guidance"}
          aria-label={isVoiceMuted ? "Unmute voice guidance" : "Mute voice guidance"}
          aria-pressed={isVoiceMuted}
          className={`w-14 h-14 sm:w-16 sm:h-16 shrink-0 rounded-2xl border flex items-center justify-center shadow-md transition-all active:scale-95 cursor-pointer pointer-events-auto ${
            isVoiceMuted 
              ? 'bg-amber-50 border-amber-200 text-amber-600 hover:bg-amber-100' 
              : 'bg-white border-gray-100 text-gray-700 hover:bg-gray-50 hover:text-gray-900'
          }`}
        >
          {isVoiceMuted ? <VolumeX className="w-5 h-5 sm:w-6 sm:h-6" /> : <Volume2 className="w-5 h-5 sm:w-6 sm:h-6" />}
        </button>

        {/* 7. End Trip Button (Red X) */}
        <button
          type="button"
          onClick={onCancel}
          title="Exit Navigation"
          aria-label="End trip"
          className="drive-hud-end-trip w-14 h-14 sm:w-16 sm:h-16 shrink-0 rounded-2xl bg-red-50 border border-red-200 text-red-500 hover:bg-red-500 hover:text-white hover:border-red-500 flex items-center justify-center shadow-md transition-all active:scale-95 cursor-pointer pointer-events-auto"
        >
          <X className="w-6 h-6 sm:w-7 sm:h-7" />
        </button>
      </div>

      {/* Add Stop drawer: designed for a quick, safe detour choice while a trip remains active. */}
      {isAddStopDrawerOpen && (
        <div className="fixed inset-0 z-[210] flex items-end justify-center p-3 sm:p-4 bg-slate-950/35 backdrop-blur-[1px] pointer-events-auto">
          <div className="w-full max-w-lg rounded-3xl bg-slate-950 border border-white/15 shadow-[0_25px_70px_rgba(0,0,0,0.75)] p-4 space-y-3 animate-in slide-in-from-bottom-4 duration-200">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] font-black uppercase tracking-wider text-indigo-300">Route stays active</p>
                <h3 className="text-lg font-black text-white">Add a stop</h3>
              </div>
              <button type="button" onClick={() => setIsAddStopDrawerOpen(false)} className="w-9 h-9 rounded-xl bg-white/10 hover:bg-white/20 text-slate-200 flex items-center justify-center" aria-label="Close add stop">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={(event) => { event.preventDefault(); void findStops(stopQuery); }} className="flex gap-2">
              <input
                value={stopQuery}
                onChange={(event) => setStopQuery(event.target.value)}
                placeholder="Search a place or address"
                className="min-w-0 flex-1 rounded-xl bg-white/10 border border-white/10 px-3 py-2.5 text-sm font-semibold text-white placeholder:text-slate-500 outline-none focus:border-indigo-400"
                autoFocus
              />
              <button type="submit" disabled={!stopQuery.trim() || isSearchingStops} className="rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 px-3 text-white text-xs font-black">
                {isSearchingStops ? '...' : 'Search'}
              </button>
            </form>

            <div className="grid grid-cols-4 gap-2">
              {[
                { label: 'Gas', icon: Fuel, value: 'gas' as const },
                { label: 'Coffee', icon: Coffee, value: 'coffee' as const },
                { label: 'Food', icon: Package, value: 'food' as const },
                { label: 'Grocery', icon: Car, value: 'grocery' as const }
              ].map(({ label, icon: Icon, value }) => (
                <button key={value} type="button" onClick={() => void findStops('', value)} className="rounded-xl bg-white/10 hover:bg-indigo-500/30 border border-white/10 py-2 text-slate-200 text-[10px] font-black flex flex-col items-center gap-1">
                  <Icon className="w-4 h-4 text-indigo-300" />
                  {label}
                </button>
              ))}
            </div>

            <div className="max-h-56 overflow-y-auto space-y-1.5 pr-1">
              {stopResults.map(place => (
                <button key={place.id} type="button" onClick={() => addStop(place)} className="w-full text-left rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 px-3 py-2.5 flex items-center gap-2.5 transition-colors">
                  <div className="w-8 h-8 rounded-lg bg-indigo-500/20 text-indigo-300 flex items-center justify-center shrink-0"><Plus className="w-4 h-4" /></div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-black text-white truncate">{place.name}</p>
                    <p className="text-[10px] text-slate-400 truncate">{place.address || place.description || 'Along your route'}</p>
                  </div>
                  <span className="text-[10px] font-black text-indigo-300">Add</span>
                </button>
              ))}
              {!isSearchingStops && stopResults.length === 0 && (
                <p className="py-3 text-center text-[11px] font-medium text-slate-500">Search or choose a category to add a stop.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Alternative Routes & On-the-Fly Reroute Selection Modal */}
      {isAlternativesModalOpen && (
        <div className="fixed inset-0 z-[200] flex items-end justify-center p-3 sm:p-4 bg-slate-950/30 backdrop-blur-[1px] animate-in fade-in duration-200 pointer-events-auto">
          <div className="bg-slate-900/[0.97] border border-white/15 rounded-3xl p-4 sm:p-5 max-w-lg w-full shadow-[0_25px_70px_rgba(0,0,0,0.85)] space-y-3 max-h-[62vh] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-white/10 pb-3 shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-indigo-600 to-purple-600 flex items-center justify-center shadow-md text-white">
                  <Route className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h3 className="text-base sm:text-lg font-black text-white">Choose a route</h3>
                  <p className="text-xs text-slate-400 truncate max-w-[200px] sm:max-w-[280px]">
                    To: <span className="text-slate-200 font-bold">{route.destinationName}</span>
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onRecalculateRoutes && onRecalculateRoutes()}
                  disabled={isRecalculatingRoutes}
                  className="px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-slate-200 hover:text-white text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                  title="Recalculate fresh routes from current GPS"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isRecalculatingRoutes ? 'animate-spin' : ''}`} />
                  <span className="hidden sm:inline">{isRecalculatingRoutes ? 'Evaluating...' : 'Refresh'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setIsAlternativesModalOpen(false)}
                  className="w-8 h-8 rounded-xl bg-white/10 hover:bg-white/20 text-slate-300 hover:text-white flex items-center justify-center transition-all cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="shrink-0 rounded-xl bg-white/5 border border-white/10 px-3 py-2 text-xs">
              {isRecalculatingRoutes ? (
                <span className="text-cyan-300 font-semibold">Finding routes from your current location…</span>
              ) : alternativeRoutes.length > 1 ? (
                <span className="text-slate-300"><strong className="text-white">{alternativeRoutes.length} routes found.</strong> The map shows each path; compare arrival time and route corridor below.</span>
              ) : (
                <span className="text-slate-300">Your current route is shown first. We’ll list another route only when it is meaningfully different.</span>
              )}
            </div>

            {/* Content List */}
            <div className="flex-1 overflow-y-auto space-y-3 pr-1 no-scrollbar">
              {((alternativeRoutes && alternativeRoutes.length > 0) ? alternativeRoutes : [route]).map((r, idx) => {
                const isActive = (r.id === route.id) || (r.summary === route.summary && r.totalDistance === route.totalDistance);
                const routeRoadNames = getRouteRoadNames(r);
                const routeDescription = routeRoadNames.length
                  ? `via ${routeRoadNames.join(' → ')}`
                  : (r.summary || 'Street details are unavailable for this route');
                const activeMinutes = route.durationMinutes || Number.parseInt(route.totalTime, 10) || 0;
                const optionMinutes = r.durationMinutes || Number.parseInt(r.totalTime, 10) || 0;
                const deltaMinutes = optionMinutes - activeMinutes;
                const arrivalTime = optionMinutes > 0
                  ? new Date(Date.now() + optionMinutes * 60_000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
                  : '';
                const deltaLabel = isActive
                  ? 'Fastest'
                  : deltaMinutes === 0 ? 'Same time' : deltaMinutes > 0 ? `+${deltaMinutes} min` : `${deltaMinutes} min`;

                return (
                  <div
                    key={r.id || `route_card_${idx}`}
                    className={`px-4 py-3 rounded-2xl border transition-all duration-200 ${
                      isActive
                        ? 'bg-indigo-950/40 border-cyan-400/60 shadow-[0_0_20px_rgba(6,182,212,0.25)] ring-1 ring-cyan-400/40'
                        : 'bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className={`text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full ${
                            isActive
                              ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                              : r.routeType === 'toll_free' || !r.hasTolls
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                              : 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/40'
                          }`}>
                            {isActive ? 'Active Route' : (r.routeLabel || (r.routeType === 'toll_free' ? 'Toll-Free' : `Option ${idx + 1}`))}
                          </span>
                          {r.hasTolls ? (
                            <span className="text-[10px] font-bold text-amber-300 bg-amber-500/15 px-1.5 py-0.5 rounded border border-amber-500/30">
                              {r.tollCostEstimate || `$${r.estimatedTolls?.toFixed(2)} Tolls`}
                            </span>
                          ) : (
                            <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/15 px-1.5 py-0.5 rounded border border-emerald-500/30">
                              No Tolls
                            </span>
                          )}
                        </div>

                        <h4 className="text-sm font-black text-white truncate">
                          {routeDescription}
                        </h4>

                        <div className="flex items-center gap-2 text-xs text-slate-300 mt-1.5 flex-wrap">
                          <span className="font-black text-white text-sm">{arrivalTime || r.totalTime}</span>
                          <span className="text-slate-500">·</span>
                          <span className={`font-black ${isActive || deltaMinutes <= 0 ? 'text-emerald-300' : 'text-amber-300'}`}>{deltaLabel}</span>
                          <span className="text-slate-500">·</span>
                          <span>{r.totalDistance}</span>
                          {r.fuelCostEstimate && (
                            <>
                              <span className="text-slate-500">·</span>
                              <span
                                className="text-slate-300 font-semibold"
                                title={r.fuelEstimateGal !== undefined ? `Estimated from ${r.fuelEstimateGal.toFixed(2)} gallons for this route` : 'Estimated fuel cost for this route'}
                              >
                                ≈ {r.fuelCostEstimate} gas{r.fuelEstimateGal !== undefined ? ` (${r.fuelEstimateGal.toFixed(2)} gal)` : ''}
                              </span>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Action Button */}
                      <div className="shrink-0 pt-1">
                        {isActive ? (
                          <div className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-cyan-500/20 border border-cyan-400/50 text-cyan-300 text-xs font-black">
                            <Check className="w-3.5 h-3.5 text-cyan-300" />
                            <span>Selected</span>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              if (onSwitchRoute) {
                                onSwitchRoute(r);
                                setIsAlternativesModalOpen(false);
                              }
                            }}
                            className="px-3.5 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 active:scale-95 text-white font-black text-xs shadow-lg shadow-emerald-600/30 transition-all flex items-center gap-1.5 cursor-pointer"
                          >
                            <GitFork className="w-3.5 h-3.5" />
                            <span>Select</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
              {!isRecalculatingRoutes && alternativeRoutes.length <= 1 && (
                <div className="rounded-2xl border border-dashed border-white/15 bg-white/[0.03] px-4 py-3 text-xs text-slate-400">
                  No distinct alternate route is available right now. Refresh after traffic or your position changes.
                </div>
              )}
            </div>

            {/* Footer Tip */}
            <div className="pt-2 border-t border-white/10 text-center shrink-0">
              <p className="text-[11px] text-slate-400 flex items-center justify-center gap-1.5">
                <Lightbulb className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span><span className="text-slate-300 font-semibold">Tip:</span> You can also tap alternative route lines directly on the map to switch routes.</span>
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Convoy Control Center Modal */}
      {isConvoyDrawerOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-in fade-in duration-200 pointer-events-auto">
          <div className="bg-slate-900 border border-purple-500/40 rounded-3xl p-5 max-w-md w-full shadow-[0_25px_60px_rgba(0,0,0,0.8)] space-y-4">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-2xl bg-purple-500/20 border border-purple-500/40 flex items-center justify-center text-purple-300 shadow-md shrink-0">
                  <Users className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-black text-white">Caravan & Convoy Mode</h3>
                  <p className="text-xs text-purple-300">Multi-Vehicle Road Trip Linking</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsConvoyDrawerOpen(false)}
                className="w-8 h-8 rounded-full bg-white/10 text-slate-300 hover:text-white flex items-center justify-center transition-all cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Destination Info */}
            <div className="p-3 rounded-2xl bg-white/5 border border-white/5 flex items-center justify-between">
              <div>
                <span className="text-[10px] uppercase font-bold text-slate-400">Destination</span>
                <p className="text-sm font-bold text-white truncate max-w-[220px]">{route.destinationName}</p>
              </div>
              <span className="text-xs font-bold text-emerald-400">{route.totalTime}</span>
            </div>

            {/* Convoy Members List */}
            <div className="space-y-2 max-h-56 overflow-y-auto custom-scrollbar">
              <p className="text-[10px] uppercase font-bold text-slate-400">
                Linked Convoy Vehicles ({convoyTelemetry.length})
              </p>
              {convoyTelemetry.length === 0 ? (
                <div className="p-3 text-center text-xs text-slate-400 bg-white/5 rounded-xl">
                  No other vehicles linked yet. Invite circle members below!
                </div>
              ) : (
                convoyTelemetry.map(member => (
                  <div key={member.id} className="p-2.5 rounded-xl bg-white/5 border border-white/5 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      {member.avatar ? (
                        <img src={member.avatar} className="w-8 h-8 rounded-lg object-cover" />
                      ) : (
                        <div className="w-8 h-8 rounded-lg bg-purple-500/20 text-purple-300 flex items-center justify-center font-bold text-xs">
                          {member.name[0]}
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-bold text-white truncate">{member.name}</p>
                        <p className="text-[10px] text-slate-400">
                          {member.distanceToUserMiles.toFixed(1)} mi {member.isAhead ? 'ahead' : 'behind'} • {member.speed} MPH
                        </p>
                      </div>
                    </div>

                    <span className={`text-[9px] font-black px-2 py-1 rounded-md flex items-center gap-1.5 ${
                      member.status === 'lagging'
                        ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30 animate-pulse'
                        : member.status === 'stopped'
                        ? 'bg-red-500/20 text-red-300 border border-red-500/30'
                        : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                    }`}>
                      {member.status === 'lagging' ? (
                        <>
                          <AlertTriangle className="w-3 h-3 text-amber-400" />
                          <span>Lagging</span>
                        </>
                      ) : member.status === 'stopped' ? (
                        <>
                          <OctagonAlert className="w-3 h-3 text-red-400" />
                          <span>Stopped</span>
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                          <span>In Sync</span>
                        </>
                      )}
                    </span>
                  </div>
                ))
              )}

              {/* Unlinked Circle Members to Add */}
              {activeConvoy && members.filter(m => m.id !== currentUserId && !activeConvoy.memberIds.includes(m.id)).length > 0 && (
                <div className="pt-2 border-t border-white/5 space-y-1.5">
                  <p className="text-[10px] uppercase font-bold text-purple-400">
                    Invite Circle Members to Convoy
                  </p>
                  {members.filter(m => m.id !== currentUserId && !activeConvoy.memberIds.includes(m.id)).map(unlinked => (
                    <div key={unlinked.id} className="p-2 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <img src={unlinked.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${unlinked.id}`} className="w-6 h-6 rounded-full object-cover" />
                        <span className="text-xs font-bold text-slate-200 truncate">{unlinked.name}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          convoyService.joinConvoy(unlinked.id);
                          if (activeConvoy) {
                            convoyService.broadcastInvite(activeConvoy, 'Convoy Leader');
                          }
                        }}
                        className="px-2 py-1 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-[10px] font-black shadow-sm cursor-pointer"
                      >
                        + Invite
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="space-y-2 pt-2 border-t border-white/10">
              {activeConvoy ? (
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      speechService.speak('Broadcasting pit stop request to convoy members.');
                    }}
                    className="py-2.5 px-3 rounded-xl bg-amber-500/20 border border-amber-500/30 text-amber-300 text-xs font-bold hover:bg-amber-500/30 transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Coffee className="w-3.5 h-3.5" />
                    <span>Suggest Pit Stop</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      convoyService.endConvoy();
                      setIsConvoyDrawerOpen(false);
                    }}
                    className="py-2.5 px-3 rounded-xl bg-red-500/20 border border-red-500/30 text-red-400 text-xs font-bold hover:bg-red-500/30 transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <XCircle className="w-3.5 h-3.5" />
                    <span>End Convoy</span>
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    convoyService.startConvoy(
                      route.destinationName || 'Destination',
                      route.destinationLoc || { lat: 0, lng: 0 },
                      currentUserId,
                      'You',
                      members.map(m => m.id)
                    );
                    setIsConvoyDrawerOpen(false);
                  }}
                  className="w-full py-3 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white text-xs font-black shadow-lg transition-all active:scale-95 flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Users className="w-4 h-4" />
                  <span>Start Convoy with All Circle Members</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 1-Tap Road Incident Reporter Modal */}
      {isIncidentReporterOpen && (
        <IncidentReporter
          theme={theme}
          isMobile={isMobile}
          onClose={() => setIsIncidentReporterOpen(false)}
          onReport={(type, details) => {
            if (userLocation) {
              incidentService.reportIncident(
                type,
                userLocation,
                { id: currentUserId || 'driver', name: 'You' },
                details
              );
            }
          }}
        />
      )}
      {/* Storefront Photo Fullscreen Lightbox Modal */}
      {isStorefrontLightboxOpen && route.destinationImageUrl && (
        <div 
          onClick={() => setIsStorefrontLightboxOpen(false)}
          className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-black/90 backdrop-blur-xl animate-in fade-in duration-200 pointer-events-auto cursor-zoom-out"
        >
          <div 
            onClick={(e) => e.stopPropagation()}
            className="relative max-w-lg w-full rounded-3xl overflow-hidden border-2 border-emerald-500/50 shadow-2xl bg-black"
          >
            <img 
              src={route.destinationImageUrl} 
              alt={route.destinationName} 
              className="w-full max-h-[70vh] object-contain"
            />
            <div className="p-4 bg-slate-950/95 flex items-center justify-between border-t border-white/10">
              <div className="min-w-0 flex-1 pr-2">
                <h4 className="text-sm font-black text-white truncate">{route.destinationName}</h4>
                {route.destinationEntranceNotes && (
                  <p className="text-xs text-amber-300 font-bold truncate flex items-center gap-1.5 mt-0.5">
                    <Car className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    <span>{route.destinationEntranceNotes}</span>
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setIsStorefrontLightboxOpen(false)}
                className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-bold transition-all cursor-pointer shrink-0"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Corridor Gas Station / EV Charging Quick-Selection Drawer */}
      {isGasStationsDrawerOpen && lowFuelAlert && (
        <div
          onClick={(e) => {
            e.stopPropagation();
            setIsGasStationsDrawerOpen(false);
          }}
          className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-in fade-in duration-200 pointer-events-auto cursor-pointer"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className={`w-full max-w-sm rounded-3xl p-4 border shadow-2xl space-y-3 cursor-default ${
              theme === 'dark' ? 'bg-slate-900 border-white/15 text-white' : 'bg-white border-slate-200 text-slate-900'
            }`}
          >
            <div className="flex items-center justify-between border-b border-white/10 pb-2.5">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-amber-500/20 text-amber-400">
                  {lowFuelAlert.fuelType === 'electric' ? <Zap className="w-5 h-5" /> : <Fuel className="w-5 h-5" />}
                </div>
                <div>
                  <h3 className="text-sm font-black">
                    {lowFuelAlert.fuelType === 'electric' ? 'Nearby EV Charging' : 'Nearby Gas Stations'}
                  </h3>
                  <p className="text-[10px] text-slate-400">
                    Route Corridor • 1-tap add as waypoint
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsGasStationsDrawerOpen(false)}
                className="w-7 h-7 rounded-xl bg-white/10 hover:bg-white/20 text-slate-400 hover:text-white flex items-center justify-center text-xs cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
              {(lowFuelAlert.gasStations && lowFuelAlert.gasStations.length > 0) ? (
                lowFuelAlert.gasStations.slice(0, 5).map((station, idx) => (
                  <div
                    key={station.id || idx}
                    className={`p-2.5 rounded-2xl border flex items-center justify-between gap-2 transition-all ${
                      theme === 'dark' ? 'bg-white/5 border-white/10 hover:bg-white/10' : 'bg-slate-50 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-black truncate">{station.name}</p>
                      <p className="text-[10px] text-slate-400 truncate">
                        {(station.address && !/^\s*-?\d+\.\d+/.test(station.address) && station.address !== 'Nearby')
                          ? station.address
                          : (station.description && !station.description.includes('detour') && station.description !== 'Nearby' && !/^\s*-?\d+\.\d+/.test(station.description))
                            ? station.description
                            : 'Route Corridor'}
                      </p>
                      <span className="text-[9px] font-bold text-amber-400">
                        +{station.detourMinutes || 1} min detour ({station.detourMiles || 0.2} mi)
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setIsGasStationsDrawerOpen(false);
                        onSelectGasStationStop && onSelectGasStationStop(station);
                      }}
                      className="px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 active:scale-95 text-slate-950 font-black text-xs shadow-md transition-all flex items-center gap-1 cursor-pointer shrink-0"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add</span>
                    </button>
                  </div>
                ))
              ) : (
                <div className="text-center py-6 text-slate-400 text-xs">
                  Searching for stations along route corridor...
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

export const DriveHUD = DriveModeHUD;
export default DriveModeHUD;
