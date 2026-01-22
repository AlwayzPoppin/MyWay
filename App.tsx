
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { FamilyMember, Place, DailyInsight, NavigationRoute, CircleTask, IncidentReport, PrivacyZone, Reward } from './types';
// Sidebar removed - replaced by BentoSidebar
import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import MapView from './components/MapView';
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
import RewardsPanel from './components/RewardsPanel';
import BottomSheet from './components/BottomSheet';
import QuickStopGrid from './components/QuickStopGrid';
import SafetyAlerts from './components/SafetyAlerts';
import QuickActions from './components/QuickActions';
import MessagingPanel from './components/MessagingPanel';
import SettingsPanel from './components/SettingsPanel';
import OfflineMapManager from './components/OfflineMapManager';
import BentoSidebar from './components/BentoSidebar';
import LoginScreen from './components/LoginScreen';
import OnboardingFlow from './components/OnboardingFlow';
import PlaceDetailPanel from './components/PlaceDetailPanel';
import { useAuth } from './contexts/AuthContext';
import { useUI } from './contexts/UIContext';
import OverlayManager from './components/OverlayManager';
import {
  getFamilyInsights,
  searchPlacesOnMap,
  getSafetyAdvisory,
  getRouteToDestination,
  SafetyAdvisory
} from './services/geminiService';
import { getRouteFromOSRM, geocodePlace } from './services/osrmService';
import { geolocationService } from './services/geolocationService';
import {
  updateMemberLocation,
  subscribeToFamilyLocations,
  getCircleMembers,
  getFamilyCircle,
  FamilyCircle,
  subscribeToGeofences,
  addGeofence,
  updateUserProfile,
  getUserProfile,
  deliverWrappedKey,
  getWrappedKeyForUser,
  triggerSOS,
  clearSOS
} from './services/authService';
import { createCheckoutSession, goToBillingPortal } from './services/stripeService';
import { Geofence, GeofenceStatus, detectTransition } from './services/geofenceService';
import { sendArrivalAlert, sendDepartureAlert } from './services/emailService';
import { subscribeToRewards, seedRewards } from './services/rewardsService';
import { searchGasStations, searchCoffeeShops, searchRestaurants, searchGroceryStores } from './services/placesService';
import { subscribeToUserPlaces, UserPlace, addUserPlace, deleteUserPlace } from './services/userPlacesService';
import { subscribeSponsoredPlaces, seedSponsoredPlaces, SponsoredPlace } from './services/sponsoredPlacesService';
import { updateNavigationState, NavigationState } from './services/navigationEngine';
import {
  encryptLocation,
  decryptLocation,
  getFuzzyLocation,
  generateFamilyKey,
  setFamilyKey,
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
import { startMeshHeartbeat, subscribeToMesh, MeshNode } from './services/meshService';
import { audioService } from './services/audioService';
import { SUBSCRIPTION_TIERS } from './config/subscriptions';
import { useLocationSync } from './hooks/useLocationSync';
import { useCoPilot } from './hooks/useCoPilot';
import { getWeather, WeatherData } from './services/weatherService';

// SPONSORED_PLACES now loaded from Firebase - see useEffect below

// Demo data purged for real-world transition
const DEMO_MEMBERS: FamilyMember[] = [];
const DEMO_PLACES: Place[] = [];


// Rewards are now loaded from Firebase - see useEffect below

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
    isUpsellOpen, setUpsellOpen,
    isRewardsOpen, setRewardsOpen,
    isPrivacyOpen, setPrivacyOpen,
    isQuickStopOpen, setQuickStopOpen,
    isMessagingOpen, setMessagingOpen,
    isSettingsOpen, setSettingsOpen,
    isOfflineMapsOpen, setOfflineMapsOpen,
    isDriveMode, setDriveMode,
    is3DMode, set3DMode,
    notification, showNotification
  } = useUI();

  const [isSearching, startSearchTransition] = React.useTransition();
  const [showOnboarding, setShowOnboarding] = useState(() => {
    return !localStorage.getItem('myway_onboarding_complete');
  });
  const [isMapReady, setIsMapReady] = useState(false);

  const [geofences, setGeofences] = useState<Geofence[]>([]);
  const [memberStatuses, setMemberStatuses] = useState<Record<string, GeofenceStatus>>({});
  const [weather, setWeather] = useState<WeatherData>({ temp: 72, condition: 'Sunny', icon: '☀️' });
  const lastWeatherUpdateRef = useRef<{ lat: number; lng: number; time: number }>({ lat: 0, lng: 0, time: 0 });
  const userLocationRef = useRef<{ lat: number; lng: number } | null>(null); // For stable weather polling

  // --- HOOKS ---
  const {
    members: liveMembers,
    setMembers, // Exposed for manual updates if needed (e.g. ghost mode toggles)
    locationError,
    userLocation
  } = useLocationSync(
    user,
    profile,
    profile?.familyCircleId,
    geofences,
    (t) => {
      const message = t.to === 'INSIDE' ? `📍 Entered ${t.geofence.name}` : `🚶 Left ${t.geofence.name}`;
      showNotification(message, 5000);
    }
  );

  // Resolution logic: Prefer live data, fallback to empty (GPS will populate 'you' via hook)
  const members = liveMembers;


  // Auto-center effect (now derived from hook state)
  const [hasInitiallyCentered, setHasInitiallyCentered] = useState(false);
  const [mapCenter, setMapCenter] = useState<[number, number] | undefined>(undefined);
  useEffect(() => {
    if (userLocation && !hasInitiallyCentered) {
      const targetId = user?.uid || 'demo-you';
      setSelectedMemberId(targetId);
      setHasInitiallyCentered(true);
    }
  }, [userLocation, hasInitiallyCentered, user]);

  // Background Persistence & Lifecycle (Audit Recommendation)
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    const setupBackgroundListeners = async () => {
      // 1. App State Listener
      CapacitorApp.addListener('appStateChange', ({ isActive }) => {
        if (!isActive) {
          // When backgrounded, ensure location service continues in persistent mode
          // Native BackgroundGeolocation plugin handles the heavy lifting
          showNotification('MyWay: Running in background', 3000);
        }
      });

      // 2. Handle background navigation resume if needed
      // This is a placeholder for deep-link or notification-action resume
    };

    setupBackgroundListeners();

    return () => {
      CapacitorApp.removeAllListeners();
    };
  }, []);

  const membersRef = useRef<FamilyMember[]>([]);
  // Keep membersRef in sync for legacy references
  useEffect(() => {
    membersRef.current = members;
  }, [members]);
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [privacyZones] = useState<PrivacyZone[]>([]);
  const [sponsoredPlaces, setSponsoredPlaces] = useState<SponsoredPlace[]>([]);
  const [userPlaces, setUserPlaces] = useState<UserPlace[]>([]);
  const [discoveredPlaces, setDiscoveredPlaces] = useState<Place[]>([]);
  const [incidents, setIncidents] = useState<IncidentReport[]>([]);
  const [insights, setInsights] = useState<DailyInsight[]>([]);
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [selectedPlace, setSelectedPlace] = useState<Place | null>(null);
  const [activeRoute, setActiveRoute] = useState<NavigationRoute | null>(null);
  const [navState, setNavState] = useState<NavigationState>({
    currentStepIndex: 0,
    distanceToNextStep: 0,
    isOffRoute: false,
    hasArrived: false
  });
  // Ref pattern to avoid infinite loops: effect reads ref, only triggers on location/route changes
  const navStateRef = useRef(navState);
  useEffect(() => { navStateRef.current = navState; }, [navState]);
  const [isNavigating, setIsNavigating] = useState(false);
  const { activeAdvisory: coPilotAdvisory } = useCoPilot(user, isNavigating, members);
  const [meshNodes, setMeshNodes] = useState<MeshNode[]>([]);
  const [safetyScore, setSafetyScore] = useState(100);
  const [sessionPoints, setSessionPoints] = useState(0);
  const [isVoiceEnabled, setIsVoiceEnabled] = useState(true);
  const [isReporting, setIsReporting] = useState(false);
  const [mapBounds, setMapBounds] = useState<{ north: number; south: number; east: number; west: number } | null>(null);
  const [mapZoom, setMapZoom] = useState(14); // Synced zoom between 2D/3D modes
  const [userSettings, setUserSettings] = useState({
    theme: 'dark' as 'light' | 'dark' | 'auto',
    notifications: true,
    locationSharing: true,
    batteryAlerts: true,
    arrivalAlerts: true,
    speedAlerts: false,
    mapStyle: 'standard' as 'standard' | 'satellite' | 'terrain',
    units: 'imperial' as 'imperial' | 'metric',
    aiPersonality: 'standard' as 'standard' | 'grok' | 'newyork',
    aiGender: 'female' as 'male' | 'female',
    mapSkin: 'default' as 'default' | 'cyberpunk' | 'sunset' | 'midnight' | 'arctic' | 'forest'
  });

  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [avgGasPrice, setAvgGasPrice] = useState('$3.45');

  // PERFORMANCE: Memoized callbacks for map components to preserve React.memo optimization
  // Without these, inline arrow functions create new references on every render,
  // breaking memoization and causing expensive map redraws on each GPS update
  const handleSelectPlace = useCallback((place: Place) => {
    setSelectedMemberId(null);
    setSelectedPlace(place);
    setMapCenter([place.location.lat, place.location.lng]);
  }, []);

  const handleSelectMember = useCallback((id: string) => {
    setSelectedMemberId(id);
    setMapCenter(undefined);
  }, []);

  // Zoom sync callback for 2D/3D mode switching
  const handleZoomChange = useCallback((zoom: number) => {
    setMapZoom(zoom);
  }, []);

  const handleMapInteraction = useCallback(() => {
    setSelectedMemberId(null);
    setMapCenter(undefined);
  }, []);

  // Online/Offline listeners
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

  // Offline insight persistence
  useEffect(() => {
    if (isOffline) {
      setInsights(prev => {
        if (prev.some(i => i.category === 'System')) return prev;
        return [{
          id: 'offline-status',
          category: 'System',
          title: 'System Offline',
          description: 'Connectivity lost. Some features may be limited.',
          priority: 'high',
          type: 'alert'
        }, ...prev];
      });
    } else {
      setInsights(prev => prev.filter(i => i.id !== 'offline-status'));
    }

    // Forensic Fix: Force 2D mode when offline to prevent raster/vector incompatibility
    if (isOffline && is3DMode) {
      set3DMode(false);
      showNotification('Map switched to 2D for offline reliability', 3000);
    }
  }, [isOffline, is3DMode, set3DMode, showNotification]);

  const geofenceStatesRef = useRef<Record<string, Record<string, GeofenceStatus>>>({}); // { memberId: { geofenceId: 'INSIDE' | 'OUTSIDE' } }
  const profilesRef = useRef<Record<string, any>>({}); // Store profile info like email for fast lookup
  // Keep membersRef in sync (Handled by hook now, but removing older dup definition)


  const [currentCircle, setCurrentCircle] = useState<FamilyCircle | null>(null);
  const [ecdhKeyPair, setEcdhKeyPair] = useState<CryptoKeyPair | null>(null);
  const [isOwner, setIsOwner] = useState(false);

  // Sync settings to Audio Service
  useEffect(() => {
    audioService.updateSettings({
      personality: userSettings.aiPersonality,
      gender: userSettings.aiGender
    });
  }, [userSettings.aiPersonality, userSettings.aiGender]);


  // Fetch circle data if in one
  useEffect(() => {
    if (profile?.familyCircleId) {
      getFamilyCircle(profile.familyCircleId).then(circle => {
        setCurrentCircle(circle);
        setIsOwner(circle?.ownerId === user?.uid);
      });
    }
  }, [profile?.familyCircleId, user?.uid]);


  // Load rewards from Firebase
  useEffect(() => {
    const unsubscribe = subscribeToRewards((firebaseRewards) => {
      if (firebaseRewards.length > 0) {
        setRewards(firebaseRewards);
      } else {
        // Seed initial rewards if none exist
        seedRewards();
      }
    });
    return () => unsubscribe();
  }, []);

  // Load sponsored places from Firebase
  useEffect(() => {
    const unsubscribe = subscribeSponsoredPlaces((places) => {
      if (places.length > 0) {
        setSponsoredPlaces(places);
      } else {
        // Seed default sponsored places if none exist
        seedSponsoredPlaces();
      }
    });
    return () => unsubscribe();
  }, []);

  // Load user places from Firebase (or use demo places if not authenticated)
  useEffect(() => {
    if (!user || !profile?.familyCircleId) {
      // Demo mode: use hardcoded demo places
      setUserPlaces(DEMO_PLACES.map(p => ({ ...p, createdAt: Date.now(), createdBy: 'demo' })));
      return;
    }

    const unsubscribe = subscribeToUserPlaces(profile.familyCircleId, (places) => {
      setUserPlaces(places);
    });
    return () => unsubscribe();
  }, [user?.uid, profile?.familyCircleId, userLocation]);

  // Combine places for map display
  useEffect(() => {
    setDiscoveredPlaces([...sponsoredPlaces, ...userPlaces]);
  }, [sponsoredPlaces, userPlaces]);

  // Live Weather Updates
  // Audit Fix: Keep ref in sync with userLocation to avoid effect re-running on every GPS update
  useEffect(() => {
    userLocationRef.current = userLocation;
  }, [userLocation]);

  useEffect(() => {
    // Initial check - only run if we've ever had a location
    if (!userLocationRef.current) return;

    const fetchWeather = async () => {
      const loc = userLocationRef.current;
      if (!loc) return;

      const now = Date.now();
      const moved = Math.sqrt(Math.pow(loc.lat - lastWeatherUpdateRef.current.lat, 2) + Math.pow(loc.lng - lastWeatherUpdateRef.current.lng, 2)) * 111.32;

      const shouldFetch = lastWeatherUpdateRef.current.time === 0 || moved > 5 || (now - lastWeatherUpdateRef.current.time) > 1800000;

      if (shouldFetch) {
        console.log(`🌤️ Weather: Fetching for [${loc.lat}, ${loc.lng}] (Initial: ${lastWeatherUpdateRef.current.time === 0})`);
        const data = await getWeather(loc.lat, loc.lng);
        console.log(`🌤️ Weather Result: ${data.temp}°F ${data.condition}`);
        setWeather(data);
        lastWeatherUpdateRef.current = { lat: loc.lat, lng: loc.lng, time: now };
      }
    };

    fetchWeather();
    const interval = setInterval(fetchWeather, 600000); // Check every 10 mins (stable, not reset by GPS updates)
    return () => clearInterval(interval);
  }, []); // Empty deps - interval is stable, uses ref for current location


  // --- ADVANCED E2EE ORCHESTRATION ---
  useEffect(() => {
    if (!user) return;

    const initE2EE = async () => {
      // 1. Try to load local ECDH KeyPair from persistent storage
      let keys = ecdhKeyPair;

      if (!keys) {
        // Migration + Load from Secure Storage (IndexedDB)
        const savedKeys = await loadKeyPairFromSecureStorage(user.uid);
        if (savedKeys) {
          try {
            keys = await importKeyPairJWK(savedKeys);
            console.log("🔐 Restored E2EE Keys from Secure Storage (IndexedDB)");
          } catch (e) {
            console.error("Failed to restore keys from IDB", e);
          }
        }

        // Check legacy localStorage for migration
        const legacyKeys = localStorage.getItem(`myway_ecdh_${user.uid}`);
        if (!keys && legacyKeys) {
          try {
            const jwk = JSON.parse(legacyKeys);
            keys = await importKeyPairJWK(jwk);
            await saveKeyPairToSecureStorage(user.uid, jwk);
            localStorage.removeItem(`myway_ecdh_${user.uid}`);
            console.log("🔐 Migrated E2EE Keys from LocalStorage to Secure Storage");
          } catch (e) {
            console.error("Migration failed", e);
          }
        }
      }

      // 2. Generate new keys if none found or restored
      if (!keys) {
        keys = await generateECDHKeyPair();
        const jwk = await exportKeyPairJWK(keys);
        await saveKeyPairToSecureStorage(user.uid, jwk);
        console.log("🔐 Generated and persisted new E2EE Keys in Secure Storage");
      }

      setEcdhKeyPair(keys);

      // 3. Sync Public Key to Profile
      const pubKeyBase64 = await exportPublicKey(keys.publicKey);
      if (profile && profile.ecdhPublicKey !== pubKeyBase64) {
        updateUserProfile(user.uid, { ecdhPublicKey: pubKeyBase64 });
      }

      // 4. OWNER LOGIC: Retrieve existing key or generate new one
      if (isOwner && currentCircle) {
        const circleMembers = await getCircleMembers(currentCircle.id);

        // CRITICAL FIX: First check if owner already has a wrapped key (persisted from previous session)
        // This prevents generating a new key on every app load which would make old data undecryptable
        getWrappedKeyForUser(currentCircle.id, user.uid, async (existingWrapped) => {
          let circleKey: CryptoKey;

          if (existingWrapped) {
            // Retrieve existing key - derive shared secret with ourselves (owner-to-owner)
            const sharedSecret = await deriveSharedSecretKey(keys.privateKey, keys.publicKey);
            circleKey = await unwrapCircleKey(existingWrapped, sharedSecret);
            console.log('🔐 E2EE: Retrieved existing circle key');
          } else {
            // No existing key - generate new one and wrap for ourselves
            circleKey = await generateFamilyKey();
            const selfSharedSecret = await deriveSharedSecretKey(keys.privateKey, keys.publicKey);
            const selfWrapped = await wrapCircleKey(circleKey, selfSharedSecret);
            await deliverWrappedKey(currentCircle.id, user.uid, selfWrapped);
            console.log('🔐 E2EE: Generated and stored new circle key');
          }

          setFamilyKey(circleKey);

          // Distribute to other members
          for (const member of circleMembers) {
            if (member.uid !== user.uid && member.ecdhPublicKey) {
              const memberPubKey = await importPublicKey(member.ecdhPublicKey);
              const sharedSecret = await deriveSharedSecretKey(keys.privateKey, memberPubKey);
              const wrapped = await wrapCircleKey(circleKey, sharedSecret);
              await deliverWrappedKey(currentCircle.id, member.uid, wrapped);
            }
          }
        });
      }

      // 5. MEMBER LOGIC: Wait for key delivery from owner
      if (!isOwner && currentCircle) {
        getWrappedKeyForUser(currentCircle.id, user.uid, async (wrapped) => {
          const ownerProfile = await getUserProfile(currentCircle.ownerId);
          if (ownerProfile?.ecdhPublicKey && keys) {
            const ownerPubKey = await importPublicKey(ownerProfile.ecdhPublicKey);
            const sharedSecret = await deriveSharedSecretKey(keys.privateKey, ownerPubKey);
            const unwrapped = await unwrapCircleKey(wrapped, sharedSecret);
            setFamilyKey(unwrapped);
          }
        });
      }
    };

    initE2EE();
  }, [user?.uid, profile?.familyCircleId, isOwner, !!currentCircle, profile, currentCircle]);


  // Sync Audio Service state
  useEffect(() => {
    audioService.setEnabled(isVoiceEnabled);
  }, [isVoiceEnabled]);

  // Initialize members from auth profile
  useEffect(() => {
    if (user && profile) {
      const savedLKL = localStorage.getItem('myway_last_known_location');
      let initialLoc = { lat: 0, lng: 0 }; // Clean start

      if (savedLKL) {
        try {
          initialLoc = JSON.parse(savedLKL);
          console.log("📍 LKL: Restored last known location on startup");
        } catch (e) {
          console.warn("Failed to parse LKL", e);
        }
      }

      setMembers([
        {
          id: user.uid,
          name: profile.displayName || 'You',
          role: 'Primary',
          avatar: profile.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.uid}&backgroundColor=b6e3f4`,
          location: initialLoc,
          battery: 100,
          speed: 0,
          lastUpdated: savedLKL ? 'Recently' : 'Searching for GPS...',
          status: 'Offline',
          safetyScore: 98,
          pathHistory: [],
          driveEvents: [],
          membershipTier: (profile as any).membershipTier || 'free',
          wayType: 'NoWay'
        }
      ]);

      // If user is in a circle, fetch other members
      if (profile.familyCircleId) {
        getCircleMembers(profile.familyCircleId).then(profiles => {
          const otherMembers: FamilyMember[] = profiles
            .filter(p => p.uid !== user.uid)
            .map(p => ({
              id: p.uid,
              name: p.displayName || 'Family Member',
              role: 'Member',
              avatar: p.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${p.uid}&backgroundColor=c0aede`,
              location: { lat: 0, lng: 0 },
              battery: 0,
              speed: 0,
              lastUpdated: 'Never',
              status: 'Offline',
              safetyScore: 100,
              pathHistory: [],
              driveEvents: [],
              membershipTier: 'free',
              wayType: 'HisWay'
            }));

          setMembers(prev => [...prev.filter(m => m.id === user.uid), ...otherMembers]);

          // Populate profilesRef with member emails
          profiles.forEach(p => {
            profilesRef.current[p.uid] = p;
          });
        });

        // Logic moved to useLocationSync hook

      }

      // Also store current user profile in ref
      profilesRef.current[user.uid] = profile;

      // Sync theme from profile
      if (profile.settings?.theme && profile.settings.theme !== 'auto') {
        setTheme(profile.settings.theme as 'light' | 'dark');
        setUserSettings(prev => ({ ...prev, theme: profile.settings.theme }));
      }
    }
  }, [user, profile, setMembers, setTheme]);

  // Subscribe to Geofences
  useEffect(() => {
    if (profile?.familyCircleId) {
      const unsubscribe = subscribeToGeofences(profile.familyCircleId, (circlesGeofences) => {
        setGeofences(circlesGeofences);
      });
      return () => unsubscribe();
    }
  }, [profile?.familyCircleId, user?.uid]);


  // Proactive AI Co-Pilot loop (Hook)
  const { activeAdvisory } = useCoPilot(user, isNavigating, members);

  // Mesh P2P Continuity Loop (Upgraded to Firebase-backed Relays)
  useEffect(() => {
    if (!user || !profile?.familyCircleId) return;

    // Use current location from profile or fallback to center
    const currentLoc = profile.location || { lat: 37.7749, lng: -122.4194 };

    // Start our own heartbeat
    const stopHeartbeat = startMeshHeartbeat(profile.familyCircleId, user.uid, currentLoc);

    // Subscribe to others
    const unsubscribe = subscribeToMesh(profile.familyCircleId, user.uid, currentLoc, (node) => {
      setMeshNodes(prev => {
        const filtered = prev.filter(n => n.id !== node.id);
        return [...filtered, node];
      });
    });

    return () => {
      stopHeartbeat();
      unsubscribe();
    };
  }, [user?.uid, profile?.familyCircleId, profile?.location?.lat]);



  // NOTE: isMobile resize handling is now in UIContext

  // --- Navigation Engine Integration (Modular) ---
  // FIX: Use navStateRef to avoid infinite loop - effect reads from ref, only triggers on location/route changes
  useEffect(() => {
    if (isNavigating && activeRoute && userLocation) {
      const currentNavState = navStateRef.current;
      const newNavState = updateNavigationState(userLocation, activeRoute, currentNavState);

      // Only update if something actually changed
      if (newNavState.currentStepIndex === currentNavState.currentStepIndex &&
        newNavState.isOffRoute === currentNavState.isOffRoute &&
        newNavState.hasArrived === currentNavState.hasArrived) {
        return; // No change, skip update
      }

      if (newNavState.currentStepIndex !== currentNavState.currentStepIndex) {
        showNotification(`🔜 Next: ${activeRoute.steps[newNavState.currentStepIndex].instruction}`, 4000);
      }

      if (newNavState.hasArrived && !currentNavState.hasArrived) {
        showNotification(`🎯 You have arrived at your destination!`, 6000);

        // Phase 4: Award Safety Points
        const earned = Math.floor(safetyScore / 5);
        setSessionPoints(earned);
        setRewards(prev => [...prev, {
          id: `safety_${Date.now()}`,
          title: 'Safe Drive Completion',
          description: `Earned for maintaining a ${safetyScore}% safety score.`,
          points: earned,
          category: 'Transportation',
          expiryDate: 'Never',
          status: 'AVAILABLE',
          partner: 'MyWay Safety'
        }]);

        audioService.speak(`You have arrived. Safety score: ${safetyScore} percent. You earned ${earned} points.`);

        // Reset navigation
        setTimeout(() => {
          setDriveMode(false);
          setIsNavigating(false);
          setActiveRoute(null);
        }, 5000);
      }

      setNavState(newNavState);
    }
  }, [userLocation, isNavigating, activeRoute, safetyScore, showNotification]); // Removed navState from deps

  // --- Geofence Logic (Modular) ---
  useEffect(() => {
    if (members.length > 0 && geofences.length > 0) {
      members.forEach(member => {
        // IGNORE: Members waiting for their first real signal (prevents alerting on demo coords)
        if (member.lastUpdated === 'Waiting for signal...') return;

        const memberGeofenceStates = geofenceStatesRef.current[member.id] || {};
        geofences.forEach(geofence => {
          const isKnown = !!memberGeofenceStates[geofence.id];
          const previousStatus = memberGeofenceStates[geofence.id] || 'OUTSIDE';
          const transition = detectTransition(member.location, geofence, previousStatus);

          if (transition) {
            if (!geofenceStatesRef.current[member.id]) {
              geofenceStatesRef.current[member.id] = {};
            }
            geofenceStatesRef.current[member.id][geofence.id] = transition.to;

            // PRIME: If this is the first time we've seen this member/geofence combo, 
            // DON'T alert. Just record the state. This fixes "Cold Start" noise.
            if (!isKnown) {
              console.log(`📍 Geofence Primary: Initialized ${member.name} as ${transition.to} for ${geofence.name}`);
              return;
            }

            // Trigger alerts
            const recipients = members.map(m => m.id === member.id ? '' : (profilesRef.current[m.id]?.email || '')).filter(e => e !== '');

            if (transition.to === 'INSIDE') {
              showNotification(`🏠 ${member.name} reached ${geofence.name}!`, 5000);
              if (recipients.length > 0) {
                sendArrivalAlert(recipients, member.name, geofence.name).catch(console.error);
              }
            } else {
              showNotification(`🚗 ${member.name} left ${geofence.name}.`, 5000);
              if (recipients.length > 0) {
                sendDepartureAlert(recipients, member.name, geofence.name).catch(console.error);
              }
            }
          }
        });
      });
    }
  }, [members, geofences, showNotification]);

  useEffect(() => {
    if (members.length === 0) return;

    const fetchInsights = async () => {
      const results = await getFamilyInsights(members);
      setInsights(results || []);
    };

    fetchInsights();
    const interval = setInterval(fetchInsights, 600000); // 10 minutes
    return () => clearInterval(interval);
  }, [members.length]);

  const handleToggleGhost = useCallback((memberId: string) => {
    setMembers(prev => prev.map(m => m.id === memberId ? { ...m, isGhostMode: !m.isGhostMode } : m));
  }, [setMembers]);

  const handleUpgrade = useCallback(async (tierId: string) => {
    try {
      const tier = SUBSCRIPTION_TIERS[tierId];
      if (!tier) return;

      showNotification(`🚀 Preparing your ${tier.name}...`, 5000);
      const checkoutUrl = await createCheckoutSession(tier.priceId);
      window.location.href = checkoutUrl;
    } catch (err: any) {
      showNotification(`❌ Error: ${err.message}`, 5000);
    }
  }, [showNotification]);

  const handleDiscovery = useCallback((query: string) => {
    if (members.length === 0) return;
    startSearchTransition(async () => {
      const results = await searchPlacesOnMap(query, members[0].location);
      setDiscoveredPlaces([...sponsoredPlaces, ...userPlaces, ...results]);

      if (results.length > 0) {
        // Find best match - if we searched for an address, it's usually the first result
        const topResult = results[0];

        // Smarter heuristic: If the query is long or has numbers, it's likely an address search
        // In that case, we should fly the map to the result
        const isLikelySpecific = query.length > 8 || /\d/.test(query);

        if (isLikelySpecific) {
          showNotification(`📍 Found ${topResult.name}`, 3000);
          // Set center (Standardize to [lng, lat] internally for App state if possible, or convert per map)
          // Let's use [lat, lng] for internal App state as it's more common in GPS logic
          setMapCenter([topResult.location.lat, topResult.location.lng]);
          setSelectedMemberId(null); // Clear selected member to allow centering on the search
        }
      }
    });
  }, [members, sponsoredPlaces, userPlaces, showNotification]);

  // Quick search handlers for category buttons (GAS, COFFEE, FOOD, GROCERY)
  const handleQuickSearch = useCallback((type: 'gas' | 'coffee' | 'food' | 'grocery') => {
    if (members.length === 0) return;
    const location = members[0].location;

    startSearchTransition(async () => {
      let results: Place[] = [];
      try {
        switch (type) {
          case 'gas':
            results = await searchGasStations(location);
            break;
          case 'coffee':
            results = await searchCoffeeShops(location);
            break;
          case 'food':
            results = await searchRestaurants(location);
            break;
          case 'grocery':
            results = await searchGroceryStores(location);
            break;
        }
      } catch (error) {
        console.warn('Places API error, falling back to Gemini:', error);
      }

      // If no results from Places API, fallback to Gemini search
      if (results.length === 0) {
        const query = type === 'gas' ? 'gas station' : type === 'coffee' ? 'coffee shop' : type === 'food' ? 'restaurant' : 'grocery store';
        results = await searchPlacesOnMap(query, location);
      }

      setDiscoveredPlaces([...sponsoredPlaces, ...userPlaces, ...results]);
    });
  }, [members, sponsoredPlaces, userPlaces]);

  const handleStartNavigation = useCallback(async (dest: string) => {
    if (members.length === 0) return;

    try {
      showNotification(`🧭 Preparing navigation...`, 5000);

      // Guard: Prevent navigation starting from Africa (0,0)
      if (members[0].location.lat === 0 && members[0].location.lng === 0) {
        showNotification("⚠️ Still waiting for high-precision GPS lock. Please wait a moment...", 4000);
        return;
      }

      // First, geocode the destination to get coordinates
      const destLocation = await geocodePlace(dest);
      if (!destLocation) {
        showNotification("❌ Could not find destination. Please try a different address.", 4000);
        return;
      }

      let route: NavigationRoute | null = null;

      // AUDIT FIX: Try OSRM first, fallback to Gemini AI if it fails
      try {
        route = await getRouteFromOSRM(members[0].location, dest, destLocation);
      } catch (osrmError) {
        console.warn('⚠️ OSRM routing failed, falling back to Gemini:', osrmError);
        showNotification('🔄 Primary routing failed, trying AI backup...', 3000);
      }

      // Fallback: Use Gemini AI routing if OSRM failed
      if (!route || !route.steps || route.steps.length === 0) {
        try {
          route = await getRouteToDestination(members[0].location, dest, members);
          if (route) {
            console.log('✅ Fallback to Gemini AI routing succeeded');
          }
        } catch (geminiError) {
          console.error('❌ Both OSRM and Gemini routing failed:', geminiError);
        }
      }

      if (!route || !route.steps) {
        showNotification("❌ Could not calculate route. Please try again.", 4000);
        return;
      }

      setActiveRoute(route);
      setNavState({
        currentStepIndex: 0,
        distanceToNextStep: 0,
        isOffRoute: false,
        hasArrived: false
      });
      setDriveMode(true);
      setIsNavigating(true);
      set3DMode(true); // VisionQA: Trigger 3D Fly-to on Navigation Start
    } catch (error) {
      console.error("Navigation startup error:", error);
      showNotification("❌ Failed to start navigation.", 3000);
    }
  }, [members, showNotification]);

  // NEW: Automatic Rerouting Detection (Audit Round 5)
  useEffect(() => {
    if (isNavigating && navState.isOffRoute && activeRoute) {
      console.warn("Off route detected! Triggering automatic rerouting...");
      showNotification("🔄 Off route! Recalculating...", 4000);
      handleStartNavigation(activeRoute.destinationName);
    }
  }, [isNavigating, navState.isOffRoute, activeRoute, handleStartNavigation, showNotification]);

  if (authLoading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-[#050914] text-white">
        <div className="flex flex-col items-center gap-4">
          <div className="w-16 h-16 border-4 border-amber-500 border-t-transparent rounded-full animate-spin" />
          <p className="font-bold tracking-widest animate-pulse">LOADING MY WAY...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <LoginScreen
        theme={theme}
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

  // Show onboarding for first-time users
  if (showOnboarding) {
    return (
      <OnboardingFlow
        theme={theme}
        onComplete={() => setShowOnboarding(false)}
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
            onOpenSettings={() => setSettingsOpen(true)}
            weather={weather}
          />
        )}

        {/* Mobile-only Profile/Settings FAB - Desktop has this in sidebar */}
        {!isDriveMode && isMobile && (
          <button
            onClick={() => setSettingsOpen(true)}
            className="absolute top-4 left-4 z-[90] group flex items-center gap-3 transition-all duration-300"
          >
            <div className={`relative w-11 h-11 rounded-full border-2 overflow-hidden shadow-2xl transition-all duration-300
              ${theme === 'dark' ? 'bg-slate-800 border-white/20' : 'bg-white border-slate-200'}
              ${members[0]?.membershipTier === 'gold' ? 'border-amber-500' : ''}`}
            >
              <img
                src={members[0]?.avatar || user?.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${user?.uid}`}
                alt="Profile"
                className="w-full h-full object-cover"
              />
            </div>
          </button>
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
            {is3DMode ? (
              <MapLibre3DView
                members={members}
                theme={theme}
                mapSkin={userSettings.mapSkin}
                selectedMemberId={selectedMemberId}
                center={mapCenter ? [mapCenter[1], mapCenter[0]] : undefined} // MapLibre needs [lng, lat]
                zoom={mapZoom}
                onZoomChange={handleZoomChange}
                onUserInteraction={handleMapInteraction}
                onMapReady={() => setIsMapReady(true)}
                activeRoute={activeRoute}
                places={discoveredPlaces}
                incidents={incidents}
                privacyZones={privacyZones}
              />
            ) : (
              <MapView
                members={members}
                places={discoveredPlaces}
                tasks={[]}
                incidents={incidents}
                privacyZones={privacyZones}
                selectedMemberId={selectedMemberId}
                activeRoute={activeRoute}
                isNavigating={isNavigating || isDriveMode}
                theme={theme}
                onSelectPlace={handleSelectPlace}
                onSelectMember={handleSelectMember}
                onBoundsChange={setMapBounds}
                onUserInteraction={handleMapInteraction}
                onMapReady={() => setIsMapReady(true)}
                center={mapCenter} // MapView (Leaflet) needs [lat, lng]
                zoom={mapZoom}
                onZoomChange={handleZoomChange}
                is3DMode={false}
              />
            )}
          </div>

          {/* UI Overlays - z-10 and above to appear over the map */}
          {notification && (
            <div className="absolute top-20 left-1/2 -translate-x-1/2 z-[110] animate-in slide-in-from-top">
              <div className="bg-amber-500 text-black px-6 py-3 rounded-full shadow-2xl font-black text-xs border-2 border-white/20">
                {notification}
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
                onCancel={() => {
                  setDriveMode(false);
                  setIsNavigating(false);
                  setActiveRoute(null);
                }}
                speed={members.find(m => m.id === user?.uid)?.speed || 0}
                theme={theme}
                stepIndex={navState.currentStepIndex}
                advisory={activeAdvisory}
                safetyScore={safetyScore}
                sessionPoints={sessionPoints}
              />
            </OverlayManager>
          ) : (
            <>


              {/* QuickStopGrid modal */}
              {isQuickStopOpen && (
                <QuickStopGrid
                  onSearch={handleDiscovery}
                  onClose={() => setQuickStopOpen(false)}
                  theme={theme}
                />
              )}

              {isUpsellOpen && <PremiumUpsellModal onClose={() => setUpsellOpen(false)} onUpgrade={handleUpgrade} theme={theme} />}

              {isRewardsOpen && (
                <OverlayManager>
                  <div className={`absolute z-[90] transition-all duration-500 ${isMobile ? 'inset-x-0 bottom-28 p-4' : 'left-8 top-32 w-80'}`}>
                    <RewardsPanel rewards={rewards} onClose={() => setRewardsOpen(false)} theme={theme} />
                  </div>
                </OverlayManager>
              )}

              {isPrivacyOpen && (
                <OverlayManager>
                  <div className={`absolute z-[90] transition-all duration-500 ${isMobile ? 'inset-x-0 bottom-28 p-4' : 'left-8 top-32 w-80'}`}>
                    <PrivacyPanel
                      zones={[]}
                      isGhostMode={members.find(m => m.id === user?.uid)?.isGhostMode || false}
                      onToggleGhost={() => handleToggleGhost(user?.uid || '')}
                      onClose={() => setPrivacyOpen(false)}
                      theme={theme}
                    />
                  </div>
                </OverlayManager>
              )}

              {/* Member detail panel - desktop only, mobile uses BottomSheet */}
              {/* Member detail panel - desktop only, mobile uses BottomSheet */}
              {selectedMemberId && !isPrivacyOpen && !isRewardsOpen && !isMobile && (() => {
                const selectedMember = members.find(m => m.id === selectedMemberId);
                return selectedMember ? (
                  <OverlayManager>
                    <div className="absolute z-[80] left-8 top-32 w-80 flex flex-col gap-4">
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
                        onCheckIn={() => showNotification(`✅ Check-in request sent to ${selectedMember.name}`, 3000)}
                        onSendEmoji={(emoji) => showNotification(`✨ Sent ${emoji} to ${selectedMember.name}`, 2000)}
                        onCall={() => showNotification(`📞 Calling ${selectedMember.name}...`, 3000)}
                        onNavigateTo={() => handleStartNavigation(selectedMember.name)}
                        theme={theme}
                      />
                    </div>
                  </OverlayManager>
                ) : null;
              })()}

              {/* Place detail panel */}
              {selectedPlace && !isMobile && (
                <OverlayManager>
                  <div className="absolute z-[80] left-8 top-32 w-80">
                    <PlaceDetailPanel
                      place={selectedPlace}
                      onClose={() => setSelectedPlace(null)}
                      onNavigate={() => {
                        handleStartNavigation(selectedPlace.name);
                        setSelectedPlace(null);
                      }}
                      theme={theme}
                    />
                  </div>
                </OverlayManager>
              )}

              {/* Unified Command Center - Bottom Center Single Bar */}
              <OverlayManager>
                <div className={`absolute left-1/2 -translate-x-1/2 w-full max-w-2xl z-40 px-4 ${isMobile ? 'bottom-20' : 'bottom-10'}`}>
                  <SearchBox
                    onSearch={handleDiscovery}
                    onNavigate={handleStartNavigation}
                    onCategorySearch={handleQuickSearch}
                    onLocate={() => {
                      const targetId = user?.uid || 'demo-you';
                      setSelectedMemberId(targetId);
                      setMapCenter(undefined); // Reset specific search center to follow user
                      showNotification("📍 Centered on your location", 2000);
                    }}
                    onQuickStop={() => setQuickStopOpen(true)}
                    theme={theme}
                  />
                </div>
              </OverlayManager>

              {/* Safety Insights - Repositioned to Top Center Drawer as per Audit */}
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
            </>
          )}

          {/* Action Hub - Grouped Clusters shifted higher to avoid taskbar */}
          <OverlayManager>
            <div className={`absolute flex flex-col items-end gap-6 z-[60] ${isMobile ? 'top-4 right-4' : 'bottom-40 right-6'}`}>

              {/* Mesh Status (If active) */}
              {meshNodes.length > 0 && (
                <div className="bg-indigo-500/90 backdrop-blur-md text-white border border-white/20 p-2 rounded-2xl shadow-2xl animate-pulse flex flex-col items-center mb-2">
                  <span className="text-[10px] font-black uppercase tracking-tighter">MESH SIMULATED</span>
                  <div className="flex gap-2 items-baseline">
                    <span className="text-xl font-black">{meshNodes.length}</span>
                    <span className="text-[9px] font-bold opacity-70">NODES</span>
                  </div>
                </div>
              )}

              {/* Cluster 1: Intelligence & Navigation */}
              <div className="flex flex-col gap-2 p-1.5 bg-black/40 backdrop-blur-md rounded-[1.5rem] border border-white/10 shadow-2xl">
                <button
                  onClick={() => setIsVoiceEnabled(!isVoiceEnabled)}
                  className={`w-11 h-11 rounded-2xl flex items-center justify-center transition-all
                    ${isVoiceEnabled ? 'bg-indigo-500 text-white shadow-lg' : 'bg-white/5 text-slate-500'}`}
                  title="Voice Co-Pilot"
                >
                  <span className="text-xl">🎙️</span>
                </button>
                <button
                  onClick={() => set3DMode(!is3DMode)}
                  className={`w-11 h-11 rounded-2xl flex items-center justify-center transition-all
                    ${is3DMode ? 'bg-amber-500 text-white shadow-lg' : 'bg-white/5 text-slate-500'}`}
                  title="3D Mode"
                >
                  <span className="text-xl">🗺️</span>
                </button>
              </div>

              {/* Cluster 2: Communication & Safety */}
              <div className="flex flex-col gap-2 p-1.5 bg-black/40 backdrop-blur-md rounded-[1.5rem] border border-white/10 shadow-2xl">
                <button
                  onClick={() => setMessagingOpen(true)}
                  className="w-11 h-11 rounded-2xl bg-white/5 text-slate-300 flex items-center justify-center hover:bg-white/10 transition-all"
                  title="Family Chat"
                >
                  <span className="text-xl">💬</span>
                </button>
                <button
                  onClick={() => {
                    const confirmed = confirm('🚨 EMERGENCY SOS\n\nAlert circle members?');
                    if (confirmed && user && profile?.familyCircleId) {
                      triggerSOS(profile.familyCircleId, user.uid);
                      showNotification('🆘 SOS Alert sent!', 5000);
                    }
                  }}
                  className={`w-11 h-11 rounded-2xl flex items-center justify-center transition-all shadow-lg ring-2
                    ${members.find(m => m.id === user?.uid)?.sosActive
                      ? 'bg-red-700 animate-bounce ring-red-400'
                      : 'bg-red-600/80 hover:bg-red-700 animate-pulse hover:animate-none ring-red-500/50'}`}
                  title="Emergency SOS"
                >
                  <span className="text-xl">🛡️</span>
                </button>
              </div>

              {/* Cluster 3: System & Profile - REMOVED per VisionQA 3.0 Audit (Redundant) */}
              {/* Settings now exclusively accessed via Sidebar */}
            </div>
          </OverlayManager>

          {/* Messaging Panel */}
          {isMessagingOpen && (
            <OverlayManager>
              <div className={`absolute z-[150] ${isMobile ? 'inset-4' : 'right-6 bottom-6 w-96 h-[500px]'}`}>
                <MessagingPanel
                  members={members}
                  currentUserId={user?.uid || ''}
                  circleId={profile?.familyCircleId}
                  onClose={() => setMessagingOpen(false)}
                  theme={theme}
                />
              </div>
            </OverlayManager>
          )}

          {/* Settings Panel */}
          {isSettingsOpen && (
            <OverlayManager>
              <div className={`absolute z-[150] ${isMobile ? 'inset-4' : 'right-6 top-20 w-96 max-h-[calc(100vh-120px)]'}`}>
                <SettingsPanel
                  settings={userSettings}
                  onUpdateSettings={(newSettings) => {
                    setUserSettings(newSettings);
                    if (newSettings.theme !== 'auto') {
                      setTheme(newSettings.theme);
                    }
                  }}
                  onClose={() => setSettingsOpen(false)}
                  onOpenOfflineMaps={() => setOfflineMapsOpen(true)}
                  theme={theme}
                  userName={members[0]?.name || 'User'}
                  userAvatar={members[0]?.avatar || ''}
                  onUpgrade={() => setUpsellOpen(true)}
                  isPremium={members[0]?.membershipTier === 'gold' || members[0]?.membershipTier === 'platinum'}
                  userPlaces={userPlaces}
                  onAddPlace={(place) => {
                    if (user && profile?.familyCircleId) {
                      addUserPlace(profile.familyCircleId, place, user.uid);
                    }
                  }}
                  onDeletePlace={(placeId) => {
                    if (profile?.familyCircleId) {
                      deleteUserPlace(profile.familyCircleId, placeId);
                    }
                  }}
                  onSignOut={logout}
                  currentLocation={userLocation || undefined}
                  onManageSubscription={async () => {
                    try {
                      await goToBillingPortal();
                    } catch (err: any) {
                      showNotification(`❌ ${err.message}`, 5000);
                    }
                  }}
                  onShowPrivacy={() => window.open('https://myway-gps.com/privacy', '_blank')}
                  onManageCircle={() => showNotification('🔄 Family Circle management is moving to its own dashboard soon!', 5000)}
                />
              </div>
            </OverlayManager>
          )}

          {/* Offline Maps Panel */}
          {isOfflineMapsOpen && (
            <OverlayManager>
              <div className={`absolute z-[150] ${isMobile ? 'inset-4' : 'right-6 bottom-6 w-96'}`}>
                <OfflineMapManager
                  currentBounds={mapBounds}
                  theme={theme}
                  onClose={() => setOfflineMapsOpen(false)}
                />
              </div>
            </OverlayManager>
          )}
        </div>
      </div>

      {/* Mobile Bottom Sheet - replaces sidebar on mobile */}
      {
        isMobile && !isDriveMode && (
          <BottomSheet
            members={members}
            selectedId={selectedMemberId}
            onSelect={setSelectedMemberId}
            theme={theme}
          />
        )
      }

      {/* Mobile Place Detail Bottom Sheet */}
      {isMobile && selectedPlace && !isDriveMode && (
        <OverlayManager>
          <div className="absolute z-[150] inset-x-0 bottom-0 p-4">
            <PlaceDetailPanel
              place={selectedPlace}
              onClose={() => setSelectedPlace(null)}
              onNavigate={() => {
                handleStartNavigation(selectedPlace.name);
                setSelectedPlace(null);
              }}
              theme={theme}
            />
          </div>
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
    </div >
  );
};

import ErrorBoundary from './components/ErrorBoundary';

const AppWrapper: React.FC = () => (
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);

export default AppWrapper;
