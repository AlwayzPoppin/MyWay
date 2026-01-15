
import React, { useState, useEffect, useRef } from 'react';
import { FamilyMember, Place, DailyInsight, NavigationRoute, CircleTask, IncidentReport, PrivacyZone, Reward } from './types';
import Sidebar from './components/Sidebar';
import MapView from './components/MapView';
import Header from './components/Header';
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
import { useAuth } from './contexts/AuthContext';
import { createCheckoutSession } from './services/stripeService';
import { SUBSCRIPTION_TIERS } from './config/subscriptions';
import {
  getFamilyInsights,
  getRouteToDestination,
  searchPlacesOnMap
} from './services/geminiService';
import { geolocationService } from './services/geolocationService';

const SPONSORED_PLACES: Place[] = [
  { id: 's1', name: 'Shell Premium', location: { lat: 37.7880, lng: -122.4100 }, radius: 0.005, type: 'sponsored', icon: '⛽', brandColor: '#fbbf24', deal: '10¢ off/gal for Circle members' }
];

const INITIAL_REWARDS: Reward[] = [
  { id: 'r1', brand: 'Starbucks', title: 'Buy One Get One Free', code: 'OMNIDRINK', expiry: '2025-12-31', icon: '☕' },
  { id: 'r2', brand: 'Shell', title: '10¢ off per Gallon', code: 'OMNIGAS', expiry: '2025-06-30', icon: '⛽' }
];

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
    clearError
  } = useAuth();

  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [isUpsellOpen, setIsUpsellOpen] = useState(false);
  const [isRewardsOpen, setIsRewardsOpen] = useState(false);
  const [rewards] = useState<Reward[]>(INITIAL_REWARDS);
  const [privacyZones] = useState<PrivacyZone[]>([]);
  const [discoveredPlaces, setDiscoveredPlaces] = useState<Place[]>(SPONSORED_PLACES);
  const [incidents, setIncidents] = useState<IncidentReport[]>([]);
  const [insights, setInsights] = useState<DailyInsight[]>([]);
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [activeRoute, setActiveRoute] = useState<NavigationRoute | null>(null);
  const [isNavigating, setIsNavigating] = useState(false);
  const [isDriveMode, setIsDriveMode] = useState(false);
  const [isReporting, setIsReporting] = useState(false);
  const [isPrivacyOpen, setIsPrivacyOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [notification, setNotification] = useState<string | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [isQuickStopOpen, setIsQuickStopOpen] = useState(false);
  const [isMessagingOpen, setIsMessagingOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isOfflineMapsOpen, setIsOfflineMapsOpen] = useState(false);
  const [mapBounds, setMapBounds] = useState<{ north: number; south: number; east: number; west: number } | null>(null);
  const [is3DMode, setIs3DMode] = useState(false);
  const [userSettings, setUserSettings] = useState({
    theme: 'light' as 'light' | 'dark' | 'auto',
    notifications: true,
    locationSharing: true,
    batteryAlerts: true,
    arrivalAlerts: true,
    speedAlerts: false,
    mapStyle: 'standard' as 'standard' | 'satellite' | 'terrain',
    units: 'imperial' as 'imperial' | 'metric'
  });

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
          lastUpdated: 'Now',
          status: 'Stationary',
          safetyScore: 98,
          pathHistory: [],
          driveEvents: [],
          membershipTier: (profile as any).membershipTier || 'free',
          wayType: 'NoWay'
        }
      ]);
    }
  }, [user, profile]);

  // Handle window resize
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Real GPS tracking for "You" member
  useEffect(() => {
    if (!user) return;
    if (!geolocationService.isSupported()) {
      setLocationError('GPS not supported on this device');
      return;
    }

    geolocationService.watchPosition(
      (location) => {
        setLocationError(null);
        setMembers(prev => prev.map(m =>
          m.id === user.uid ? {
            ...m,
            location: { lat: location.latitude, lng: location.longitude },
            speed: location.speed || 0,
            heading: location.heading || 0,
            lastUpdated: new Date().toISOString(),
            status: (location.speed && location.speed > 5) ? 'Driving' :
              (location.speed && location.speed > 0.5) ? 'Moving' : 'Stationary'
          } : m
        ));
      },
      (error) => {
        setLocationError(error.message);
        console.warn('Geolocation error:', error.message);
      }
    );

    return () => geolocationService.stopWatching();
  }, [user]);

  useEffect(() => {
    if (members.length > 0) {
      const fetch = async () => setInsights(await getFamilyInsights(members));
      fetch();
    }
  }, [members]);

  const handleToggleGhost = (memberId: string) => {
    setMembers(prev => prev.map(m => m.id === memberId ? { ...m, isGhostMode: !m.isGhostMode } : m));
  };

  const handleUpgrade = async (tierId: string) => {
    try {
      const tier = SUBSCRIPTION_TIERS[tierId];
      if (!tier) return;

      setNotification(`🚀 Preparing your ${tier.name}...`);
      const checkoutUrl = await createCheckoutSession(tier.priceId);
      window.location.href = checkoutUrl;
    } catch (err: any) {
      setNotification(`❌ Error: ${err.message}`);
      setTimeout(() => setNotification(null), 5000);
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

  const handleDiscovery = async (query: string) => {
    if (members.length === 0) return;
    const results = await searchPlacesOnMap(query, members[0].location);
    setDiscoveredPlaces([...SPONSORED_PLACES, ...results]);
  };

  const handleStartNavigation = async (dest: string) => {
    if (members.length === 0) return;
    const route = await getRouteToDestination(members[0].location, dest, members);
    setActiveRoute(route);
    setIsNavigating(true);
    setIsDriveMode(true);
  };

  return (
    <div className={`flex flex-col h-full w-full overflow-hidden transition-all duration-700 ${theme === 'dark' ? 'bg-black' : 'bg-[#f1f5f9]'}`}>
      {!isDriveMode && (
        <Header
          theme={theme}
          onToggleTheme={() => setTheme(t => t === 'light' ? 'dark' : 'light')}
          onUpgrade={() => setIsUpsellOpen(true)}
          userTier={members[0].membershipTier}
        />
      )}

      <div className={`flex flex-1 relative overflow-hidden ${isMobile && !isDriveMode ? 'flex-col-reverse' : 'flex-row'}`}>
        {/* Desktop Sidebar - Bento Grid style */}
        {!isDriveMode && !isMobile && (
          <BentoSidebar
            members={members}
            selectedId={selectedMemberId}
            onSelect={setSelectedMemberId}
            theme={theme}
          />
        )}

        {/* Map and overlay container */}
        <div className="flex-1 relative overflow-hidden" style={{ perspective: is3DMode ? '1000px' : 'none' }}>
          {/* Map layer - z-0 to ensure overlays appear on top */}
          <div
            className="absolute inset-0 z-0 transition-transform duration-500"
            style={{
              transform: is3DMode ? 'rotateX(45deg) scale(1.2)' : 'none',
              transformOrigin: 'center center'
            }}
          >
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
              onSelectPlace={(p) => handleStartNavigation(p.name)}
              onSelectMember={setSelectedMemberId}
              onBoundsChange={setMapBounds}
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

          {/* Safety Alerts */}
          {!isDriveMode && (
            <div className="absolute z-[70] top-18 right-4 pointer-events-auto flex flex-col items-end">
              <SafetyAlerts
                members={members}
                onDismiss={(id) => console.log('Dismissed:', id)}
                onSendReminder={(memberId, type) => {
                  setNotification(`📱 Sent ${type === 'charge' ? 'charge reminder' : 'check-in request'}!`);
                  setTimeout(() => setNotification(null), 3000);
                }}
                theme={theme}
              />
            </div>
          )}

          {isDriveMode && activeRoute ? (
            <DriveModeHUD
              route={activeRoute}
              onCancel={() => { setIsDriveMode(false); setIsNavigating(false); setActiveRoute(null); }}
              speed={members[0].speed}
            />
          ) : (
            <>
              {/* Search bar - centralized */}
              <div className={`absolute z-[100] px-4 transition-all duration-500 ${isMobile
                ? 'bottom-28 left-0 right-0 flex justify-center'
                : 'bottom-8 left-1/2 -translate-x-1/2 w-full max-w-xl'
                }`}>
                <div className="flex gap-3 w-full max-w-lg shadow-2xl rounded-2xl items-end">
                  <SearchBox onSearch={handleDiscovery} theme={theme} />
                  {/* Quick Stop button - Gold Theme */}
                  <button
                    onClick={() => setIsQuickStopOpen(true)}
                    className="h-14 w-14 md:h-14 md:w-14 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 border-2 border-white/20 text-white shadow-xl flex items-center justify-center text-xl hover:scale-105 active:scale-95 transition-all"
                    title="Quick Stops"
                  >
                    ☕
                  </button>
                </div>
              </div>

              {/* QuickStopGrid modal */}
              {isQuickStopOpen && (
                <QuickStopGrid
                  onSearch={handleDiscovery}
                  onClose={() => setIsQuickStopOpen(false)}
                  theme={theme}
                />
              )}

              {isUpsellOpen && <PremiumUpsellModal onClose={() => setIsUpsellOpen(false)} onUpgrade={handleUpgrade} theme={theme} />}

              {isRewardsOpen && (
                <div className={`absolute z-[90] transition-all duration-500 ${isMobile ? 'inset-x-0 bottom-28 p-4' : 'left-8 top-32 w-80'}`}>
                  <RewardsPanel rewards={rewards} onClose={() => setIsRewardsOpen(false)} theme={theme} />
                </div>
              )}

              {isPrivacyOpen && (
                <div className={`absolute z-[90] transition-all duration-500 ${isMobile ? 'inset-x-0 bottom-28 p-4' : 'left-8 top-32 w-80'}`}>
                  <PrivacyPanel zones={[]} isGhostMode={members[0].isGhostMode || false} onToggleGhost={() => handleToggleGhost('1')} onClose={() => setIsPrivacyOpen(false)} theme={theme} />
                </div>
              )}

              {/* Member detail panel - desktop only, mobile uses BottomSheet */}
              {selectedMemberId && !isPrivacyOpen && !isRewardsOpen && !isMobile && (
                <div className="absolute z-[80] left-8 top-32 w-80">
                  <MemberDetailPanel
                    member={members.find(m => m.id === selectedMemberId)!}
                    onClose={() => setSelectedMemberId(null)}
                    onToggleGhost={selectedMemberId === '1' ? () => handleToggleGhost('1') : undefined}
                    theme={theme}
                  />
                </div>
              )}

              {!isMobile && <div className="absolute bottom-12 left-32 w-80 z-30"><InsightsBar insights={insights} theme={theme} /></div>}
            </>
          )}

          {/* Safety controls - positioned for easy access */}
          <div className={`absolute flex flex-col items-end gap-3 z-[60] ${isMobile ? 'top-4 right-4' : 'bottom-24 right-6'
            }`}>
            <CoPilotOverlay isActive={false} isSpeaking={false} transcription="" onToggle={() => { }} />

            {/* 3D Mode toggle */}
            <button
              onClick={() => setIs3DMode(!is3DMode)}
              className={`w-14 h-14 md:w-16 md:h-16 rounded-2xl text-white shadow-lg flex items-center justify-center font-black border-2 hover:scale-105 active:scale-95 transition-all
                ${is3DMode
                  ? 'bg-gradient-to-br from-amber-400 to-orange-500 border-white/20 shadow-[0_10px_30px_rgba(245,158,11,0.4)]'
                  : theme === 'dark' ? 'bg-white/10 border-white/20' : 'bg-white border-slate-200 text-slate-700'}
              `}
              title="Toggle 3D Mode"
            >
              <span className="text-xl">🗺️</span>
            </button>

            {/* Settings button */}
            <button
              onClick={() => setIsSettingsOpen(true)}
              className={`w-14 h-14 md:w-16 md:h-16 rounded-2xl shadow-lg flex items-center justify-center font-black border-2 hover:scale-105 active:scale-95 transition-all ${theme === 'dark'
                ? 'bg-white/10 border-white/20 text-white'
                : 'bg-white border-slate-200 text-slate-700'
                }`}
              title="Settings"
            >
              <span className="text-xl">⚙️</span>
            </button>

            {/* Chat button */}
            <button
              onClick={() => setIsMessagingOpen(true)}
              className="w-14 h-14 md:w-16 md:h-16 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 text-white shadow-[0_10px_30px_rgba(245,158,11,0.4)] flex items-center justify-center font-black border-2 border-white/20 hover:scale-105 active:scale-95 transition-all"
              title="Family Chat"
            >
              <span className="text-xl">💬</span>
            </button>

            {/* SOS button with safety shield */}
            <div className="relative group">
              <button
                className="w-14 h-14 md:w-16 md:h-16 rounded-2xl bg-gradient-to-br from-red-500 to-red-700 text-white shadow-[0_10px_30px_rgba(220,38,38,0.4)] flex items-center justify-center font-black border-2 border-red-400/50 hover:scale-105 active:scale-95 transition-all"
                title="Emergency SOS"
              >
                <span className="text-xl">🛡️</span>
              </button>
              {/* SOS reveals on hover/long press */}
              <div className="absolute bottom-full right-0 mb-2 opacity-0 group-hover:opacity-100 transition-all pointer-events-none group-hover:pointer-events-auto">
                <button className="w-16 h-16 rounded-full bg-red-600 text-white shadow-2xl flex items-center justify-center font-black text-sm border-4 border-white/20 animate-pulse">
                  SOS
                </button>
              </div>
            </div>
          </div>

          {/* Messaging Panel */}
          {isMessagingOpen && (
            <div className={`absolute z-[150] ${isMobile ? 'inset-4' : 'right-6 bottom-6 w-96 h-[500px]'}`}>
              <MessagingPanel
                members={members}
                currentUserId="1"
                onClose={() => setIsMessagingOpen(false)}
                theme={theme}
              />
            </div>
          )}

          {/* Settings Panel */}
          {isSettingsOpen && (
            <div className={`absolute z-[150] ${isMobile ? 'inset-4' : 'right-6 top-20 w-96 max-h-[calc(100vh-120px)]'}`}>
              <SettingsPanel
                settings={userSettings}
                onUpdateSettings={(newSettings) => {
                  setUserSettings(newSettings);
                  if (newSettings.theme !== 'auto') {
                    setTheme(newSettings.theme);
                  }
                }}
                onClose={() => setIsSettingsOpen(false)}
                onOpenOfflineMaps={() => setIsOfflineMapsOpen(true)}
                theme={theme}
                userName={members[0].name}
                userAvatar={members[0].avatar}
              />
            </div>
          )}

          {/* Offline Maps Panel */}
          {isOfflineMapsOpen && (
            <div className={`absolute z-[150] ${isMobile ? 'inset-4' : 'right-6 bottom-6 w-96'}`}>
              <OfflineMapManager
                currentBounds={mapBounds}
                theme={theme}
                onClose={() => setIsOfflineMapsOpen(false)}
              />
            </div>
          )}
        </div>
      </div>

      {/* Mobile Bottom Sheet - replaces sidebar on mobile */}
      {isMobile && !isDriveMode && (
        <BottomSheet
          members={members}
          selectedId={selectedMemberId}
          onSelect={setSelectedMemberId}
          theme={theme}
        />
      )}
    </div>
  );
};

export default App;
