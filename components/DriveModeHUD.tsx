
import React, { useState, useEffect, useMemo } from 'react';
import { NavigationRoute, FamilyMember, Location } from '../types';
import { speechService } from '../services/speechService';
import { BetterRouteSuggestion, UpcomingTollAlert } from '../hooks/useNavigation';
import { convoyService, ConvoyMember, ConvoySession } from '../services/convoyService';
import { maintenanceAlertService } from '../services/maintenanceAlertService';
import { vehicleFuelService } from '../services/vehicleFuelService';

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
  onSwitchRoute?: (route: NavigationRoute) => void;
  onDismissReroute?: () => void;
  upcomingTollAlert?: UpcomingTollAlert | null;
  onTakeTollFreeExit?: () => void;
  onDismissTollAlert?: () => void;
  members?: FamilyMember[];
  userLocation?: Location | null;
  currentUserId?: string;
  isCameraFree?: boolean;
  onRecenter?: () => void;
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

const DriveModeHUD: React.FC<DriveModeHUDProps> = ({
  route,
  speed,
  onCancel,
  theme,
  stepIndex,
  safetyScore,
  sessionPoints,
  isMobile = false,
  betterRouteSuggestion,
  onSwitchRoute,
  onDismissReroute,
  upcomingTollAlert,
  onTakeTollFreeExit,
  onDismissTollAlert,
  members = [],
  userLocation,
  currentUserId = '',
  isCameraFree = false,
  onRecenter
}) => {
  const [showDetails, setShowDetails] = useState(!isMobile);
  const [advisoryDismissed, setAdvisoryDismissed] = useState(false);
  const [advisoryExpanded, setAdvisoryExpanded] = useState(false);
  const [isVoiceMuted, setIsVoiceMuted] = useState(() => speechService.getIsMuted());

  // Multi-Vehicle Convoy State
  const [activeConvoy, setActiveConvoy] = useState<ConvoySession | null>(() => convoyService.getActiveConvoy());
  const [isConvoyDrawerOpen, setIsConvoyDrawerOpen] = useState(false);

  useEffect(() => {
    return speechService.onMuteChange(setIsVoiceMuted);
  }, []);

  useEffect(() => {
    return convoyService.subscribe(setActiveConvoy);
  }, []);

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
          const icon = primaryItem.icon || '🔧';
          return {
            type: 'warning' as const,
            severity: 'high' as const,
            title: `Vehicle Alert: ${primaryItem.title}`,
            description: `${icon} Service overdue by ${Math.abs(Math.round(primaryItem.milesRemaining)).toLocaleString()} mi. Schedule maintenance soon.`,
            icon
          };
        } else if (health.overallStatus === 'due_soon' && health.items.length > 0) {
          const dueSoonItems = health.items.filter(i => i.status === 'due_soon');
          if (dueSoonItems.length > 0) {
            const primaryItem = dueSoonItems[0];
            const icon = primaryItem.icon || '🔧';
            return {
              type: 'warning' as const,
              severity: 'medium' as const,
              title: `Service Due Soon: ${primaryItem.title}`,
              description: `${icon} ${Math.round(primaryItem.milesRemaining).toLocaleString()} mi remaining until recommended service.`,
              icon
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
        icon: '⚠️'
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
  const distMeters = parseDistanceMeters(currentStep.distance);
  const distColor = distMeters > 500 ? 'text-emerald-400' : distMeters > 100 ? 'text-amber-400' : 'text-red-400';
  const distBorder = distMeters > 500 ? 'from-indigo-500 to-purple-600' : distMeters > 100 ? 'from-amber-500 to-orange-600' : 'from-red-500 to-rose-600';

  const totalSteps = steps.length;
  const progress = totalSteps > 0 ? ((stepIndex + 1) / totalSteps) * 100 : 0;
  const currentSpeedLimit = currentStep.speedLimit || 35;
  const isSpeeding = speed > currentSpeedLimit;
  const isSevereSpeeding = speed >= currentSpeedLimit + 10;
  const hasCameraNearby = currentStep.hasCamera;

  return (
    <div className="absolute inset-0 z-[100] flex flex-col pointer-events-none">
      {/* Top Navigation Bar - Glassmorphism */}
      <div className={`w-full pointer-events-auto ${isMobile ? 'pt-3 px-3' : 'pt-12 px-6'}`}>
        <div className={`max-w-xl mx-auto bg-black/40 backdrop-blur-2xl border border-white/10 shadow-[0_20px_50px_rgba(0,0,0,0.5)] flex items-center overflow-hidden relative ${
          isMobile ? 'rounded-2xl p-3 gap-3' : 'rounded-[2.5rem] p-6 gap-6'
        }`}>
          <div className="absolute -left-20 -top-20 w-40 h-40 bg-indigo-500/20 blur-[80px]" />

          {/* Next Turn Icon — color shifts with distance */}
          <div className={`bg-gradient-to-br ${distBorder} flex items-center justify-center text-white shadow-lg shrink-0 transition-all duration-500 ${
            isMobile ? 'w-12 h-12 rounded-xl' : 'w-20 h-20 rounded-3xl'
          }`}>
            <svg className={isMobile ? 'w-7 h-7' : 'w-12 h-12'} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={4} d="M5 10l7-7m0 0l7 7m-7-7v18" />
            </svg>
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-2">
              <span className={`font-black tracking-tighter transition-colors duration-500 ${distColor} ${
                isMobile ? 'text-3xl' : 'text-5xl'
              }`}>{currentStep.distance}</span>
            </div>
            <p className={`font-bold text-slate-200 truncate ${isMobile ? 'text-sm' : 'text-2xl'}`}>{currentStep.instruction}</p>

            {/* Visual Lane Guidance Arrows Strip */}
            {currentStep.lanes && currentStep.lanes.length > 0 && (
              <div className="flex items-center gap-1.5 mt-2 p-1.5 bg-black/60 backdrop-blur-md rounded-2xl border border-white/15 w-fit shadow-xl animate-in fade-in slide-in-from-top-1 duration-300">
                {currentStep.lanes.map((lane, lIdx) => (
                  <div
                    key={lIdx}
                    title={lane.isValid ? "Recommended Lane" : "Other Lane"}
                    className={`rounded-xl flex items-center justify-center transition-all ${
                      isMobile ? 'w-6 h-6' : 'w-8 h-8'
                    } ${
                      lane.isValid
                        ? 'bg-sky-500/25 border-2 border-sky-400 shadow-[0_0_12px_rgba(56,189,248,0.5)] scale-105'
                        : 'bg-white/5 border border-white/5 opacity-35'
                    }`}
                  >
                    {renderLaneIcon(lane.direction, lane.isValid)}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Progress Indicator */}
          <div className="absolute bottom-0 left-0 h-1 bg-indigo-500 transition-all duration-500" style={{ width: `${progress}%` }} />
        </div>
      </div>

      {/* Dynamic In-Drive Reroute Option Switcher Pill */}
      {betterRouteSuggestion && (
        <div className={`w-full pointer-events-auto flex justify-center mt-2.5 px-4 animate-in slide-in-from-top-3 duration-300`}>
          <div className="bg-gradient-to-r from-emerald-950/95 via-slate-900/98 to-indigo-950/95 backdrop-blur-2xl border-2 border-emerald-500/50 rounded-2xl sm:rounded-3xl p-3 sm:px-5 sm:py-3.5 shadow-[0_15px_40px_rgba(16,185,129,0.35)] flex items-center justify-between gap-3 sm:gap-6 max-w-lg w-full">
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <div className="w-10 h-10 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-lg shrink-0 shadow-md">
                {betterRouteSuggestion.route.routeType === 'toll_free' ? '🟢' : '⚡'}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[11px] font-black text-emerald-400 uppercase tracking-wider">
                    {betterRouteSuggestion.savingsLabel}
                  </span>
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300">
                    {betterRouteSuggestion.route.totalTime}
                  </span>
                </div>
                <p className="text-xs font-bold text-slate-200 truncate mt-0.5">
                  {betterRouteSuggestion.reason}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => onSwitchRoute && onSwitchRoute(betterRouteSuggestion.route)}
                className="px-3.5 py-2 bg-emerald-500 hover:bg-emerald-400 active:scale-95 text-slate-950 font-black text-xs rounded-xl shadow-lg shadow-emerald-500/30 transition-all flex items-center gap-1"
              >
                <span>🔀</span> Switch
              </button>
              <button
                type="button"
                onClick={() => onDismissReroute && onDismissReroute()}
                className="w-8 h-8 rounded-xl bg-white/10 hover:bg-white/20 text-slate-300 hover:text-white text-xs font-bold transition-all flex items-center justify-center"
                title="Dismiss suggestion"
              >
                ✕
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Dynamic In-Drive Toll Avoidance Switcher Chip */}
      {upcomingTollAlert && (
        <div className={`w-full pointer-events-auto flex justify-center mt-2 px-4 animate-in slide-in-from-top-3 duration-300`}>
          <div className="bg-gradient-to-r from-rose-950/95 via-slate-900/98 to-amber-950/95 backdrop-blur-2xl border-2 border-rose-500/50 rounded-2xl sm:rounded-3xl p-3 sm:px-5 sm:py-3.5 shadow-[0_15px_40px_rgba(244,63,94,0.35)] flex items-center justify-between gap-3 sm:gap-6 max-w-lg w-full">
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <div className="w-10 h-10 rounded-2xl bg-rose-500/20 border border-rose-500/40 flex items-center justify-center text-lg shrink-0 shadow-md">
                💳
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[11px] font-black text-rose-400 uppercase tracking-wider">
                    Toll Plaza Ahead (~${upcomingTollAlert.estimatedToll.toFixed(2)})
                  </span>
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300">
                    in {(upcomingTollAlert.distanceMeters / 1609).toFixed(1)} mi
                  </span>
                </div>
                <p className="text-xs font-bold text-slate-200 truncate mt-0.5">
                  {upcomingTollAlert.tollName}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => onTakeTollFreeExit && onTakeTollFreeExit()}
                className="px-3.5 py-2 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 active:scale-95 text-slate-950 font-black text-xs rounded-xl shadow-lg shadow-emerald-500/30 transition-all flex items-center gap-1"
              >
                <span>🛣️</span> Take Toll-Free Exit
              </button>
              <button
                type="button"
                onClick={() => onDismissTollAlert && onDismissTollAlert()}
                className="w-8 h-8 rounded-xl bg-white/10 hover:bg-white/20 text-slate-300 hover:text-white text-xs font-bold transition-all flex items-center justify-center"
                title="Dismiss toll alert"
              >
                ✕
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Multi-Vehicle Caravan & Convoy Telemetry Pill */}
      {(activeConvoy || convoyTelemetry.length > 0) && (
        <div className={`w-full pointer-events-auto flex justify-center mt-2 px-4 animate-in slide-in-from-top-2 duration-300`}>
          <div 
            onClick={() => setIsConvoyDrawerOpen(true)}
            className="bg-gradient-to-r from-purple-950/95 via-slate-900/98 to-indigo-950/95 backdrop-blur-2xl border-2 border-purple-500/50 rounded-2xl sm:rounded-3xl p-2.5 sm:px-4 sm:py-2.5 shadow-[0_12px_35px_rgba(168,85,247,0.3)] flex items-center justify-between gap-3 max-w-lg w-full cursor-pointer hover:border-purple-400 transition-all group"
          >
            <div className="flex items-center gap-2.5 min-w-0 flex-1">
              <span className="text-base sm:text-lg animate-pulse">🚗🚗</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[10px] font-black uppercase tracking-wider text-purple-300">
                    {activeConvoy ? 'Convoy Active' : 'Nearby Circle'}
                  </span>
                  {convoyTelemetry.length > 0 && (
                    <span className="text-[9px] font-bold px-1.5 py-0.2 rounded-md bg-purple-500/25 text-purple-200 truncate">
                      {convoyTelemetry[0].name}: {convoyTelemetry[0].distanceToUserMiles.toFixed(1)} mi {convoyTelemetry[0].isAhead ? 'ahead' : 'behind'} ({convoyTelemetry[0].speed} MPH)
                    </span>
                  )}
                </div>
                {convoyTelemetry.length > 0 && convoyTelemetry[0].status === 'lagging' && (
                  <p className="text-[10px] text-amber-300 font-bold truncate mt-0.5 animate-pulse">
                    ⚠️ {convoyTelemetry[0].name} is falling behind
                  </p>
                )}
              </div>
            </div>

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setIsConvoyDrawerOpen(true);
              }}
              className="px-2.5 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-[10px] font-black shadow-md flex items-center gap-1 shrink-0"
            >
              <span>⚙️</span> Convoy ({convoyTelemetry.length})
            </button>
          </div>
        </div>
      )}

      {/* Upcoming maneuver preview */}
      {steps[stepIndex + 1] && (
        <div className={`w-full pointer-events-auto flex justify-center mt-2 px-3 transition-all duration-700 animate-in fade-in slide-in-from-top-2`}>
          <div className="bg-black/40 backdrop-blur-xl border border-white/5 rounded-full px-4 py-1.5 flex items-center gap-3 shadow-lg">
            <span className="text-[10px] font-black text-indigo-400 uppercase tracking-widest">Next</span>
            <div className="w-px h-3 bg-white/10" />
            <p className="text-[11px] font-bold text-slate-300 truncate max-w-[200px]">
              {steps[stepIndex + 1].instruction}
            </p>
          </div>
        </div>
      )}

      {/* Advisory Alert */}
      {advisory && !advisoryDismissed && (
        isMobile ? (
          <div className="absolute top-20 right-3 z-10 pointer-events-auto">
            {advisoryExpanded ? (
              <div className={`p-3 rounded-xl border backdrop-blur-xl animate-in slide-in-from-right duration-300 shadow-xl max-w-[250px]
                ${advisory.severity === 'high' ? 'bg-red-500/30 border-red-500/40' :
                  advisory.severity === 'medium' ? 'bg-amber-500/30 border-amber-500/40' :
                    'bg-indigo-500/30 border-indigo-500/40'}
              `}>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm">
                      {advisory.icon || (advisory.type === 'weather' ? '⛈️' : advisory.type === 'traffic' ? '🚗' : advisory.type === 'crime' ? '🛡️' : '⚠️')}
                    </span>
                    <h4 className="text-white font-bold uppercase tracking-wider text-[9px]">{advisory.title}</h4>
                  </div>
                  <button onClick={() => setAdvisoryDismissed(true)} className="text-slate-400 hover:text-white text-xs">✕</button>
                </div>
                <p className="text-slate-200 text-[11px] leading-tight">{advisory.description}</p>
              </div>
            ) : (
              <button
                onClick={() => setAdvisoryExpanded(true)}
                className={`w-9 h-9 rounded-full flex items-center justify-center shadow-lg border backdrop-blur-xl transition-all active:scale-90
                  ${advisory.severity === 'high' ? 'bg-red-500/40 border-red-500/50' :
                    advisory.severity === 'medium' ? 'bg-amber-500/40 border-amber-500/50' :
                      'bg-indigo-500/40 border-indigo-500/50'}
                `}
              >
                <span className="text-sm">
                  {advisory.icon || (advisory.type === 'weather' ? '⛈️' : advisory.type === 'traffic' ? '🚗' : advisory.type === 'crime' ? '🛡️' : '⚠️')}
                </span>
              </button>
            )}
          </div>
        ) : (
          <div className="absolute top-28 right-6 z-10 pointer-events-auto">
            <div className={`p-4 rounded-2xl border backdrop-blur-xl animate-in slide-in-from-right duration-500 shadow-xl max-w-xs
              ${advisory.severity === 'high' ? 'bg-red-500/30 border-red-500/40' :
                advisory.severity === 'medium' ? 'bg-amber-500/30 border-amber-500/40' :
                  'bg-indigo-500/30 border-indigo-500/40'}
            `}>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-lg">
                  {advisory.icon || (advisory.type === 'weather' ? '⛈️' : advisory.type === 'traffic' ? '🚗' : advisory.type === 'crime' ? '🛡️' : '⚠️')}
                </span>
                <h4 className="text-white font-bold uppercase tracking-wider text-[10px]">{advisory.title}</h4>
              </div>
              <p className="text-slate-200 text-xs leading-snug">{advisory.description}</p>
            </div>
          </div>
        )
      )}

      {/* Spacer - Map visible in center */}
      <div className="flex-1" />

      {/* DESKTOP / TABLET: Left Docked Navigation Cockpit + Right Action Buttons */}
      {!isMobile ? (
        <>
          {/* Left Docked Navigation Sidebar */}
          <div className="absolute left-6 bottom-6 z-20 pointer-events-auto flex items-end gap-3.5 max-w-xl w-[520px] animate-in slide-in-from-left duration-500">
            {/* Speedometer Dial & MUTCD Speed Limit Sign */}
            <div className="flex flex-col items-center gap-2 shrink-0">
              {/* Safety / Speed Camera Warning Badge */}
              {hasCameraNearby && (
                <div className="px-2.5 py-1 rounded-full bg-amber-500/20 border border-amber-500/40 text-[10px] font-black text-amber-300 flex items-center gap-1 shadow-lg animate-pulse">
                  <span>📷</span>
                  <span>CAMERA ZONE</span>
                </div>
              )}

              <div className="flex items-center gap-2.5">
                {/* Speedometer Dial */}
                <div className="relative">
                  <div className="bg-black/75 backdrop-blur-2xl border-4 border-indigo-500/40 rounded-3xl w-28 h-28 flex flex-col items-center justify-center shadow-[0_20px_50px_rgba(0,0,0,0.6)]">
                    <span className={`font-black text-5xl leading-none transition-colors duration-300 ${
                      isSevereSpeeding ? 'text-red-400' : isSpeeding ? 'text-amber-300' : 'text-white'
                    }`}>{speed}</span>
                    <span className="font-bold text-indigo-300 uppercase text-[11px] tracking-wider mt-0.5">MPH</span>
                    <svg className="absolute inset-0 w-full h-full -rotate-90">
                      <circle
                        cx="56" cy="56" r="50"
                        fill="none" stroke="currentColor" strokeWidth="3"
                        strokeDasharray="314"
                        strokeDashoffset={314 - (314 * (Math.min(speed, 80) / 80))}
                        className={`${
                          isSevereSpeeding ? 'text-red-500' : isSpeeding ? 'text-amber-400' : 'text-indigo-500'
                        } transition-all duration-500`}
                      />
                    </svg>
                  </div>
                </div>

                {/* MUTCD Speed Limit Sign */}
                <div className={`bg-white rounded-2xl border-2 border-black flex flex-col items-center justify-center w-16 h-24 p-1.5 shadow-2xl transition-all duration-300 ${
                  isSevereSpeeding
                    ? 'ring-4 ring-red-500/70 shadow-[0_0_25px_rgba(239,68,68,0.7)] animate-pulse'
                    : isSpeeding
                    ? 'ring-2 ring-amber-500/60 shadow-[0_0_15px_rgba(245,158,11,0.5)]'
                    : 'shadow-xl'
                }`}>
                  <span className="font-black text-black uppercase tracking-tighter text-[9px] leading-tight">SPEED</span>
                  <span className="font-black text-black uppercase tracking-tighter text-[9px] leading-tight">LIMIT</span>
                  <span className={`font-black text-3xl tracking-tight leading-none mt-1 ${
                    isSevereSpeeding ? 'text-red-600' : 'text-black'
                  }`}>
                    {currentSpeedLimit}
                  </span>
                </div>
              </div>
            </div>

            {/* Left Stacked Panels: ETA Summary (Yellow) + Itinerary Deck (Blue) */}
            <div className="flex-1 flex flex-col gap-3">
              {/* ETA & Distance Summary Card (Yellow section) */}
              <div className="bg-black/75 backdrop-blur-2xl border border-white/15 rounded-3xl p-5 shadow-[0_20px_50px_rgba(0,0,0,0.6)]">
                <div className="flex items-center justify-between">
                  <div className="flex gap-6">
                    <div>
                      <p className="font-bold text-slate-400 uppercase tracking-wider text-[10px]">Estimated Arrival</p>
                      <p className="font-black text-white text-3xl">{route.totalTime}</p>
                    </div>
                    <div className="w-px bg-white/15" />
                    <div>
                      <p className="font-bold text-slate-400 uppercase tracking-wider text-[10px]">Distance</p>
                      <p className="font-black text-white text-3xl">{route.totalDistance}</p>
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-1.5">
                    <div className="px-2.5 py-1 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center gap-1.5">
                      <span className="text-xs">🛡️</span>
                      <span className="text-[11px] font-black text-emerald-400">{safetyScore}% Safety</span>
                    </div>
                    {sessionPoints !== undefined && (
                      <span className="text-[11px] font-black text-amber-400/80 px-1">
                        {sessionPoints > 0 ? `+${sessionPoints} Pts` : '0 Pts'}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Step-by-Step Itinerary Deck (Blue section) */}
              <div className="bg-black/75 backdrop-blur-2xl border border-white/15 rounded-3xl p-5 shadow-[0_20px_50px_rgba(0,0,0,0.6)]">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-[10px] font-black text-indigo-400 uppercase tracking-widest">
                    Upcoming Itinerary ({steps.length - stepIndex} Remaining)
                  </p>
                  <span className="text-[10px] text-slate-400 font-bold truncate max-w-[140px]" title={route.destinationName}>
                    {route.destinationName}
                  </span>
                </div>

                {showDetails && (
                  <div className="space-y-2 max-h-56 overflow-y-auto pr-1 custom-scrollbar animate-in fade-in duration-300">
                    {steps.slice(stepIndex).map((step, sliceIdx) => {
                      const actualIdx = stepIndex + sliceIdx;
                      const isCurrent = sliceIdx === 0;

                      return (
                        <div key={actualIdx} className={`flex gap-3 items-center p-2.5 rounded-2xl transition-all ${
                          isCurrent 
                            ? 'bg-indigo-500/25 border border-indigo-500/50 shadow-lg' 
                            : 'bg-white/5 border border-white/5 opacity-75 hover:opacity-100'
                        }`}>
                          <div className={`w-7 h-7 rounded-xl flex items-center justify-center shrink-0 ${
                            isCurrent ? 'bg-indigo-600 text-white shadow-md' : 'bg-white/10 text-slate-400'
                          }`}>
                            <span className="text-[11px] font-black">{actualIdx + 1}</span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className={`text-xs font-bold leading-snug ${isCurrent ? 'text-white' : 'text-slate-300'}`}>
                              {step.instruction}
                            </p>
                            {step.lanes && step.lanes.length > 0 && (
                              <div className="flex items-center gap-1 mt-1">
                                {step.lanes.map((l, lk) => (
                                  <span
                                    key={lk}
                                    className={`w-3.5 h-3.5 rounded flex items-center justify-center text-[8px] font-black ${
                                      l.isValid ? 'bg-sky-500/30 text-sky-300 border border-sky-400/40' : 'bg-white/5 text-slate-500'
                                    }`}
                                  >
                                    {l.direction === 'right' || l.direction === 'slight_right' ? '↗' : l.direction === 'left' || l.direction === 'slight_left' ? '↖' : l.direction === 'uturn' ? '↶' : '↑'}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {step.speedLimit && (
                              <span className="px-1.5 py-0.5 rounded bg-white/10 text-[9px] font-black text-slate-300">
                                {step.speedLimit} MPH
                              </span>
                            )}
                            <span className={`text-[11px] font-bold ${isCurrent ? 'text-indigo-300' : 'text-slate-500'}`}>
                              {step.distance}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                <button
                  onClick={() => setShowDetails(!showDetails)}
                  className="mt-3 w-full flex items-center justify-center gap-1.5 text-[11px] font-bold text-slate-400 hover:text-white py-1.5 bg-white/5 hover:bg-white/10 rounded-xl border border-white/5 transition-all active:scale-95"
                >
                  <span className="text-[10px] opacity-70">{showDetails ? '▼' : '▲'}</span>
                  <span>{showDetails ? 'Minimize Itinerary' : 'Expand Itinerary'}</span>
                </button>
              </div>
            </div>
          </div>

          {/* Desktop Floating Recenter Button */}
          {isCameraFree && (
            <div className="absolute bottom-28 left-1/2 -translate-x-1/2 z-30 pointer-events-auto animate-in fade-in zoom-in duration-200">
              <button
                onClick={onRecenter}
                className="flex items-center gap-2.5 px-6 py-3 bg-gradient-to-r from-indigo-600 via-purple-600 to-indigo-600 hover:from-indigo-500 hover:to-purple-500 text-white rounded-full shadow-[0_12px_30px_rgba(99,102,241,0.65)] border-2 border-white/40 font-black text-xs uppercase tracking-wider backdrop-blur-xl active:scale-95 transition-all cursor-pointer"
              >
                <span className="text-base animate-pulse">🎯</span>
                <span>Recenter Map</span>
              </button>
            </div>
          )}

          {/* Right Action Controls: Voice Mute + Cancel */}
          <div className="absolute right-6 bottom-6 z-20 pointer-events-auto flex items-center gap-3 animate-in slide-in-from-right duration-500">
            {/* Voice Mute / Unmute Toggle */}
            <button
              onClick={() => {
                const next = speechService.toggleMuted();
                setIsVoiceMuted(next);
              }}
              title={isVoiceMuted ? "Unmute voice guidance" : "Mute voice guidance"}
              className={`border flex items-center justify-center shadow-2xl transition-all backdrop-blur-xl active:scale-95 h-20 w-20 rounded-3xl text-2xl ${
                isVoiceMuted 
                  ? 'bg-amber-500/20 border-amber-500/40 text-amber-400 hover:bg-amber-500/30' 
                  : 'bg-indigo-500/20 border-indigo-500/40 text-indigo-300 hover:bg-indigo-500/30'
              }`}
            >
              <span>{isVoiceMuted ? '🔇' : '🔊'}</span>
            </button>

            {/* Cancel Navigation */}
            <button
              onClick={onCancel}
              title="Exit Navigation"
              className="bg-red-500/20 border border-red-500/40 text-red-500 flex items-center justify-center shadow-2xl hover:bg-red-500/40 transition-all backdrop-blur-xl active:scale-95 h-20 w-20 rounded-3xl"
            >
              <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </>
      ) : (
        /* MOBILE: Compact Bottom Sheet Layout */
        <div className="w-full pointer-events-auto pb-3 px-3">
          {/* Mobile Floating Recenter Button */}
          {isCameraFree && (
            <div className="flex justify-center mb-3 animate-in fade-in zoom-in duration-200">
              <button
                onClick={onRecenter}
                className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-indigo-600 via-purple-600 to-indigo-600 hover:from-indigo-500 hover:to-purple-500 text-white rounded-full shadow-[0_10px_25px_rgba(99,102,241,0.65)] border border-white/40 font-black text-xs uppercase tracking-wider backdrop-blur-xl active:scale-95 transition-all cursor-pointer"
              >
                <span className="text-sm animate-pulse">🎯</span>
                <span>Recenter</span>
              </button>
            </div>
          )}
          <div className="max-w-xl mx-auto flex items-end justify-between gap-3">
            {/* Left: Speed + Speed Limit + ETA */}
            <div className="flex items-end gap-2 flex-1">
              {/* Speedometer */}
              <div className="relative shrink-0">
                <div className="bg-black/70 backdrop-blur-xl border-4 border-indigo-500/40 flex flex-col items-center justify-center shadow-xl rounded-2xl w-16 h-16">
                  <span className={`font-black text-2xl leading-none ${
                    isSevereSpeeding ? 'text-red-400' : isSpeeding ? 'text-amber-300' : 'text-white'
                  }`}>{speed}</span>
                  <span className="font-bold text-indigo-300 uppercase text-[7px]">MPH</span>
                  <svg className="absolute inset-0 w-full h-full -rotate-90">
                    <circle
                      cx="32" cy="32" r="28"
                      fill="none" stroke="currentColor" strokeWidth="2.5"
                      strokeDasharray="176"
                      strokeDashoffset={176 - (176 * (Math.min(speed, 80) / 80))}
                      className={`${
                        isSevereSpeeding ? 'text-red-500' : isSpeeding ? 'text-amber-400' : 'text-indigo-500'
                      } transition-all duration-500`}
                    />
                  </svg>
                </div>
              </div>

              {/* Mini Speed Limit Sign */}
              <div className={`bg-white rounded-xl border border-black flex flex-col items-center justify-center w-10 h-16 p-1 shrink-0 ${
                isSevereSpeeding
                  ? 'ring-2 ring-red-500 shadow-[0_0_12px_rgba(239,68,68,0.7)] animate-pulse'
                  : isSpeeding
                  ? 'ring-1 ring-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]'
                  : 'shadow-md'
              }`}>
                <span className="font-black text-black uppercase tracking-tighter text-[6px] leading-tight">SPEED</span>
                <span className="font-black text-black uppercase tracking-tighter text-[6px] leading-tight">LIMIT</span>
                <span className={`font-black text-base tracking-tight leading-none mt-0.5 ${
                  isSevereSpeeding ? 'text-red-600' : 'text-black'
                }`}>
                  {currentSpeedLimit}
                </span>
              </div>

              {/* ETA + Distance */}
              <div className="bg-black/70 backdrop-blur-2xl border border-white/15 rounded-t-[2rem] rounded-b-xl p-3 flex-1 transition-all duration-500">
                <div className="w-10 h-1 bg-white/10 rounded-full mx-auto mb-3" />
                <div className="flex gap-3">
                  <div>
                    <p className="font-bold text-slate-500 uppercase tracking-wider text-[7px]">ETA</p>
                    <p className="font-black text-white text-lg">{route.totalTime}</p>
                  </div>
                  <div className="w-px bg-white/10" />
                  <div>
                    <p className="font-bold text-slate-500 uppercase tracking-wider text-[7px]">Distance</p>
                    <p className="font-black text-white text-lg">{route.totalDistance}</p>
                  </div>
                </div>

                {showDetails && (
                  <div className="mt-3 pt-3 border-t border-white/10 animate-in slide-in-from-bottom duration-300">
                    <div className="flex gap-6 mb-3 justify-between">
                      <div>
                        <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Safety</p>
                        <p className="text-lg font-black text-emerald-400">{safetyScore}%</p>
                      </div>
                      {sessionPoints && sessionPoints > 0 && (
                        <div>
                          <p className="text-[9px] font-bold text-amber-500 uppercase tracking-widest">Points</p>
                          <p className="text-lg font-black text-amber-400">+{sessionPoints}</p>
                        </div>
                      )}
                    </div>

                    <div className="space-y-2 max-h-36 overflow-y-auto pr-1">
                      {steps.slice(stepIndex, stepIndex + 3).map((step, sliceIdx) => {
                        const actualIdx = stepIndex + sliceIdx;
                        const isCurrent = sliceIdx === 0;

                        return (
                          <div key={actualIdx} className={`flex gap-2 items-center p-1.5 rounded-lg ${isCurrent ? 'bg-indigo-500/20 text-white' : 'text-slate-400'}`}>
                            <span className="text-[10px] font-black w-4">{actualIdx + 1}</span>
                            <p className="text-[11px] font-bold truncate flex-1">{step.instruction}</p>
                            <span className="text-[10px] text-slate-500 shrink-0">{step.distance}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                <button
                  onClick={() => setShowDetails(!showDetails)}
                  className="mt-2 w-full flex items-center justify-center gap-1 py-1.5 bg-indigo-500/10 rounded-lg border border-indigo-500/20 text-indigo-300 font-bold text-[9px] uppercase tracking-wider active:scale-95"
                >
                  <span>{showDetails ? '▼ Hide Details' : '▲ More Stats'}</span>
                </button>
              </div>
            </div>

            {/* Mobile Right Action Controls */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  const next = speechService.toggleMuted();
                  setIsVoiceMuted(next);
                }}
                className={`border flex items-center justify-center shadow-2xl transition-all backdrop-blur-xl active:scale-95 h-14 w-14 rounded-xl text-xl ${
                  isVoiceMuted 
                    ? 'bg-amber-500/20 border-amber-500/40 text-amber-400' 
                    : 'bg-indigo-500/20 border-indigo-500/40 text-indigo-300'
                }`}
              >
                <span>{isVoiceMuted ? '🔇' : '🔊'}</span>
              </button>

              <button
                onClick={onCancel}
                className="bg-red-500/20 border border-red-500/40 text-red-500 flex items-center justify-center shadow-2xl hover:bg-red-500/40 transition-all backdrop-blur-xl active:scale-95 h-14 w-14 rounded-xl"
              >
                <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Convoy Control Center Modal */}
      {isConvoyDrawerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-in fade-in duration-200 pointer-events-auto">
          <div className="bg-slate-900 border border-purple-500/40 rounded-3xl p-5 max-w-md w-full shadow-[0_25px_60px_rgba(0,0,0,0.8)] space-y-4">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div className="flex items-center gap-2">
                <span className="text-2xl">🚗🚗</span>
                <div>
                  <h3 className="text-base font-black text-white">Caravan & Convoy Mode</h3>
                  <p className="text-xs text-purple-300">Multi-Vehicle Road Trip Linking</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsConvoyDrawerOpen(false)}
                className="w-8 h-8 rounded-full bg-white/10 text-slate-300 hover:text-white flex items-center justify-center"
              >
                ✕
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

                    <span className={`text-[9px] font-black px-2 py-0.5 rounded-md ${
                      member.status === 'lagging'
                        ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30 animate-pulse'
                        : member.status === 'stopped'
                        ? 'bg-red-500/20 text-red-300'
                        : 'bg-emerald-500/20 text-emerald-300'
                    }`}>
                      {member.status === 'lagging' ? '⚠️ Lagging' : member.status === 'stopped' ? '🛑 Stopped' : '✅ In Sync'}
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
                        className="px-2 py-1 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-[10px] font-black shadow-sm"
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
                    className="py-2.5 px-3 rounded-xl bg-amber-500/20 border border-amber-500/30 text-amber-300 text-xs font-bold hover:bg-amber-500/30 transition-all flex items-center justify-center gap-1.5"
                  >
                    <span>☕</span> Suggest Pit Stop
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      convoyService.endConvoy();
                      setIsConvoyDrawerOpen(false);
                    }}
                    className="py-2.5 px-3 rounded-xl bg-red-500/20 border border-red-500/30 text-red-400 text-xs font-bold hover:bg-red-500/30 transition-all flex items-center justify-center gap-1.5"
                  >
                    <span>⏹</span> End Convoy
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
                  className="w-full py-3 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white text-xs font-black shadow-lg transition-all active:scale-95 flex items-center justify-center gap-2"
                >
                  <span>🚗🚗</span> Start Convoy with All Circle Members
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DriveModeHUD;
