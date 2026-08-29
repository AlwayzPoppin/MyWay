import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { FamilyMember, Place, DailyInsight, NavigationRoute, CircleTask, IncidentReport, PrivacyZone, Trip } from './types';
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
import IncidentReporter from './components/IncidentReporter';
import PrivacyPanel from './components/PrivacyPanel';
import PremiumUpsellModal from './components/PremiumUpsellModal';
// Audit #3: RewardsPanel removed — sponsored rewards deferred for MVP
import BottomSheet from './components/BottomSheet';
import QuickStopGrid from './components/QuickStopGrid';
import SafetyAlerts from './components/SafetyAlerts';
import QuickActions from './components/QuickActions';
import MessagingPanel from './components/MessagingPanel';
import SettingsPanel from './components/SettingsPanel';
import OfflineMapManager from './components/OfflineMapManager';
import BentoSidebar from './components/BentoSidebar';
import HoldToActivate from './components/HoldToActivate';
import LoginScreen from './components/LoginScreen';
import OnboardingFlow from './components/OnboardingFlow';
import PlaceDetailPanel from './components/PlaceDetailPanel';
import LoadingScreen from './components/LoadingScreen';
import { useAuth } from './contexts/AuthContext';
import { useUI } from './contexts/UIContext';
import OverlayManager, { OverlayStackProvider } from './components/OverlayManager';
import LegalConsentScreen, { hasLegalConsent } from './components/LegalConsentScreen';
import {
  getFamilyInsights,
  searchPlacesOnMap
} from './services/geminiService';
import { getRouteFromOSRM, geocodePlace } from './services/osrmService';
import { geolocationService } from './services/geolocationService';
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
  removeMember
} from './services/authService';
import { createCheckoutSession, goToBillingPortal } from './services/stripeService';
import { Geofence, GeofenceStatus, detectTransition } from './services/geofenceService';
import { getSafeAvatarUrl, getDefaultAvatarDataUri } from './utils/avatar';
// Audit #3: rewardsService removed
import { searchGasStations, searchCoffeeShops, searchRestaurants, searchGroceryStores, searchPlacesText } from './services/placesService';
import { subscribeToUserPlaces, UserPlace, addUserPlace, deleteUserPlace, updateUserPlace } from './services/userPlacesService';
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
import TripHistoryPanel from './components/TripHistoryPanel';
import { startCrashMonitoring, stopCrashMonitoring, cancelCrashCountdown, updateCrashDetectionSpeed } from './services/crashDetectionService';
import CrashCountdownOverlay from './components/CrashCountdownOverlay';
import CircleAdminPanel from './components/CircleAdminPanel';
import NotificationCenter, { addNotification, getUnreadCount, getNotifications, AppNotification } from './components/NotificationCenter';
import InviteShareModal from './components/InviteShareModal';
import WeeklySafetyReport from './components/WeeklySafetyReport';
import BatteryOptimizationPrompt, { shouldShowBatteryPrompt } from './components/BatteryOptimizationPrompt';
import KeyRecoveryPanel from './components/KeyRecoveryPanel';
import ErrorBoundary from './components/ErrorBoundary';
import PermissionGuard from './components/PermissionGuard';
import { convoyService, ConvoyInvite } from './services/convoyService';
import MaintenancePanel from './components/MaintenancePanel';

export type ActiveModal =
  | 'settings'
  | 'privacy'
  | 'quickstop'
  | 'upsell'
  | 'messaging'
  | 'offline_maps'
  | 'trip_history'
  | 'circle_admin'
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
    logout
  } = useAuth();

  const {
    theme, setTheme,
    isMobile,
    isDriveMode, setDriveMode,
    is3DMode, set3DMode,
    notification, showNotification
  } = useUI();

  const [activeModal, setActiveModal] = useState<ActiveModal | null>(null);

  const [isSearching, startSearchTransition] = React.useTransition();
  const [showOnboarding, setShowOnboarding] = useState(() => {
    return !localStorage.getItem('myway_onboarding_complete');
  });

  // --- CORE STATE ---
  const [isMapReady, setIsMapReady] = useState(false);
  const [currentCircle, setCurrentCircle] = useState<FamilyCircle | null>(null);
  const [isOwner, setIsOwner] = useState(false);
  const [userPlaces, setUserPlaces] = useState<UserPlace[]>([]);
  const [discoveredPlaces, setDiscoveredPlaces] = useState<Place[]>([]);
  const [safetyScore, setSafetyScore] = useState(100);
  const [sessionPoints, setSessionPoints] = useState(0);
  const [crashCountdown, setCrashCountdown] = useState<number | null>(null);
  const [etaSharing, setEtaSharing] = useState(false);
  const [actionBarExpanded, setActionBarExpanded] = useState(false);
  const [mapBounds, setMapBounds] = useState<{ north: number; south: number; east: number; west: number } | null>(null);
  const [mapZoom, setMapZoom] = useState(14);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [avgGasPrice, setAvgGasPrice] = useState('$3.45');
  const [hasInitiallyCentered, setHasInitiallyCentered] = useState(false);
  const [mapCenter, setMapCenter] = useState<[number, number] | undefined>(undefined);
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [messagingRecipientId, setMessagingRecipientId] = useState<string | null>(null);
  const [selectedPlace, setSelectedPlace] = useState<Place | null>(null);
  const [previewRoute, setPreviewRoute] = useState<NavigationRoute | null>(null);
  const [incomingConvoyInvite, setIncomingConvoyInvite] = useState<ConvoyInvite | null>(null);
  const [reviewedTrip, setReviewedTrip] = useState<Trip | null>(null);
  const [isBottomSheetExpanded, setIsBottomSheetExpanded] = useState(false);
  const [userSettings, setUserSettings] = useState({
    theme: 'dark' as 'light' | 'dark' | 'auto',
    notifications: true,
    locationSharing: true,
    batteryAlerts: true,
    arrivalAlerts: true,
    speedAlerts: false,
    mapStyle: 'standard' as 'standard' | 'satellite' | 'terrain',
    units: 'imperial' as 'imperial' | 'metric',
    mapSkin: ((localStorage.getItem('myway_map_skin') as any) || 'default') as 'default' | 'cyberpunk' | 'sunset' | 'midnight' | 'arctic' | 'forest',
    buildingScale: ((localStorage.getItem('myway_building_scale') as any) || 'enhanced') as 'realistic' | 'enhanced' | 'monumental',
    landmarkGlow: localStorage.getItem('myway_landmark_glow') !== 'false',
    avoidTolls: localStorage.getItem('myway_avoid_tolls') === 'true',
    avoidHighways: localStorage.getItem('myway_avoid_highways') === 'true'
  });

  const [showStylePicker, setShowStylePicker] = useState(false);
  const styleLongPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const didStyleLongPressRef = useRef(false);

  const [privacyZones] = useState<PrivacyZone[]>([]);
  const [incidents, setIncidents] = useState<IncidentReport[]>([]);
  const [insights, setInsights] = useState<DailyInsight[]>([]);
  const [activities, setActivities] = useState<AppNotification[]>([]);
  const logActivityRef = useRef<((type: AppNotification['type'], title: string, message: string, icon: string, memberId?: string) => void) | null>(null);
  const prevMembersRef = useRef<Record<string, { sosActive: boolean; battery: number; status: string }>>({});

  // Free-look camera state during navigation
  const [isCameraFree, setIsCameraFree] = useState(false);
  const handleRecenter = useCallback(() => {
    setIsCameraFree(false);
  }, []);

  // Define logActivity helper
  const logActivity = useCallback((
    type: AppNotification['type'],
    title: string,
    message: string,
    icon: string,
    memberId?: string
  ) => {
    const notif = addNotification(type, title, message, icon, memberId);
    setActivities(prev => [notif, ...prev.filter(a => a.id !== notif.id)]);
  }, []);

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
    return userPlaces.map(p => ({
      id: p.id,
      name: p.name,
      lat: p.location.lat,
      lng: p.location.lng,
      radius: (p.radius || 0.3) * 1000 // Convert km to meters
    }));
  }, [userPlaces]);

  const {
    members: liveMembers,
    setMembers,
    userLocation
  } = useLocationSync(
    user,
    profile,
    profile?.familyCircleId,
    mappedGeofences,
    (t) => {
      const isInside = t.to === 'INSIDE';
      const message = isInside ? `📍 Entered ${t.geofence.name}` : `🚶 Left ${t.geofence.name}`;
      showNotification(message, 5000);
      if (logActivityRef.current) {
        logActivityRef.current(
          isInside ? 'arrival' : 'departure',
          isInside ? 'Geofence Entry' : 'Geofence Exit',
          `${profile?.displayName || 'You'} ${isInside ? 'entered' : 'left'} ${t.geofence.name}`,
          isInside ? '📍' : '🚶',
          user?.uid
        );
      }
    }
  );

  const members = liveMembers;

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
    isNavigating,
    navState,
    betterRouteSuggestion,
    upcomingTollAlert,
    handleSwitchRoute,
    handleDismissReroute,
    handleTakeTollFreeExit,
    handleDismissTollAlert,
    handleStartNavigation,
    handleCancelNavigation,
    handleDiscovery,
    handleQuickSearch,
    setIsNavigating,
    setActiveRoute
  } = useNavigation(
    user,
    profile,
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

  // --- SIDE EFFECTS ---

  // Initialize activities from localStorage
  useEffect(() => {
    setActivities(getNotifications());
  }, []);

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
          logActivity('sos', 'Emergency SOS', `${member.name} triggered an Emergency SOS!`, '🚨', member.id);
        }
        // 2. Low Battery Alert
        if (currentBattery <= 20 && prev.battery > 20) {
          logActivity('safety', 'Low Battery', `${member.name}'s battery is low (${currentBattery}%)`, '🪫', member.id);
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
      const targetId = user?.uid || 'demo-you';
      setSelectedMemberId(targetId);
      setHasInitiallyCentered(true);
    }
  }, [userLocation, hasInitiallyCentered, user]);

  // Lifecycle & Deep Links
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const setup = async () => {
      CapacitorApp.addListener('appStateChange', ({ isActive }) => {
        if (!isActive) showNotification('MyWay: Running in background', 3000);
      });
      CapacitorApp.addListener('appUrlOpen', ({ url }) => {
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
      });
    };
    setup();
    return () => { CapacitorApp.removeAllListeners(); };
  }, [user, joinCircle, showNotification]);

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
    if (profile?.familyCircleId) {
      getFamilyCircle(profile.familyCircleId).then(circle => {
        setCurrentCircle(circle);
        setIsOwner(circle?.ownerId === user?.uid);
      });
    }
  }, [profile?.familyCircleId, user?.uid]);

  // Places Sync
  useEffect(() => {
    if (!user || !profile?.familyCircleId) {
      setUserPlaces([]);
      return;
    }
    const unsubscribe = subscribeToUserPlaces(profile.familyCircleId, (places) => {
      setUserPlaces(places);
    });
    return () => unsubscribe();
  }, [user?.uid, profile?.familyCircleId]);

  // Synchronize userPlaces with discoveredPlaces without blowing away search results
  useEffect(() => {
    setDiscoveredPlaces(prev => {
      // Keep any active search/discovered places that are not saved userPlaces
      const searchResults = prev.filter(p => p.type === 'search_result' || p.id.startsWith('photon-') || p.id.startsWith('nominatim-') || p.id.startsWith('overpass-'));
      // Combine updated userPlaces with existing search results
      return [...userPlaces, ...searchResults];
    });
  }, [userPlaces]);


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
  useEffect(() => {
    if (!user?.uid) return;

    let cleanup: (() => void) | undefined;
    import('./services/pushNotificationService').then(async ({ persistTokenToProfile, onForegroundMessage }) => {
      persistTokenToProfile(user.uid);
      cleanup = await onForegroundMessage((payload) => {
        const body = payload.notification?.body || 'New alert received';
        showNotification(body, 4000);
      });
    });

    return () => {
      if (cleanup) cleanup();
    };
  }, [user?.uid, showNotification]);

  // --- HANDLERS ---
  const handleSelectPlace = useCallback((place: Place) => {
    setSelectedMemberId(null);
    setSelectedPlace(place);
    setMapCenter([place.location.lat, place.location.lng]);
  }, []);

  const handleAddPlace = useCallback((place: Omit<Place, 'id'>) => {
    if (user && profile?.familyCircleId) {
      addUserPlace(profile.familyCircleId, { ...place, createdBy: user.uid }, user.uid);
      showNotification(`⭐ Saved "${place.name}" to Circle Geofences!`, 3000);
    } else {
      const newPlaceWithId: UserPlace = {
        ...place,
        id: `demo-place-${Date.now()}`,
        createdAt: Date.now(),
        createdBy: 'demo'
      };
      setUserPlaces(prev => [...prev, newPlaceWithId]);
      showNotification(`⭐ Saved "${place.name}" to Circle Geofences!`, 3000);
    }
  }, [user, profile, showNotification]);

  const handleDeletePlace = useCallback((placeId: string) => {
    if (profile?.familyCircleId) {
      deleteUserPlace(profile.familyCircleId, placeId);
      showNotification(`Removed place from circle`, 2500);
    } else {
      setUserPlaces(prev => prev.filter(p => p.id !== placeId));
      showNotification(`Removed place from circle`, 2500);
    }
  }, [profile, showNotification]);

  const handleSelectMember = useCallback((id: string) => {
    setSelectedMemberId(id);
    setMapCenter(undefined);
  }, []);

  const handleZoomChange = useCallback((zoom: number) => {
    setMapZoom(zoom);
  }, []);

  const handleMapInteraction = useCallback(() => {
    setSelectedMemberId(null);
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
    // 1. Update selected place state
    setSelectedPlace(prev => prev && prev.id === placeId ? { ...prev, radius } : prev);
    
    // 2. Update discovered places state so the geofence circle on the 3D Map updates live
    setDiscoveredPlaces(prev => prev.map(p => p.id === placeId ? { ...p, radius } : p));
    
    // 3. If place is a saved circle place, update local userPlaces and sync to Firebase
    const isSavedPlace = userPlaces.some(p => p.id === placeId);
    if (isSavedPlace) {
      setUserPlaces(prev => prev.map(p => p.id === placeId ? { ...p, radius } : p));
      if (user && profile?.familyCircleId) {
        updateUserPlace(profile.familyCircleId, placeId, { radius }).catch(err => {
          console.warn('Could not update saved place radius in DB:', err);
        });
      }
    }
  }, [user, profile, userPlaces]);

  const handleTriggerSOS = useCallback(() => {
    const memberName = profile?.displayName || user?.displayName || 'You';
    const memberId = user?.uid || 'demo-you';
    if (user && profile?.familyCircleId) {
      triggerSOS(profile.familyCircleId, user.uid);
      showNotification('🚨 SOS SENT!', 10000);
      logActivity('EMERGENCY', 'Emergency SOS', `${memberName} triggered an Emergency SOS`, '🚨', memberId);
      setMembers(prev => prev.map(m => m.id === user.uid ? { ...m, sosActive: true } : m));
    } else {
      showNotification('🚨 SOS SENT! (Demo Mode)', 10000);
      logActivity('EMERGENCY', 'Emergency SOS', `${memberName} triggered an Emergency SOS`, '🚨', memberId);
      setMembers(prev => prev.map(m => m.id === memberId ? { ...m, sosActive: true } : m));
    }
  }, [user, profile, showNotification, logActivity, setMembers]);

  const handleStylePointerDown = useCallback(() => {
    didStyleLongPressRef.current = false;
    if (styleLongPressTimerRef.current) clearTimeout(styleLongPressTimerRef.current);
    styleLongPressTimerRef.current = setTimeout(() => {
      didStyleLongPressRef.current = true;
      setShowStylePicker(prev => !prev);
    }, 500);
  }, []);

  const handleStylePointerUp = useCallback(() => {
    if (styleLongPressTimerRef.current) {
      clearTimeout(styleLongPressTimerRef.current);
      styleLongPressTimerRef.current = null;
    }
    if (!didStyleLongPressRef.current) {
      set3DMode(prev => !prev);
    }
  }, []);

  const handleStylePointerLeave = useCallback(() => {
    if (styleLongPressTimerRef.current) {
      clearTimeout(styleLongPressTimerRef.current);
      styleLongPressTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      if (styleLongPressTimerRef.current) {
        clearTimeout(styleLongPressTimerRef.current);
      }
    };
  }, []);

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
    return <LoadingScreen theme={theme as 'light' | 'dark'} />;
  }
 
  if (!user) {
    return (
      <LoginScreen
        theme={theme as 'light' | 'dark'}
        onSignInWithGoogle={signInWithGoogle}
        onSignInWithEmail={signInWithEmail}
        onSignUpWithEmail={signUpWithEmail}
        onSendMagicLink={sendMagicLink}
        magicLinkSent={emailLinkSent}
        loading={authLoading}
        error={authError}
        onClearError={clearError}
      />
    );
  }
 
  return (
    <div className={`flex flex-col h-full w-full overflow-hidden transition-all duration-700 ${theme === 'dark' ? 'bg-black' : 'bg-[#f1f5f9]'}`}>
      {!isDriveMode && null}

      <div className={`flex flex-1 relative overflow-hidden ${isMobile && !isDriveMode ? 'flex-col-reverse' : 'flex-row'}`}>
        {/* Desktop Sidebar - Bento Grid style */}
        {!isDriveMode && !isMobile && (
          <BentoSidebar
            members={members}
            selectedId={selectedMemberId}
            onSelect={setSelectedMemberId}
            theme={theme}
            hasCircle={!!profile?.familyCircleId}
            inviteCode={currentCircle?.inviteCode}
            onCreateCircle={createCircle}
            onJoinCircle={joinCircle}
            avgGasPrice={avgGasPrice}
            showNotification={showNotification}
            onOpenSettings={() => setActiveModal('settings')}
            onOpenTripHistory={() => setActiveModal('trip_history')}
            onOpenNotifications={() => setActiveModal('notifications')}
            onOpenWeeklyReport={() => setActiveModal('weekly_report')}
            onOpenInviteShare={() => setActiveModal('invite')}
            onSOS={handleManualSOS}
            activities={activities}
            onResolveSOS={handleResolveSOS}
            userPlaces={userPlaces}
            selectedPlaceId={selectedPlace?.id}
            onSelectPlace={handleSelectPlace}
            onAddPlace={handleAddPlace}
            onDeletePlace={handleDeletePlace}
            onNavigatePlace={(place: Place) => handleStartNavigation(place.name, place.location)}
            userLocation={userLocation}
            onOpenMaintenance={() => setActiveModal('maintenance')}
          />
        )}

        {/* Mobile-only Profile/Settings FAB - Desktop has this in sidebar */}
        {!isDriveMode && isMobile && !activeModal && !isBottomSheetExpanded && (
          <button
            onClick={() => setActiveModal('settings')}
            className="absolute top-6 left-6 z-[90] group flex items-center gap-3 transition-all duration-300"
          >
            <div className={`relative w-11 h-11 rounded-full border-2 overflow-hidden shadow-2xl transition-all duration-300
              ${theme === 'dark' ? 'bg-slate-800 border-white/20' : 'bg-white border-slate-200'}
              ${members[0]?.membershipTier === 'gold' ? 'border-amber-500' : ''}`}
            >
              <img
                src={getSafeAvatarUrl(members[0]?.avatar || user?.photoURL, profile?.displayName || user?.displayName || user?.uid || 'guest')}
                alt="Profile"
                className="w-full h-full object-cover"
                onError={(e) => {
                  (e.target as HTMLImageElement).src = getDefaultAvatarDataUri(profile?.displayName || user?.displayName || user?.uid || 'guest');
                }}
              />
            </div>
          </button>
        )}

        {/* Ghost Mode Active Banner - Audit UX Fix: prevents users from forgetting they're invisible */}
        {!isDriveMode && !activeModal && !isBottomSheetExpanded && members.find(m => m.id === user?.uid)?.isGhostMode && (
          <div
            className="absolute top-4 left-1/2 -translate-x-1/2 z-[95] px-4 py-2 rounded-full flex items-center gap-2 cursor-pointer shadow-lg backdrop-blur-md transition-all duration-300 animate-pulse"
            style={{
              background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.85), rgba(79, 70, 229, 0.85))',
              border: '1px solid rgba(255,255,255,0.2)'
            }}
            onClick={() => setActiveModal('privacy')}
          >
            <span className="text-lg">👻</span>
            <span className="text-white text-sm font-semibold tracking-wide">Ghost Mode Active</span>
            <span className="text-white/60 text-xs">• Tap to manage</span>
          </div>
        )}

        {/* Map and overlay container */}
        <div className="flex-1 relative overflow-hidden" style={{ perspective: is3DMode ? '1000px' : 'none' }}>
          {/* Map layer - z-0 to ensure overlays appear on top */}
          <div
            className="absolute inset-0 z-0 transition-transform duration-500"
            style={{
              transform: is3DMode ? 'none' : 'none', // MapLibre handles its own 3D transform
              transformOrigin: 'center center'
            }}
          >
            {/* UNIFIED MAP: Single MapLibre3DView handles both 2D and 3D modes */}
            <MapLibre3DView
              members={members}
              userLocation={userLocation}
              currentUserId={user?.uid || ''}
              theme={theme}
              mapSkin={userSettings.mapSkin}
              buildingScale={userSettings.buildingScale}
              landmarkGlow={userSettings.landmarkGlow}
              selectedMemberId={selectedMemberId}
              center={mapCenter ? [mapCenter[1], mapCenter[0]] : undefined}
              zoom={mapZoom}
              onZoomChange={handleZoomChange}
              onUserInteraction={handleMapInteraction}
              onMapReady={() => setIsMapReady(true)}
              activeRoute={activeRoute || previewRoute}
              places={discoveredPlaces}
              incidents={incidents}
              privacyZones={privacyZones}
              tasks={[]}
              tripSafetyEvents={reviewedTrip?.driveEvents || []}
              is3DMode={is3DMode}
              isNavigating={isNavigating || isDriveMode}
              currentStepIndex={navState.currentStepIndex}
              splitIndex={navState.splitIndex}
              onSelectPlace={handleSelectPlace}
              onSelectMember={handleSelectMember}
              onBoundsChange={setMapBounds}
              mapStyle={userSettings.mapStyle}
              isMobile={isMobile}
              isCameraFree={isCameraFree}
              onCameraFreeChange={setIsCameraFree}
            />
          </div>

          {/* UI Overlays - z-10 and above to appear over the map */}
          {notification && (
            <div className="absolute top-20 left-1/2 -translate-x-1/2 z-[110] animate-in slide-in-from-top">
              <div className="bg-amber-500 text-black px-6 py-3 rounded-full shadow-2xl font-black text-xs border-2 border-white/20">
                {notification}
              </div>
            </div>
          )}

          {/* Real-time Caravan / Convoy Invite Banner */}
          {incomingConvoyInvite && (
            <div className="fixed top-4 inset-x-4 max-w-md mx-auto z-[250] bg-slate-900/98 border-2 border-purple-500 rounded-3xl p-4 shadow-[0_20px_50px_rgba(168,85,247,0.4)] backdrop-blur-2xl animate-in slide-in-from-top duration-300 text-white pointer-events-auto">
              <div className="flex items-start gap-3">
                <div className="w-12 h-12 rounded-2xl bg-purple-600/30 border border-purple-400/50 flex items-center justify-center text-2xl shrink-0 animate-bounce">
                  🚗🚗
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
                      <span>🚀</span> Join & Follow Route
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
                  onDismiss={(id) => console.log('Dismissed:', id)}
                  onSendReminder={(memberId, type) => {
                    showNotification(`📱 Sent ${type === 'charge' ? 'charge reminder' : 'check-in request'}!`, 3000);
                  }}
                  theme={theme}
                />
              </div>
            </OverlayManager>
          )}

          {isDriveMode && activeRoute && activeRoute.steps && activeRoute.steps.length > 0 ? (
            <OverlayManager>
              <DriveModeHUD
                route={activeRoute}
                onCancel={handleCancelNavigation}
                speed={members.find(m => m.id === user?.uid)?.speed || 0}
                theme={theme}
                stepIndex={navState.currentStepIndex}
                safetyScore={safetyScore}
                sessionPoints={sessionPoints}
                isMobile={isMobile}
                betterRouteSuggestion={betterRouteSuggestion}
                onSwitchRoute={handleSwitchRoute}
                onDismissReroute={handleDismissReroute}
                upcomingTollAlert={upcomingTollAlert}
                onTakeTollFreeExit={handleTakeTollFreeExit}
                onDismissTollAlert={handleDismissTollAlert}
                members={members}
                userLocation={userLocation}
                currentUserId={user?.uid || ''}
                isCameraFree={isCameraFree}
                onRecenter={handleRecenter}
              />
            </OverlayManager>
          ) : (
            <>


              {/* QuickStopGrid / Saved Places modal */}
              {activeModal === 'quickstop' && (
                <QuickStopGrid
                  onSearch={handleDiscovery}
                  onClose={() => setActiveModal(null)}
                  theme={theme}
                  userPlaces={userPlaces}
                  onSelectPlace={handleSelectPlace}
                  onNavigatePlace={(place: Place) => handleStartNavigation(place.name, place.location)}
                  onAddPlace={handleAddPlace}
                  userLocation={userLocation}
                  members={members}
                />
              )}

              {activeModal === 'upsell' && <PremiumUpsellModal onClose={() => setActiveModal(null)} onUpgrade={handleUpgrade} theme={theme} />}

              {/* Audit #3: RewardsPanel removed */}

              {activeModal === 'privacy' && (
                <OverlayManager>
                  <div className={`absolute z-[90] transition-all duration-500 ${isMobile ? 'inset-x-0 bottom-28 p-4' : 'left-8 top-32 w-80'}`}>
                    <PrivacyPanel
                      zones={[]}
                      isGhostMode={members.find(m => m.id === user?.uid)?.isGhostMode || false}
                      onToggleGhost={() => handleToggleGhost(user?.uid || '')}
                      onClose={() => setActiveModal(null)}
                      theme={theme}
                    />
                  </div>
                </OverlayManager>
              )}

              {/* Member detail panel - desktop only, mobile uses BottomSheet */}
              {selectedMemberId && activeModal !== 'privacy' && !isMobile && (() => {
                const selectedMember = members.find(m => m.id === selectedMemberId);
                return selectedMember ? (
                  <OverlayManager>
                    <div className="absolute z-[80] right-6 top-6 w-84 max-w-[360px] flex flex-col gap-4 pointer-events-auto animate-in slide-in-from-right-4 duration-300">
                      <MemberDetailPanel
                        member={selectedMember}
                        onClose={() => setSelectedMemberId(null)}
                        onToggleGhost={selectedMemberId === user?.uid ? () => handleToggleGhost(user?.uid || '') : undefined}
                        theme={theme}
                      />
                      {/* Audit Round 5: Integrated QuickActions */}
                      <QuickActions
                        member={selectedMember}
                        isCurrentUser={selectedMemberId === user?.uid}
                        onMessage={() => {
                          setMessagingRecipientId(selectedMember.id);
                          setActiveModal('messaging');
                          setSelectedMemberId(null);
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
                        onCall={() => showNotification(`📞 Calling ${selectedMember.name}...`, 3000)}
                        onNavigateTo={() => handleStartNavigation(selectedMember.name, selectedMember.location)}
                        onSOS={handleManualSOS}
                        theme={theme}
                      />
                    </div>
                  </OverlayManager>
                ) : null;
              })()}

              {/* Mobile Member Detail — compact floating card when marker tapped */}
              {selectedMemberId && !activeModal && !isBottomSheetExpanded && isMobile && (() => {
                const selectedMember = members.find(m => m.id === selectedMemberId);
                if (!selectedMember) return null;
                const isSelf = selectedMember.id === user?.uid || selectedMember.id === 'demo-you';

                return (
                  <OverlayManager>
                    <div className="absolute z-[120] inset-x-0 bottom-40 px-3">
                      <div className={`rounded-2xl shadow-2xl border backdrop-blur-xl p-3.5 ${
                        theme === 'dark' ? 'bg-slate-900/98 border-white/10' : 'bg-white/98 border-slate-200'
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
                              className="w-11 h-11 rounded-full object-cover border-2 border-indigo-500 shadow-md bg-slate-800"
                            />
                            {isSelf && (
                              <span className="absolute -bottom-1 -right-1 text-[8px] font-black px-1 rounded-full bg-indigo-600 text-white border border-slate-900">
                                YOU
                              </span>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <div className={`font-bold text-sm truncate ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>
                                {selectedMember.name}
                              </div>
                              {selectedMember.privacyMode === 'blurred' && (
                                <span className="text-[8px] font-black px-1 rounded bg-purple-500/20 text-purple-300">
                                  👻 Blur
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-slate-500 flex items-center gap-2">
                              <span>{selectedMember.status}</span>
                              <span>•</span>
                              <span>🔋 {selectedMember.battery}%</span>
                              {selectedMember.speed > 0 && <><span>•</span><span>{Math.round(selectedMember.speed)} mph</span></>}
                            </div>
                          </div>
                          <button
                            onClick={() => setSelectedMemberId(null)}
                            className={`w-8 h-8 rounded-full flex items-center justify-center ${
                              theme === 'dark' ? 'bg-white/10 text-slate-400' : 'bg-slate-100 text-slate-500'
                            }`}
                          >✕</button>
                        </div>

                        {/* Row 2: Action buttons */}
                        {!isSelf ? (
                          <div className="grid grid-cols-4 gap-2">
                            <button
                              onClick={() => {
                                setMessagingRecipientId(selectedMember.id);
                                setActiveModal('messaging');
                                setSelectedMemberId(null);
                              }}
                              className="py-2.5 rounded-xl bg-purple-500/20 text-purple-400 text-xs font-bold active:scale-95 transition-all flex items-center justify-center gap-1"
                            >
                              <span>💬</span> Message
                            </button>
                            <button
                              onClick={() => showNotification(`📞 Calling ${selectedMember.name}...`, 3000)}
                              className="py-2.5 rounded-xl bg-blue-500/20 text-blue-400 text-xs font-bold active:scale-95 transition-all flex items-center justify-center gap-1"
                            >
                              <span>📞</span> Call
                            </button>
                            <button
                              onClick={() => { handleStartNavigation(selectedMember.name, selectedMember.location); setSelectedMemberId(null); }}
                              className="py-2.5 rounded-xl bg-indigo-500/20 text-indigo-400 text-xs font-bold active:scale-95 transition-all flex items-center justify-center gap-1"
                            >
                              <span>🧭</span> Nav
                            </button>
                            <button
                              onClick={() => showNotification(`✨ Sent 👋 to ${selectedMember.name}`, 2000)}
                              className="py-2.5 rounded-xl bg-amber-500/20 text-amber-400 text-xs font-bold active:scale-95 transition-all flex items-center justify-center gap-1"
                            >
                              <span>👋</span> Wave
                            </button>
                          </div>
                        ) : (
                          <div className="grid grid-cols-3 gap-2">
                            <button
                              onClick={() => {
                                logActivity('arrival', 'Check-In', `${selectedMember.name} checked in: I'm Safe`, '✨', selectedMember.id);
                                showNotification(`✅ Checked in: I'm Safe`, 3000);
                              }}
                              className="py-2.5 rounded-xl bg-emerald-500/20 text-emerald-400 text-xs font-bold active:scale-95 transition-all flex items-center justify-center gap-1 shadow-sm"
                            >
                              <span>✨</span> Check In
                            </button>
                            <button
                              onClick={() => {
                                handleToggleGhost(user?.uid || '');
                              }}
                              className="py-2.5 rounded-xl bg-purple-500/20 text-purple-300 text-xs font-bold active:scale-95 transition-all flex items-center justify-center gap-1"
                            >
                              <span>👻</span> Privacy
                            </button>
                            <button
                              onClick={() => {
                                setActiveModal('settings');
                                setSelectedMemberId(null);
                              }}
                              className="py-2.5 rounded-xl bg-indigo-500/20 text-indigo-400 text-xs font-bold active:scale-95 transition-all flex items-center justify-center gap-1"
                            >
                              <span>🚗</span> Garage
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </OverlayManager>
                );
              })()}

              {/* Place detail panel */}
              {selectedPlace && !isMobile && !activeModal && (
                <OverlayManager>
                  <div className="absolute z-[80] right-6 top-6 w-84 max-w-[360px] pointer-events-auto animate-in slide-in-from-right-4 duration-300">
                    <PlaceDetailPanel
                      place={userPlaces.find(p => p.id === selectedPlace.id) || selectedPlace}
                      candidatePlaces={discoveredPlaces.filter(p => p.type === 'search_result')}
                      onSelectCandidate={handleSelectPlace}
                      onClose={() => {
                        setSelectedPlace(null);
                        setPreviewRoute(null);
                      }}
                      onNavigate={(selectedRoute) => {
                        handleStartNavigation(selectedPlace.name, selectedPlace.location, selectedRoute);
                        setSelectedPlace(null);
                        setPreviewRoute(null);
                      }}
                      onSelectRoutePreview={(route) => setPreviewRoute(route)}
                      theme={theme}
                      userLocation={userLocation}
                      onUpdateRadius={handleUpdatePlaceRadius}
                      isSaved={userPlaces.some(p => p.id === selectedPlace.id || (p.location.lat === selectedPlace.location.lat && p.location.lng === selectedPlace.location.lng))}
                      onAddPlace={handleAddPlace}
                      onDeletePlace={handleDeletePlace}
                      members={liveMembers}
                      currentUserId={user?.uid}
                    />
                  </div>
                </OverlayManager>
              )}

              {/* Unified Command Center - Bottom Center Single Bar */}
              {!activeModal && !selectedPlace && !isBottomSheetExpanded && (
                <OverlayManager>
                  <div className={`absolute left-1/2 -translate-x-1/2 w-full max-w-2xl z-40 px-4 pointer-events-auto ${isMobile ? 'bottom-24' : 'bottom-12'}`}>
                    <SearchBox
                      onSearch={(q) => handleDiscovery(q, handleSelectPlace)}
                      onNavigate={handleStartNavigation}
                      onCategorySearch={handleQuickSearch}
                      onLocate={() => {
                        const targetId = user?.uid || 'demo-you';
                        setSelectedMemberId(targetId);
                        setMapCenter(undefined); // Reset specific search center to follow user
                        showNotification("📍 Centered on your location", 2000);
                      }}
                      onQuickStop={() => setActiveModal('quickstop')}
                      theme={theme}
                      userPlaces={userPlaces}
                      onSelectSavedPlace={handleSelectPlace}
                      onSelectPlace={handleSelectPlace}
                      userLocation={userLocation}
                    />
                  </div>
                </OverlayManager>
              )}

              {/* Safety Insights - Repositioned to Top Center Drawer as per Audit */}
              {!activeModal && !isBottomSheetExpanded && (
                <OverlayManager>
                  <div className={`absolute left-1/2 -translate-x-1/2 z-50 ${isMobile ? 'top-4 w-auto max-w-[90%]' : 'top-6 w-auto'}`}>
                    <InsightsBar
                      insights={insights}
                      theme={theme}
                      onReconnect={() => {
                        showNotification("🔄 Attempting to reconnect...", 3000);
                        setTimeout(() => setIsOffline(false), 1500);
                      }}
                    />
                  </div>
                </OverlayManager>
              )}
            </>
          )}

          {/* Action Hub — Unified vertical pill */}
          {!activeModal && !isBottomSheetExpanded && (
            <OverlayManager>
              <div className={`absolute flex flex-col items-end z-[60] pointer-events-auto ${isMobile ? 'top-4 right-4' : 'bottom-40 right-6'}`}>

                {/* Unified Action Cluster */}
                <div className="flex flex-col gap-2 p-1.5 bg-black/40 backdrop-blur-md rounded-[1.5rem] border border-white/10 shadow-2xl relative">

                  {/* 3D Mode / Map Style — tap toggles 3D, long-press opens style picker */}
                  <div className="relative">
                    <button
                      onPointerDown={handleStylePointerDown}
                      onPointerUp={handleStylePointerUp}
                      onPointerLeave={handleStylePointerLeave}
                      className={`w-11 h-11 rounded-2xl flex items-center justify-center transition-all select-none
                        ${is3DMode ? 'bg-amber-500 text-white shadow-lg' : 'bg-white/5 text-slate-500'}`}
                      title="Tap: 3D Mode • Hold: Map Style"
                    >
                      <span className="text-xl">🗺️</span>
                    </button>

                    {/* Map Style Radial Picker — slides out to the left */}
                    {showStylePicker && (
                      <div className="absolute right-14 top-1/2 -translate-y-1/2 flex items-center gap-1.5 bg-black/70 backdrop-blur-xl rounded-full p-1.5 border border-white/10 shadow-2xl animate-in slide-in-from-right duration-200">
                        {[
                          { id: 'standard' as const, label: '🗺️', name: 'Standard' },
                          { id: 'satellite' as const, label: '🛰️', name: 'Satellite' },
                          { id: 'terrain' as const, label: '⛰️', name: 'Terrain' },
                        ].map(opt => (
                          <button
                            key={opt.id}
                            onClick={() => {
                              setUserSettings(prev => ({ ...prev, mapStyle: opt.id }));
                              setShowStylePicker(false);
                            }}
                            className={`w-10 h-10 rounded-full flex flex-col items-center justify-center transition-all
                              ${userSettings.mapStyle === opt.id
                                ? 'bg-indigo-500 text-white ring-2 ring-indigo-400/50 scale-110'
                                : 'bg-white/5 text-slate-400 hover:bg-white/10 hover:text-white'}`}
                            title={opt.name}
                          >
                            <span className="text-base leading-none">{opt.label}</span>
                            <span className="text-[7px] font-black tracking-tight leading-none mt-0.5 opacity-80">{opt.name.slice(0, 3).toUpperCase()}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <button
                    onClick={() => {
                      setMessagingRecipientId(null);
                      setActiveModal('messaging');
                    }}
                    className="w-11 h-11 rounded-2xl bg-white/5 text-slate-300 flex items-center justify-center hover:bg-white/10 transition-all"
                    title="Family Chat & DMs"
                  >
                    <span className="text-xl">💬</span>
                  </button>
                  <HoldToActivate
                    onActivate={handleTriggerSOS}
                    duration={2000}
                    className={`w-11 h-11 rounded-2xl flex items-center justify-center transition-all shadow-lg ring-2 relative select-none overflow-hidden ${
                      members.find(m => m.id === user?.uid)?.sosActive
                        ? 'bg-red-700 animate-bounce ring-red-400'
                        : 'bg-red-600/80 hover:bg-red-700 active:scale-95 ring-red-500/50'
                    }`}
                  >
                    <span className="text-xl relative z-10" title="Hold for SOS">🛡️</span>
                  </HoldToActivate>
                </div>
              </div>
            </OverlayManager>
          )}

          {/* Messaging Panel */}
          {activeModal === 'messaging' && (
            <OverlayManager>
              {/* Audit #4: On mobile during navigation, show chat in bottom half so HUD stays visible */}
              <div className={`absolute z-[150] pointer-events-auto ${isMobile 
                ? (isNavigating ? 'inset-x-4 bottom-4 top-[50%]' : 'inset-4')
                : 'right-6 bottom-6 w-96 h-[500px]'
              }`}>
                <MessagingPanel
                  members={members}
                  currentUserId={user?.uid || ''}
                  circleId={profile?.familyCircleId}
                  initialRecipientId={messagingRecipientId}
                  onClose={() => {
                    setActiveModal(null);
                    setMessagingRecipientId(null);
                  }}
                  theme={theme}
                />
              </div>
            </OverlayManager>
          )}

          {/* Settings Panel */}
          {activeModal === 'settings' && (
            <OverlayManager>
              <div className={`absolute z-[150] flex flex-col pointer-events-auto ${isMobile ? 'inset-4' : 'right-6 top-20 w-96 h-[calc(100vh-120px)]'}`}>
                <SettingsPanel
                  settings={userSettings}
                  onUpdateSettings={(newSettings) => {
                    setUserSettings(newSettings);
                    if (newSettings.theme !== 'auto') {
                      setTheme(newSettings.theme);
                    }
                    if (newSettings.mapSkin) {
                      localStorage.setItem('myway_map_skin', newSettings.mapSkin);
                    }
                    if (newSettings.buildingScale) {
                      localStorage.setItem('myway_building_scale', newSettings.buildingScale);
                    }
                    if (typeof newSettings.landmarkGlow === 'boolean') {
                      localStorage.setItem('myway_landmark_glow', String(newSettings.landmarkGlow));
                    }
                  }}
                  onClose={() => setActiveModal(null)}
                  onOpenOfflineMaps={() => setActiveModal('offline_maps')}
                  theme={theme}
                  userName={profile?.displayName || user?.displayName || 'User'}
                  userAvatar={profile?.photoURL || user?.photoURL || ''}
                  onUpgrade={() => setActiveModal('upsell')}
                  isPremium={profile?.membershipTier === 'gold' || profile?.membershipTier === 'platinum'}
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
                      
                      showNotification('👤 Profile updated successfully!', 3000);
                    } catch (err: any) {
                      showNotification(`❌ Update failed: ${err.message}`, 5000);
                      throw err;
                    }
                  }}
                  onSignOut={() => {
                    logout();
                  }}
                  onManageSubscription={async () => {
                    try {
                      await goToBillingPortal();
                    } catch (err: any) {
                      showNotification(`❌ ${err.message}`, 5000);
                    }
                  }}
                  onShowPrivacy={() => window.open('https://myway-gps.com/privacy', '_blank')}
                  onManageCircle={async () => {
                    try {
                      if (user?.uid && currentCircle?.id) {
                        const { leaveCircle } = await import('./services/authService');
                        if (window.confirm('Are you sure you want to leave this circle?')) {
                          await leaveCircle(currentCircle.id, user.uid);
                          setCurrentCircle(null);
                          showNotification('👋 Left circle', 3000);
                        }
                      }
                    } catch (err: any) {
                      showNotification(`❌ ${err.message}`, 5000);
                    }
                  }}
                  onOpenKeyRecovery={() => setActiveModal('key_recovery')}
                />
              </div>
            </OverlayManager>
          )}

          {/* Offline Maps Panel */}
          {activeModal === 'offline_maps' && (
            <OverlayManager>
              <div className={`absolute z-[200] pointer-events-auto ${isMobile ? 'inset-4' : 'right-6 bottom-6 w-96'}`}>
                <OfflineMapManager
                  currentBounds={mapBounds}
                  userLocation={userLocation}
                  theme={theme}
                  onClose={() => setActiveModal(null)}
                />
              </div>
            </OverlayManager>
          )}

          {/* Trip History Panel */}
          {activeModal === 'trip_history' && (
            <OverlayManager>
              <div className={`absolute z-[200] pointer-events-auto ${isMobile ? 'inset-4' : 'right-6 top-20 w-[420px] max-h-[calc(100vh-120px)]'}`}>
                <div className="glass-panel rounded-2xl overflow-hidden max-h-full">
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
                </div>
              </div>
            </OverlayManager>
          )}

          {/* Circle Admin Panel */}
          {activeModal === 'circle_admin' && (
            <OverlayManager>
              <div className={`absolute z-[200] pointer-events-auto ${isMobile ? 'inset-4' : 'right-6 top-20 w-[420px] max-h-[calc(100vh-120px)]'}`}>
                <div className="glass-panel rounded-2xl overflow-hidden max-h-full">
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
                    theme={theme}
                  />
                </div>
              </div>
            </OverlayManager>
          )}

          {/* Notification Center */}
          {activeModal === 'notifications' && (
            <OverlayManager>
              <div className={`absolute z-[200] pointer-events-auto ${isMobile ? 'inset-4' : 'right-6 top-20 w-[400px] max-h-[calc(100vh-120px)]'}`}>
                <div className="glass-panel rounded-2xl overflow-hidden max-h-full">
                  <NotificationCenter
                    onClose={() => setActiveModal(null)}
                    onBack={() => setActiveModal('settings')}
                    theme={theme}
                  />
                </div>
              </div>
            </OverlayManager>
          )}

          {/* Weekly Safety Report */}
          {activeModal === 'weekly_report' && (
            <OverlayManager>
              <div className={`absolute z-[200] pointer-events-auto ${isMobile ? 'inset-4' : 'right-6 top-20 w-[420px] max-h-[calc(100vh-120px)]'}`}>
                <div className="glass-panel rounded-2xl overflow-hidden max-h-full">
                  <WeeklySafetyReport
                    onClose={() => setActiveModal(null)}
                    onBack={() => setActiveModal('settings')}
                    memberName={profile?.name || members[0]?.name}
                    theme={theme}
                  />
                </div>
              </div>
            </OverlayManager>
          )}

          {/* Invite Share Modal */}
          {activeModal === 'invite' && currentCircle?.inviteCode && (
            <InviteShareModal
              inviteCode={currentCircle.inviteCode}
              circleName={currentCircle.name}
              onClose={() => setActiveModal(null)}
              onBack={() => setActiveModal('settings')}
              showNotification={showNotification}
              theme={theme}
            />
          )}

          {/* Key Recovery Panel */}
          {activeModal === 'key_recovery' && (
            <OverlayManager>
              <div className={`absolute z-[200] pointer-events-auto ${isMobile ? 'inset-4' : 'right-6 bottom-6 w-96'}`}>
                <div className={`rounded-3xl overflow-hidden shadow-2xl border ${
                  theme === 'dark' ? 'bg-slate-900/95 border-white/10' : 'bg-white/95 border-slate-200'
                }`}>
                  <KeyRecoveryPanel
                    uid={user?.uid || ''}
                    onClose={() => setActiveModal(null)}
                    onBack={() => setActiveModal('settings')}
                    showNotification={showNotification}
                    theme={theme}
                  />
                </div>
              </div>
            </OverlayManager>
          )}

          {/* My Maintenance Panel — Vehicle expenses, mileage, gig driver tracking */}
          {activeModal === 'maintenance' && (
            <MaintenancePanel
              theme={theme}
              onClose={() => setActiveModal(null)}
            />
          )}

          {/* Battery Optimization Prompt (Android only, after onboarding) */}
          {activeModal === 'battery_prompt' && (
            <BatteryOptimizationPrompt
              onDismiss={() => setActiveModal(null)}
              theme={theme}
            />
          )}
        </div>
      </div>

      {/* Mobile Bottom Sheet - replaces sidebar on mobile */}
      {
        isMobile && !isDriveMode && !activeModal && (
          <BottomSheet
            isExpanded={isBottomSheetExpanded}
            onExpandedChange={setIsBottomSheetExpanded}
            members={members}
            selectedId={selectedMemberId}
            onSelect={setSelectedMemberId}
            theme={theme}
            hasCircle={!!profile?.familyCircleId}
            inviteCode={currentCircle?.inviteCode}
            onCreateCircle={createCircle}
            onJoinCircle={joinCircle}
            avgGasPrice={avgGasPrice}
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
              setActiveModal('invite');
            }}
            onOpenMaintenance={() => {
              setIsBottomSheetExpanded(false);
              setActiveModal('maintenance');
            }}
            onSOS={handleManualSOS}
            activities={activities}
            onResolveSOS={handleResolveSOS}
            userPlaces={userPlaces}
            selectedPlaceId={selectedPlace?.id}
            onSelectPlace={(place) => {
              setIsBottomSheetExpanded(false);
              handleSelectPlace(place);
            }}
            onAddPlace={handleAddPlace}
            onDeletePlace={handleDeletePlace}
            onNavigatePlace={(place: Place) => handleStartNavigation(place.name, place.location)}
            userLocation={userLocation}
          />
        )
      }

      {/* Mobile Place Detail Bottom Sheet */}
      {isMobile && selectedPlace && !isDriveMode && !activeModal && !isBottomSheetExpanded && (
        <OverlayManager>
          <div className="absolute z-[150] inset-x-0 bottom-0 pointer-events-auto">
            <PlaceDetailPanel
              place={userPlaces.find(p => p.id === selectedPlace.id) || selectedPlace}
              candidatePlaces={discoveredPlaces.filter(p => p.type === 'search_result')}
              onSelectCandidate={handleSelectPlace}
              onClose={() => {
                setSelectedPlace(null);
                setPreviewRoute(null);
              }}
              onNavigate={(selectedRoute) => {
                handleStartNavigation(selectedPlace.name, selectedPlace.location, selectedRoute);
                setSelectedPlace(null);
                setPreviewRoute(null);
              }}
              onSelectRoutePreview={(route) => setPreviewRoute(route)}
              theme={theme}
              userLocation={userLocation}
              isMobile={true}
              onUpdateRadius={handleUpdatePlaceRadius}
              isSaved={userPlaces.some(p => p.id === selectedPlace.id || (p.location.lat === selectedPlace.location.lat && p.location.lng === selectedPlace.location.lng))}
              onAddPlace={handleAddPlace}
              onDeletePlace={handleDeletePlace}
              members={liveMembers}
              currentUserId={user?.uid}
            />
          </div>
        </OverlayManager>
      )}

      {/* Crash Detection Countdown Overlay */}
      {crashCountdown !== null && (
        <OverlayManager priority={10}>
          <CrashCountdownOverlay
            remainingSeconds={crashCountdown}
            onDismiss={() => cancelCrashCountdown()}
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
    // Audit #5: Persistent theme state logic to pass to PermissionGuard
    // during cold-start boot when profile might not be ready yet.
    const [theme, setTheme] = useState<'light' | 'dark'>(() => {
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
