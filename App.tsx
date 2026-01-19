
import React, { useState, useEffect, useRef } from 'react';
import { FamilyMember, Place, DailyInsight, NavigationRoute, CircleTask, IncidentReport, PrivacyZone, Reward } from './types';
import Sidebar from './components/Sidebar';
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
import { useAuth } from './contexts/AuthContext';
import { useUI } from './contexts/UIContext';
import OverlayManager from './components/OverlayManager';
import {
  getFamilyInsights,
  getRouteToDestination,
  searchPlacesOnMap,
  getSafetyAdvisory,
  SafetyAdvisory
} from './services/geminiService';
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
  getWrappedKeyForUser
} from './services/authService';
import { createCheckoutSession, goToBillingPortal } from './services/stripeService';
import { Geofence, GeofenceStatus, detectTransition } from './services/geofenceService';
import { sendArrivalAlert, sendDepartureAlert } from './services/emailService';
import { subscribeToRewards, seedRewards } from './services/rewardsService';
import { searchGasStations, searchCoffeeShops, searchRestaurants, searchGroceryStores } from './services/placesService';
import { subscribeToUserPlaces, seedDefaultPlaces, UserPlace, addUserPlace, deleteUserPlace } from './services/userPlacesService';
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
  unwrapCircleKey
} from './services/cryptoService';
import { startMeshHeartbeat, subscribeToMesh, MeshNode } from './services/meshService';
import { audioService } from './services/audioService';
import { SUBSCRIPTION_TIERS } from './config/subscriptions';
import { useLocationSync } from './hooks/useLocationSync';
import { useCoPilot } from './hooks/useCoPilot';

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
  const [isSimulationActive, setIsSimulationActive] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(() => {
    return !localStorage.getItem('myway_onboarding_complete');
  });

  // --- HOOKS ---
  const {
    members: liveMembers,
    setMembers, // Exposed for manual updates if needed (e.g. ghost mode toggles)
    locationError,
    userLocation
  } = useLocationSync(user, profile, isSimulationActive, profile?.familyCircleId);

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
  const [activeRoute, setActiveRoute] = useState<NavigationRoute | null>(null);
  const [navState, setNavState] = useState<NavigationState>({
    currentStepIndex: 0,
    distanceToNextStep: 0,
    isOffRoute: false,
    hasArrived: false
  });
  const [isNavigating, setIsNavigating] = useState(false);
  const { activeAdvisory: coPilotAdvisory } = useCoPilot(user, isNavigating, members);
  const [meshNodes, setMeshNodes] = useState<MeshNode[]>([]);
  const [safetyScore, setSafetyScore] = useState(100);
  const [sessionPoints, setSessionPoints] = useState(0);
  const [isVoiceEnabled, setIsVoiceEnabled] = useState(true);
  const [isReporting, setIsReporting] = useState(false);
  const [mapBounds, setMapBounds] = useState<{ north: number; south: number; east: number; west: number } | null>(null);
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

  const [geofences, setGeofences] = useState<Geofence[]>([]);
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
      if (places.length > 0) {
        setUserPlaces(places);
      } else {
        // Seed default "Home" place for new circles
        seedDefaultPlaces(profile.familyCircleId, user.uid, userLocation || undefined);
      }
    });
    return () => unsubscribe();
  }, [user?.uid, profile?.familyCircleId, userLocation]);

  // Combine places for map display
  useEffect(() => {
    setDiscoveredPlaces([...sponsoredPlaces, ...userPlaces]);
  }, [sponsoredPlaces, userPlaces]);


  // --- ADVANCED E2EE ORCHESTRATION ---
  useEffect(() => {
    if (!user) return;

    const initE2EE = async () => {
      // 1. Generate local ECDH KeyPair if not exists
      let keys = ecdhKeyPair;
      if (!keys) {
        keys = await generateECDHKeyPair();
        setEcdhKeyPair(keys);
      }

      // 2. Sync Public Key to Profile
      const pubKeyBase64 = await exportPublicKey(keys.publicKey);
      if (profile && profile.ecdhPublicKey !== pubKeyBase64) {
        updateUserProfile(user.uid, { ecdhPublicKey: pubKeyBase64 });
      }

      // 3. OWNER LOGIC: Deliver keys to circle members
      if (isOwner && currentCircle) {
        const circleMembers = await getCircleMembers(currentCircle.id);

        // In this strategic demo, we generate the circle key if it's not set locally.
        // In a real app, the owner would unwrap it from a master recovery key.
        const ownerCircleKey = await generateFamilyKey();
        setFamilyKey(ownerCircleKey);

        for (const member of circleMembers) {
          if (member.uid !== user.uid && member.ecdhPublicKey) {
            const memberPubKey = await importPublicKey(member.ecdhPublicKey);
            const sharedSecret = await deriveSharedSecretKey(keys.privateKey, memberPubKey);
            const wrapped = await wrapCircleKey(ownerCircleKey, sharedSecret);
            await deliverWrappedKey(currentCircle.id, member.uid, wrapped);
          }
        }
      }

      // 4. MEMBER LOGIC: Wait for key delivery from owner
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
  }, [user?.uid, profile?.familyCircleId, isOwner, !!currentCircle, ecdhKeyPair, profile, currentCircle]);


  // Sync Audio Service state
  useEffect(() => {
    audioService.setEnabled(isVoiceEnabled);
  }, [isVoiceEnabled]);

  // Initialize members from auth profile
  useEffect(() => {
    if (user && profile) {
      setMembers([
        {
          id: user.uid,
          name: profile.displayName || 'You',
          role: 'Primary',
          avatar: profile.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.uid}&backgroundColor=b6e3f4`,
          location: { lat: 37.7749, lng: -122.4194 },
          battery: 100,
          speed: 0,
          lastUpdated: 'Waiting for signal...',
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

        // If no geofences exist, let's create a default "Home" one for demo purposes if the user is the owner
        if (circlesGeofences.length === 0 && profile.uid === user?.uid) {
          addGeofence(profile.familyCircleId, {
            name: 'Home',
            lat: 37.7749,
            lng: -122.4194,
            radius: 100
          });
        }
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
  useEffect(() => {
    if (isNavigating && activeRoute && userLocation) { // utilizing userLocation from hook
      const newNavState = updateNavigationState(userLocation, activeRoute, navState);

      if (newNavState.currentStepIndex !== navState.currentStepIndex) {
        showNotification(`🔜 Next: ${activeRoute.steps[newNavState.currentStepIndex].instruction}`, 4000);
      }

      if (newNavState.hasArrived && !navState.hasArrived) {
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
        updateNavigationState(userLocation, null, navState);

        // Reset navigation
        setTimeout(() => {
          setDriveMode(false);
          setIsNavigating(false);
          setActiveRoute(null);
        }, 5000);
      } else {
        setNavState(newNavState);
      }
    }
  }, [userLocation, isNavigating, activeRoute, navState, safetyScore, showNotification]);

  // --- Geofence Logic (Modular) ---
  useEffect(() => {
    if (members.length > 0 && geofences.length > 0) {
      members.forEach(member => {
        const memberGeofenceStates = geofenceStatesRef.current[member.id] || {};
        geofences.forEach(geofence => {
          const previousStatus = memberGeofenceStates[geofence.id] || 'OUTSIDE';
          const transition = detectTransition(member.location, geofence, previousStatus);

          if (transition) {
            if (!geofenceStatesRef.current[member.id]) {
              geofenceStatesRef.current[member.id] = {};
            }
            geofenceStatesRef.current[member.id][geofence.id] = transition.to;

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

  const handleToggleGhost = (memberId: string) => {
    setMembers(prev => prev.map(m => m.id === memberId ? { ...m, isGhostMode: !m.isGhostMode } : m));
  };

  const handleUpgrade = async (tierId: string) => {
    try {
      const tier = SUBSCRIPTION_TIERS[tierId];
      if (!tier) return;

      showNotification(`🚀 Preparing your ${tier.name}...`, 5000);
      const checkoutUrl = await createCheckoutSession(tier.priceId);
      window.location.href = checkoutUrl;
    } catch (err: any) {
      showNotification(`❌ Error: ${err.message}`, 5000);
    }
  };

  if (authLoading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-[#050914] text-white">
        <div className="flex flex-col items-center gap-4">
          <div className="w-16 h-16 border-4 border-amber-500 border-t-transparent rounded-full animate-spin" />
          <p className="font-bold tracking-widest animate-pulse">LOADING MYWAY...</p>
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

  const handleDiscovery = (query: string) => {
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
  };

  // Quick search handlers for category buttons (GAS, COFFEE, FOOD, GROCERY)
  const handleQuickSearch = (type: 'gas' | 'coffee' | 'food' | 'grocery') => {
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
  };

  const handleStartNavigation = async (dest: string, simulate: boolean = false) => {
    if (members.length === 0) return;

    try {
      showNotification(`🧭 ${simulate ? 'Calculating simulation route...' : 'Preparing navigation...'}`, 5000);

      const route = await getRouteToDestination(members[0].location, dest, members);

      if (!route || !route.steps) {
        showNotification("❌ Could not calculate route. Please try again.", 4000);
        return;
      }

      if (simulate) {
        // Extract simulation points from range steps
        const simulationPoints = route.steps
          .filter(s => s.endLocation)
          .map(s => s.endLocation!);

        // Add start and end
        if (members[0].location) simulationPoints.unshift(members[0].location);
        simulationPoints.push(route.destinationLoc);

        geolocationService.setSimulationRoute(simulationPoints);
        setIsSimulationActive(true);
        geolocationService.setSimulationMode(true);
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
  };


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
          />
        )}

        {/* Top Left Profile/Settings FAB (Replaces Header) */}
        {!isDriveMode && (
          <button
            onClick={() => setSettingsOpen(true)}
            className={`absolute top-4 left-4 z-[90] group flex items-center gap-3 transition-all duration-300 ${!isMobile ? 'hover:scale-105' : ''}`}
          >
            <div className={`relative w-11 h-11 md:w-12 md:h-12 rounded-full border-2 overflow-hidden shadow-2xl transition-all duration-300
              ${theme === 'dark' ? 'bg-slate-800 border-white/20' : 'bg-white border-slate-200'}
              ${members[0]?.membershipTier === 'gold' ? 'border-amber-500' : ''}`}
            >
              <img
                src={members[0]?.avatar || user?.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${user?.uid}`}
                alt="Profile"
                className="w-full h-full object-cover"
              />
            </div>
            {!isMobile && (
              <div className={`px-4 py-2 rounded-xl shadow-lg backdrop-blur-md font-bold text-sm border
                 ${theme === 'dark' ? 'bg-black/50 border-white/10 text-white' : 'bg-white/80 border-slate-200 text-slate-800'}`}>
                Settings
              </div>
            )}
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
                onUserInteraction={() => { }}
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
                onSelectPlace={(place) => {
                  setSelectedMemberId(null);
                  setMapCenter([place.location.lat, place.location.lng]);
                }}
                onSelectMember={(id) => {
                  setSelectedMemberId(id);
                  setMapCenter(undefined);
                }}
                onBoundsChange={setMapBounds}
                onUserInteraction={() => { }}
                center={mapCenter} // MapView (Leaflet) needs [lat, lng]
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
                  geolocationService.setSimulationMode(false);
                  setIsSimulationActive(false);
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
              {selectedMemberId && !isPrivacyOpen && !isRewardsOpen && !isMobile && (() => {
                const selectedMember = members.find(m => m.id === selectedMemberId);
                return selectedMember ? (
                  <OverlayManager>
                    <div className="absolute z-[80] left-8 top-32 w-80">
                      <MemberDetailPanel
                        member={selectedMember}
                        onClose={() => setSelectedMemberId(null)}
                        onToggleGhost={selectedMemberId === user?.uid ? () => handleToggleGhost(user?.uid || '') : undefined}
                        theme={theme}
                      />
                    </div>
                  </OverlayManager>
                ) : null;
              })()}

              {/* Unified Command Center - Bottom Center Single Bar */}
              <OverlayManager>
                <div className={`absolute left-1/2 -translate-x-1/2 w-full max-w-2xl z-40 px-4 ${isMobile ? 'bottom-20' : 'bottom-10'}`}>
                  <SearchBox
                    onSearch={handleDiscovery}
                    onCategorySearch={handleQuickSearch}
                    onLocate={() => {
                      const targetId = user?.uid || 'demo-you';
                      setSelectedMemberId(targetId);
                      setMapCenter(undefined); // Reset specific search center to follow user
                      showNotification("📍 Centered on your location", 2000);
                    }}
                    onQuickStop={() => setQuickStopOpen(true)}
                    onTestDrive={() => handleStartNavigation("Simulated Destination", true)}
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
                  <span className="text-[10px] font-black uppercase tracking-tighter">MESH ACTIVE</span>
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
                    if (confirmed) showNotification('🆘 SOS Alert sent!', 5000);
                  }}
                  className="w-11 h-11 rounded-2xl bg-red-600/80 text-white flex items-center justify-center hover:bg-red-700 transition-all shadow-lg animate-pulse hover:animate-none ring-2 ring-red-500/50"
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
    </div >
  );
};

export default App;
