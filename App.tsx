import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { FamilyMember, Place, DailyInsight, NavigationRoute, RouteWaypoint, CircleTask, IncidentReport, PrivacyZone, Trip, CrashImpactMetadata, ParkedVehiclePlace } from './types';
import { parkingService } from './services/parkingService';
// Sidebar removed - replaced by BentoSidebar
import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
// UNIFIED MAP: MapView removed - now using MapLibre3DView for both 2D/3D modes
import MapLibre3DView from './components/MapLibre3DView';
import InsightsBar from './components/InsightsBar';
import MemberDetailPanel from './components/MemberDetailPanel';
import NavigationOverlay from './components/NavigationOverlay';
import SearchBox from './components/SearchBox';
import CoPilotOverlay from './components/CoPilotOverlay';
import DriveModeHUD from './components/DriveModeHUD';
import MapEdgeAwareness from './components/MapEdgeAwareness';
import IncidentReporter from './components/IncidentReporter';
import PrivacyPanel from './components/PrivacyPanel';
import PremiumUpsellModal from './components/PremiumUpsellModal';
// Audit #3: RewardsPanel removed — sponsored rewards deferred for MVP
import BottomSheet from './components/BottomSheet';
import QuickStopGrid from './components/QuickStopGrid';
import SafetyAlerts from './components/SafetyAlerts';
import QuickActions from './components/QuickActions';
import CircleContactsPanel from './components/CircleContactsPanel';
import SettingsPanel from './components/SettingsPanel';
import { MapSkinId } from './services/mapSkinService';
import BentoSidebar from './components/BentoSidebar';
import EmergencySOSModal from './components/EmergencySOSModal';
import EditPlaceModal from './components/EditPlaceModal';
import CorrectLocationModal from './components/CorrectLocationModal';
import ApproachingDestinationCard from './components/ApproachingDestinationCard';
import MultiStopArrivalCard from './components/MultiStopArrivalCard';
import TripReviewCard from './components/TripReviewCard';
import TripResumePrompt from './components/TripResumePrompt';
import CircleSettingsModal from './components/CircleSettingsModal';
import IncidentDetailModal from './components/IncidentDetailModal';
import { incidentService } from './services/incidentService';
import { ambientPoiService } from './services/ambientPoiService';
import { findSchoolZoneAdvisory, SchoolZoneAdvisory } from './services/schoolZoneService';
import LoginScreen from './components/LoginScreen';
import SetupWizardModal from './components/SetupWizardModal';
import PlaceDetailPanel from './components/PlaceDetailPanel';
import LoadingScreen from './components/LoadingScreen';
import { useAuth } from './contexts/AuthContext';
import { useUI } from './contexts/UIContext';
import OverlayManager, { OverlayStackProvider } from './components/OverlayManager';
import LegalConsentScreen, { hasLegalConsent } from './components/LegalConsentScreen';
import {
  EyeOff,
  Car,
  Navigation,
  MessageSquare,
  Phone,
  Hand,
  CheckCircle2,
  X,
  Battery,
  Radio,
  AlertTriangle,
  Shield,
  Settings
} from 'lucide-react';
import {
  getFamilyInsights,
  searchPlacesOnMap
} from './services/geminiService';
import { getRouteFromOSRM, geocodePlace } from './services/osrmService';
import { isGeoIntentUrl, parseGeoIntent } from './utils/geoIntentParser';
import { syncMapSkinSettings, syncSavedPlaces } from './services/androidAutoService';
import { geolocationService } from './services/geolocationService';
import { nativeBackgroundTrackingService } from './services/nativeBackgroundTrackingService';
import { nativeRoadRecorderService } from './services/nativeRoadRecorderService';
import { isCurrentLocationPublisher } from './services/deviceSessionService';
import { getCirclePrivacyMode } from './services/privacyService';
import { getMapReviewAccess, listPendingAccessPointReviews } from './services/mapReviewService';
import { setupAutoFlush as setupOfflineLocationAutoFlush } from './services/offlineLocationBuffer';
import {
  updateMemberLocation,
  syncBufferedLocations,
  subscribeToFamilyLocations,
  getCircleMembers,
  getFamilyCircle,
  FamilyCircle,
  subscribeToGeofences,
  addGeofence,
  updateUserProfile,
  getUserProfile,
  uploadProfileImage,
  deliverWrappedKey,
  getWrappedKeyForUser,
  triggerSOS,
  clearSOS,
  removeMember,
  getCircleSubscriptionEntitlement,
  CircleSubscriptionEntitlement
} from './services/authService';
import { createCheckoutSession } from './services/stripeService';
import { Geofence, GeofenceStatus, detectTransition, getGeofenceDisplayName } from './services/geofenceService';
import { getSafeAvatarUrl, getDefaultAvatarDataUri } from './utils/avatar';
import { setKnownPlaces } from './services/locationService';
import { formatMemberStatus } from './utils/memberStatus';
// Audit #3: rewardsService removed
import { searchGasStations, searchCoffeeShops, searchRestaurants, searchGroceryStores, searchPlacesText } from './services/placesService';
import { subscribeToUserPlaces, subscribeToUserPlacesMulti, UserPlace, addUserPlace, deleteUserPlace, updateUserPlace, broadcastPlaceGeofenceUpdate } from './services/userPlacesService';
import { placeCorrectionService } from './services/placeCorrectionService';
// Audit #3: sponsoredPlacesService removed
import { updateNavigationState, NavigationState } from './services/navigationEngine';
import {
  encryptLocation,
  decryptLocation,
  getFuzzyLocation,
  generateFamilyKey,
  setFamilyKey,
  getFamilyKey,
  generateECDHKeyPair,
  exportPublicKey,
  importPublicKey,
  deriveSharedSecretKey,
  wrapCircleKey,
  unwrapCircleKey,
  exportKeyPairJWK,
  importKeyPairJWK,
  saveKeyPairToSecureStorage,
  loadKeyPairFromSecureStorage
} from './services/cryptoService';
// Mesh P2P removed: Simulation provided no real offline value (Audit Sprint Mar 2026)
import { audioService } from './services/audioService';
import { SUBSCRIPTION_TIERS } from './config/subscriptions';
import { useLocationSync } from './hooks/useLocationSync';
import { useGeofences } from './hooks/useGeofences';
import { useNavigation } from './hooks/useNavigation';
import { useE2EE } from './hooks/useE2EE';
import { startTrip, recordTripPoint, endTrip, getActiveTrip } from './services/tripHistoryService';
import { startCrashMonitoring, stopCrashMonitoring, cancelCrashCountdown, updateCrashDetectionSpeed } from './services/crashDetectionService';
import CrashCountdownOverlay from './components/CrashCountdownOverlay';
import NotificationCenter, { addNotification, getUnreadCount, getNotifications, AppNotification } from './components/NotificationCenter';
import BatteryOptimizationPrompt, { shouldShowBatteryPrompt } from './components/BatteryOptimizationPrompt';
import ErrorBoundary from './components/ErrorBoundary';
import PermissionGuard from './components/PermissionGuard';
import { convoyService, ConvoyInvite } from './services/convoyService';
import { placePhotoService } from './services/placePhotoService';
import { nativeStatusBarService } from './services/nativeStatusBarService';
import { setCirclePrivacyMode } from './services/privacyService';
import { clearTemporaryVisibility, getTemporaryVisibilityExpiry, startTemporaryVisibility } from './services/temporaryVisibilityService';

// Lazy-loaded modal panels for optimal tree-shaking & main-thread responsiveness
const OfflineMapManager = React.lazy(() => import('./components/OfflineMapManager'));
const TripHistoryPanel = React.lazy(() => import('./components/TripHistoryPanel'));
const CircleAdminPanel = React.lazy(() => import('./components/CircleAdminPanel'));
const MaintenancePanel = React.lazy(() => import('./components/MaintenancePanel'));
const KeyRecoveryPanel = React.lazy(() => import('./components/KeyRecoveryPanel'));
const WeeklySafetyReport = React.lazy(() => import('./components/WeeklySafetyReport'));
const InviteShareModal = React.lazy(() => import('./components/InviteShareModal'));

export type ActiveModal =
  | 'settings'
  | 'privacy'
  | 'quickstop'
  | 'upsell'
  | 'contacts'
  | 'offline_maps'
  | 'trip_history'
  | 'circle_admin'
  | 'circle_settings'
  | 'notifications'
  | 'weekly_report'
  | 'invite'
  | 'key_recovery'
  | 'battery_prompt'
  | 'maintenance';

const App: React.FC = () => {
  const {
    user,
    profile,
    currentCircle,
    userCircles,
    loading: authLoading,
    error: authError,
    emailLinkSent,
    signInWithGoogle,
    signInWithEmail,
    signUpWithEmail,
    sendMagicLink,
    clearError,
    createCircle,
    joinCircle,
    switchCircle,
    leaveCurrentCircle,
    renameCircle,
    updateCircleColor,
    deleteCircle,
    deleteUserAccount,
    sendPasswordReset,
    refreshCircles,
    logout
  } = useAuth();

  // Instant local profile overrides from onboarding before remote Firebase sync settles.
  const [localProfileOverride, setLocalProfileOverride] = useState<any>(null);
  const activeUserProfile = useMemo(() => (profile ? { ...profile, ...(localProfileOverride || {}) } : null), [profile, localProfileOverride]);

  // Profiles created before setup completion was stored should remain usable.
  // They are established accounts, not new sign-ups; migrate them once so a
  // storage reset cannot send them back into the onboarding wizard.
  useEffect(() => {
    if (!user?.uid || !profile || profile.hasCompletedSetup !== undefined) return;
    void import('./services/authService').then(({ updateUserProfile }) =>
      updateUserProfile(user.uid, { hasCompletedSetup: true })
    ).catch(error => console.warn('[App] Could not migrate legacy setup state:', error));
  }, [user?.uid, profile?.hasCompletedSetup]);

  const {
    theme, setTheme,
    mapSkin, setMapSkin,
    effectiveSkin, isDefaultSkin,
    isMobile,
    isDriveMode, setDriveMode,
    is3DMode, set3DMode,
    notification, showNotification
  } = useUI();

  // Dynamically resolve activeTheme to 'light' whenever the Default map skin is active
  const activeTheme: 'light' | 'dark' = isDefaultSkin || theme === 'light' ? 'light' : 'dark';

  // Keep Android's edge-to-edge status bar in the same family as the map skin.
  // The native bridge also selects contrasting system icons for each backdrop.
  useEffect(() => {
    void nativeStatusBarService.applyMapSkin(effectiveSkin);
  }, [effectiveSkin]);

  // Android Auto owns a separate native map surface, so mirror the resolved
  // phone skin rather than leaving it on the renderer's old dark default.
  // `effectiveSkin` also resolves Auto Solar Transition before it reaches car.
  useEffect(() => {
    void syncMapSkinSettings({
      skin: effectiveSkin,
      theme: activeTheme,
      is3DMode
    });
  }, [effectiveSkin, activeTheme, is3DMode]);

  const [activeModal, setActiveModal] = useState<ActiveModal | null>(null);
  const [pendingOperationsReviewCount, setPendingOperationsReviewCount] = useState<number | null>(null);
  const [circleSettingsTab, setCircleSettingsTab] = useState<'circles' | 'invite' | 'manage'>('circles');
  const [activeFilterCircleId, setActiveFilterCircleId] = useState<string | 'all'>('all');

  useEffect(() => {
    if (!user?.uid) {
      setPendingOperationsReviewCount(null);
      return;
    }
    let active = true;
    let refreshId: number | undefined;
    const refreshPendingReviews = async () => {
      let shouldRefresh = true;
      try {
        const access = await getMapReviewAccess();
        if (!access.isAdmin) {
          shouldRefresh = false;
          if (active) setPendingOperationsReviewCount(null);
          return;
        }
        const submissions = await listPendingAccessPointReviews();
        if (active) setPendingOperationsReviewCount(submissions.length);
      } catch {
        if (active) setPendingOperationsReviewCount(null);
      } finally {
        if (active && shouldRefresh) refreshId = window.setTimeout(() => void refreshPendingReviews(), 60_000);
      }
    };
    void refreshPendingReviews();
    return () => {
      active = false;
      if (refreshId !== undefined) window.clearTimeout(refreshId);
    };
  }, [user?.uid]);

  const [isSearching, startSearchTransition] = React.useTransition();
  const [showOnboarding, setShowOnboarding] = useState(false);

  // --- CORE STATE ---
  const [isMapReady, setIsMapReady] = useState(false);
  const [isMapRecovering, setIsMapRecovering] = useState(false);
  const [isOwner, setIsOwner] = useState(false);
  const [userPlaces, setUserPlaces] = useState<UserPlace[]>([]);

  // Async hydration of local storage data to prevent main thread blocking
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        const onboardingComplete = localStorage.getItem('myway_onboarding_complete');
        if (!onboardingComplete) {
          setShowOnboarding(true);
        }
        
        const savedPlaces = localStorage.getItem('myway_user_places');
        if (savedPlaces) {
          setUserPlaces(JSON.parse(savedPlaces));
        }
      } catch (e) {
        console.warn('Failed to hydrate from localStorage', e);
      }
    }
  }, []);

  // Keep saved places available to navigation and place features.
  useEffect(() => {
    setKnownPlaces(userPlaces || []);
  }, [userPlaces]);
  const [discoveredPlaces, setDiscoveredPlaces] = useState<Place[]>([]);
  const [searchResultPlaces, setSearchResultPlaces] = useState<Place[]>([]);
  const [safetyScore, setSafetyScore] = useState(100);
  const [sessionPoints, setSessionPoints] = useState(0);
  const [crashCountdown, setCrashCountdown] = useState<number | null>(null);
  const [etaSharing, setEtaSharing] = useState(false);
  const [actionBarExpanded, setActionBarExpanded] = useState(false);
  const [mapBounds, setMapBounds] = useState<{ north: number; south: number; east: number; west: number } | null>(null);
  const [mapZoom, setMapZoom] = useState(14);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [hasInitiallyCentered, setHasInitiallyCentered] = useState(false);
  const [mapCenter, setMapCenter] = useState<[number, number] | undefined>(undefined);
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [isMemberDetailOpen, setIsMemberDetailOpen] = useState<boolean>(false);
  const [isMemberIdentityInspectorOpen, setIsMemberIdentityInspectorOpen] = useState(false);
  const lastMemberSelectedAtRef = useRef<number>(0);
  const [contactAction, setContactAction] = useState<'text' | 'call'>('text');
  const [contactRecipientId, setContactRecipientId] = useState<string | null>(null);
  const [selectedPlace, setSelectedPlace] = useState<Place | null>(null);
  const [plannedWaypoints, setPlannedWaypoints] = useState<RouteWaypoint[]>([]);
  const [keepStopPlannerOpen, setKeepStopPlannerOpen] = useState(false);
  const [isPlaceDetailOpen, setIsPlaceDetailOpen] = useState<boolean>(false);
  const [photoSavedConfirmation, setPhotoSavedConfirmation] = useState<{ name: string; place: Place | null; isSynced: boolean } | null>(null);
  useEffect(() => {
    if (!photoSavedConfirmation) return;
    const timer = window.setTimeout(() => setPhotoSavedConfirmation(null), 4_500);
    return () => window.clearTimeout(timer);
  }, [photoSavedConfirmation]);
  useEffect(() => {
    const retryPendingPhotos = () => {
      void placePhotoService.retryPendingContributions().then(count => {
        if (count > 0) showNotification(`✅ ${count} building photo${count === 1 ? '' : 's'} synced`, 3500);
      });
    };
    if (navigator.onLine) retryPendingPhotos();
    window.addEventListener('online', retryPendingPhotos);
    const retryWhenVisible = () => {
      if (document.visibilityState === 'visible') retryPendingPhotos();
    };
    document.addEventListener('visibilitychange', retryWhenVisible);
    return () => {
      window.removeEventListener('online', retryPendingPhotos);
      document.removeEventListener('visibilitychange', retryWhenVisible);
    };
  }, [showNotification]);
  const [parkedVehicle, setParkedVehicle] = useState<ParkedVehiclePlace | null>(() => parkingService.getParkedVehicle());
  const [searchText, setSearchText] = useState('');
  const [previewRoute, setPreviewRoute] = useState<NavigationRoute | null>(null);
  const [incomingConvoyInvite, setIncomingConvoyInvite] = useState<ConvoyInvite | null>(null);
  const [reviewedTrip, setReviewedTrip] = useState<Trip | null>(null);
  const [isBottomSheetExpanded, setIsBottomSheetExpanded] = useState(false);
  // Phones remain touch devices in landscape, but the wide canvas is far
  // better served by the sidebar than by a full-width bottom sheet.
  const getIsLandscapeHandheld = () => typeof window !== 'undefined'
    && isMobile
    && window.innerWidth >= 900
    && window.innerWidth > window.innerHeight;
  const [isLandscapeHandheld, setIsLandscapeHandheld] = useState(getIsLandscapeHandheld);
  useEffect(() => {
    const syncLayout = () => setIsLandscapeHandheld(getIsLandscapeHandheld());
    syncLayout();
    window.addEventListener('resize', syncLayout, { passive: true });
    window.addEventListener('orientationchange', syncLayout, { passive: true });
    return () => {
      window.removeEventListener('resize', syncLayout);
      window.removeEventListener('orientationchange', syncLayout);
    };
  }, [isMobile]);
  const usesMobileSheetLayout = isMobile && !isLandscapeHandheld;
  const [userSettings, setUserSettings] = useState(() => {
    let cachedSpeedAlerts = false;
    try {
      const direct = localStorage.getItem('setting_speed_alerts');
      if (direct !== null) {
        cachedSpeedAlerts = JSON.parse(direct) === true;
      } else {
        const myway = localStorage.getItem('myway_speed_alerts');
        if (myway !== null) {
          cachedSpeedAlerts = myway === 'true' || JSON.parse(myway) === true;
        }
      }
    } catch (e) {
      console.warn('[App] Failed to parse cached speedAlerts setting:', e);
    }

    const storedBuildingScale = localStorage.getItem('myway_building_scale');
    const buildingScale = storedBuildingScale === 'none' || storedBuildingScale === 'flat' || storedBuildingScale === 'realistic'
      ? storedBuildingScale
      : 'realistic';
    if (storedBuildingScale && storedBuildingScale !== buildingScale) {
      localStorage.setItem('myway_building_scale', buildingScale);
    }
    localStorage.removeItem('myway_landmark_glow');

    return {
      theme: 'dark' as 'light' | 'dark' | 'auto',
      notifications: true,
      locationSharing: true,
      batteryAlerts: true,
      arrivalAlerts: true,
      speedAlerts: cachedSpeedAlerts,
      autoRoadRecording: localStorage.getItem('myway_auto_road_recording') !== 'false',
      roadRecordingMode: localStorage.getItem('myway_road_recording_mode') === 'trip' ? 'trip' as const : 'moving' as const,
      roadRecordingQuality: localStorage.getItem('myway_road_recording_quality') === 'standard' ? 'standard' as const : 'hd' as const,
      roadRecordingStorageGb: ([1, 2, 5].includes(Number(localStorage.getItem('myway_road_recording_storage_gb'))) ? Number(localStorage.getItem('myway_road_recording_storage_gb')) : 2) as 1 | 2 | 5,
      privacyMode: 'exact' as const,
      mapStyle: 'standard' as 'standard' | 'satellite' | 'terrain',
      units: 'imperial' as 'imperial' | 'metric',
      mapSkin: mapSkin,
      buildingScale,
      showTrafficControls: localStorage.getItem('myway_show_traffic_controls') !== 'false',
      avoidTolls: localStorage.getItem('myway_avoid_tolls') === 'true',
      avoidHighways: localStorage.getItem('myway_avoid_highways') === 'true'
    };
  });

  // Synchronize and hydrate userSettings when remote profile finishes loading
  useEffect(() => {
    if (!profile?.settings) return;
    setUserSettings(prev => {
      const useMotionFirstDefault = localStorage.getItem('myway_road_recorder_motion_default_v1') !== 'applied';
      if (useMotionFirstDefault) {
        localStorage.setItem('myway_road_recorder_motion_default_v1', 'applied');
        localStorage.setItem('myway_road_recording_mode', 'moving');
      }
      const storedRoadRecordingMode = localStorage.getItem('myway_road_recording_mode');
      const profileSpeedAlerts = (profile.settings as any).speedAlerts;
      const effectiveSpeedAlerts = typeof profileSpeedAlerts === 'boolean'
        ? profileSpeedAlerts
        : prev.speedAlerts;

      if (typeof profileSpeedAlerts === 'boolean') {
        try {
          localStorage.setItem('setting_speed_alerts', JSON.stringify(profileSpeedAlerts));
          localStorage.setItem('myway_speed_alerts', JSON.stringify(profileSpeedAlerts));
        } catch {}
      }

      return {
        ...prev,
        theme: profile.settings.theme || prev.theme,
        notifications: profile.settings.notifications ?? prev.notifications,
        locationSharing: profile.settings.locationSharing ?? prev.locationSharing,
        batteryAlerts: (profile.settings as any).batteryAlerts ?? prev.batteryAlerts,
        arrivalAlerts: (profile.settings as any).arrivalAlerts ?? prev.arrivalAlerts,
        speedAlerts: effectiveSpeedAlerts,
        autoRoadRecording: (profile.settings as any).autoRoadRecording ?? prev.autoRoadRecording,
        roadRecordingMode: storedRoadRecordingMode === 'trip' ? 'trip' : 'moving',
        roadRecordingQuality: (profile.settings as any).roadRecordingQuality === 'standard' ? 'standard' : ((profile.settings as any).roadRecordingQuality === 'hd' ? 'hd' : prev.roadRecordingQuality),
        roadRecordingStorageGb: [1, 2, 5].includes((profile.settings as any).roadRecordingStorageGb) ? (profile.settings as any).roadRecordingStorageGb : prev.roadRecordingStorageGb,
        privacyMode: (profile.settings as any).privacyMode === 'blurred'
          ? 'blurred'
          : ((profile.settings as any).privacyMode === 'invisible' || profile.settings.locationSharing === false)
            ? 'invisible'
            : 'exact'
      };
    });
  }, [profile?.settings]);

  // Dynamic Parking Service Subscription & Alert Handlers
  useEffect(() => {
    parkingService.setAlertHandlers({
      showNotification,
      logActivity: (type, title, message, icon, memberId) => {
        if (logActivityRef.current) {
          logActivityRef.current(type, title, message, icon, memberId);
        }
      }
    });
    return parkingService.subscribe(setParkedVehicle);
  }, [showNotification]);

  // Synchronize Member State: reliably ensure isMemberDetailOpen is true when selectedMemberId is set
  useEffect(() => {
    if (selectedMemberId) {
      setIsMemberDetailOpen(true);
    } else {
      setIsMemberDetailOpen(false);
    }
  }, [selectedMemberId]);

  const [privacyZones] = useState<PrivacyZone[]>([]);
  const [incidents, setIncidents] = useState<IncidentReport[]>(() => incidentService.getActiveIncidents());
  const [selectedIncident, setSelectedIncident] = useState<IncidentReport | null>(null);
  const [insights, setInsights] = useState<DailyInsight[]>([]);
  const [isSOSModalOpen, setIsSOSModalOpen] = useState(false);
  const [editingPlace, setEditingPlace] = useState<Place | null>(null);
  const [correctingPlace, setCorrectingPlace] = useState<Place | null>(null);

  // The floating destination bar can sit above the bottom sheet. Use the
  // highest active bottom overlay as the map-controls boundary on phones.
  useEffect(() => {
    if (!isMobile || isDriveMode || typeof ResizeObserver === 'undefined') {
      document.documentElement.style.removeProperty('--mobile-map-controls-bottom');
      return;
    }
    const root = document.documentElement;
    const updateControlsBoundary = () => {
      const tops = Array.from(document.querySelectorAll<HTMLElement>('[data-map-bottom-obstruction]'))
        .map(overlay => overlay.getBoundingClientRect())
        .filter(rect => rect.height > 0 && rect.top < window.innerHeight)
        .map(rect => rect.top);
      if (!tops.length) {
        root.style.removeProperty('--mobile-map-controls-bottom');
        return;
      }
      root.style.setProperty('--mobile-map-controls-bottom', `${Math.ceil(window.innerHeight - Math.min(...tops) + 12)}px`);
    };
    const observer = new ResizeObserver(updateControlsBoundary);
    document.querySelectorAll<HTMLElement>('[data-map-bottom-obstruction]').forEach(overlay => observer.observe(overlay));
    updateControlsBoundary();
    window.addEventListener('resize', updateControlsBoundary, { passive: true });
    window.visualViewport?.addEventListener('resize', updateControlsBoundary, { passive: true });
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateControlsBoundary);
      window.visualViewport?.removeEventListener('resize', updateControlsBoundary);
      root.style.removeProperty('--mobile-map-controls-bottom');
    };
  }, [isMobile, isDriveMode, isBottomSheetExpanded, activeModal, selectedPlace, isPlaceDetailOpen, correctingPlace]);

  // Real-time Road Incidents sync across all drivers & circle members
  useEffect(() => {
    return incidentService.subscribe(setIncidents);
  }, []);

  // Ambient map POIs: emergency services, fuel, and schools from the current viewport.
  const [ambientPlaces, setAmbientPlaces] = useState<Place[]>(() => ambientPoiService.getPois());
  const [schoolZoneAdvisory, setSchoolZoneAdvisory] = useState<SchoolZoneAdvisory | null>(null);

  useEffect(() => {
    return ambientPoiService.subscribe(setAmbientPlaces);
  }, []);
  const [activities, setActivities] = useState<AppNotification[]>([]);
  const ACTIVITY_LOG_LAST_VIEWED_KEY = 'myway_activity_log_last_viewed';
  const [activityLogLastViewedAt, setActivityLogLastViewedAt] = useState(() => {
    const stored = Number(localStorage.getItem(ACTIVITY_LOG_LAST_VIEWED_KEY));
    return Number.isFinite(stored) && stored > 0 ? stored : Date.now();
  });
  const unreadActivityCount = useMemo(
    () => activities.filter(activity => activity.timestamp > activityLogLastViewedAt).length,
    [activities, activityLogLastViewedAt]
  );
  const markActivityLogViewed = useCallback(() => {
    const viewedAt = Date.now();
    localStorage.setItem(ACTIVITY_LOG_LAST_VIEWED_KEY, String(viewedAt));
    setActivityLogLastViewedAt(viewedAt);
  }, []);
  const prevMembersRef = useRef<Record<string, { sosActive: boolean; battery: number; status: string }>>({});

  // Free-look camera state during navigation
  const [isCameraFree, setIsCameraFree] = useState(false);
  const handleRecenter = useCallback(() => {
    setIsCameraFree(false);
  }, []);

  const logActivity = useCallback((
    type: AppNotification['type'],
    title: string,
    message: string,
    icon: string,
    memberId?: string,
    impact?: CrashImpactMetadata
  ) => {
    const notif = addNotification(type, title, message, icon, memberId, impact);
    setActivities(prev => [notif, ...prev.filter(a => a.id !== notif.id)]);
  }, []);

  const logActivityRef = useRef<((type: AppNotification['type'], title: string, message: string, icon: string, memberId?: string, impact?: CrashImpactMetadata) => void) | null>(null);

  // Update logActivityRef so the geofence transition callback can safely access it
  useEffect(() => {
    logActivityRef.current = logActivity;
  }, [logActivity]);

  // --- REFS ---
  const membersRef = useRef<FamilyMember[]>([]);
  const profilesRef = useRef<Record<string, any>>({});

  // --- DOMAIN HOOKS ---
  // Map userPlaces to geofences
  const mappedGeofences = useMemo<Geofence[]>(() => {
    return userPlaces.map(p => {
      const r = p.radius !== undefined && p.radius !== null ? p.radius : 0.05;
      const radiusMeters = r > 5 ? r : r * 1000;
      return {
        id: p.id,
        name: p.name,
        lat: p.location.lat,
        lng: p.location.lng,
        radius: Math.max(15, radiusMeters),
        entranceType: p.entranceType,
        entranceLocation: p.entranceLocation,
        entrancePrecision: p.entrancePrecision,
        address: p.address,
        description: p.description
      };
    });
  }, [userPlaces]);

  const {
    members: liveMembers,
    setMembers,
    userLocation,
    forcePublishLocation
  } = useLocationSync(
    user,
    profile,
    profile?.familyCircleId,
    mappedGeofences,
    (t) => {
      const isInside = t.to === 'INSIDE';
      const placeLabel = getGeofenceDisplayName(t.geofence);
      const message = isInside ? `📍 Entered ${placeLabel}` : `🚶 Left ${placeLabel}`;
      showNotification(message, 5000);
      if (logActivityRef.current) {
        logActivityRef.current(
          isInside ? 'arrival' : 'departure',
          isInside ? 'Geofence Entry' : 'Geofence Exit',
          `${profile?.displayName || 'You'} ${isInside ? 'entered' : 'left'} ${placeLabel}`,
          isInside ? '📍' : '🚶',
          user?.uid
        );
      }
    },
    userCircles,
    activeFilterCircleId
  );

  const members = liveMembers;
  const [circleEntitlement, setCircleEntitlement] = useState<CircleSubscriptionEntitlement | null>(null);
  useEffect(() => {
    if (!currentCircle?.id) {
      setCircleEntitlement(null);
      return;
    }
    let active = true;
    getCircleSubscriptionEntitlement(currentCircle.id)
      .then(value => { if (active) setCircleEntitlement(value); })
      .catch(error => {
        // The settings screen remains usable if entitlement refresh is temporarily unavailable.
        console.warn('[App] Could not refresh Circle subscription entitlement:', error);
        if (active) setCircleEntitlement(null);
      });
    return () => { active = false; };
  }, [currentCircle?.id]);
  const hasCirclePremium = circleEntitlement?.active === true;
  const temporaryVisibilityCircleId = activeFilterCircleId !== 'all'
    ? activeFilterCircleId
    : (currentCircle?.id || profile?.familyCircleId || 'default');
  const [temporaryVisibilityExpiry, setTemporaryVisibilityExpiry] = useState<number | null>(() => getTemporaryVisibilityExpiry(temporaryVisibilityCircleId));
  const [temporaryVisibilityRemainingMs, setTemporaryVisibilityRemainingMs] = useState(() => {
    const expiresAt = getTemporaryVisibilityExpiry(temporaryVisibilityCircleId);
    return expiresAt ? Math.max(0, expiresAt - Date.now()) : 0;
  });
  const beginOneHourVisibility = useCallback(async () => {
    const circleId = temporaryVisibilityCircleId;
    const expiresAt = startTemporaryVisibility(circleId);
    setTemporaryVisibilityExpiry(expiresAt);
    setTemporaryVisibilityRemainingMs(Math.max(0, expiresAt - Date.now()));
    setCirclePrivacyMode(circleId, 'exact');
    localStorage.setItem('myway_privacy_mode', 'exact');
    setUserSettings(prev => ({ ...prev, privacyMode: 'exact', locationSharing: true }));
    if (user?.uid) {
      await updateUserProfile(user.uid, { settings: { ...profile?.settings, privacyMode: 'exact', locationSharing: true } } as any);
    }
    await forcePublishLocation?.(true);
  }, [temporaryVisibilityCircleId, user?.uid, profile?.settings, forcePublishLocation]);
  useEffect(() => {
    const circleId = temporaryVisibilityCircleId;
    const expiresAt = temporaryVisibilityExpiry || getTemporaryVisibilityExpiry(circleId);
    if (!expiresAt) {
      setTemporaryVisibilityRemainingMs(0);
      return;
    }
    const restoreInvisible = async () => {
      clearTemporaryVisibility(circleId);
      setTemporaryVisibilityExpiry(null);
      setTemporaryVisibilityRemainingMs(0);
      setCirclePrivacyMode(circleId, 'invisible');
      localStorage.setItem('myway_privacy_mode', 'invisible');
      setUserSettings(prev => ({ ...prev, privacyMode: 'invisible', locationSharing: false }));
      if (user?.uid) await updateUserProfile(user.uid, { settings: { ...profile?.settings, privacyMode: 'invisible', locationSharing: false } } as any);
      await forcePublishLocation?.(false);
    };
    const updateRemaining = () => setTemporaryVisibilityRemainingMs(Math.max(0, expiresAt - Date.now()));
    updateRemaining();
    const countdown = window.setInterval(updateRemaining, 15_000);
    const delay = expiresAt - Date.now();
    if (delay <= 0) { void restoreInvisible(); return; }
    const timer = window.setTimeout(() => { void restoreInvisible(); }, delay);
    return () => {
      window.clearInterval(countdown);
      window.clearTimeout(timer);
    };
  }, [temporaryVisibilityCircleId, temporaryVisibilityExpiry, user?.uid, profile?.settings, forcePublishLocation]);

  // Development-only diagnostic: Ctrl/Cmd + Shift + I exposes identity data
  // without putting any debug controls in the production navigation UI.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'i') {
        event.preventDefault();
        setIsMemberIdentityInspectorOpen(open => !open);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Keep ambient POIs updated around user's live position or current map view
  useEffect(() => {
    if (userLocation && userLocation.lat !== 0 && userLocation.lng !== 0) {
      ambientPoiService.updateAmbientPois(userLocation, mapBounds);
    }
  }, [userLocation?.lat, userLocation?.lng]);

  // Live Dynamic Parking Detection & Geofence Evaluation Loop
  useEffect(() => {
    if (!userLocation || userLocation.lat === 0 || userLocation.lng === 0) return;
    const selfMember = members.find(m => m.id === user?.uid);
    const speedMph = selfMember?.speed || 0;
    const rawStatus = selfMember?.status || 'Stationary';
    const status: 'Driving' | 'Walking' | 'Stationary' =
      rawStatus.toLowerCase().includes('driving') || speedMph > 5
        ? 'Driving'
        : rawStatus.toLowerCase().includes('walking') || speedMph > 0.6
          ? 'Walking'
          : 'Stationary';

    parkingService.processTelemetry({
      userLocation,
      speedMph,
      status,
      places: userPlaces,
      user,
      profile,
      circleId: activeFilterCircleId !== 'all' ? activeFilterCircleId : (currentCircle?.id || profile?.familyCircleId),
      showNotification,
      logActivity: logActivityRef.current
    }).catch(e => console.warn('[App] Parking telemetry error:', e));
  }, [userLocation, members, userPlaces, user, profile, activeFilterCircleId, currentCircle?.id, showNotification]);

  useEffect(() => {
    if (!mapBounds) return;
    const timer = setTimeout(() => {
      ambientPoiService.updateAmbientPois(null, mapBounds);
    }, 600);
    return () => clearTimeout(timer);
  }, [mapBounds]);

  useGeofences(
    members,
    mappedGeofences,
    showNotification,
    user?.uid,
    logActivity
  );
  const { ecdhKeyPair } = useE2EE(user, profile, currentCircle, isOwner);
  const {
    activeRoute,
    upcomingGuidance,
    alternativeRoutes,
    activeRouteIndex,
    isRecalculatingRoutes,
    handleRecalculateRoutes,
    isNavigating,
    navState,
    betterRouteSuggestion,
    upcomingTollAlert,
    leaderDivertedPrompt,
    ambientMaintenanceAdvisory,
    handleSelectMaintenanceStop,
    handleDismissMaintenanceAdvisory,
    handleFollowLeader,
    handleKeepOriginalRoute,
    handleSwitchRoute,
    handleDismissReroute,
    handleTakeTollFreeExit,
    handleDismissTollAlert,
    handleStartNavigation,
    handleCancelNavigation,
    handleDiscovery,
    handleQuickSearch,
    onTripCompleted,
    pendingTripResume,
    isResumingTrip,
    handleResumeTrip,
    handleDiscardTripResume,
    approachingTripData,
    setApproachingTripData,
    completedTripData,
    setCompletedTripData,
    multiStopArrival,
    handleContinueAfterStop,
    handleDismissStopApproach,
    setIsNavigating,
    setActiveRoute,
    liveSpeedMph,
    liveFuelSnapshot,
    lowFuelAlert,
    handleSelectGasStationStop,
    handleAddStop,
    handleDismissLowFuelAlert,
    fuelUpdatePromptNonce,
    handleQuickFuelUpdate
  } = useNavigation(
    user,
    profile,
    userSettings.speedAlerts,
    members,
    userLocation,
    showNotification,
    setDriveMode,
    set3DMode,
    setCrashCountdown,
    setEtaSharing,
    userPlaces,
    setDiscoveredPlaces,
    safetyScore,
    startSearchTransition
  );

  const roadRecorderPauseRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [roadRecorderStatus, setRoadRecorderStatus] = useState<'recording' | 'paused' | 'error' | 'off'>('off');

  // Recording is local-only and starts from the visible navigation UI, which
  // lets Android grant the camera permission without background access.
  useEffect(() => {
    if (!nativeRoadRecorderService.isSupported()) return;
    let cancelled = false;
    const clearPauseTimer = () => {
      if (roadRecorderPauseRef.current) {
        clearTimeout(roadRecorderPauseRef.current);
        roadRecorderPauseRef.current = null;
      }
    };
    void (async () => {
      try {
        const recordingEnabled = isNavigating && userSettings.autoRoadRecording !== false;
        const movingOnly = userSettings.roadRecordingMode !== 'trip';
        const currentlyMoving = typeof liveSpeedMph !== 'number' || liveSpeedMph > 1.5;
        if (recordingEnabled && currentlyMoving) {
          clearPauseTimer();
          const status = await nativeRoadRecorderService.start({
            quality: userSettings.roadRecordingQuality || 'hd',
            storageGb: userSettings.roadRecordingStorageGb || 2
          });
          if (!cancelled) setRoadRecorderStatus(status.recording ? 'recording' : 'error');
        } else if (recordingEnabled) {
          if (!roadRecorderPauseRef.current) {
            if (!cancelled) setRoadRecorderStatus('paused');
            roadRecorderPauseRef.current = setTimeout(() => {
              roadRecorderPauseRef.current = null;
              void nativeRoadRecorderService.stop();
              setRoadRecorderStatus('paused');
            }, movingOnly ? 12_000 : 45_000);
          }
        } else {
          clearPauseTimer();
          await nativeRoadRecorderService.stop();
          if (!cancelled) setRoadRecorderStatus('off');
        }
      } catch (error: any) {
        if (!cancelled && isNavigating) {
          console.warn('[RoadRecorder] Could not start:', error?.message || error);
          setRoadRecorderStatus('error');
          showNotification('Road Recorder needs camera permission to record this trip.', 4000);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [isNavigating, liveSpeedMph, userSettings.autoRoadRecording, userSettings.roadRecordingMode, userSettings.roadRecordingQuality, userSettings.roadRecordingStorageGb, showNotification]);

  useEffect(() => () => {
    if (roadRecorderPauseRef.current) clearTimeout(roadRecorderPauseRef.current);
  }, []);

  useEffect(() => {
    if (!isNavigating || !userLocation) {
      setSchoolZoneAdvisory(null);
      return;
    }
    let active = true;
    void findSchoolZoneAdvisory(userLocation).then(advisory => {
      if (active) setSchoolZoneAdvisory(advisory);
    });
    return () => { active = false; };
  }, [isNavigating, userLocation?.lat, userLocation?.lng]);

  // --- SIDE EFFECTS ---

  // Initialize activities from localStorage
  useEffect(() => {
    setActivities(getNotifications());
  }, []);

  // Listen for real-time Place & Entrance Corrections across circle members
  useEffect(() => {
    const unsub = placeCorrectionService.subscribe(() => {
      setDiscoveredPlaces(prev => placeCorrectionService.applyCorrectionsToPlaces(prev));
      setSelectedPlace(prev => prev ? (placeCorrectionService.applyCorrectionsToPlaces([prev])[0] || prev) : null);
    });
    return unsub;
  }, []);

  // Whenever navigation starts, automatically lock chase camera and clear selected place preview
  useEffect(() => {
    if (isNavigating || isDriveMode) {
      setIsCameraFree(false);
      setSelectedPlace(null);
      setIsPlaceDetailOpen(false);
      setPreviewRoute(null);
    }
  }, [isNavigating, isDriveMode]);

  // Ensure isPlaceDetailOpen is synchronized with selectedPlace: if selectedPlace is set, force isPlaceDetailOpen to true
  /* useEffect(() => {
    if (selectedPlace && !isPlaceDetailOpen && !correctingPlace) {
      setIsPlaceDetailOpen(true);
    }
  }, [selectedPlace, isPlaceDetailOpen, correctingPlace]); */

  // Listen for real-time Convoy & Caravan invites
  useEffect(() => {
    const unsub = convoyService.onInvite(invite => {
      if (!invite || !invite.session || !invite.session.isActive) {
        setIncomingConvoyInvite(null);
        return;
      }
      if (invite.session.leaderId === user?.uid) {
        return;
      }
      if (invite.session.memberIds && invite.session.memberIds.length > 0) {
        if (user?.uid && !invite.session.memberIds.includes(user.uid)) {
          return;
        }
      }
      setIncomingConvoyInvite(invite);
    });
    return unsub;
  }, [user]);

  // Subscribe to Multi-Device Circle Convoys & Fleet Reroutes over network
  useEffect(() => {
    if (!profile?.familyCircleId || !user?.uid) return;
    const unsub = convoyService.subscribeCircleConvoy(profile.familyCircleId, user.uid);
    return unsub;
  }, [profile?.familyCircleId, user?.uid]);



  // Handle emergency resolution
  const handleResolveSOS = useCallback((id: string, memberId?: string) => {
    setActivities(prev => {
      const updated = prev.map(a => a.id === id ? { ...a, isResolved: true } : a);
      localStorage.setItem('myway_notifications', JSON.stringify(updated));
      return updated;
    });

    if (memberId) {
      if (memberId === user?.uid || memberId === 'demo-you') {
        if (profile?.familyCircleId) {
          clearSOS(profile.familyCircleId, user.uid);
        }
        setMembers(prev => prev.map(m => m.id === memberId ? { ...m, sosActive: false } : m));
        showNotification('Emergency SOS Resolved', 5000);
      } else if (profile?.familyCircleId) {
        clearSOS(profile.familyCircleId, memberId).then(() => {
          showNotification('Emergency SOS Resolved for member', 5000);
        }).catch(err => {
          console.error("Failed to clear SOS for other member in DB:", err);
        });
      }
    }
  }, [user, profile, setMembers, showNotification]);

  // Reactively watch members state for status/alert changes
  useEffect(() => {
    if (members.length === 0) return;

    members.forEach(member => {
      const prev = prevMembersRef.current[member.id];
      const currentSos = !!member.sosActive;
      const currentBattery = member.battery;
      const currentStatus = member.status;
      const isSelf = member.id === user?.uid || member.id === 'demo-you' || member.id === members[0]?.id;

      if (prev) {
        // 1. SOS Trigger
        if (currentSos && !prev.sosActive && !isSelf) {
          const impact = member.impact;
          const alertMsg = impact
            ? `${member.name} triggered an Emergency SOS (${impact.gForce}G Impact @ ${impact.speed} mph)!`
            : `${member.name} triggered an Emergency SOS!`;
          logActivity('sos', 'Emergency SOS', alertMsg, '🚨', member.id, impact);
        }
        // 2. Low Battery Alert
        if (currentBattery <= 20 && prev.battery > 20) {
          const msg = isSelf
            ? `Your phone battery is low (${currentBattery}%). Please plug in your charger.`
            : `${member.name}'s battery is low (${currentBattery}%)`;
          logActivity('safety', 'Low Battery', msg, '🪫', member.id);
        }
        // 3. Started Driving Trigger
        if (currentStatus === 'Driving' && prev.status !== 'Driving') {
          logActivity('departure', 'Started Driving', `${member.name} started driving`, '🏎️', member.id);

          // Zero-Touch Trip Logging: Start background drive for self if not already in a trip
          if (isSelf && !getActiveTrip()) {
            startTrip(member.location, 'Drive');
            showNotification('🏎️ Auto-logging drive in background', 3000);
          }
        }
        // 4. Stopped Driving Trigger
        if (currentStatus !== 'Driving' && prev.status === 'Driving') {
          // End background trip if not in active turn-by-turn navigation
          if (isSelf && getActiveTrip() && !isDriveMode) {
            const completed = endTrip(member.location);
            if (completed && completed.totalDistanceMiles > 0.05) {
              showNotification(`🏁 Drive logged: ${completed.totalDistanceMiles} mi (Score: ${completed.safetyScore}%)`, 5000);
            }
          }
        }
      }

      // Update tracking ref
      prevMembersRef.current[member.id] = {
        sosActive: currentSos,
        battery: currentBattery,
        status: currentStatus
      };
    });
  }, [members, logActivity, user, isDriveMode, showNotification]);

  // Update membersRef
  useEffect(() => {
    membersRef.current = members;
  }, [members]);

  // Battery Prompt
  useEffect(() => {
    if (!showOnboarding && shouldShowBatteryPrompt()) {
      const timer = setTimeout(() => setActiveModal('battery_prompt'), 5000);
      return () => clearTimeout(timer);
    }
  }, [showOnboarding]);

  // Initial Map Centering
  useEffect(() => {
    if (userLocation && !hasInitiallyCentered) {
      setMapCenter([userLocation.lat, userLocation.lng]);
      setHasInitiallyCentered(true);
    }
  }, [userLocation, hasInitiallyCentered]);

  // Lifecycle & Background State
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const listener = CapacitorApp.addListener('appStateChange', ({ isActive }) => {
      if (!isActive) showNotification('MyWay: Running in background', 3000);
    });
    return () => {
      listener.then(l => l.remove()).catch(() => {});
    };
  }, [showNotification]);

  // Android's native foreground service owns background updates after the
  // Capacitor WebView is closed. Keep its configuration in sync with the
  // signed-in mobile device, selected Circles, and per-Circle privacy choice.
  const backgroundCircleKey = useMemo(() => userCircles.map(circle => circle.id).sort().join(','), [userCircles]);
  const [privacyRevision, setPrivacyRevision] = useState(0);
  useEffect(() => {
    const refreshNativePrivacy = () => setPrivacyRevision(value => value + 1);
    window.addEventListener('myway-privacy-mode-changed', refreshNativePrivacy);
    return () => window.removeEventListener('myway-privacy-mode-changed', refreshNativePrivacy);
  }, []);
  useEffect(() => {
    if (!nativeBackgroundTrackingService.isSupported()) return;
    if (!user?.uid || profile?.settings?.locationSharing === false || !isCurrentLocationPublisher()) {
      void nativeBackgroundTrackingService.stop().catch(() => {});
      return;
    }

    const circles = userCircles.map(circle => ({
      id: circle.id,
      privacyMode: getCirclePrivacyMode(circle.id)
    }));
    if (circles.length === 0) {
      void nativeBackgroundTrackingService.stop().catch(() => {});
      return;
    }

    let cancelled = false;
    void nativeBackgroundTrackingService.start({
      uid: user.uid,
      displayName: profile.displayName || user.displayName,
      photoURL: profile.photoURL || user.photoURL,
      role: profile.role,
      circles
    }).catch(error => {
      if (!cancelled) console.warn('[BackgroundTracking] Native service was not started:', error?.message || error);
    });
    return () => { cancelled = true; };
  }, [user?.uid, profile?.settings?.locationSharing, profile?.displayName, profile?.photoURL, profile?.role, backgroundCircleKey, privacyRevision]);

  // Offline Handling
  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Offline Location Buffer Auto-Flush Initialization
  useEffect(() => {
    const cleanup = setupOfflineLocationAutoFlush(async (locations) => {
      await syncBufferedLocations(locations);
      if (locations.length > 0) {
        showNotification(`📦 Synced ${locations.length} offline location point${locations.length > 1 ? 's' : ''}`, 3000);
      }
    });
    return () => cleanup();
  }, [showNotification]);

  useEffect(() => {
    if (isOffline && is3DMode) {
      set3DMode(false);
      showNotification('Switched to 2D for offline reliability', 3000);
    }
  }, [isOffline, is3DMode, set3DMode, showNotification]);

  // Circle Data Sync
  useEffect(() => {
    setIsOwner(currentCircle?.ownerId === user?.uid);
  }, [currentCircle?.ownerId, user?.uid]);

  // Places Sync across all circles and personal storage
  const userCircleIdsKey = useMemo(() => userCircles.map(c => c.id).sort().join(','), [userCircles]);

  useEffect(() => {
    if (!user?.uid) return;
    const targetCircleIds = Array.from(new Set([
      ...(userCircles.map(c => c.id)),
      ...(profile?.familyCircleId ? [profile.familyCircleId] : [])
    ].filter(Boolean)));

    const unsubscribe = subscribeToUserPlacesMulti(targetCircleIds, user.uid, (places) => {
      setUserPlaces(prev => {
        const next = places || [];
        if (prev.length === next.length && prev.every((p, i) => p.id === next[i].id && p.name === next[i].name)) {
          return prev;
        }
        return next;
      });
    });
    return () => unsubscribe();
  }, [user?.uid, profile?.familyCircleId, userCircleIdsKey]);

  // Synchronize userPlaces with discoveredPlaces without blowing away search results
  useEffect(() => {
    try {
      localStorage.setItem('myway_user_places', JSON.stringify(userPlaces || []));
    } catch (e) {}
    syncSavedPlaces(userPlaces || []);
    setDiscoveredPlaces(prev => {
      // Only keep search/discovered places — don't blindly re-inject all userPlaces.
      // The allDisplayPlaces memo already combines userPlaces + discoveredPlaces for map display.
      // Re-merging all userPlaces here would undo query-relevant filtering in handleDiscovery.
      const filtered = prev.filter(p => p.type === 'search_result' || p.id.startsWith('photon-') || p.id.startsWith('nominatim-') || p.id.startsWith('overpass-'));
      if (filtered.length === prev.length && filtered.every((p, idx) => p.id === prev[idx]?.id)) {
        return prev;
      }
      return filtered;
    });
  }, [userPlaces]);

  const allDisplayPlaces = useMemo(() => {
    const list: Place[] = userPlaces.map(p => ({ ...p, isSaved: true }));
    const seenIds = new Set(userPlaces.map(p => p.id));

    const isExactSavedPlace = (p?: Place | null) => {
      if (!p) return false;
      const pName = (p.name || '').trim().toLowerCase();
      const pAddr = (p.address || p.description || '').trim().toLowerCase();
      return userPlaces.some(up => 
        up.id === p.id || 
        (pName && (up.name || '').trim().toLowerCase() === pName) ||
        (pAddr && (up.address || up.description || '').trim().toLowerCase() === pAddr)
      );
    };

    // 1. Ensure selectedPlace ALWAYS has a pin rendered on the map unless it duplicates an existing user place
    // Respect literal search: allow temporary search pins to render even if physically adjacent to a saved place (like Home)
    if (selectedPlace && selectedPlace.location && typeof selectedPlace.location.lat === 'number' && typeof selectedPlace.location.lng === 'number') {
      if (!seenIds.has(selectedPlace.id) && !isExactSavedPlace(selectedPlace)) {
        seenIds.add(selectedPlace.id);
        list.push({
          ...selectedPlace,
          type: selectedPlace.type || 'search_result',
          icon: selectedPlace.icon || '📍',
          brandColor: selectedPlace.brandColor || '#6366f1',
          isSaved: false
        });
      }
    }

    // 2. Add active live search result locations (from typing in SearchBox)
    // ONLY display search result pins when NO place is currently selected.
    // When a user selects a place (like "Home"), other search result pins must not clutter the map!
    if (!selectedPlace) {
      for (const sp of searchResultPlaces) {
        if (sp && sp.location && typeof sp.location.lat === 'number' && typeof sp.location.lng === 'number' && !seenIds.has(sp.id) && !isExactSavedPlace(sp)) {
          seenIds.add(sp.id);
          list.push({
            ...sp,
            type: sp.type || 'search_result',
            icon: sp.icon || '📍',
            brandColor: sp.brandColor || '#6366f1',
            isSaved: false
          });
        }
      }

      // 3. Add discovered search places
      for (const dp of discoveredPlaces || []) {
        if (dp && dp.location && typeof dp.location.lat === 'number' && typeof dp.location.lng === 'number' && !seenIds.has(dp.id) && !isExactSavedPlace(dp)) {
          seenIds.add(dp.id);
          list.push({
            ...dp,
            isSaved: false
          });
        }
      }
    }

    // 4. Add ambient POIs
    for (const ap of ambientPlaces || []) {
      if (ap && ap.location && !seenIds.has(ap.id) && !isExactSavedPlace(ap)) {
        const overlaps = list.some(p => Math.abs(p.location.lat - ap.location.lat) < 0.0005 && Math.abs(p.location.lng - ap.location.lng) < 0.0005);
        if (!overlaps) {
          seenIds.add(ap.id);
          list.push(ap);
        }
      }
    }

    // 5. Add dynamic parked vehicle place if active
    if (parkedVehicle && parkedVehicle.location && !seenIds.has(parkedVehicle.id)) {
      seenIds.add(parkedVehicle.id);
      list.push(parkedVehicle);
    }

    return list;
  }, [userPlaces, selectedPlace, searchResultPlaces, discoveredPlaces, ambientPlaces, parkedVehicle]);


  // Insights Loop
  useEffect(() => {
    if (members.length === 0) return;
    const fetch = async () => {
      try {
        const res = await getFamilyInsights(members);
        setInsights(res || []);
      } catch (err) { console.warn('AI Insights failed'); }
    };
    fetch();
    const interval = setInterval(fetch, 600000);
    return () => clearInterval(interval);
  }, [members.length]);

  // Push Token Sync & Foreground Alert Listener
  const showNotificationRef = useRef(showNotification);
  showNotificationRef.current = showNotification;

  useEffect(() => {
    if (!user?.uid) return;

    let cleanup: (() => void) | undefined;
    import('./services/pushNotificationService').then(async ({ persistTokenToProfile, onForegroundMessage }) => {
      persistTokenToProfile(user.uid);
      cleanup = await onForegroundMessage((payload) => {
        const body = payload.notification?.body || 'New alert received';
        showNotificationRef.current(body, 4000);
      });
    });

    return () => {
      if (cleanup) cleanup();
    };
  }, [user?.uid]);

  const handleClearSelectedPlace = useCallback(() => {
    setSelectedPlace(null);
    setPlannedWaypoints([]);
    setKeepStopPlannerOpen(false);
    setIsPlaceDetailOpen(false);
    setPreviewRoute(null);
    setSearchResultPlaces([]);
    setDiscoveredPlaces([]);
    setSearchText('');
  }, []);

  const handleSelectRoutePreview = useCallback((route: NavigationRoute | null) => {
    setPreviewRoute(route);
  }, []);

  const handlePromoteRouteStop = useCallback((destination: Place, remainingStops: RouteWaypoint[]) => {
    setPlannedWaypoints(remainingStops);
    setKeepStopPlannerOpen(true);
    setSelectedPlace(destination);
    setIsPlaceDetailOpen(true);
    setSearchText(destination.name || destination.address || '');
    setMapCenter([destination.location.lat, destination.location.lng]);
  }, []);

  const handleSelectPlace = useCallback((place: Place) => {
    // Guard: ignore if a circle member was just selected within 800ms (prevents map click race conditions)
    if (Date.now() - lastMemberSelectedAtRef.current < 800) return;
    console.log('Place clicked:', place);
    setPlannedWaypoints([]);
    setKeepStopPlannerOpen(false);
    // Dismiss bottom sheet expansion and modals so Place Details / Family Hub Card displays cleanly
    setIsBottomSheetExpanded(false);
    setActiveModal(null);
    setCorrectingPlace(null);
    setSelectedMemberId(null);
    setIsMemberDetailOpen(false);
    setSearchResultPlaces([]); // Purge all temporary search result pins from the map!
    
    // 0. Explicit check for Parked Vehicle
    if (place.type === 'parked_vehicle' || place.id === 'temp-parked-vehicle') {
      setSelectedPlace(place);
      setIsPlaceDetailOpen(true);
      setSearchText(place.name || 'Parked Vehicle');
      setMapCenter([place.location.lat, place.location.lng]);
      return;
    }

    // Respect Literal User Input:
    // Strict exact ID, exact string, or coordinate proximity matching for saved places
    const placeNameNorm = (place.name || '').trim().toLowerCase();
    const placeAddrNorm = (place.address || place.description || '').trim().toLowerCase();

    const existingSaved = userPlaces.find(p => {
      // 1. Explicit ID match
      if (p.id === place.id) return true;

      // 2. Strict exact name match (e.g. user selected saved "Home" or "Work")
      const pNameNorm = (p.name || '').trim().toLowerCase();
      if (pNameNorm && pNameNorm === placeNameNorm) return true;

      // 3. Strict exact address match
      const pAddrNorm = (p.address || p.description || '').trim().toLowerCase();
      if (pAddrNorm && placeAddrNorm && pAddrNorm === placeAddrNorm) return true;

      // 4. Coordinates match within ~50 meters
      if (p.location && place.location && Math.abs(p.location.lat - place.location.lat) < 0.0005 && Math.abs(p.location.lng - place.location.lng) < 0.0005) return true;

      return false;
    });

    const resolvedPlace = existingSaved ? { ...existingSaved, isSaved: true } : place;
    setSelectedPlace(resolvedPlace);
    setIsPlaceDetailOpen(true);
    setSearchText(resolvedPlace.name || resolvedPlace.address || '');
    setMapCenter([resolvedPlace.location.lat, resolvedPlace.location.lng]);

    // Keep literal search result in discoveredPlaces if it's not already a saved user place
    if (!existingSaved) {
      setDiscoveredPlaces([resolvedPlace]);
    } else {
      setDiscoveredPlaces([]);
    }
  }, [userPlaces]);

  const lastProcessedUrlRef = useRef<string | null>(null);

  const handleIncomingUrl = useCallback(async (url: string) => {
    if (!url || typeof url !== 'string') return;
    if (lastProcessedUrlRef.current === url) return;
    lastProcessedUrlRef.current = url;
    setTimeout(() => {
      if (lastProcessedUrlRef.current === url) {
        lastProcessedUrlRef.current = null;
      }
    }, 4000);

    console.log('🔗 [DeepLink] Processing incoming URL:', url);

    // 1. External Geo & Navigation Intents (Spark, Google Maps, Waze, delivery apps)
    if (isGeoIntentUrl(url)) {
      if (!user) {
        sessionStorage.setItem('myway_pending_geo_intent', url);
      }
      const parsed = parseGeoIntent(url);
      if (!parsed) return;

      showNotification(`🧭 Navigation intent: ${parsed.name}`, 3000);

      let targetCoords = parsed.coords;
      const targetName = parsed.name;

      // If coordinates not directly provided in intent, geocode the address or query
      if (!targetCoords && parsed.query) {
        try {
          const liveOrigin = userLocation?.lat ? userLocation : undefined;
          const geocoded = await geocodePlace(parsed.query, liveOrigin);
          if (geocoded) {
            targetCoords = geocoded;
          }
        } catch (err) {
          console.error('Failed to geocode geo intent destination:', err);
        }
      }

      if (targetCoords) {
        const intentPlace: Place = {
          id: `intent-${Date.now()}`,
          name: targetName,
          location: targetCoords,
          address: parsed.address || targetName,
          description: parsed.address || targetName,
          radius: 50,
          type: 'search_result',
          icon: 'Navigation',
          isSaved: false,
        };

        // Drop the pin on the map and open the pre-trip route preview. External
        // apps should never silently start a drive; the user still chooses the
        // route and taps Go in MyWay.
        handleSelectPlace(intentPlace);
      } else {
        showNotification(`⚠️ Could not resolve destination: ${parsed.name}`, 4000);
        if (parsed.query) {
          setSearchText(parsed.query);
        }
      }
      return;
    }

    // 2. Circle Invitation Deep Links (e.g. /join/ABC123XYZ)
    try {
      const parsed = new URL(url);
      const match = parsed.pathname.match(/\/join\/([A-Za-z0-9]+)/);
      if (match) {
        const code = match[1];
        if (user) {
          joinCircle(code);
          showNotification(`🔗 Joining circle: ${code}`, 3000);
        } else {
          localStorage.setItem('myway_pending_invite', code);
        }
      }
    } catch {
      // Non-HTTP URI, safely ignore
    }
  }, [userLocation, handleSelectPlace, showNotification, user, joinCircle, setSearchText]);

  // Process any pending geo intent once user is signed in
  useEffect(() => {
    if (user) {
      const pendingGeo = sessionStorage.getItem('myway_pending_geo_intent');
      if (pendingGeo) {
        sessionStorage.removeItem('myway_pending_geo_intent');
        handleIncomingUrl(pendingGeo);
      }
    }
  }, [user, handleIncomingUrl]);

  // Deep Link & External Intent Lifecycle Listeners
  useEffect(() => {
    // Browser / Dev mode simulation: allow testing via window.simulateGeoIntent or ?intent=
    if (typeof window !== 'undefined') {
      (window as any).simulateGeoIntent = (url: string) => handleIncomingUrl(url);
      const params = new URLSearchParams(window.location.search);
      const intentParam = params.get('intent');
      if (intentParam) {
        handleIncomingUrl(intentParam);
      }
    }

    if (!Capacitor.isNativePlatform()) return;

    let isMounted = true;

    // Check cold launch URL (when app was launched by tapping an address in another app)
    CapacitorApp.getLaunchUrl().then((launchData) => {
      if (isMounted && launchData?.url) {
        console.log('🚀 [DeepLink] Cold launch URL detected:', launchData.url);
        handleIncomingUrl(launchData.url);
      }
    }).catch((err) => {
      console.warn('⚠️ [DeepLink] Failed to check getLaunchUrl:', err);
    });

    // Listen for warm / background resume intent events
    const urlListener = CapacitorApp.addListener('appUrlOpen', ({ url }) => {
      if (isMounted && url) {
        console.log('⚡ [DeepLink] appUrlOpen event received:', url);
        handleIncomingUrl(url);
      }
    });

    return () => {
      isMounted = false;
      urlListener.then(l => l.remove()).catch(() => {});
    };
  }, [handleIncomingUrl]);

  const handleAddPlace = useCallback(async (place: Omit<Place, 'id'>) => {
    const targetCircleId = currentCircle?.id || profile?.familyCircleId || (userCircles[0]?.id) || '';
    let savedPlace: UserPlace;
    if (user) {
      savedPlace = await addUserPlace(targetCircleId, { ...place, createdBy: user.uid }, user.uid);
      setUserPlaces(prev => {
        const filtered = prev.filter(p => p.id !== savedPlace.id && (p.name || '').trim().toLowerCase() !== (savedPlace.name || '').trim().toLowerCase());
        return [...filtered, savedPlace];
      });
      showNotification(`⭐ Saved "${place.name}" to Geofences!`, 3000);
    } else {
      savedPlace = {
        ...place,
        id: `demo-place-${Date.now()}`,
        createdAt: Date.now(),
        createdBy: 'demo'
      };
      setUserPlaces(prev => [...prev, savedPlace]);
      showNotification(`⭐ Saved "${place.name}" to Geofences!`, 3000);
    }

    // Immediately update selectedPlace to the saved place to prevent duplicate pins and reflect saved status
    setSelectedPlace(savedPlace);
    setIsPlaceDetailOpen(true);

    // Purge the temporary search result from discoveredPlaces and searchResultPlaces
    setDiscoveredPlaces(prev => prev.filter(p => p.id !== savedPlace.id && (p.name || '').trim().toLowerCase() !== (savedPlace.name || '').trim().toLowerCase()));
    setSearchResultPlaces(prev => prev.filter(p => p.id !== savedPlace.id && (p.name || '').trim().toLowerCase() !== (savedPlace.name || '').trim().toLowerCase()));
  }, [user, profile, currentCircle, userCircles, showNotification]);

  const handleDeletePlace = useCallback((placeId: string) => {
    // 1. Collect all candidate coordinates from targets and nearby places (~100m / 0.001 deg)
    const isNearby = (locA?: { lat: number; lng: number } | null, locB?: { lat: number; lng: number } | null, threshold = 0.001): boolean => {
      if (!locA || !locB || typeof locA.lat !== 'number' || typeof locA.lng !== 'number' || typeof locB.lat !== 'number' || typeof locB.lng !== 'number') return false;
      return Math.abs(locA.lat - locB.lat) < threshold && Math.abs(locA.lng - locB.lng) < threshold;
    };

    const targetPlace = userPlaces.find(p => p.id === placeId) ||
      (selectedPlace && (selectedPlace.id === placeId || isNearby(selectedPlace.location, userPlaces.find(p => isNearby(p.location, selectedPlace.location))?.location))
        ? userPlaces.find(p => isNearby(p.location, selectedPlace.location)) || (selectedPlace.id === placeId ? selectedPlace : undefined)
        : undefined) ||
      (editingPlace && editingPlace.id === placeId ? editingPlace : undefined) ||
      (correctingPlace && correctingPlace.id === placeId ? correctingPlace : undefined);

    if (!targetPlace || !user?.uid || targetPlace.createdBy !== user.uid) {
      showNotification('Only the member who saved this place can remove it.', 3000);
      return;
    }

    // Collect all coordinates associated with the place (building centroid, driveway pin, entrance)
    const targetCoordsList: { lat: number; lng: number }[] = [];
    const addCoords = (loc?: { lat: number; lng: number } | null) => {
      if (loc && typeof loc.lat === 'number' && typeof loc.lng === 'number' && !(loc.lat === 0 && loc.lng === 0)) {
        targetCoordsList.push({ lat: loc.lat, lng: loc.lng });
      }
    };

    addCoords(targetPlace?.location);
    addCoords(targetPlace?.entrancePrecision?.location);
    addCoords(targetPlace?.entrancePin);
    addCoords(targetPlace?.entranceLocation);
    if (selectedPlace && (selectedPlace.id === placeId || (targetPlace && isNearby(selectedPlace.location, targetPlace.location)))) {
      addCoords(selectedPlace.location);
      addCoords(selectedPlace.entrancePrecision?.location);
      addCoords(selectedPlace.entrancePin);
      addCoords(selectedPlace.entranceLocation);
    }
    if (editingPlace && (editingPlace.id === placeId || (targetPlace && isNearby(editingPlace.location, targetPlace.location)))) {
      addCoords(editingPlace.location);
    }

    // Collect all associated place IDs (the passed placeId, targetPlace id, selectedPlace id, etc.)
    const matchingIds = new Set<string>([placeId]);
    if (targetPlace?.id) matchingIds.add(targetPlace.id);
    if (selectedPlace && (selectedPlace.id === placeId || targetCoordsList.some(tc => isNearby(selectedPlace.location, tc)))) {
      matchingIds.add(selectedPlace.id);
    }
    if (editingPlace && (editingPlace.id === placeId || targetCoordsList.some(tc => isNearby(editingPlace.location, tc)))) {
      matchingIds.add(editingPlace.id);
    }
    if (correctingPlace && (correctingPlace.id === placeId || targetCoordsList.some(tc => isNearby(correctingPlace.location, tc)))) {
      matchingIds.add(correctingPlace.id);
    }

    const matchesTarget = (p: Place | null | undefined): boolean => {
      if (!p) return false;
      if (matchingIds.has(p.id)) return true;
      const pCoordsList = [p.location, p.entrancePrecision?.location, p.entrancePin, p.entranceLocation].filter(Boolean);
      for (const pCoord of pCoordsList) {
        if (targetCoordsList.some(tc => isNearby(pCoord, tc, 0.001))) {
          return true;
        }
      }
      if (targetPlace?.name && p.name && targetPlace.name.trim().toLowerCase() === p.name.trim().toLowerCase() && targetCoordsList.some(tc => isNearby(p.location, tc, 0.005))) {
        return true;
      }
      return false;
    };

    // 2. Comprehensive check if the place is Home or Work
    const isTargetNear = (refLoc?: { lat: number; lng: number } | null): boolean => {
      if (!refLoc) return false;
      return targetCoordsList.some(tc => isNearby(tc, refLoc, 0.001));
    };

    const isHome = (targetPlace && (
      targetPlace.type === 'home' || 
      (targetPlace as any).category === 'home' || 
      targetPlace.name?.toLowerCase() === 'home' ||
      targetPlace.icon === 'home' ||
      targetPlace.tags?.includes('home')
    )) ||
      placeId === 'profile-home-place' || 
      placeId === 'precise_home' ||
      isTargetNear(activeUserProfile?.preciseHomeLocation) ||
      isTargetNear(profile?.preciseHomeLocation) ||
      (typeof localStorage !== 'undefined' && (() => {
        try {
          const raw = localStorage.getItem('myway_precise_home_location');
          return raw ? isTargetNear(JSON.parse(raw)) : false;
        } catch { return false; }
      })());

    const isWork = (targetPlace && (
      targetPlace.type === 'work' || 
      (targetPlace as any).category === 'work' || 
      targetPlace.name?.toLowerCase() === 'work' ||
      targetPlace.icon === 'work' ||
      targetPlace.tags?.includes('work')
    )) ||
      placeId === 'profile-work-place' || 
      placeId === 'precise_work' ||
      isTargetNear((activeUserProfile as any)?.workLocation) ||
      isTargetNear((profile as any)?.workLocation);

    // 3. Clear persistent and profile storage for Home/Work to prevent synthetic geofence resurrection
    if (isHome) {
      try {
        localStorage.removeItem('myway_precise_home_location');
      } catch (e) {}
      setLocalProfileOverride(prev => ({
        ...(prev || {}),
        preciseHomeLocation: null as any,
        homeAddress: ''
      }));
      if (user?.uid) {
        updateUserProfile(user.uid, { preciseHomeLocation: null as any }).catch(err => {
          console.warn('⚠️ Could not clear preciseHomeLocation in DB:', err);
        });
      }
    }

    if (isWork) {
      try {
        localStorage.removeItem('myway_work_location');
      } catch (e) {}
      setLocalProfileOverride(prev => ({
        ...(prev || {}),
        workLocation: null as any,
        workAddress: ''
      } as any));
      if (user?.uid) {
        updateUserProfile(user.uid, { workLocation: null as any, workAddress: '' } as any).catch(err => {
          console.warn('⚠️ Could not clear workLocation in DB:', err);
        });
      }
    }

    // 4. Update userPlaces and immediately synchronize localStorage
    const nextUserPlaces = userPlaces.filter(p => !matchesTarget(p));
    setUserPlaces(nextUserPlaces);
    try {
      localStorage.setItem('myway_user_places', JSON.stringify(nextUserPlaces));
    } catch (e) {}

    // 5. Update locationService cache immediately
    setKnownPlaces(nextUserPlaces);

    // 6. Purge from discoveredPlaces & searchResultPlaces
    setDiscoveredPlaces(prev => prev.filter(p => !matchesTarget(p)));
    setSearchResultPlaces(prev => prev.filter(p => !matchesTarget(p)));

    // 7. Clear active UI selection if it matches the deleted place
    if (matchesTarget(selectedPlace) || matchingIds.has(selectedPlace?.id || '')) {
      setSelectedPlace(null);
      setIsPlaceDetailOpen(false);
      setPreviewRoute(null);
    }
    if (matchesTarget(editingPlace) || matchingIds.has(editingPlace?.id || '')) {
      setEditingPlace(null);
    }
    if (matchesTarget(correctingPlace) || matchingIds.has(correctingPlace?.id || '')) {
      setCorrectingPlace(null);
    }

    // 8. Remote delete across circles and user personal store in Firebase RTDB & Firestore
    const targetCircleId = targetPlace?.circleId || currentCircle?.id || profile?.familyCircleId || '';
    const allCircleIds = Array.from(new Set([
      targetCircleId,
      'default',
      ...(userCircles.map(c => c.id)),
      ...(profile?.familyCircleId ? [profile.familyCircleId] : []),
      ...(currentCircle?.id ? [currentCircle.id] : [])
    ].filter(Boolean)));

    for (const id of matchingIds) {
      deleteUserPlace(targetCircleId, id, user?.uid, allCircleIds).catch(err => {
        console.warn(`⚠️ Failed to delete place ${id} from database:`, err);
      });
    }

    showNotification(targetPlace?.name ? `Removed "${targetPlace.name}"` : 'Removed place', 2500);
  }, [userPlaces, selectedPlace, editingPlace, correctingPlace, profile, activeUserProfile, currentCircle, userCircles, user, showNotification]);

  const handleUpdatePlace = useCallback(async (placeId: string, updates: Partial<Place>) => {
    const targetPlace = userPlaces.find(p => p.id === placeId);
    if (!targetPlace || !user?.uid || targetPlace.createdBy !== user.uid) {
      showNotification('Only the member who saved this place can edit it.', 3000);
      return;
    }

    setUserPlaces(prev => {
      const next = prev.map(p => p.id === placeId ? { ...p, ...updates } : p);
      try {
        localStorage.setItem('myway_user_places', JSON.stringify(next));
      } catch (e) {}
      return next;
    });
    showNotification(`✅ Updated "${updates.name || 'Place'}"`, 3000);

    const targetCircleId = targetPlace?.circleId || currentCircle?.id || profile?.familyCircleId || userCircles[0]?.id || '';
    const allCircleIds = Array.from(new Set([
      targetCircleId,
      ...(userCircles.map(c => c.id)),
      ...(profile?.familyCircleId ? [profile.familyCircleId] : []),
      ...(currentCircle?.id ? [currentCircle.id] : [])
    ].filter(Boolean)));

    try {
      await updateUserPlace(targetCircleId, placeId, updates, user?.uid, allCircleIds);
    } catch (e) {
      console.warn('⚠️ Failed to sync place update to Firebase:', e);
    }
  }, [profile, currentCircle, userCircles, userPlaces, user, showNotification]);

  // Real-time live geofence radius & location update for parent map components (MapLibre3DView)
  const handleLiveUpdatePlace = useCallback((placeId: string, updates: Partial<Place>) => {
    setEditingPlace(prev => (prev && prev.id === placeId ? { ...prev, ...updates } : prev));
    setUserPlaces(prev => prev.map(p => p.id === placeId ? { ...p, ...updates } : p));
  }, []);

  const handleSearchResultsChange = useCallback((results: Place[]) => {
    setSearchResultPlaces(prev => {
      if (prev.length === results.length && prev.every((p, idx) => p.id === results[idx]?.id)) {
        return prev;
      }
      return results;
    });
  }, []);

  const mapboxCenter = useMemo<[number, number] | undefined>(() => {
    return mapCenter ? [mapCenter[1], mapCenter[0]] : undefined;
  }, [mapCenter?.[0], mapCenter?.[1]]);

  const handleBoundsChange = useCallback((b: { north: number; south: number; east: number; west: number }) => {
    setMapBounds(prev => {
      if (!prev) return b;
      if (
        Math.abs(prev.north - b.north) < 0.0005 &&
        Math.abs(prev.south - b.south) < 0.0005 &&
        Math.abs(prev.east - b.east) < 0.0005 &&
        Math.abs(prev.west - b.west) < 0.0005
      ) {
        return prev;
      }
      return b;
    });
  }, []);

  const handleLocateSelf = useCallback(() => {
    // Dismiss Place Detail / search input if open
    setSelectedPlace(null);
    setIsPlaceDetailOpen(false);
    setSearchText('');
    setSearchResultPlaces([]);
    setSelectedMemberId(null);
    setIsMemberDetailOpen(false);

    // Get current user location
    const selfMember = members.find(m => m.id === user?.uid || m.id === 'demo-you' || m.id === 'current_user' || m.id === 'local-user');
    const loc = userLocation || selfMember?.location;
    const lat = loc ? ((loc as any).latitude ?? loc.lat) : undefined;
    const lng = loc ? ((loc as any).longitude ?? loc.lng) : undefined;

    if (typeof lat !== 'number' || typeof lng !== 'number' || (lat === 0 && lng === 0) || isNaN(lat) || isNaN(lng)) {
      showNotification('Waiting for GPS signal...', 3000);
      return;
    }

    const mapInstance = (window as any).mywayMap;
    if (mapInstance) {
      const curCenter = typeof mapInstance.getCenter === 'function' ? mapInstance.getCenter() : null;
      const curZoom = typeof mapInstance.getZoom === 'function' ? mapInstance.getZoom() : 16.5;
      const dist = curCenter ? Math.hypot(curCenter.lng - lng, curCenter.lat - lat) : 0;
      const targetZoom = Math.max(16.5, curZoom);
      const padding = isMobile ? { top: 0, bottom: 200, left: 0, right: 0 } : { top: 0, bottom: 0, left: 0, right: 0 };

      // Snappy, butter-smooth camera glide: 550ms easeTo if nearby (< 25km), 850ms flyTo if far
      if (dist > 0.25 && typeof mapInstance.flyTo === 'function') {
        mapInstance.flyTo({
          center: [lng, lat],
          zoom: targetZoom,
          pitch: is3DMode ? 60 : 0,
          speed: 2.5,
          curve: 1.0,
          maxDuration: 850,
          essential: true,
          padding
        });
      } else if (typeof mapInstance.easeTo === 'function') {
        mapInstance.easeTo({
          center: [lng, lat],
          zoom: targetZoom,
          pitch: is3DMode ? 60 : 0,
          duration: 550,
          essential: true,
          padding
        });
      }
    }
    setMapCenter([lat, lng]);
    showNotification("📍 Centered on your location", 2000);
  }, [user?.uid, userLocation, members, is3DMode, isMobile, showNotification]);

  const handleSelectMember = useCallback((id: string) => {
    const member = members.find(m => m.id === id);
    const lat = member?.location ? ((member.location as any).latitude ?? member.location.lat) : undefined;
    const lng = member?.location ? ((member.location as any).longitude ?? member.location.lng) : undefined;

    // Handle Missing Locations:
    if (!member || typeof lat !== 'number' || typeof lng !== 'number' || (lat === 0 && lng === 0) || isNaN(lat) || isNaN(lng)) {
      showNotification('Location unavailable', 3000);
      return;
    }

    // Trigger Fast & Smooth Map Camera Animation:
    const mapInstance = (window as any).mywayMap;
    if (mapInstance) {
      const curCenter = typeof mapInstance.getCenter === 'function' ? mapInstance.getCenter() : null;
      const curZoom = typeof mapInstance.getZoom === 'function' ? mapInstance.getZoom() : 16;
      const dist = curCenter ? Math.hypot(curCenter.lng - lng, curCenter.lat - lat) : 0;
      const targetZoom = Math.max(16, curZoom);
      const padding = isMobile ? { top: 0, bottom: 200, left: 0, right: 0 } : { top: 0, bottom: 0, left: 0, right: 0 };

      if (dist > 0.25 && typeof mapInstance.flyTo === 'function') {
        mapInstance.flyTo({
          center: [lng, lat],
          zoom: targetZoom,
          pitch: is3DMode ? 60 : 0,
          speed: 2.5,
          curve: 1.0,
          maxDuration: 850,
          essential: true,
          padding
        });
      } else if (typeof mapInstance.easeTo === 'function') {
        mapInstance.easeTo({
          center: [lng, lat],
          zoom: targetZoom,
          pitch: is3DMode ? 60 : 0,
          duration: 550,
          essential: true,
          padding
        });
      }
    }
    setMapCenter([lat, lng]);

    // Current User Check:
    // If it's the current user, camera pans to their pin, but do NOT pop open the member detail card
    const isCurrentUser = id === user?.uid || id === 'demo-you' || id === 'current_user' || id === 'local-user';
    if (isCurrentUser) {
      setSelectedMemberId(null);
      setIsMemberDetailOpen(false);
      return;
    }

    // Trigger Selection State:
    // Along with moving the camera, select member so their detail card automatically pops open
    lastMemberSelectedAtRef.current = Date.now();
    setSelectedMemberId(id);
    setIsMemberDetailOpen(true);
    // Dismiss conflicting place selection
    setSelectedPlace(null);
    setIsPlaceDetailOpen(false);
  }, [user?.uid, members, is3DMode, isMobile, showNotification]);

  const handleZoomChange = useCallback((zoom: number) => {
    setMapZoom(zoom);
  }, []);

  const handleMapInteraction = useCallback(() => {
    // Guard: ignore if circle member was just selected within 800ms
    if (Date.now() - lastMemberSelectedAtRef.current < 800) return;
    setSelectedMemberId(null);
    setIsMemberDetailOpen(false);
    setMapCenter(undefined);
  }, []);

  const handleManualSOS = useCallback(() => {
    const memberName = profile?.displayName || user?.displayName || 'You';
    const memberId = user?.uid || 'demo-you';
    if (user && profile?.familyCircleId) {
      if (window.confirm("🚨 Trigger EMERGENCY SOS? This alerts your circle immediately.")) {
        triggerSOS(profile.familyCircleId, user.uid);
        showNotification('🚨 SOS SENT!', 10000);
        logActivity('EMERGENCY', 'Emergency SOS', `${memberName} triggered an Emergency SOS`, '🚨', memberId);
        setMembers(prev => prev.map(m => m.id === user.uid ? { ...m, sosActive: true } : m));
      }
    } else {
      if (window.confirm("🚨 Trigger EMERGENCY SOS? (Demo Mode)")) {
        showNotification('🚨 SOS SENT! (Demo Mode)', 10000);
        logActivity('EMERGENCY', 'Emergency SOS', `${memberName} triggered an Emergency SOS`, '🚨', memberId);
        setMembers(prev => prev.map(m => m.id === memberId ? { ...m, sosActive: true } : m));
      }
    }
  }, [user, profile, showNotification, logActivity, setMembers]);

  const handleUpdatePlaceRadius = useCallback((placeId: string, radius: number) => {
    // 1. Resolve matching saved place in userPlaces (by ID or coordinates)
    const targetSavedPlace = userPlaces.find(p => 
      p.id === placeId || 
      (selectedPlace && (p.id === selectedPlace.id || 
        (Math.abs(p.location.lat - selectedPlace.location.lat) < 0.0002 && Math.abs(p.location.lng - selectedPlace.location.lng) < 0.0002)))
    );

    const actualPlaceId = targetSavedPlace?.id || placeId;

    if (!targetSavedPlace || !user?.uid || targetSavedPlace.createdBy !== user.uid) {
      showNotification('Only the member who saved this place can change its safe zone.', 3000);
      return;
    }

    // 2. Visual Save Confirmation: Formatted descriptor toast
    const radiusMeters = radius > 5 ? Math.round(radius) : Math.round(radius * 1000);
    let radiusDescriptor = 'Safe Zone';
    if (radiusMeters <= 20) radiusDescriptor = 'Driveway';
    else if (radiusMeters <= 75) radiusDescriptor = 'Street';
    else if (radiusMeters <= 250) radiusDescriptor = 'Neighborhood';
    else radiusDescriptor = 'City Area';

    const displayMeters = radiusMeters >= 1000 ? `${(radiusMeters / 1000).toFixed(1).replace('.0', '')}km` : `${radiusMeters}m`;
    showNotification(`📍 Geofence set to ${displayMeters} (${radiusDescriptor})`, 3500);

    // 3. Update selected place state immediately
    setSelectedPlace(prev => {
      if (!prev) return null;
      if (prev.id === placeId || prev.id === actualPlaceId || 
          (targetSavedPlace && Math.abs(prev.location.lat - targetSavedPlace.location.lat) < 0.0002 && Math.abs(prev.location.lng - targetSavedPlace.location.lng) < 0.0002)) {
        return { ...prev, radius };
      }
      return prev;
    });
    
    // 4. Update discovered places state so the geofence circle on the 3D Map updates live
    setDiscoveredPlaces(prev => prev.map(p => 
      (p.id === placeId || p.id === actualPlaceId) ? { ...p, radius } : p
    ));
    
    // 5. Update userPlaces and persist to localStorage immediately
    setUserPlaces(prev => {
      const next = prev.map(p => 
        (p.id === placeId || p.id === actualPlaceId) ? { ...p, radius } : p
      );
      try {
        localStorage.setItem('myway_user_places', JSON.stringify(next));
      } catch (e) {}
      return next;
    });

    // 6. Sync to Firebase across all target circles and user personal store
    const targetCircleId = targetSavedPlace?.circleId || currentCircle?.id || profile?.familyCircleId || userCircles[0]?.id || '';
    const allCircleIds = Array.from(new Set([
      targetCircleId,
      ...(userCircles.map(c => c.id)),
      ...(profile?.familyCircleId ? [profile.familyCircleId] : []),
      ...(currentCircle?.id ? [currentCircle.id] : [])
    ].filter(Boolean)));

    updateUserPlace(targetCircleId, actualPlaceId, { radius }, user?.uid, allCircleIds).catch(err => {
      console.warn('Could not update saved place radius in DB:', err);
    });

    // 7. Realtime Circle Broadcast: Broadcast across active circle WebSockets & Activity feed
    const memberName = profile?.displayName || user?.displayName || 'Family Member';
    const targetPlaceName = targetSavedPlace?.name || selectedPlace?.name || 'Safe Zone';
    if (targetCircleId) {
      broadcastPlaceGeofenceUpdate(targetCircleId, actualPlaceId, targetPlaceName, radiusMeters, memberName);
    }
    logActivity('CIRCLE', 'Geofence Updated', `${memberName} set ${targetPlaceName} geofence to ${displayMeters} (${radiusDescriptor})`, '📍', user?.uid);
  }, [user, profile, currentCircle, userCircles, userPlaces, selectedPlace, showNotification, logActivity]);

  const handleTriggerSOS = useCallback((impact?: CrashImpactMetadata) => {
    const memberName = profile?.displayName || user?.displayName || 'You';
    const memberId = user?.uid || 'demo-you';
    if (user && profile?.familyCircleId) {
      triggerSOS(profile.familyCircleId, user.uid, undefined, impact);
      const alertMsg = impact ? `🚨 SOS SENT (${impact.gForce}G Impact)!` : '🚨 SOS SENT!';
      showNotification(alertMsg, 10000);
      logActivity('EMERGENCY', 'Emergency SOS', `${memberName} triggered an Emergency SOS`, '🚨', memberId, impact);
      setMembers(prev => prev.map(m => m.id === user.uid ? { ...m, sosActive: true, impact } : m));
    } else {
      showNotification('🚨 SOS SENT! (Demo Mode)', 10000);
      logActivity('EMERGENCY', 'Emergency SOS', `${memberName} triggered an Emergency SOS`, '🚨', memberId, impact);
      setMembers(prev => prev.map(m => m.id === memberId ? { ...m, sosActive: true, impact } : m));
    }
  }, [user, profile, showNotification, logActivity, setMembers]);

  const handleCancelSOS = useCallback(() => {
    const memberId = user?.uid || 'demo-you';
    if (user && profile?.familyCircleId) {
      clearSOS(profile.familyCircleId, user.uid);
    }
    showNotification('✅ Emergency SOS Cancelled', 4000);
    setMembers(prev => prev.map(m => m.id === memberId ? { ...m, sosActive: false, impact: undefined } : m));
  }, [user, profile, showNotification, setMembers]);

  const handleToggleGhost = useCallback((memberId: string) => {
    setMembers(prev => prev.map(m => m.id === memberId ? { ...m, isGhostMode: !m.isGhostMode } : m));
  }, [setMembers]);

  const handleUpgrade = useCallback(async (tierId: string) => {
    try {
      const tier = SUBSCRIPTION_TIERS[tierId];
      if (!tier) return;
      showNotification(`🚀 Preparing ${tier.name}...`, 5000);
      const url = await createCheckoutSession(tier.priceId);
      window.location.href = url;
    } catch (err) { showNotification(`❌ Error upgrading`, 5000); }
  }, [showNotification]);

  // --- RENDER GATES ---
  const [legalConsented, setLegalConsented] = useState(() => hasLegalConsent());
 
  // --- AUTH GATES ---
  if (authLoading) {
    return <LoadingScreen theme={activeTheme} />;
  }
 
  if (!user) {
    return (
      <LoginScreen
        theme={activeTheme}
        onSignInWithGoogle={signInWithGoogle}
        onSignInWithEmail={signInWithEmail}
        onSignUpWithEmail={signUpWithEmail}
        onSendMagicLink={sendMagicLink}
        onSendPasswordReset={sendPasswordReset}
        magicLinkSent={emailLinkSent}
        loading={authLoading}
        error={authError}
        onClearError={clearError}
      />
    );
  }
 
  return (
    <div className={`fixed inset-0 flex flex-col h-full w-full overflow-hidden transition-colors duration-700 ${
      isDefaultSkin || activeTheme === 'light' 
        ? 'theme-default light-mode bg-[#f8f6f0] text-slate-900' 
        : 'theme-dark bg-black text-white'
    }`}>
      {!isDriveMode && null}

      <div className={`flex flex-1 relative overflow-hidden ${usesMobileSheetLayout && !isDriveMode ? 'flex-col-reverse' : 'flex-row'}`}>
        {/* Desktop Sidebar - Bento Grid style */}
        {!isDriveMode && !usesMobileSheetLayout && (
          <BentoSidebar
            members={members}
            currentUserId={user?.uid || ''}
            selectedId={selectedMemberId}
            onSelect={handleSelectMember}
            theme={activeTheme}
            hasCircle={!!profile?.familyCircleId}
            circleName={currentCircle?.name}
            activeCircleId={currentCircle?.id}
            userCircles={userCircles}
            activeFilterCircleId={activeFilterCircleId}
            onSelectFilterCircle={setActiveFilterCircleId}
            onOpenCircleSettings={(tab) => {
              setCircleSettingsTab(tab || 'circles');
              setActiveModal('circle_settings');
            }}
            inviteCode={currentCircle?.inviteCode}
            onCreateCircle={createCircle}
            onJoinCircle={joinCircle}
            showNotification={showNotification}
            pendingOperationsReviewCount={pendingOperationsReviewCount}
            onOpenSettings={() => setActiveModal('settings')}
            onOpenTripHistory={() => setActiveModal('trip_history')}
            onOpenNotifications={() => setActiveModal('notifications')}
            onOpenWeeklyReport={() => setActiveModal('weekly_report')}
            onOpenInviteShare={() => {
              setCircleSettingsTab('invite');
              setActiveModal('circle_settings');
            }}
            onOpenContacts={(recipientId) => {
              setContactRecipientId(typeof recipientId === 'string' && recipientId.trim() ? recipientId : null);
              setContactAction('text'); setActiveModal('contacts');
            }}
            onSOS={handleManualSOS}
            activities={activities}
            unreadActivityCount={unreadActivityCount}
            onLogViewed={markActivityLogViewed}
            onResolveSOS={handleResolveSOS}
            userPlaces={userPlaces}
            parkedVehicle={parkedVehicle}
            selectedPlaceId={selectedPlace?.id}
            onSelectPlace={handleSelectPlace}
            onAddPlace={handleAddPlace}
            onDeletePlace={handleDeletePlace}
            onEditPlace={(place: Place) => setEditingPlace(place)}
            onNavigatePlace={(place: Place) => handleStartNavigation(place.name, place.location)}
            userLocation={userLocation}
            onOpenMaintenance={() => setActiveModal('maintenance')}
          />
        )}

        {/* Mobile-only Settings FAB - a gear is clearer than a profile photo. */}
        {!isDriveMode && usesMobileSheetLayout && !activeModal && !isBottomSheetExpanded && (
          <button
            onClick={() => setActiveModal('settings')}
            className="absolute top-16 left-4 z-[90] group flex items-center gap-3 transition-all duration-300 pointer-events-auto"
          >
            <span className={`relative w-11 h-11 rounded-2xl border flex items-center justify-center shadow-xl transition-all duration-300 ${activeTheme === 'dark' ? 'bg-slate-900/90 border-white/15 text-slate-100' : 'bg-white border-slate-200 text-slate-700 shadow-md'}`}>
              <Settings className="w-5 h-5" />
              {pendingOperationsReviewCount && pendingOperationsReviewCount > 0 && <span className="absolute -right-1 -top-1 min-w-5 h-5 px-1 rounded-full bg-violet-600 text-white text-[10px] font-black grid place-items-center ring-2 ring-white" aria-label={`${pendingOperationsReviewCount} reviews awaiting moderation`}>{pendingOperationsReviewCount > 99 ? '99+' : pendingOperationsReviewCount}</span>}
            </span>
          </button>
        )}

        {/* Persistent visibility state: the user should never have to infer whether their Circle can see them. */}
        {!isDriveMode && !activeModal && !isBottomSheetExpanded && (userSettings.privacyMode === 'invisible' || temporaryVisibilityRemainingMs > 0) && (
          <div
            className="absolute top-4 left-1/2 -translate-x-1/2 z-[95] px-4 py-2 rounded-full flex items-center gap-2 cursor-pointer shadow-lg backdrop-blur-md transition-all duration-300 animate-pulse"
            style={{
              background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.85), rgba(79, 70, 229, 0.85))',
              border: '1px solid rgba(255,255,255,0.2)'
            }}
          >
            <EyeOff className="w-5 h-5 text-purple-200 shrink-0" />
            <span className="text-white text-sm font-semibold tracking-wide">{temporaryVisibilityRemainingMs > 0 ? `Sharing for ${Math.max(1, Math.ceil(temporaryVisibilityRemainingMs / 60_000))} min` : 'Invisible'}</span>
            {temporaryVisibilityRemainingMs <= 0 && <button type="button" onClick={() => void beginOneHourVisibility()} className="rounded-full bg-white/20 hover:bg-white/30 px-2 py-1 text-[10px] font-black text-white transition-colors">Share 1 hour</button>}
            <button type="button" onClick={() => setActiveModal('privacy')} className="text-white/70 hover:text-white text-xs">Manage</button>
          </div>
        )}

        {/* Map and overlay container */}
        <div className="flex-1 relative overflow-hidden" style={{ perspective: is3DMode ? '1000px' : 'none' }}>
          {/* Map layer - z-0 to ensure overlays appear on top */}
          <div className="absolute inset-0 z-0 overflow-hidden">
            {/* UNIFIED MAP: Single MapLibre3DView handles both 2D and 3D modes */}
            <MapLibre3DView
              members={members}
              userLocation={userLocation}
              currentUserId={user?.uid || ''}
              userProfile={activeUserProfile}
              theme={activeTheme}
              mapSkin={userSettings.mapSkin}
              buildingScale={userSettings.buildingScale}
              showTrafficControls={userSettings.showTrafficControls}
              selectedMemberId={selectedMemberId}
              selectedPlaceId={selectedPlace?.id || null}
              selectedPlace={selectedPlace}
              center={mapboxCenter}
              zoom={mapZoom}
              onZoomChange={handleZoomChange}
              onUserInteraction={handleMapInteraction}
              onMapReady={() => setIsMapReady(true)}
              activeRoute={activeRoute || previewRoute}
              alternativeRoutes={isNavigating ? alternativeRoutes : []}
              onSelectAlternativeRoute={(altRoute) => handleSwitchRoute(altRoute)}
              places={allDisplayPlaces}
              savedPlaces={userPlaces}
              incidents={incidents}
              privacyZones={privacyZones}
              tasks={[]}
              tripSafetyEvents={reviewedTrip?.driveEvents || []}
              is3DMode={is3DMode}
              isNavigating={isNavigating || isDriveMode}
              currentStepIndex={navState.currentStepIndex}
              splitIndex={navState.splitIndex}
              remainingDistanceMeters={navState.remainingDistanceMeters}
              hasArrived={navState.hasArrived}
              onMapRecoveryStateChange={setIsMapRecovering}
              onSelectPlace={handleSelectPlace}
              onSelectMember={handleSelectMember}
              onSelectIncident={setSelectedIncident}
              onBoundsChange={handleBoundsChange}
              mapStyle={userSettings.mapStyle}
              isMobile={usesMobileSheetLayout}
              isCameraFree={isCameraFree}
              onCameraFreeChange={setIsCameraFree}
              onToggle3DMode={() => set3DMode(prev => !prev)}
              onSelectMapStyle={(style) => setUserSettings(prev => ({ ...prev, mapStyle: style }))}
              onOpenAlerts={() => setActiveModal('incident')}
            />
          </div>

          {!isDriveMode && !activeModal && !isBottomSheetExpanded && (
            <MapEdgeAwareness
              bounds={mapBounds}
              members={members}
              savedPlaces={userPlaces}
              currentUserId={user?.uid}
              onSelectMember={handleSelectMember}
              onSelectPlace={handleSelectPlace}
            />
          )}

          {import.meta.env.DEV && isMemberIdentityInspectorOpen && !isDriveMode && (
            <aside className="absolute right-3 top-3 z-[130] w-[min(22rem,calc(100%-1.5rem))] rounded-2xl border border-slate-700 bg-slate-950/95 p-3 text-left text-white shadow-2xl backdrop-blur" aria-label="Member identity inspector">
              <div className="mb-2 flex items-center justify-between gap-3">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.14em] text-indigo-300">Dev only · Member identities</p>
                  <p className="text-xs font-semibold text-slate-300">Authenticated ID: {user.uid}</p>
                </div>
                <button type="button" onClick={() => setIsMemberIdentityInspectorOpen(false)} className="rounded-lg px-2 py-1 text-xs font-bold text-slate-300 hover:bg-white/10">Close</button>
              </div>
              <div className="max-h-56 space-y-1 overflow-y-auto pr-1">
                {members.map(member => (
                  <div key={member.id} className="rounded-lg border border-white/10 bg-white/5 px-2 py-1.5">
                    <p className="truncate text-xs font-bold">{member.name}</p>
                    <p className="truncate font-mono text-[10px] text-slate-400">{member.id}</p>
                    <p className={`text-[10px] font-bold ${member.id === user.uid ? 'text-emerald-300' : member.isSelf ? 'text-rose-300' : 'text-slate-400'}`}>
                      {member.id === user.uid ? 'AUTHENTICATED SELF' : member.isSelf ? 'INVALID SELF FLAG' : 'CIRCLE MEMBER'}
                    </p>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-[10px] text-slate-400">Toggle: Ctrl/Cmd + Shift + I</p>
            </aside>
          )}

          {/* UI Overlays - z-10 and above to appear over the map */}
          {notification && (
            <div className="absolute top-20 left-1/2 -translate-x-1/2 z-[110] animate-in slide-in-from-top pointer-events-none">
              <div className="bg-amber-500 text-black px-6 py-3 rounded-full shadow-2xl font-black text-xs border-2 border-white/20 pointer-events-auto">
                {notification}
              </div>
            </div>
          )}

          {photoSavedConfirmation && (
            <aside className="fixed bottom-[calc(env(safe-area-inset-bottom,0px)+18px)] left-3 right-3 z-[210] mx-auto flex max-w-md items-center gap-3 rounded-2xl border border-emerald-200 bg-white/95 p-3 shadow-2xl backdrop-blur-xl animate-in slide-in-from-bottom-3 duration-200">
              <div className="rounded-xl bg-emerald-500/15 p-2 text-emerald-600"><CheckCircle2 className="h-5 w-5" /></div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-black text-slate-900">Building photo saved</p>
                <p className="truncate text-[11px] font-bold text-slate-500">{photoSavedConfirmation.isSynced ? `${photoSavedConfirmation.name} · Trip complete` : `${photoSavedConfirmation.name} · Saved on device, syncing automatically`}</p>
              </div>
              {photoSavedConfirmation.place && (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedPlace(photoSavedConfirmation.place);
                    setIsPlaceDetailOpen(true);
                    setPhotoSavedConfirmation(null);
                  }}
                  className="rounded-xl bg-emerald-600 px-3 py-2 text-xs font-black text-white shadow-sm active:scale-95"
                >
                  View
                </button>
              )}
              <button type="button" onClick={() => setPhotoSavedConfirmation(null)} aria-label="Dismiss photo saved confirmation" className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100"><X className="h-4 w-4" /></button>
            </aside>
          )}

          {/* Real-time Caravan / Convoy Invite Banner */}
          {incomingConvoyInvite && (
            <div className="fixed top-4 inset-x-4 max-w-md mx-auto z-[250] bg-slate-900/98 border-2 border-purple-500 rounded-3xl p-4 shadow-[0_20px_50px_rgba(168,85,247,0.4)] backdrop-blur-2xl animate-in slide-in-from-top duration-300 text-white pointer-events-auto">
              <div className="flex items-start gap-3">
                <div className="w-12 h-12 rounded-2xl bg-purple-600/30 border border-purple-400/50 flex items-center justify-center shrink-0 animate-bounce text-purple-300">
                  <Car className="w-6 h-6 text-purple-300" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-purple-500/30 text-purple-300 border border-purple-500/40">
                      Caravan Invite
                    </span>
                    <span className="text-[10px] text-slate-400">Multi-Vehicle Trip</span>
                  </div>
                  <h4 className="text-sm font-black mt-1 text-white truncate">
                    {incomingConvoyInvite.senderName} started a Convoy
                  </h4>
                  <p className="text-xs text-slate-300 mt-0.5">
                    Destination: <span className="font-bold text-purple-200">{incomingConvoyInvite.session.destinationName}</span>
                  </p>

                  <div className="flex gap-2 mt-3">
                    <button
                      type="button"
                      onClick={() => {
                        const acceptedSession = convoyService.acceptInvite(incomingConvoyInvite, user?.uid || 'self');
                        setIncomingConvoyInvite(null);
                        handleStartNavigation(
                          acceptedSession.destinationName,
                          acceptedSession.destinationLocation
                        );
                      }}
                      className="flex-1 py-2.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white rounded-xl font-black text-xs shadow-lg shadow-purple-600/30 transition-all active:scale-95 flex items-center justify-center gap-1.5"
                    >
                      <Navigation className="w-4 h-4 fill-current shrink-0" />
                      <span>Join & Follow Route</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        convoyService.declineInvite();
                        setIncomingConvoyInvite(null);
                      }}
                      className="px-3 py-2.5 rounded-xl border border-white/10 hover:bg-white/5 text-xs text-slate-400 hover:text-white transition-all"
                    >
                      Decline
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Safety Alerts */}
          {!isDriveMode && (
            <OverlayManager>
              <div className="absolute z-[70] top-18 right-4 pointer-events-auto flex flex-col items-end">
                <SafetyAlerts
                  members={members}
                  currentUserId={user?.uid}
                  currentUserName={profile?.displayName}
                  onDismiss={(id) => console.log('Dismissed:', id)}
                  onSendReminder={(memberId, type) => {
                    const target = members.find(m => m.id === memberId);
                    const name = target ? target.name : 'member';
                    showNotification(`📱 Sent ${type === 'charge' ? 'charge reminder' : 'check-in request'} to ${name}!`, 3000);
                  }}
                  theme={activeTheme}
                />
              </div>
            </OverlayManager>
          )}

          {isDriveMode && activeRoute && activeRoute.steps && activeRoute.steps.length > 0 ? (
            <OverlayManager>
              <DriveModeHUD
                route={activeRoute}
                upcomingGuidance={upcomingGuidance}
                onCancel={handleCancelNavigation}
                speed={liveSpeedMph}
                speedAlertsEnabled={userSettings.speedAlerts}
                theme={activeTheme}
                stepIndex={navState.currentStepIndex}
                isMapRecovering={isMapRecovering}
                safetyScore={safetyScore}
                sessionPoints={sessionPoints}
                isMobile={isMobile}
                betterRouteSuggestion={betterRouteSuggestion}
                alternativeRoutes={alternativeRoutes}
                onRecalculateRoutes={handleRecalculateRoutes}
                isRecalculatingRoutes={isRecalculatingRoutes}
                onSwitchRoute={handleSwitchRoute}
                onDismissReroute={handleDismissReroute}
                upcomingTollAlert={upcomingTollAlert}
                onTakeTollFreeExit={handleTakeTollFreeExit}
                onDismissTollAlert={handleDismissTollAlert}
                leaderDivertedPrompt={leaderDivertedPrompt}
                onFollowLeader={handleFollowLeader}
                onKeepOriginalRoute={handleKeepOriginalRoute}
                ambientMaintenanceAdvisory={ambientMaintenanceAdvisory}
                onSelectMaintenanceStop={handleSelectMaintenanceStop}
                onDismissMaintenanceAdvisory={handleDismissMaintenanceAdvisory}
                members={members}
                userLocation={userLocation}
                currentUserId={user?.uid || ''}
                remainingDistanceMeters={navState.remainingDistanceMeters}
                remainingDurationSeconds={navState.remainingDurationSeconds}
                distanceToNextStep={navState.distanceToNextStep}
                isCameraFree={isCameraFree}
                onRecenter={handleRecenter}
                liveFuelSnapshot={liveFuelSnapshot}
                lowFuelAlert={lowFuelAlert}
                schoolZoneAdvisory={schoolZoneAdvisory}
                onSelectGasStationStop={handleSelectGasStationStop}
                onAddStop={handleAddStop}
                onDismissLowFuelAlert={handleDismissLowFuelAlert}
                fuelUpdatePromptNonce={fuelUpdatePromptNonce}
                onQuickFuelUpdate={handleQuickFuelUpdate}
                onContinueAfterFuelStop={handleContinueAfterStop}
                savedPlaces={userPlaces}
                roadRecorderStatus={roadRecorderStatus}
                roadRecorderEnabled={nativeRoadRecorderService.isSupported() && userSettings.autoRoadRecording !== false}
                onRoadRecorderStatusTap={() => {
                  if (roadRecorderStatus !== 'recording') return;
                  void nativeRoadRecorderService.showPreview().catch((error) => {
                    console.warn('[RoadRecorder] Could not show preview:', error);
                    showNotification('Camera preview is unavailable right now.', 3000);
                  });
                }}
              />
            </OverlayManager>
          ) : (
            <>


              {/* QuickStopGrid / Saved Places modal */}
              {activeModal === 'quickstop' && (
                <QuickStopGrid
                  onSearch={handleDiscovery}
                  onClose={() => setActiveModal(null)}
                  theme={activeTheme}
                  userPlaces={userPlaces}
                  onSelectPlace={handleSelectPlace}
                  onNavigatePlace={(place: Place) => handleStartNavigation(place.name, place.location)}
                  onAddPlace={handleAddPlace}
                  userLocation={userLocation}
                  members={members}
                />
              )}

              {activeModal === 'upsell' && <PremiumUpsellModal onClose={() => setActiveModal(null)} onUpgrade={handleUpgrade} theme={activeTheme} />}

              {/* Audit #3: RewardsPanel removed */}

              {activeModal === 'privacy' && (
                <OverlayManager>
                  <div className={`absolute z-[90] pointer-events-auto transition-all duration-500 ${isMobile ? 'inset-4 top-16 bottom-20' : 'left-8 top-24 w-96 max-h-[85vh]'}`}>
                    <PrivacyPanel
                      zones={[]}
                      isGhostMode={members.find(m => m.id === user?.uid)?.isGhostMode || false}
                      userCircles={userCircles}
                      activeCircleId={currentCircle?.id || profile?.familyCircleId}
                      onClose={() => setActiveModal(null)}
                      theme={activeTheme}
                    />
                  </div>
                </OverlayManager>
              )}

              {/* Wide landscape follows the sidebar composition, including this detail panel. */}
              {selectedMemberId && isMemberDetailOpen && activeModal !== 'privacy' && !usesMobileSheetLayout && (() => {
                const selectedMember = members.find(m => m.id === selectedMemberId);
                return selectedMember ? (
                  <OverlayManager priority={8}>
                    <div className="absolute z-[80] right-6 top-6 w-84 max-w-[360px] flex flex-col gap-4 opacity-100 pointer-events-auto animate-in slide-in-from-right-4 duration-300">
                      <MemberDetailPanel
                        member={selectedMember}
                        onClose={() => {
                          setSelectedMemberId(null);
                          setIsMemberDetailOpen(false);
                        }}
                        onToggleGhost={selectedMemberId === user?.uid ? () => handleToggleGhost(user?.uid || '') : undefined}
                        theme={activeTheme}
                      />
                      {/* Audit Round 5: Integrated QuickActions */}
                      <QuickActions
                        member={selectedMember}
                        isCurrentUser={selectedMemberId === user?.uid}
                        onText={() => {
                          if (selectedMember.id !== user?.uid) {
                            setContactRecipientId(selectedMember.id);
                          } else {
                            setContactRecipientId(null);
                          }
                          setContactAction('text'); setActiveModal('contacts');
                          setSelectedMemberId(null);
                          setIsMemberDetailOpen(false);
                        }}
                        onCheckIn={selectedMemberId === user?.uid
                          ? () => {
                              logActivity('arrival', 'Check-In', `${selectedMember.name} checked in: I'm Safe`, '✨', selectedMember.id);
                              showNotification(`✅ Checked in: I'm Safe`, 3000);
                            }
                          : () => {
                              logActivity('safety', 'Check-In Request', `Sent check-in request to ${selectedMember.name}`, '📱', user?.uid);
                              showNotification(`✅ Check-in request sent to ${selectedMember.name}`, 3000);
                            }
                        }
                        onSendEmoji={(emoji) => showNotification(`✨ Sent ${emoji} to ${selectedMember.name}`, 2000)}
                        onCall={() => { setContactRecipientId(selectedMember.id); setContactAction('call'); setActiveModal('contacts'); }}
                        onNavigateTo={() => {
                          handleStartNavigation(selectedMember.name, selectedMember.location);
                          setSelectedMemberId(null);
                          setIsMemberDetailOpen(false);
                        }}
                        onSOS={handleManualSOS}
                        theme={activeTheme}
                      />
                    </div>
                  </OverlayManager>
                ) : null;
              })()}

              {/* Mobile Member Detail — compact floating card when marker tapped */}
              {selectedMemberId && isMemberDetailOpen && !activeModal && !isBottomSheetExpanded && usesMobileSheetLayout && (() => {
                const selectedMember = members.find(m => m.id === selectedMemberId);
                if (!selectedMember) return null;
                const isSelf = selectedMember.id === user?.uid || selectedMember.id === 'demo-you';
                const isUnresolved = !selectedMember.location || (selectedMember.location.lat === 0 && selectedMember.location.lng === 0);

                return (
                  <OverlayManager priority={8}>
                    <div className="absolute z-[120] inset-x-0 bottom-40 px-3 pointer-events-none">
                      <div className={`rounded-2xl shadow-2xl border backdrop-blur-xl p-3.5 opacity-100 pointer-events-auto ${
                        activeTheme === 'dark' ? 'bg-slate-900/98 border-white/10 text-white' : 'bg-[#fdfbf7]/98 border-slate-200/80 text-slate-900 shadow-xl'
                      }`}>
                        {/* Row 1: Avatar + Info + Close */}
                        <div className="flex items-center gap-3 mb-3">
                          <div className="relative">
                            <img
                              src={getSafeAvatarUrl(selectedMember.avatar, selectedMember.name || selectedMember.id)}
                              onError={(e) => {
                                (e.target as HTMLImageElement).src = getDefaultAvatarDataUri(selectedMember.name || selectedMember.id);
                              }}
                              alt={selectedMember.name}
                              className={`w-11 h-11 rounded-full object-cover border-2 shadow-md bg-slate-800 ${
                                isUnresolved ? 'border-amber-400 saturate-75' : 'border-indigo-500'
                              }`}
                            />
                            {isSelf && (
                              <span className="absolute -bottom-1 -right-1 text-[8px] font-black px-1 rounded-full bg-indigo-600 text-white border border-slate-900">
                                YOU
                              </span>
                            )}
                            {isUnresolved && !isSelf && (
                              <span className="absolute -bottom-1 -right-1 text-[8px] font-black w-4 h-4 rounded-full bg-amber-500 text-slate-950 flex items-center justify-center border border-slate-900 animate-pulse">
                                <Radio className="w-2.5 h-2.5 text-slate-950" />
                              </span>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <div className={`font-bold text-sm truncate ${activeTheme === 'dark' ? 'text-white' : 'text-slate-900'}`}>
                                {selectedMember.name}
                              </div>
                              {isUnresolved && (
                                <span className="text-[8px] font-black uppercase px-1.5 py-0.5 rounded-md border flex items-center gap-1 shrink-0 bg-amber-500/15 border-amber-500/40 text-amber-400 animate-pulse">
                                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                                  <span>Locating…</span>
                                </span>
                              )}
                              {selectedMember.privacyMode === 'blurred' && (
                                <span className="text-[8px] font-black px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300 flex items-center gap-1">
                                  <EyeOff className="w-2.5 h-2.5 shrink-0" />
                                  <span>Blur</span>
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-slate-500 flex items-center gap-2 flex-wrap">
                              {isUnresolved ? (
                                <span className="font-semibold text-amber-400 flex items-center gap-1.5">
                                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping inline-block" />
                                  <span>Waiting for device signal…</span>
                                </span>
                              ) : (
                                <span className="font-semibold text-slate-300">
                                  {formatMemberStatus(selectedMember, undefined, userPlaces)}
                                </span>
                              )}
                              <span>•</span>
                              <span className="flex items-center gap-1">
                                <Battery className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                                <span>{selectedMember.battery}%</span>
                              </span>
                              {!isUnresolved && selectedMember.speed > 0 && <><span>•</span><span>{Math.round(selectedMember.speed)} mph</span></>}
                            </div>
                          </div>
                          <button
                            onClick={() => {
                              setSelectedMemberId(null);
                              setIsMemberDetailOpen(false);
                            }}
                            className={`w-8 h-8 rounded-full flex items-center justify-center ${
                              activeTheme === 'dark' ? 'bg-white/10 text-slate-400 hover:bg-white/20' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                            }`}
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>

                        {/* Row 2: Action buttons */}
                        {!isSelf ? (
                          <div className="grid grid-cols-4 gap-2">
                            <button
                              onClick={() => {
                                setContactRecipientId(selectedMember.id);
                                setContactAction('text'); setActiveModal('contacts');
                                setSelectedMemberId(null);
                                setIsMemberDetailOpen(false);
                              }}
                              className="py-2.5 rounded-xl bg-purple-500/20 text-purple-400 text-xs font-bold active:scale-95 transition-all flex items-center justify-center gap-1.5"
                            >
                              <MessageSquare className="w-3.5 h-3.5 shrink-0" />
                              <span>Text</span>
                            </button>
                            <button
                            onClick={() => {
                              setContactRecipientId(selectedMember.id);
                              setContactAction('call'); setActiveModal('contacts');
                              setSelectedMemberId(null);
                              setIsMemberDetailOpen(false);
                            }}
                              className="py-2.5 rounded-xl bg-blue-500/20 text-blue-400 text-xs font-bold active:scale-95 transition-all flex items-center justify-center gap-1.5"
                            >
                              <Phone className="w-3.5 h-3.5 shrink-0" />
                              <span>Call</span>
                            </button>
                            <button
                              onClick={() => {
                                if (isUnresolved) {
                                  showNotification(`📡 Waiting for ${selectedMember.name}'s location before navigating…`, 3000);
                                  return;
                                }
                                handleStartNavigation(selectedMember.name, selectedMember.location);
                                setSelectedMemberId(null);
                                setIsMemberDetailOpen(false);
                              }}
                              className={`py-2.5 rounded-xl text-xs font-bold active:scale-95 transition-all flex items-center justify-center gap-1.5 ${
                                isUnresolved ? 'bg-slate-500/10 text-slate-500' : 'bg-indigo-500/20 text-indigo-400'
                              }`}
                              title={isUnresolved ? 'Location pending' : 'Start navigation'}
                            >
                              <Navigation className="w-3.5 h-3.5 shrink-0" />
                              <span>Nav</span>
                            </button>
                            <button
                              onClick={() => {
                                logActivity('safety', 'Check-In Request', `Sent check-in request to ${selectedMember.name}`, '📱', user?.uid);
                                showNotification(`✅ Check-in request sent to ${selectedMember.name}`, 3000);
                              }}
                              className="py-2.5 rounded-xl bg-emerald-500/20 text-emerald-400 text-xs font-bold active:scale-95 transition-all flex items-center justify-center gap-1.5"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                              <span>Check In</span>
                            </button>
                          </div>
                        ) : (
                          <div className="grid grid-cols-2 gap-2">
                            <button
                              onClick={() => {
                                logActivity('arrival', 'Check-In', `${selectedMember.name} checked in: I'm Safe`, '✨', selectedMember.id);
                                showNotification(`✅ Checked in: I'm Safe`, 3000);
                              }}
                              className="py-2.5 rounded-xl bg-purple-500/20 text-purple-300 text-xs font-bold active:scale-95 transition-all flex items-center justify-center gap-1.5"
                            >
                              <EyeOff className="w-3.5 h-3.5 shrink-0" />
                              <span>Privacy</span>
                            </button>
                            <button
                              onClick={() => {
                                setActiveModal('settings');
                                setSelectedMemberId(null);
                                setIsMemberDetailOpen(false);
                              }}
                              className="py-2.5 rounded-xl bg-indigo-500/20 text-indigo-400 text-xs font-bold active:scale-95 transition-all flex items-center justify-center gap-1.5"
                            >
                              <Car className="w-3.5 h-3.5 shrink-0" />
                              <span>Garage</span>
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </OverlayManager>
                );
              })()}

              {/* ────────────────────────────────────────────────────────── */}
              {/* UNIFIED INTERACTION CONTAINER (DESKTOP / LANDSCAPE: MAP ROUTING COLUMN) */}
              {/* ────────────────────────────────────────────────────────── */}
              {!usesMobileSheetLayout && !isDriveMode && !activeModal && !correctingPlace && (
                <div className="absolute left-1/2 -translate-x-1/2 bottom-6 md:bottom-8 lg:bottom-10 landscape:bottom-6 landscape:md:bottom-8 w-full max-w-[min(620px,calc(100%-2rem))] z-[120] flex flex-col-reverse gap-2 sm:gap-3 pointer-events-none max-h-[calc(100%-2rem)] md:max-h-[calc(100%-4rem)] landscape:max-h-[calc(100dvh-4rem)] justify-start transition-all duration-300">
                  {/* Search Input Bar (Anchors dropdown directly above) */}
                  <div className="w-full pointer-events-auto">
                    <SearchBox
                      onSearch={(q) => handleDiscovery(q, handleSelectPlace)}
                      onSearchResultsChange={handleSearchResultsChange}
                      onNavigate={handleStartNavigation}
                      onCategorySearch={handleQuickSearch}
                      onLocate={handleLocateSelf}
                      onQuickStop={() => setActiveModal('quickstop')}
                      onOpenContacts={() => {
                        setContactRecipientId(null);
                        setContactAction('text'); setActiveModal('contacts');
                      }}
                      theme={activeTheme}
                      userPlaces={userPlaces}
                      onSelectSavedPlace={handleSelectPlace}
                      onSelectPlace={handleSelectPlace}
                      userLocation={userLocation}
                      selectedPlace={selectedPlace}
                      onClearSelectedPlace={handleClearSelectedPlace}
                      searchText={searchText}
                      onSearchTextChange={setSearchText}
                      mapCenter={mapCenter}
                    />
                  </div>

                  {/* Place Detail Panel (Renders immediately below search in the exact same physical column) */}
                  {selectedPlace && isPlaceDetailOpen && !correctingPlace && (
                    <div className="flex-1 overflow-y-auto no-scrollbar max-h-[calc(100dvh-120px)] landscape:max-h-[calc(100dvh-5.5rem)] rounded-[1.75rem] sm:rounded-[2rem] opacity-100 pointer-events-auto animate-in fade-in slide-in-from-top-3 duration-300">
                      <PlaceDetailPanel
                        place={userPlaces.find(p => p.id === selectedPlace.id || (p.location && selectedPlace.location && Math.abs(p.location.lat - selectedPlace.location.lat) < 0.00005 && Math.abs(p.location.lng - selectedPlace.location.lng) < 0.00005)) || selectedPlace}
                        onClose={handleClearSelectedPlace}
                        onNavigate={(selectedRoute) => {
                          handleStartNavigation(selectedPlace.name, selectedPlace.location, selectedRoute);
                          handleClearSelectedPlace();
                        }}
                        onSelectRoutePreview={handleSelectRoutePreview}
                        onPromoteStop={handlePromoteRouteStop}
                        initialWaypoints={plannedWaypoints}
                        keepStopPlannerOpen={keepStopPlannerOpen}
                        theme={activeTheme}
                        userLocation={userLocation}
                        onUpdateRadius={handleUpdatePlaceRadius}
                        isSaved={userPlaces.some(p => 
                          p.id === selectedPlace.id || 
                          ((p.name || '').trim().toLowerCase() === (selectedPlace.name || '').trim().toLowerCase()) ||
                          (p.address && selectedPlace.address && (p.address || '').trim().toLowerCase() === (selectedPlace.address || '').trim().toLowerCase())
                        )}
                        onAddPlace={handleAddPlace}
                        onDeletePlace={handleDeletePlace}
                        onEditPlace={(place) => setEditingPlace(place)}
                        onCorrectLocation={(place) => setCorrectingPlace(place)}
                        members={liveMembers}
                        currentUserId={user?.uid}
                        userPlaces={userPlaces}
                      />
                    </div>
                  )}
                </div>
              )}

              {/* Safety Insights - Repositioned to Top Center Drawer as per Audit */}
              {!activeModal && !isBottomSheetExpanded && (
                <div className={`absolute left-1/2 -translate-x-1/2 z-50 pointer-events-none ${isMobile ? 'top-14 w-auto max-w-[90%]' : 'top-3 sm:top-6 w-auto max-w-[calc(100%-4rem)]'}`}>
                  <InsightsBar
                    insights={insights}
                    theme={activeTheme}
                    onReconnect={() => {
                      showNotification("🔄 Attempting to reconnect...", 3000);
                      setTimeout(() => setIsOffline(false), 1500);
                    }}
                  />
                </div>
              )}
            </>
          )}



          {/* Native contact actions and number sharing */}
          {activeModal === 'contacts' && (
            <OverlayManager>
              {/* Audit #4: On mobile during navigation, show contacts in bottom half so HUD stays visible */}
              <div className={`absolute z-[150] pointer-events-auto ${isMobile 
                ? (isNavigating ? 'inset-x-4 bottom-4 top-[50%]' : 'inset-4')
                : 'right-6 bottom-6 w-96 h-[500px]'
              }`}>
                <CircleContactsPanel
                  members={members}
                  currentUserId={user?.uid || ''}
                  userCircles={userCircles}
                  initialAction={contactAction}
                  initialRecipientId={contactRecipientId}
                  onClose={() => {
                    setActiveModal(null);
                    setContactRecipientId(null);
                  }}
                  theme={activeTheme}
                />
              </div>
            </OverlayManager>
          )}

          {/* 1-Tap Road Incident Reporter */}
          {activeModal === 'incident' && (
            <OverlayManager>
              <IncidentReporter
                theme={activeTheme}
                isMobile={isMobile}
                activeIncidents={incidents}
                currentUserId={user?.uid}
                onRemoveIncident={async (id) => {
                  await incidentService.removeIncident(id, user?.uid);
                  showNotification('🗑️ Removed alert from map', 3000);
                }}
                onClose={() => setActiveModal(null)}
                onReport={(type, details) => {
                  if (userLocation) {
                    incidentService.reportIncident(
                      type,
                      userLocation,
                      { id: user?.uid || 'driver', name: profile?.displayName || user?.displayName || 'Driver' },
                      details
                    );
                    showNotification(`📢 Road report shared with circle!`, 3000);
                  }
                }}
              />
            </OverlayManager>
          )}

          {/* Incident Detail & Dismiss / Remove Modal */}
          {selectedIncident && (
            <IncidentDetailModal
              incident={selectedIncident}
              onClose={() => setSelectedIncident(null)}
              currentUserId={user?.uid}
              currentUserName={profile?.displayName || user?.displayName}
              showNotification={showNotification}
              theme={activeTheme}
            />
          )}

          {/* Emergency SOS Safety Dispatch Modal */}
          <EmergencySOSModal
            isOpen={isSOSModalOpen}
            onClose={() => setIsSOSModalOpen(false)}
            isSosActive={!!members.find(m => m.id === (user?.uid || 'demo-you'))?.sosActive}
            onTriggerSOS={() => handleTriggerSOS()}
            onCancelSOS={handleCancelSOS}
            theme={activeTheme}
            userLocation={userLocation}
          />

          {/* Edit Saved Place & Geofence Modal */}
          <EditPlaceModal
            place={editingPlace}
            isOpen={!!editingPlace}
            onClose={() => setEditingPlace(null)}
            onSave={handleUpdatePlace}
            onUpdatePlace={handleLiveUpdatePlace}
            onDelete={handleDeletePlace}
            onCorrectLocation={(place) => setCorrectingPlace(place)}
            userLocation={userLocation}
            theme={activeTheme}
            currentUserId={user?.uid}
            currentUserName={profile?.name || user?.displayName || 'You'}
            currentUserAvatar={profile?.avatar || user?.photoURL || undefined}
            onPhotoUploaded={(placeId, imageUrl) => {
              void handleUpdatePlace(placeId, { imageUrl, needsBuildingPhoto: false });
            }}
          />

          {/* Precision Address & Pin Location Correction Modal */}
          <CorrectLocationModal
            place={correctingPlace}
            isOpen={!!correctingPlace}
            onClose={() => setCorrectingPlace(null)}
            userLocation={userLocation}
            theme={activeTheme}
            userId={user?.uid}
            userName={profile?.name || user?.displayName || 'You'}
            userAvatar={profile?.avatar || user?.photoURL || undefined}
            onPendingSubmitted={(placeName, status) => showNotification(
                status === 'approved'
                    ? `${placeName} was auto-approved as an Operations contribution.`
                    : `Submitted ${placeName} to My Way Operations for review.`,
                4000
            )}
            onSave={(correctedPlace) => {
              // 1. Update selectedPlace if active so panel and route preview update
              if (selectedPlace && (selectedPlace.id === correctedPlace.id || selectedPlace.name === correctedPlace.name)) {
                setSelectedPlace(correctedPlace);
                setIsPlaceDetailOpen(true);
              }
              // 2. If it's a saved place in userPlaces, update it in Firebase / local state
              if (userPlaces.some(p => p.id === correctedPlace.id)) {
                handleUpdatePlace(correctedPlace.id, {
                  name: correctedPlace.name,
                  description: correctedPlace.description,
                  address: correctedPlace.address,
                  type: correctedPlace.type,
                  location: correctedPlace.location,
                  entrancePin: correctedPlace.entrancePin,
                  entranceLocation: correctedPlace.entranceLocation,
                  entrancePrecision: correctedPlace.entrancePrecision,
                  entranceType: correctedPlace.entranceType,
                  originalLocation: correctedPlace.originalLocation,
                  isCorrected: correctedPlace.isCorrected,
                  isCommunityVerified: correctedPlace.isCommunityVerified,
                  correctedAt: correctedPlace.correctedAt,
                  visibility: correctedPlace.visibility,
                  imageUrl: correctedPlace.imageUrl,
                  submitterId: correctedPlace.submitterId,
                  submitterName: correctedPlace.submitterName,
                  submitterAvatar: correctedPlace.submitterAvatar,
                  helpfulCount: correctedPlace.helpfulCount,
                  helpfulUserIds: correctedPlace.helpfulUserIds
                });
              }
              // 3. Update discoveredPlaces so map pin immediately repositions
              setDiscoveredPlaces(prev => prev.map(p => 
                (p.id === correctedPlace.id || (p.name === correctedPlace.name && p.description === correctedPlace.description))
                  ? correctedPlace
                  : p
              ));
              showNotification(`✅ Pin location & entrance photo saved!`, 4000);
            }}
          />

          <ApproachingDestinationCard
            key={approachingTripData ? `${approachingTripData.destinationPlace?.id || approachingTripData.destinationName}:${approachingTripData.arrivedAt || ''}` : 'arrival-card-closed'}
            arrivalData={approachingTripData}
            isOpen={!!approachingTripData}
            onDismiss={() => setApproachingTripData(null)}
            onFixLocation={(destinationPlace) => {
              setCorrectingPlace(destinationPlace);
            }}
            onPhotoSaved={(placeId, imageUrl, isSynced) => {
              const savedPlace = userPlaces.find(place => place.id === placeId);
              if (savedPlace?.createdBy === user?.uid) {
                void handleUpdatePlace(placeId, { imageUrl, needsBuildingPhoto: false });
              }
              setPhotoSavedConfirmation({
                name: savedPlace?.name || approachingTripData?.destinationName || 'Destination',
                place: savedPlace || null,
                isSynced
              });
              // A successful contribution is the driver's completion action.
              // End this trip now instead of leaving an ambiguous shared state.
              onTripCompleted(undefined, true);
            }}
            theme={activeTheme}
            userId={user?.uid}
            userName={profile?.displayName || user?.displayName || 'Driver'}
            userAvatar={profile?.photoURL || user?.photoURL || ''}
          />

          <MultiStopArrivalCard
            state={multiStopArrival}
            theme={activeTheme}
            onResume={handleContinueAfterStop}
            onEndTrip={handleCancelNavigation}
            onDismissApproach={handleDismissStopApproach}
          />

          {pendingTripResume && (
            <TripResumePrompt
              destinationName={pendingTripResume.destinationName}
              isResuming={isResumingTrip}
              onResume={() => { void handleResumeTrip(); }}
              onEndTrip={handleDiscardTripResume}
            />
          )}

          <TripReviewCard
            arrivalData={completedTripData}
            isOpen={Boolean(completedTripData)}
            theme={activeTheme}
            userId={user?.uid}
            userName={profile?.displayName || user?.displayName || 'Driver'}
            userAvatar={profile?.photoURL || user?.photoURL || ''}
            onClose={() => setCompletedTripData(null)}
            onReportPin={(place) => {
              setCompletedTripData(null);
              setCorrectingPlace(place);
            }}
          />

          {/* New User Onboarding Setup Wizard Modal */}
          <SetupWizardModal
            isOpen={Boolean(user && activeUserProfile && activeUserProfile.hasCompletedSetup === false && !authLoading)}
            user={user}
            profile={activeUserProfile}
            theme={activeTheme as 'light' | 'dark'}
            userLocation={userLocation}
            onComplete={(updatedProfile, createdPlace) => {
              setLocalProfileOverride(prev => ({ ...(prev || {}), ...updatedProfile }));
              if (createdPlace) {
                setUserPlaces(prev => {
                  const filtered = prev.filter(p => p.id !== createdPlace.id && p.name !== createdPlace.name);
                  const updated = [createdPlace as UserPlace, ...filtered];
                  try {
                    localStorage.setItem('myway_user_places', JSON.stringify(updated));
                  } catch (e) {}
                  return updated;
                });
              }
              showNotification(createdPlace ? '🎉 Welcome to MyWay! Your profile and first place are ready.' : '🎉 Welcome to MyWay! Your profile is ready.', 4500);
            }}
          />

          {/* Circle Settings & Multi-Circle Management Modal */}
          <CircleSettingsModal
            isOpen={activeModal === 'circle_settings'}
            onClose={() => setActiveModal(null)}
            currentCircle={currentCircle}
            userCircles={userCircles}
            members={members}
            currentUserId={user?.uid}
            activeFilterCircleId={activeFilterCircleId}
            onSelectFilterCircle={setActiveFilterCircleId}
            onSwitchCircle={async (id) => {
              await switchCircle(id);
              showNotification('✅ Switched active circle', 2500);
            }}
            onCreateCircle={createCircle}
            onJoinCircle={joinCircle}
            onRenameCircle={renameCircle}
            onUpdateCircleColor={async (circleId, color) => {
              await updateCircleColor(circleId, color);
              showNotification('🎨 Circle color theme updated!', 2500);
            }}
            onLeaveCircle={async (id, successorId) => {
              await leaveCurrentCircle(id, successorId);
            }}
            onDeleteCircle={deleteCircle}
            onRemoveMember={(memberId) => {
              if (currentCircle?.id && user?.uid) {
                removeMember(currentCircle.id, user.uid, memberId).catch((err: any) => {
                  console.error('Failed to remove member:', err);
                });
              }
              setMembers(prev => prev.filter(m => m.id !== memberId));
              showNotification('Member removed & security keys rotated', 3000);
            }}
            onUpdateRole={(memberId, role) => {
              setMembers(prev => prev.map(m => m.id === memberId ? { ...m, role } : m));
            }}
            showNotification={showNotification}
            theme={activeTheme}
            initialTab={circleSettingsTab}
          />

          {/* Settings Panel */}
          {activeModal === 'settings' && (
            <OverlayManager>
              <div
                className={`absolute z-[150] flex flex-col pointer-events-auto ${isMobile ? 'mobile-modal-safe-frame' : 'right-6 top-20 w-96 h-[calc(100dvh-120px)]'}`}
              >
                <SettingsPanel
                onOpenContacts={() => { setContactRecipientId(null); setContactAction('text'); setActiveModal('contacts'); }}
                  userCircles={userCircles}
                  pendingReviewCount={pendingOperationsReviewCount}
                  settings={userSettings}
                  onUpdateSettings={async (newSettings) => {
                    const prevSharing = userSettings.privacyMode !== 'invisible';
                    const nextSharing = newSettings.privacyMode !== 'invisible';
                    const normalizedSettings = { ...newSettings, locationSharing: nextSharing };
                    setUserSettings(normalizedSettings);

                    // Optimistic localStorage persistence for Speed Alerts
                    try {
                      localStorage.setItem('setting_speed_alerts', JSON.stringify(newSettings.speedAlerts));
                      localStorage.setItem('myway_speed_alerts', JSON.stringify(newSettings.speedAlerts));
                      localStorage.setItem('myway_auto_road_recording', String(newSettings.autoRoadRecording !== false));
                      localStorage.setItem('myway_road_recording_mode', newSettings.roadRecordingMode || 'trip');
                      localStorage.setItem('myway_road_recording_quality', newSettings.roadRecordingQuality || 'hd');
                      localStorage.setItem('myway_road_recording_storage_gb', String(newSettings.roadRecordingStorageGb || 2));
                    } catch (e) {}

                    if (newSettings.theme !== 'auto') {
                      setTheme(newSettings.theme);
                    }
                    if (newSettings.mapSkin) {
                      setMapSkin(newSettings.mapSkin);
                      localStorage.setItem('myway_map_skin', newSettings.mapSkin);
                    }
                    if (newSettings.buildingScale) {
                      localStorage.setItem('myway_building_scale', newSettings.buildingScale);
                    }
                    if (typeof newSettings.showTrafficControls === 'boolean') {
                      localStorage.setItem('myway_show_traffic_controls', String(newSettings.showTrafficControls));
                    }

                    // Save settings to user profile (RTDB & Firestore)
                    if (user?.uid) {
                      try {
                        const { updateUserProfile } = await import('./services/authService');
                        await updateUserProfile(user.uid, {
                          settings: {
                            ...profile?.settings,
                            theme: newSettings.theme,
                            notifications: newSettings.notifications,
                            locationSharing: nextSharing,
                            privacyMode: normalizedSettings.privacyMode,
                            batteryAlerts: newSettings.batteryAlerts,
                            arrivalAlerts: newSettings.arrivalAlerts,
                            speedAlerts: newSettings.speedAlerts,
                            autoRoadRecording: newSettings.autoRoadRecording !== false,
                            roadRecordingMode: newSettings.roadRecordingMode || 'trip',
                            roadRecordingQuality: newSettings.roadRecordingQuality || 'hd',
                            roadRecordingStorageGb: newSettings.roadRecordingStorageGb || 2
                          }
                        });
                      } catch (err) {
                        console.warn('[App] Failed to update user settings in profile:', err);
                      }
                    }

                    if (user?.uid && nextSharing !== prevSharing) {
                      try {
                        if (nextSharing) {
                          const { claimLocationSharingForCurrentDevice } = await import('./services/deviceSessionService');
                          await claimLocationSharingForCurrentDevice();
                          if (forcePublishLocation) {
                            await forcePublishLocation(true);
                          }
                        } else {
                          if (forcePublishLocation) {
                            await forcePublishLocation(false);
                          }
                        }
                      } catch (err) {
                        console.warn('[App] Failed to update location sharing setting in profile:', err);
                      }
                    }
                  }}
                  onClose={() => setActiveModal(null)}
                  onOpenOfflineMaps={() => setActiveModal('offline_maps')}
                  theme={activeTheme}
                  userName={profile?.displayName || user?.displayName || 'User'}
                  userEmail={user?.email || profile?.email || null}
                  userId={user?.uid}
                  circleId={profile?.familyCircleId || undefined}
                  userAvatar={profile?.photoURL || user?.photoURL || ''}
                  onUpgrade={() => setActiveModal('upsell')}
                  isPremium={hasCirclePremium || profile?.membershipTier === 'gold' || profile?.membershipTier === 'platinum'}
                  onUpdateProfile={async (name, file) => {
                    if (!user) return;
                    try {
                      let photoURL = profile?.photoURL || '';
                      if (file) {
                        const { uploadProfileImage } = await import('./services/authService');
                        photoURL = await uploadProfileImage(user.uid, file);
                      }
                      
                      const { updateUserProfile } = await import('./services/authService');
                      await updateUserProfile(user.uid, { 
                        displayName: name, 
                        photoURL: photoURL 
                      });
                      // Existing building photos show their contributor in
                      // search and arrival panels. Keep that attribution in
                      // sync with the profile the user just saved.
                      void placePhotoService.refreshContributorIdentity(user.uid, name, photoURL)
                        .catch(error => console.warn('[App] Could not refresh building-photo contributor identity:', error));
                      
                      showNotification('👤 Profile updated successfully!', 3000);
                    } catch (err: any) {
                      showNotification(`❌ Update failed: ${err.message}`, 5000);
                      throw err;
                    }
                  }}
                  onSignOut={() => {
                    logout();
                  }}
                  onOpenKeyRecovery={() => setActiveModal('key_recovery')}
                  onDeleteAccount={deleteUserAccount}
                />
              </div>
            </OverlayManager>
          )}

          {/* Offline Maps Panel */}
          {activeModal === 'offline_maps' && (
            <OverlayManager>
              <div className="absolute inset-0 z-[200] pointer-events-none">
                <React.Suspense fallback={<div className="glass-panel p-6 text-center text-xs text-slate-400 font-bold rounded-2xl">Loading Offline Maps...</div>}>
                  <OfflineMapManager
                    currentBounds={mapBounds}
                    theme={activeTheme}
                    isMobile={isMobile}
                    onClose={() => setActiveModal(null)}
                    onDownloadComplete={(area) => {
                      setActiveModal(null);
                      showNotification(`Map saved for offline use: ${area.name}`, 4000);
                    }}
                  />
                </React.Suspense>
              </div>
            </OverlayManager>
          )}

          {/* Trip History Panel */}
          {activeModal === 'trip_history' && (
            <OverlayManager>
              <div className={`absolute z-[200] pointer-events-auto ${isMobile ? 'mobile-modal-safe-frame' : 'right-6 top-20 w-[420px] max-h-[calc(100dvh-120px)]'}`}>
                <div className="glass-panel rounded-2xl overflow-hidden max-h-full">
                  <React.Suspense fallback={<div className="p-6 text-center text-xs text-slate-400 font-bold">Loading Trip History...</div>}>
                    <TripHistoryPanel
                      onClose={() => {
                        setActiveModal(null);
                        setReviewedTrip(null);
                      }}
                      onBack={() => {
                        setActiveModal('settings');
                        setReviewedTrip(null);
                      }}
                      onReplayTrip={(trip) => {
                        setReviewedTrip(trip);
                        // Show trip path on map
                        if (trip.path.length > 0) {
                          const mid = trip.path[Math.floor(trip.path.length / 2)];
                          setMapCenter([mid.lng, mid.lat]);
                        }
                      }}
                    />
                  </React.Suspense>
                </div>
              </div>
            </OverlayManager>
          )}

          {/* Circle Admin Panel */}
          {activeModal === 'circle_admin' && (
            <OverlayManager>
              <div className={`absolute z-[200] pointer-events-auto ${isMobile ? 'mobile-modal-safe-frame' : 'right-6 top-20 w-[420px] max-h-[calc(100dvh-120px)]'}`}>
                <div className="glass-panel rounded-2xl overflow-hidden max-h-full">
                  <React.Suspense fallback={<div className="p-6 text-center text-xs text-slate-400 font-bold">Loading Circle Admin...</div>}>
                    <CircleAdminPanel
                      members={members}
                      circleOwnerId={currentCircle?.ownerId}
                      currentUserId={user?.uid}
                      onClose={() => setActiveModal(null)}
                      onRemoveMember={(memberId) => {
                        if (currentCircle?.id && user?.uid) {
                          removeMember(currentCircle.id, user.uid, memberId).catch(err => {
                            console.error('Failed to remove member and rotate key:', err);
                          });
                        }
                        setMembers(prev => prev.filter(m => m.id !== memberId));
                        showNotification('Member removed & security keys rotated', 3000);
                      }}
                      onUpdateRole={(memberId, role) => {
                        setMembers(prev => prev.map(m => m.id === memberId ? { ...m, role } : m));
                      }}
                      showNotification={showNotification}
                      theme={activeTheme}
                    />
                  </React.Suspense>
                </div>
              </div>
            </OverlayManager>
          )}

          {/* Notification Center */}
          {activeModal === 'notifications' && (
            <OverlayManager>
              <div className={`absolute z-[200] pointer-events-auto ${isMobile ? 'mobile-modal-safe-frame' : 'right-6 top-20 w-[400px] max-h-[calc(100dvh-120px)]'}`}>
                <div className="glass-panel rounded-2xl overflow-hidden max-h-full">
                  <NotificationCenter
                    onClose={() => setActiveModal(null)}
                    onBack={() => setActiveModal('settings')}
                    theme={activeTheme}
                  />
                </div>
              </div>
            </OverlayManager>
          )}

          {/* Weekly Safety Report */}
          {activeModal === 'weekly_report' && (
            <OverlayManager>
              <div className={`absolute z-[200] pointer-events-auto ${isMobile ? 'mobile-modal-safe-frame' : 'right-6 top-20 w-[420px] max-h-[calc(100dvh-120px)]'}`}>
                <div className="bg-white rounded-3xl shadow-2xl overflow-hidden max-h-full border border-slate-200">
                  <React.Suspense fallback={<div className="p-6 text-center text-xs text-slate-400 font-bold">Loading Weekly Report...</div>}>
                    <WeeklySafetyReport
                      onClose={() => setActiveModal(null)}
                      onBack={() => setActiveModal('settings')}
                      members={members}
                      userCircles={userCircles}
                      currentCircle={currentCircle}
                      currentUserId={user?.uid}
                      theme={activeTheme}
                    />
                  </React.Suspense>
                </div>
              </div>
            </OverlayManager>
          )}

          {/* Invite Share Modal */}
          {activeModal === 'invite' && currentCircle?.inviteCode && (
            <React.Suspense fallback={<div className="glass-panel p-6 text-center text-xs text-slate-400 font-bold rounded-2xl">Loading Invite...</div>}>
              <InviteShareModal
                inviteCode={currentCircle.inviteCode}
                circleName={currentCircle.name}
                onClose={() => setActiveModal(null)}
                onBack={() => setActiveModal('settings')}
                showNotification={showNotification}
                theme={activeTheme}
              />
            </React.Suspense>
          )}

          {/* Key Recovery Panel */}
          {activeModal === 'key_recovery' && (
            <OverlayManager>
              <div className={`absolute z-[200] pointer-events-auto ${isMobile ? 'inset-4' : 'right-6 bottom-6 w-96'}`}>
                <div className={`rounded-3xl overflow-hidden shadow-2xl border ${
                  activeTheme === 'dark' ? 'bg-slate-900/95 border-white/10' : 'bg-[#fdfbf7]/98 border-slate-200/80 shadow-2xl'
                }`}>
                  <React.Suspense fallback={<div className="p-6 text-center text-xs text-slate-400 font-bold">Loading Key Recovery...</div>}>
                    <KeyRecoveryPanel
                      uid={user?.uid || ''}
                      onClose={() => setActiveModal(null)}
                      onBack={() => setActiveModal('settings')}
                      showNotification={showNotification}
                      theme={activeTheme}
                    />
                  </React.Suspense>
                </div>
              </div>
            </OverlayManager>
          )}

          {/* My Maintenance Panel — Vehicle expenses, mileage, gig driver tracking */}
          {activeModal === 'maintenance' && (
            <React.Suspense fallback={<div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 text-slate-300 font-bold text-sm">Loading Maintenance Hub...</div>}>
              <MaintenancePanel
                theme={activeTheme}
                onClose={() => setActiveModal(null)}
              />
            </React.Suspense>
          )}

          {/* Battery Optimization Prompt (Android only, after onboarding) */}
          {activeModal === 'battery_prompt' && (
            <BatteryOptimizationPrompt
              onDismiss={() => setActiveModal(null)}
              theme={activeTheme}
            />
          )}
        </div>
      </div>

      {/* Mobile Bottom Sheet - replaces sidebar on mobile */}
      {
        usesMobileSheetLayout && !isDriveMode && !activeModal && (
          <BottomSheet
            className={selectedPlace ? 'landscape:hidden' : ''}
            isExpanded={isBottomSheetExpanded}
            onExpandedChange={setIsBottomSheetExpanded}
            members={members}
            currentUserId={user?.uid || ''}
            selectedId={selectedMemberId}
            onSelect={handleSelectMember}
            theme={activeTheme}
            hasCircle={!!profile?.familyCircleId}
            circleName={currentCircle?.name}
            userCircles={userCircles}
            activeFilterCircleId={activeFilterCircleId}
            onSelectFilterCircle={setActiveFilterCircleId}
            onOpenCircleSettings={(tab) => {
              setIsBottomSheetExpanded(false);
              setCircleSettingsTab(tab || 'circles');
              setActiveModal('circle_settings');
            }}
            inviteCode={currentCircle?.inviteCode}
            onCreateCircle={createCircle}
            onJoinCircle={joinCircle}
            showNotification={showNotification}
            onOpenSettings={() => {
              setIsBottomSheetExpanded(false);
              setActiveModal('settings');
            }}
            onOpenTripHistory={() => {
              setIsBottomSheetExpanded(false);
              setActiveModal('trip_history');
            }}
            onOpenNotifications={() => {
              setIsBottomSheetExpanded(false);
              setActiveModal('notifications');
            }}
            onOpenWeeklyReport={() => {
              setIsBottomSheetExpanded(false);
              setActiveModal('weekly_report');
            }}
            onOpenInviteShare={() => {
              setIsBottomSheetExpanded(false);
              setCircleSettingsTab('invite');
              setActiveModal('circle_settings');
            }}
            onOpenMaintenance={() => {
              setIsBottomSheetExpanded(false);
              setActiveModal('maintenance');
            }}
            onOpenContacts={(recipientId) => {
              setIsBottomSheetExpanded(false);
              setContactRecipientId(typeof recipientId === 'string' && recipientId.trim() ? recipientId : null);
              setContactAction('text'); setActiveModal('contacts');
            }}
            onSOS={handleManualSOS}
            activities={activities}
            unreadActivityCount={unreadActivityCount}
            onLogViewed={markActivityLogViewed}
            onResolveSOS={handleResolveSOS}
            userPlaces={userPlaces}
            selectedPlaceId={selectedPlace?.id}
            onSelectPlace={(place) => {
              setIsBottomSheetExpanded(false);
              handleSelectPlace(place);
            }}
            onAddPlace={handleAddPlace}
            onDeletePlace={handleDeletePlace}
            onEditPlace={(place: Place) => setEditingPlace(place)}
            onNavigatePlace={(place: Place) => handleStartNavigation(place.name, place.location)}
            userLocation={userLocation}
          />
        )
      }

      {/* ────────────────────────────────────────────────────────── */}
      {/* UNIFIED INTERACTION CONTAINER (MOBILE: UNIFIED BOTTOM SHEET) */}
      {/* ────────────────────────────────────────────────────────── */}
      {/* ────────────────────────────────────────────────────────── */}
      {/* UNIFIED INTERACTION CONTAINER (MOBILE: UNIFIED BOTTOM SHEET) */}
      {/* ────────────────────────────────────────────────────────── */}
      {usesMobileSheetLayout && !isDriveMode && !activeModal && (!isBottomSheetExpanded || isPlaceDetailOpen || selectedPlace) && !correctingPlace && (
        <OverlayManager priority={isPlaceDetailOpen || selectedPlace ? 8 : 5}>
          <div className="contents">
            {/* Search Input Bar (Floats above bottom peek sheet, cleanly pushes down and hides when a place is selected) */}
            <div data-map-bottom-obstruction className={`absolute inset-x-0 bottom-[calc(116px+env(safe-area-inset-bottom,0px))] px-4 pb-1 max-h-[min(50vh,360px)] z-[90] pointer-events-none transition-all duration-300 ${
              (selectedPlace && isPlaceDetailOpen) ? 'translate-y-8 opacity-0 pointer-events-none' : 'translate-y-0 opacity-100'
            }`}>
              <div className="w-full pointer-events-auto">
                <SearchBox
                  onSearch={(q) => handleDiscovery(q, handleSelectPlace)}
                  onSearchResultsChange={handleSearchResultsChange}
                  onNavigate={handleStartNavigation}
                  onCategorySearch={handleQuickSearch}
                  onLocate={handleLocateSelf}
                  onQuickStop={() => setActiveModal('quickstop')}
                  onOpenContacts={() => {
                    setContactRecipientId(null);
                    setContactAction('text'); setActiveModal('contacts');
                  }}
                  theme={activeTheme}
                  userPlaces={userPlaces}
                  onSelectSavedPlace={handleSelectPlace}
                  onSelectPlace={handleSelectPlace}
                  userLocation={userLocation}
                  selectedPlace={selectedPlace}
                  onClearSelectedPlace={handleClearSelectedPlace}
                  searchText={searchText}
                  onSearchTextChange={setSearchText}
                  mapCenter={mapCenter}
                />
              </div>
            </div>

            {/* Mobile Place Detail Panel (Slides over the search bar cleanly from bottom-0 at z-[100]) */}
            {(selectedPlace && isPlaceDetailOpen) && (
              <div className="absolute inset-x-0 bottom-0 landscape:inset-x-auto landscape:left-4 landscape:top-16 landscape:bottom-4 landscape:my-auto landscape:w-[380px] landscape:max-w-[46vw] landscape:max-h-[calc(100dvh-5.5rem)] z-[100] opacity-100 pointer-events-auto flex flex-col animate-in slide-in-from-bottom landscape:slide-in-from-left duration-300">
                <PlaceDetailPanel
                  place={userPlaces.find(p => p.id === selectedPlace.id || (p.location && selectedPlace.location && Math.abs(p.location.lat - selectedPlace.location.lat) < 0.00005 && Math.abs(p.location.lng - selectedPlace.location.lng) < 0.00005)) || selectedPlace}
                  onClose={handleClearSelectedPlace}
                  onNavigate={(selectedRoute) => {
                    handleStartNavigation(selectedPlace.name, selectedPlace.location, selectedRoute);
                    handleClearSelectedPlace();
                  }}
                  onSelectRoutePreview={handleSelectRoutePreview}
                  onPromoteStop={handlePromoteRouteStop}
                  initialWaypoints={plannedWaypoints}
                  keepStopPlannerOpen={keepStopPlannerOpen}
                  theme={activeTheme}
                  userLocation={userLocation}
                  isMobile={true}
                  onUpdateRadius={handleUpdatePlaceRadius}
                  isSaved={userPlaces.some(p => 
                    p.id === selectedPlace.id || 
                    ((p.name || '').trim().toLowerCase() === (selectedPlace.name || '').trim().toLowerCase()) ||
                    (p.address && selectedPlace.address && (p.address || '').trim().toLowerCase() === (selectedPlace.address || '').trim().toLowerCase()) ||
                    (p.location && selectedPlace.location && Math.abs(p.location.lat - selectedPlace.location.lat) < 0.0005 && Math.abs(p.location.lng - selectedPlace.location.lng) < 0.0005)
                  )}
                  onAddPlace={handleAddPlace}
                  onDeletePlace={handleDeletePlace}
                  onEditPlace={(place) => setEditingPlace(place)}
                  onCorrectLocation={(place) => setCorrectingPlace(place)}
                  members={liveMembers}
                  currentUserId={user?.uid}
                  userPlaces={userPlaces}
                />
              </div>
            )}
          </div>
        </OverlayManager>
      )}

      {/* Crash Detection Dynamic Island Floating Notification */}
      {crashCountdown !== null && (
        <OverlayManager priority={10}>
          <CrashCountdownOverlay
            remainingSeconds={crashCountdown}
            onDismiss={() => cancelCrashCountdown()}
            onFindHospital={() => {
              handleDiscovery('Hospital', userLocation || undefined);
            }}
            onImmediateSOS={() => {
              handleTriggerSOS();
              cancelCrashCountdown();
            }}
          />
        </OverlayManager>
      )}

      {!isMapReady && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-[#0f172a] text-white">
          <div className="flex flex-col items-center gap-4">
            <div className="w-20 h-20 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            <p className="font-bold tracking-widest animate-pulse">PREPARING MAP...</p>
          </div>
        </div>
      )}
    </div>
  );
};

const AppWrapper: React.FC = () => {
    // Persistent theme state logic to pass to PermissionGuard
    // during cold-start boot when profile might not be ready yet.
    const [theme, setTheme] = useState<'light' | 'dark'>(() => {
        const skin = localStorage.getItem('myway_map_skin');
        if (skin === 'default' || skin === 'warm_cream') return 'light';
        const saved = localStorage.getItem('myway_theme');
        return (saved as 'light' | 'dark') || 'dark';
    });

    return (
        <ErrorBoundary>
            <PermissionGuard theme={theme}>
                <App />
            </PermissionGuard>
        </ErrorBoundary>
    );
};

export default AppWrapper;
