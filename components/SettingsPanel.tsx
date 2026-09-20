
import React, { useState, useEffect, useRef } from 'react';
import { 
    Shield, 
    Bell, 
    Compass, 
    Map, 
    User, 
    ChevronDown, 
    Pencil, 
    Camera, 
    X, 
    EyeOff, 
    MapPin, 
    ShieldCheck, 
    Key, 
    AlertTriangle, 
    Lock, 
    Trash2, 
    Sparkles, 
    Building2, 
    Square, 
    Minus, 
    Cpu,
    Award,
    History,
    ArrowLeft,
    ChevronRight,
    Star,
    Check,
    Smartphone,
    Monitor
} from 'lucide-react';
import { MapSkinId, MAP_SKINS } from '../services/mapSkinService';
import { PrivacyMode } from '../types';
import { setCirclePrivacyMode } from '../services/privacyService';
import { contributionService, TripContributionPayload } from '../services/contributionService';
import { placePhotoService } from '../services/placePhotoService';
import { APP_VERSION } from '../services/appVersionService';
import { nativeBackgroundTrackingService } from '../services/nativeBackgroundTrackingService';
import { FamilyCircle } from '../services/authService';
import { loadCircleContacts } from '../services/nativeContactService';
import MapReviewPanel from './MapReviewPanel';
import { assignAdminRole, getAdminDeletionProtection, getMapReviewAccess } from '../services/mapReviewService';
import {
    TrustedDevice,
    claimLocationSharingForCurrentDevice,
    getCurrentDeviceId,
    getCurrentDeviceLabel,
    isCurrentDeviceMobile,
    signOutEverywhere,
    subscribeToTrustedDevices
} from '../services/deviceSessionService';


export interface UserSettings {
    theme: 'light' | 'dark' | 'auto';
    notifications: boolean;
    locationSharing: boolean;
    batteryAlerts: boolean;
    arrivalAlerts: boolean;
    speedAlerts: boolean;
    autoRoadRecording?: boolean;
    mapStyle: 'standard' | 'satellite' | 'terrain';
    units: 'imperial' | 'metric';
    mapSkin: MapSkinId;
    buildingScale?: 'none' | 'flat' | 'realistic';
    showTrafficControls?: boolean;
    avoidTolls?: boolean;
    avoidHighways?: boolean;
    privacyMode?: PrivacyMode;
}

interface SettingsPanelProps {
    settings: UserSettings;
    onUpdateSettings: (settings: UserSettings) => void;
    onClose: () => void;
    onOpenContacts?: () => void;
    userCircles?: FamilyCircle[];
    pendingReviewCount?: number | null;
    onOpenOfflineMaps?: () => void;
    theme: 'light' | 'dark';
    userName: string;
    userEmail?: string | null;
    userId?: string;
    circleId?: string;
    userAvatar: string;
    onUpgrade?: () => void;
    isPremium?: boolean;
    // New props for account management
    onSignOut?: () => void;
    onOpenKeyRecovery?: () => void;
    onUpdateProfile?: (name: string, avatarFile?: File) => Promise<void>;
    onDeleteAccount?: (password?: string) => Promise<void>;
    onOpenContributions?: () => void;
    initialView?: 'main' | 'contributions';
}

const SettingsPanel: React.FC<SettingsPanelProps> = ({
    settings,
    onUpdateSettings,
    onClose,
    onOpenContacts,
    userCircles = [],
    pendingReviewCount = null,
    onOpenOfflineMaps,
    theme,
    userName,
    userEmail,
    userId,
    circleId,
    userAvatar,
    onUpgrade,
    isPremium = false,
    onSignOut,
    onOpenKeyRecovery,
    onUpdateProfile,
    onDeleteAccount,
    onOpenContributions,
    initialView = 'main'
}) => {
    const [currentView, setCurrentView] = useState<'main' | 'contributions' | 'account'>(initialView);
    const [contactSharingStatus, setContactSharingStatus] = useState<string | null>(null);
    const circleContactKey = userCircles.map(circle => circle.id).sort().join('|');

    useEffect(() => {
        if (currentView !== 'account' || !onOpenContacts) return;
        let active = true;
        void loadCircleContacts(circleContactKey ? circleContactKey.split('|') : [])
            .then(({ preferences }) => {
                if (!active) return;
                const sharedCircleCount = preferences.circleIds.filter(id => userCircles.some(circle => circle.id === id)).length;
                setContactSharingStatus(!preferences.phone
                    ? 'No contact number added'
                    : sharedCircleCount === 0
                        ? 'Number saved, not shared with a Circle'
                        : `Shared with ${sharedCircleCount} ${sharedCircleCount === 1 ? 'Circle' : 'Circles'}`);
            })
            .catch(() => { if (active) setContactSharingStatus('Sharing status unavailable'); });
        return () => { active = false; };
    }, [currentView, circleContactKey]);

    const handleOpenContributions = () => {
        if (onOpenContributions) {
            onOpenContributions();
        }
        setCurrentView('contributions');
    };
    const [localSettings, setLocalSettings] = useState(settings);

    useEffect(() => {
        setLocalSettings(settings);
    }, [settings]);
    const [trustedDevices, setTrustedDevices] = useState<TrustedDevice[]>([]);
    const [deviceActionError, setDeviceActionError] = useState<string | null>(null);
    const [deviceActionPending, setDeviceActionPending] = useState(false);
    const [isMapAdmin, setIsMapAdmin] = useState(false);
    const [isMapReviewOpen, setIsMapReviewOpen] = useState(false);
    const [isNativeBackgroundTrackingActive, setIsNativeBackgroundTrackingActive] = useState<boolean | null>(null);
    const [hasRecoveryAdmin, setHasRecoveryAdmin] = useState(true);
    const [recoveryAdminEmail, setRecoveryAdminEmail] = useState('');
    const [isAssigningRecoveryAdmin, setIsAssigningRecoveryAdmin] = useState(false);
    const [recoveryAdminMessage, setRecoveryAdminMessage] = useState<string | null>(null);
    const currentDeviceId = getCurrentDeviceId();
    const currentDeviceIsMobile = isCurrentDeviceMobile();
    const currentDevice = React.useMemo(() => {
        const detected = getCurrentDeviceLabel();
        return trustedDevices.find(device => device.id === currentDeviceId && !device.revokedAt) || {
            id: currentDeviceId,
            label: detected.label,
            platform: detected.platform,
            createdAt: 0,
            lastActiveAt: 0,
            isLocationPublisher: false
        };
    }, [trustedDevices, currentDeviceId]);

    // Crowdsourced Contribution History State
    const [contributions, setContributions] = useState<TripContributionPayload[]>([]);
    const [withdrawingPhotoId, setWithdrawingPhotoId] = useState<string | null>(null);

    useEffect(() => {
        if (currentView === 'contributions') {
            const unsub = contributionService.subscribeUserContributions(userId, (items) => {
                void placePhotoService.getPhotosForUser(userId).then(photos => {
                    const photoItems: TripContributionPayload[] = photos.map(photo => ({
                        id: `photo_${photo.id}`,
                        tripId: `photo_${photo.id}`,
                        destinationAddress: photo.placeName || 'Saved place',
                        destinationName: photo.placeName || 'Building photo',
                        placeId: photo.placeId,
                        rating: 0,
                        tags: ['building_photo'],
                        placeType: null,
                        isAccurate: true,
                        type: 'building_photo',
                        timestamp: photo.createdAt,
                        imageUrl: photo.url,
                        reviewStatus: photo.reviewStatus || 'pending'
                    }));
                    const photoIds = new Set(photoItems.map(item => item.tripId));
                    setContributions([...photoItems, ...items.filter(item => !photoIds.has(item.tripId))].sort((a, b) => b.timestamp - a.timestamp));
                });
            });
            return () => {
                unsub();
            };
        }
    }, [currentView, userId]);

    const withdrawBuildingPhoto = async (item: TripContributionPayload) => {
        const photoId = item.tripId?.startsWith('photo_') ? item.tripId.slice('photo_'.length) : '';
        if (!photoId || withdrawingPhotoId) return;
        const action = item.reviewStatus === 'approved' ? 'Remove this approved community photo?' : 'Withdraw this photo submission?';
        if (!window.confirm(`${action}\n\nIt will no longer appear to other drivers or in My Way Operations.`)) return;

        setWithdrawingPhotoId(photoId);
        try {
            const photos = await placePhotoService.getPhotosForUser(userId);
            const photo = photos.find(candidate => candidate.id === photoId);
            if (photo) await placePhotoService.withdrawPhotoContribution(photo);
            else {
                // A locally retained, not-yet-synced photo has no server record.
                await contributionService.deleteUserContribution(userId, item.id || '');
            }
            setContributions(current => current.filter(contribution => contribution.tripId !== item.tripId));
        } catch (error) {
            console.error('[SettingsPanel] Could not withdraw building photo:', error);
            window.alert('We could not withdraw this photo. Check your connection and try again.');
        } finally {
            setWithdrawingPhotoId(null);
        }
    };

    // Delete Account Modal State
    const [showDeleteModal, setShowDeleteModal] = useState(false);
    const [deleteConfirmText, setDeleteConfirmText] = useState('');
    const [deletePassword, setDeletePassword] = useState('');
    const [deleteError, setDeleteError] = useState<string | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);

    useEffect(() => {
        getMapReviewAccess().then(async access => {
            setIsMapAdmin(access.isAdmin);
            if (access.isAdmin) {
                const protection = await getAdminDeletionProtection();
                setHasRecoveryAdmin(protection.hasRecoveryAdmin);
            }
        }).catch(() => setIsMapAdmin(false));
    }, []);

    useEffect(() => {
        if (!nativeBackgroundTrackingService.isSupported()) return;
        let active = true;
        const readStatus = () => nativeBackgroundTrackingService.isRunning()
            .then(value => { if (active) setIsNativeBackgroundTrackingActive(value); })
            .catch(() => { if (active) setIsNativeBackgroundTrackingActive(false); });
        void readStatus();
        const refresh = window.setInterval(readStatus, 30_000);
        return () => { active = false; window.clearInterval(refresh); };
    }, []);

    const addRecoveryAdmin = async () => {
        const email = recoveryAdminEmail.trim();
        if (!email) return;
        setIsAssigningRecoveryAdmin(true);
        setRecoveryAdminMessage(null);
        try {
            await assignAdminRole({ email });
            setRecoveryAdminEmail('');
            setHasRecoveryAdmin(true);
            setRecoveryAdminMessage('Recovery admin assigned. They will receive access after their next sign-in.');
        } catch (error: any) {
            setRecoveryAdminMessage(error?.message || 'Could not assign that recovery admin.');
        } finally {
            setIsAssigningRecoveryAdmin(false);
        }
    };

    useEffect(() => {
        if (!userId) {
            setTrustedDevices([]);
            return;
        }
        return subscribeToTrustedDevices(userId, setTrustedDevices);
    }, [userId]);

    const claimThisDeviceForLocation = async () => {
        setDeviceActionPending(true);
        setDeviceActionError(null);
        try {
            await claimLocationSharingForCurrentDevice();
        } catch (error: any) {
            setDeviceActionError(error?.message || 'Could not move location sharing to this device.');
        } finally {
            setDeviceActionPending(false);
        }
    };

    const handleSignOutEverywhere = async () => {
        setDeviceActionPending(true);
        setDeviceActionError(null);
        try {
            await signOutEverywhere();
            onSignOut?.();
        } catch (error: any) {
            setDeviceActionError(error?.message || 'Could not sign out your devices.');
        } finally {
            setDeviceActionPending(false);
        }
    };

    // Profile Edit State
    const [isEditingProfile, setIsEditingProfile] = useState(false);
    const [editName, setEditName] = useState(userName);
    const [isUploading, setIsUploading] = useState(false);
    const fileInputRef = React.useRef<HTMLInputElement>(null);

    // Accordion State
    const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
        privacy: false,
        alerts: false,
        navigation_routing: false,
        map_offline_storage: false,
        account: false,
        operations: false
    });
    const [lastOpenedSection, setLastOpenedSection] = useState<string | null>(null);
    const previousViewRef = useRef(currentView);

    const toggleSection = (section: string) => {
        if (!expandedSections[section]) {
            setLastOpenedSection(section);
        }
        setExpandedSections(prev => ({
            ...prev,
            [section]: !prev[section]
        }));
    };

    const hasAnyExpanded = Object.values(expandedSections).some(v => v);

    const toggleAllSections = () => {
        const targetValue = !hasAnyExpanded;
        setLastOpenedSection(targetValue ? (lastOpenedSection || 'privacy') : null);
        setExpandedSections({
            privacy: targetValue,
            alerts: targetValue,
            navigation_routing: targetValue,
            map_offline_storage: targetValue,
            account: targetValue,
            operations: targetValue
        });
    };

    // Returning from a settings subpage should land on the section the user was editing.
    // This is in-memory only: closing Settings still starts with a compact, collapsed list.
    useEffect(() => {
        const previousView = previousViewRef.current;
        previousViewRef.current = currentView;
        if (currentView !== 'main' || previousView === 'main' || !lastOpenedSection) return;

        const restoreTimeout = window.setTimeout(() => {
            document.getElementById(`settings-section-${lastOpenedSection}`)?.scrollIntoView({
                behavior: 'smooth',
                block: 'nearest'
            });
        }, 0);
        return () => window.clearTimeout(restoreTimeout);
    }, [currentView, lastOpenedSection]);

    const AccordionSection = ({
        id,
        title,
        subtitle,
        icon: Icon,
        badge,
        children
    }: {
        id: string;
        title: string;
        subtitle?: string;
        icon: React.ComponentType<{ className?: string }>;
        badge?: React.ReactNode;
        children: React.ReactNode;
    }) => {
        const isOpen = !!expandedSections[id];
        return (
            <div id={`settings-section-${id}`} className={`border-b ${theme === 'dark' ? 'border-white/5' : 'border-slate-100'} pb-3`}>
                <button
                    onClick={() => toggleSection(id)}
                    className="w-full flex items-center justify-between py-3 text-left focus:outline-none group/btn transition-colors"
                >
                    <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-xl bg-indigo-500/10 flex items-center justify-center shrink-0">
                            <Icon className="w-4 h-4 text-indigo-500" />
                        </div>
                        <div>
                            <p className={`font-semibold text-sm ${theme === 'dark' ? 'text-white' : 'text-slate-900'} group-hover/btn:text-indigo-400 transition-colors`}>
                                {title}
                            </p>
                            {subtitle && !isOpen && (
                                <p className="text-[10px] text-slate-500 font-bold mt-0.5 uppercase tracking-wider">
                                    {subtitle}
                                </p>
                            )}
                        </div>
                    </div>
                    <span className="flex items-center gap-2 shrink-0">
                        {badge}
                        <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform duration-300 ${isOpen ? 'rotate-180 text-indigo-400' : ''}`} />
                    </span>
                </button>
                <div
                    className={`grid transition-all duration-300 ease-in-out ${
                        isOpen ? 'grid-rows-[1fr] opacity-100 mt-2' : 'grid-rows-[0fr] opacity-0 pointer-events-none'
                    }`}
                >
                    <div className="overflow-hidden">
                        <div className="pt-2 pb-4 space-y-4">
                            {children}
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    const updateSetting = <K extends keyof UserSettings>(key: K, value: UserSettings[K]) => {
        const updated = { ...localSettings, [key]: value };
        setLocalSettings(updated);
        if (key === 'speedAlerts') {
            try {
                localStorage.setItem('setting_speed_alerts', JSON.stringify(value));
                localStorage.setItem('myway_speed_alerts', JSON.stringify(value));
            } catch (e) {}
        }
        onUpdateSettings(updated);
    };

    const ToggleSwitch = ({ enabled, onChange }: { enabled: boolean; onChange: (val: boolean) => void }) => (
        <button
            onClick={() => onChange(!enabled)}
            className={`relative w-12 h-6 rounded-full transition-all ${enabled
                ? 'bg-gradient-to-r from-indigo-500 to-purple-600'
                : theme === 'dark' ? 'bg-white/10' : 'bg-slate-200'
                } `}
        >
            <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-md transition-all ${enabled ? 'left-6' : 'left-0.5'
                } `} />
        </button>
    );

    const SectionTitle = ({ children }: { children: React.ReactNode }) => (
        <h3 className={`text-xs font-bold uppercase tracking-wider mb-3 ${theme === 'dark' ? 'text-slate-500' : 'text-slate-400'
            } `}>
            {children}
        </h3>
    );

    const SettingRow = ({ label, description, children }: { label: string; description?: string; children: React.ReactNode }) => (
        <div className={`flex items-center justify-between py-3 border-b ${theme === 'dark' ? 'border-white/5' : 'border-slate-100'
            } `}>
            <div>
                <p className={`font-medium ${theme === 'dark' ? 'text-white' : 'text-slate-900'} `}>{label}</p>
                {description && <p className="text-xs text-slate-500 mt-0.5">{description}</p>}
            </div>
            {children}
        </div>
    );

    // Keep account actions out of the primary settings list to preserve vertical space.
    if (currentView === 'account') {
        return (
            <div className={`flex flex-col h-full max-h-full rounded-3xl overflow-hidden shadow-2xl border ${theme === 'dark'
                ? 'bg-slate-900/95 border-white/10 text-white'
                : 'bg-[#fdfbf7]/95 border-slate-200/80 shadow-2xl text-slate-900'}`}>
                <div className={`p-6 border-b shrink-0 ${theme === 'dark' ? 'border-white/10' : 'border-slate-200'}`}>
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <button type="button" onClick={() => setCurrentView('main')}
                                className={`px-3 py-1.5 rounded-xl transition-all flex items-center gap-1.5 text-xs font-bold ${theme === 'dark'
                                    ? 'bg-white/5 border border-white/10 text-slate-300 hover:bg-white/10 hover:text-white'
                                    : 'bg-slate-100 border border-slate-200 text-slate-700 hover:bg-slate-200'}`}
                                aria-label="Back to settings">
                                <ArrowLeft className="w-4 h-4" /><span>Back</span>
                            </button>
                            <h2 className={`text-xl font-bold ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>Account settings</h2>
                        </div>
                        <button type="button" onClick={onClose}
                            className={`p-2 rounded-full transition-colors ${theme === 'dark' ? 'text-slate-400 hover:bg-white/10 hover:text-white' : 'text-slate-500 hover:bg-black/5 hover:text-slate-800'}`}
                            aria-label="Close settings">
                            <X className="w-5 h-5" />
                        </button>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-4 sm:p-6 no-scrollbar">
                    <section className={`rounded-2xl border p-4 ${theme === 'dark' ? 'bg-white/[0.03] border-white/10' : 'bg-white border-slate-200 shadow-sm'}`}>
                        <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Signed in as</p>
                        <p className={`mt-1 text-sm font-bold break-all ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>{userEmail || 'Email unavailable'}</p>
                    </section>

                    <div className="mt-4 space-y-3">
                        {onOpenContacts && (
                            <button type="button" onClick={onOpenContacts}
                                className={`w-full rounded-2xl border p-4 text-left transition-colors ${theme === 'dark'
                                    ? 'bg-violet-500/10 border-violet-400/25 hover:bg-violet-500/15'
                                    : 'bg-violet-50/70 border-violet-200 hover:bg-violet-50'}`}>
                                <span className="flex items-center gap-3">
                                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-violet-500/15 text-violet-600"><Smartphone className="h-4 w-4" /></span>
                                    <span>
                                        <span className={`block text-sm font-bold ${theme === 'dark' ? 'text-violet-200' : 'text-violet-800'}`}>Contact number & Circle sharing</span>
                                        <span className="mt-0.5 block text-[11px] leading-relaxed text-slate-500">{contactSharingStatus || 'Checking sharing status…'}</span>
                                    </span>
                                </span>
                            </button>
                        )}
                        {onOpenKeyRecovery && (
                            <button type="button" onClick={onOpenKeyRecovery}
                                className={`w-full rounded-2xl border p-4 text-left transition-colors ${theme === 'dark'
                                    ? 'bg-amber-500/5 border-amber-500/20 hover:bg-amber-500/10'
                                    : 'bg-amber-50/70 border-amber-200 hover:bg-amber-50'}`}>
                                <span className="flex items-center gap-3">
                                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-600"><Key className="h-4 w-4" /></span>
                                    <span>
                                        <span className={`block text-sm font-bold ${theme === 'dark' ? 'text-amber-200' : 'text-amber-800'}`}>Recover encrypted data</span>
                                        <span className="mt-0.5 block text-[11px] leading-relaxed text-slate-500">Use this after changing or losing a device.</span>
                                    </span>
                                </span>
                            </button>
                        )}
                        <button type="button" onClick={onSignOut}
                            className={`w-full rounded-2xl border px-4 py-3 text-sm font-bold transition-colors flex items-center justify-between ${theme === 'dark'
                                ? 'bg-white/5 hover:bg-white/10 border-white/10 text-slate-100'
                                : 'bg-white hover:bg-slate-50 border-slate-200 text-slate-800 shadow-sm'}`}>
                            <span className="flex items-center gap-2"><Lock className="w-4 h-4 text-indigo-500" />Sign out</span>
                            <span className="text-[10px] uppercase tracking-wider text-slate-400">This device</span>
                        </button>
                        <button type="button" onClick={() => {
                            // The confirmation dialog is owned by the main settings shell.
                            setCurrentView('main');
                            setShowDeleteModal(true);
                            setDeleteConfirmText('');
                            setDeletePassword('');
                            setDeleteError(null);
                        }}
                            className={`w-full rounded-2xl px-4 py-3 text-xs font-bold transition-colors flex items-center justify-center gap-2 ${theme === 'dark' ? 'text-red-400 hover:bg-red-500/10' : 'text-red-600 hover:bg-red-50'}`}>
                            <Trash2 className="w-4 h-4" />Permanently delete account
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    // Contribution History View
    if (currentView === 'contributions') {
        return (
            <div className={`flex flex-col h-full max-h-full rounded-3xl overflow-hidden shadow-2xl border
                ${theme === 'dark'
                    ? 'bg-slate-900/95 border-white/10 text-white'
                    : 'bg-[#fdfbf7]/95 border-slate-200/80 shadow-2xl text-slate-900'
                } `}
            >
                {/* Header */}
                <div className={`p-6 border-b shrink-0 ${theme === 'dark' ? 'border-white/10' : 'border-slate-200'} `}>
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <button
                                onClick={() => setCurrentView('main')}
                                className={`px-3 py-1.5 rounded-xl transition-all flex items-center gap-1.5 text-xs font-bold ${
                                    theme === 'dark'
                                        ? 'bg-white/5 border border-white/10 text-slate-300 hover:bg-white/10 hover:text-white'
                                        : 'bg-slate-100 border border-slate-200 text-slate-700 hover:bg-slate-200'
                                }`}
                                aria-label="Back to settings"
                            >
                                <ArrowLeft className="w-4 h-4" />
                                <span>Back</span>
                            </button>
                            <div className="flex items-center gap-2">
                                <h2 className={`text-xl font-bold ${theme === 'dark' ? 'text-white' : 'text-slate-900'} `}>
                                    Your Contributions
                                </h2>
                                {contributions.length > 0 && (
                                    <span className="px-2 py-0.5 rounded-full text-[11px] font-black bg-indigo-500/15 text-indigo-400 border border-indigo-500/30">
                                        {contributions.length}
                                    </span>
                                )}
                            </div>
                        </div>
                        <button
                            onClick={onClose}
                            className={`p-2 rounded-full hover:bg-black/5 dark:hover:bg-white/10 transition-colors ${
                                theme === 'dark' ? 'text-slate-400 hover:text-white' : 'text-slate-500 hover:text-slate-800'
                            }`}
                            aria-label="Close"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>
                </div>

                {/* Content Container */}
                <div className="flex-1 overflow-y-auto p-4 sm:p-6 no-scrollbar">
                    {contributions.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center text-center my-auto py-8">
                            <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mb-4 ${
                                theme === 'dark'
                                    ? 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20'
                                    : 'bg-indigo-50 text-indigo-600 border border-indigo-100'
                            }`}>
                                <Award className="w-8 h-8" />
                            </div>
                            <h3 className={`text-base font-bold mb-1.5 ${theme === 'dark' ? 'text-white' : 'text-slate-900'} `}>
                                Your Contributions
                            </h3>
                            <p className={`text-xs max-w-[280px] leading-relaxed mb-6 ${
                                theme === 'dark' ? 'text-slate-400' : 'text-slate-500'
                            }`}>
                                Track your map edits, added places, verified building numbers, and community reports.
                            </p>

                            <div className={`w-full max-w-sm rounded-2xl border border-dashed p-8 flex flex-col items-center justify-center gap-3 ${
                                theme === 'dark' ? 'border-white/10 bg-white/[0.02]' : 'border-slate-200 bg-slate-50/60'
                            }`}>
                                <div className="w-10 h-10 rounded-full bg-slate-500/10 flex items-center justify-center text-slate-400">
                                    <History className="w-5 h-5" />
                                </div>
                                <div>
                                    <p className={`text-xs font-bold ${theme === 'dark' ? 'text-slate-300' : 'text-slate-700'}`}>
                                        No contributions recorded yet
                                    </p>
                                    <p className="text-[11px] text-slate-400 mt-0.5">
                                        Complete a trip and rate your destination to earn points
                                    </p>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            <div className="flex items-center justify-between px-1 mb-1">
                                <span className={`text-[11px] font-bold uppercase tracking-wider ${theme === 'dark' ? 'text-slate-400' : 'text-slate-500'}`}>
                                    Contribution History ({contributions.length})
                                </span>
                            </div>

                            {contributions.map((item) => {
                                const isPinCorrection = item.type === 'pin_correction' || item.isAccurate === false;
                                const isBuildingPhoto = item.type === 'building_photo';
                                const dateFormatted = new Date(item.timestamp).toLocaleDateString(undefined, {
                                    month: 'short',
                                    day: 'numeric',
                                    year: 'numeric'
                                });
                                const timeFormatted = new Date(item.timestamp).toLocaleTimeString([], {
                                    hour: '2-digit',
                                    minute: '2-digit'
                                });

                                return (
                                    <div
                                        key={item.id || `${item.timestamp}_${item.destinationAddress}`}
                                        className={`p-4 rounded-2xl border transition-all ${
                                            theme === 'dark'
                                                ? 'bg-white/5 border-white/10 hover:border-white/20'
                                                : 'bg-white border-slate-200 shadow-sm hover:border-slate-300'
                                        }`}
                                    >
                                        {/* Top Meta Row */}
                                        <div className="flex items-center justify-between gap-2 mb-2">
                                            {isBuildingPhoto ? (
                                                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-violet-500/15 text-violet-500 border border-violet-500/30">
                                                    <Camera className="w-3 h-3" />
                                                    <span>Building Photo</span>
                                                </span>
                                            ) : isPinCorrection ? (
                                                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-amber-500/15 text-amber-500 border border-amber-500/30">
                                                    <MapPin className="w-3 h-3" />
                                                    <span>Pin Correction</span>
                                                </span>
                                            ) : (
                                                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-500/15 text-emerald-500 border border-emerald-500/30">
                                                    <Check className="w-3 h-3" />
                                                    <span>Trip Review</span>
                                                </span>
                                            )}
                                            <div className="flex items-center gap-1.5 shrink-0">
                                                <span className="text-[10px] font-semibold text-slate-400">
                                                    {dateFormatted} · {timeFormatted}
                                                </span>
                                                {isBuildingPhoto && (
                                                    <button
                                                        type="button"
                                                        onClick={() => void withdrawBuildingPhoto(item)}
                                                        disabled={withdrawingPhotoId === item.tripId?.slice('photo_'.length)}
                                                        className="p-1.5 rounded-lg text-rose-500 hover:bg-rose-500/10 disabled:opacity-50 transition-colors"
                                                        title={item.reviewStatus === 'approved' ? 'Remove photo' : 'Withdraw submission'}
                                                        aria-label={item.reviewStatus === 'approved' ? 'Remove photo' : 'Withdraw submission'}
                                                    >
                                                        <Trash2 className="w-3.5 h-3.5" />
                                                    </button>
                                                )}
                                            </div>
                                        </div>

                                        {/* Destination Title & Address */}
                                        <h4 className={`text-sm font-black leading-tight ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>
                                            {item.destinationName || item.destinationAddress}
                                        </h4>
                                        {item.destinationAddress && item.destinationAddress !== item.destinationName && (
                                            <p className="text-xs text-slate-400 mt-0.5 line-clamp-1">
                                                {item.destinationAddress}
                                            </p>
                                        )}
                                        {isBuildingPhoto && item.imageUrl && (
                                            <img src={item.imageUrl} alt="Submitted building" className="mt-3 h-28 w-full rounded-xl border border-slate-200/30 object-cover" />
                                        )}

                                        {/* Badges / Details Row */}
                                        <div className="flex flex-wrap items-center gap-1.5 mt-3 pt-2 border-t border-dashed border-slate-500/20">
                                            {item.rating > 0 && (
                                                <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20 flex items-center gap-1">
                                                    <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
                                                    <span>{item.rating}/5</span>
                                                </span>
                                            )}

                                            {item.placeType && (
                                                <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold border ${
                                                    item.placeType === 'residential'
                                                        ? 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20'
                                                        : 'bg-purple-500/10 text-purple-400 border-purple-500/20'
                                                }`}>
                                                    {item.placeType === 'residential' ? '🏠 Residential' : '🏢 Business'}
                                                </span>
                                            )}

                                            {(isBuildingPhoto || isPinCorrection) ? (
                                                <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold border ${item.reviewStatus === 'approved' ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' : item.reviewStatus === 'rejected' ? 'bg-rose-500/10 text-rose-500 border-rose-500/20' : 'bg-amber-500/10 text-amber-500 border-amber-500/20'}`}>
                                                    {item.reviewStatus === 'approved' ? (isPinCorrection ? '✓ Auto-approved' : '✓ Approved') : item.reviewStatus === 'rejected' ? 'Not approved' : '◷ In review'}
                                                </span>
                                            ) : item.isAccurate ? (
                                                <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                                    ✅ Pin Perfect
                                                </span>
                                            ) : (
                                                <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20">
                                                    📍 Pin Relocated
                                                </span>
                                            )}

                                            {item.correctedCoordinates && (
                                                <span className="px-2 py-0.5 rounded-md text-[10px] font-mono text-slate-400 bg-slate-500/10 border border-slate-500/20">
                                                    [{item.correctedCoordinates[0].toFixed(4)}, {item.correctedCoordinates[1].toFixed(4)}]
                                                </span>
                                            )}

                                            {item.tags && item.tags.map((tag) => (
                                                <span
                                                    key={tag}
                                                    className="px-2 py-0.5 rounded-md text-[10px] font-medium bg-slate-500/10 text-slate-400 border border-slate-500/15"
                                                >
                                                    #{tag.replace(/_/g, ' ')}
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        );
    }

    return (
        <div className={`flex flex-col h-full max-h-full rounded-3xl overflow-hidden shadow-2xl border
      ${theme === 'dark'
                ? 'bg-slate-900/95 border-white/10 text-white'
                : 'bg-[#fdfbf7]/95 border-slate-200/80 shadow-2xl text-slate-900'
            } `}
        >
            {/* Header */}
            <div className={`p-6 border-b ${theme === 'dark' ? 'border-white/10' : 'border-slate-200'} `}>
                <div className="flex flex-wrap items-center justify-between gap-3 mb-8">
                    <h2 className={`text-xl font-bold ${theme === 'dark' ? 'text-white' : 'text-slate-900'} `}>
                        My Settings
                    </h2>
                    <div className="flex items-center gap-2">
                        {!isEditingProfile && (
                            <button
                                type="button"
                                onClick={() => setCurrentView('account')}
                                className={`px-3 py-2 rounded-xl border text-sm font-bold transition-all flex items-center gap-1.5 ${theme === 'dark'
                                    ? 'bg-white/5 border-white/10 text-slate-300 hover:bg-white/10 hover:text-white'
                                    : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100'}`}
                            >
                                <User className="w-3.5 h-3.5" />
                                <span>Account</span>
                            </button>
                        )}
                        {!isEditingProfile ? (
                            <button
                                onClick={() => {
                                    setEditName(userName);
                                    setIsEditingProfile(true);
                                }}
                                className={`px-4 py-2 rounded-xl border text-sm font-bold transition-all flex items-center gap-1.5
                                    ${theme === 'dark'
                                        ? 'bg-white/5 border-white/10 text-indigo-400 hover:bg-white/10'
                                        : 'bg-indigo-50 border-indigo-100 text-indigo-600 hover:bg-indigo-100'}`}
                            >
                                <Pencil className="w-3.5 h-3.5" />
                                <span>Edit Profile</span>
                            </button>
                        ) : (
                            <div className="flex gap-2">
                                <button
                                    onClick={async () => {
                                        console.log('✏️ Profile Update: Saving...', editName);
                                        if (onUpdateProfile) {
                                            setIsUploading(true);
                                            try {
                                                await onUpdateProfile(editName);
                                                console.log('✏️ Profile Update: Prop call finished');
                                                setIsEditingProfile(false);
                                            } catch (err) {
                                                console.error('✏️ Profile Update: Error', err);
                                            } finally {
                                                setIsUploading(false);
                                            }
                                        } else {
                                            console.warn('✏️ Profile Update: No onUpdateProfile prop found');
                                        }
                                    }}
                                    disabled={isUploading}
                                    className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-bold hover:bg-indigo-700 disabled:opacity-50"
                                >
                                    {isUploading ? '...' : 'Save'}
                                </button>
                                <button
                                    onClick={() => setIsEditingProfile(false)}
                                    className={`px-4 py-2 rounded-xl border text-sm font-bold
                                        ${theme === 'dark' ? 'bg-white/5 border-white/10 text-white' : 'bg-slate-100 border-slate-200 text-slate-600'}`}
                                >
                                    Cancel
                                </button>
                            </div>
                        )}
                        <button
                            onClick={onClose}
                            className={`w-10 h-10 flex items-center justify-center rounded-full text-lg font-bold transition-all
                                ${theme === 'dark'
                                    ? 'bg-white/10 text-white hover:bg-red-500/80 hover:text-white'
                                    : 'bg-slate-200 text-slate-700 hover:bg-red-50 hover:text-white'
                                } `}
                            aria-label="Close settings"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>
                </div>

                <div className="flex items-center gap-5 mt-2">
                    <div className="relative group/avatar">
                        <img
                            src={userAvatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${userName}`}
                            alt={userName}
                            className={`w-16 h-16 rounded-2xl object-cover bg-slate-100 ring-2 ${isEditingProfile ? 'ring-indigo-500' : 'ring-transparent'}`}
                            onError={(e) => {
                                (e.target as HTMLImageElement).src = `https://api.dicebear.com/7.x/avataaars/svg?seed=${userName}`;
                            }}
                        />
                        {isEditingProfile && (
                            <button
                                onClick={() => fileInputRef.current?.click()}
                                className="absolute inset-0 bg-black/40 rounded-2xl flex items-center justify-center opacity-0 group-hover/avatar:opacity-100 transition-opacity cursor-pointer"
                            >
                                <Camera className="w-6 h-6 text-white" />
                            </button>
                        )}
                        <input
                            type="file"
                            ref={fileInputRef}
                            className="hidden"
                            accept="image/*"
                            onChange={async (e) => {
                                const file = e.target.files?.[0];
                                if (file && onUpdateProfile) {
                                    setIsUploading(true);
                                    try {
                                        await onUpdateProfile(editName, file);
                                        // Reset input so the same file can be picked again if needed
                                        e.target.value = '';
                                    } finally {
                                        setIsUploading(false);
                                    }
                                }
                            }}
                        />
                    </div>
                    <div>
                        {isEditingProfile ? (
                            <input
                                autoFocus
                                type="text"
                                value={editName}
                                onChange={(e) => setEditName(e.target.value)}
                                className={`font-bold text-lg px-2 -mx-2 py-1 rounded-lg border-2 border-indigo-500 outline-none
                                    ${theme === 'dark' ? 'bg-white/10 text-white' : 'bg-indigo-50 text-slate-900'}`}
                            />
                        ) : (
                            <p className={`font-bold text-lg ${theme === 'dark' ? 'text-white' : 'text-slate-900'} `}>
                                {userName}
                            </p>
                        )}
                        <p className="text-sm text-slate-500">Family Circle Admin</p>
                    </div>
                </div>

            </div>

            {/* Settings content - scrollable with visible scrollbar */}
            <div
                className={`flex-1 overflow-y-auto p-6 pb-8 space-y-4 scrollbar-visible scroll-smooth ${theme === 'light' ? 'scrollbar-visible-light' : ''} `}
                style={{ scrollBehavior: 'smooth' }}
            >
                {/* Accordion Controls */}
                <div className="flex justify-end mb-2">
                    <button
                        onClick={toggleAllSections}
                        className={`text-xs font-bold transition-all hover:underline cursor-pointer ${
                            theme === 'dark' ? 'text-slate-500 hover:text-slate-300' : 'text-slate-400 hover:text-slate-600'
                        }`}
                    >
                        {hasAnyExpanded ? 'Collapse All' : 'Expand All'}
                    </button>
                </div>


                {/* 1. Privacy & Visibility */}
                <AccordionSection
                    id="privacy"
                    title="Privacy & Visibility"
                    icon={Shield}
                    subtitle={`${localSettings.privacyMode === 'blurred' ? 'Neighborhood Blurred' : localSettings.privacyMode === 'invisible' ? 'Invisible' : 'Exact GPS'}`}
                >
                    {/* Granular Ghost & Privacy Blur Selector */}
                    <div className="mb-4 pb-3 border-b border-white/10">
                        <div className="flex items-center justify-between mb-1.5">
                            <div>
                                <h4 className={`text-xs font-black flex items-center gap-1.5 ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>
                                    <EyeOff className="w-3.5 h-3.5 text-purple-400" />
                                    <span>Location Privacy Level</span>
                                </h4>
                                <p className="text-[11px] text-slate-400">Control how circle members see your location</p>
                            </div>
                            <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-md bg-purple-500/20 text-purple-300">
                                {localSettings.privacyMode === 'blurred' ? 'Blurred' : localSettings.privacyMode === 'invisible' ? 'Invisible' : 'Exact'}
                            </span>
                        </div>

                        <div className={`grid grid-cols-3 gap-1.5 p-1 rounded-xl border mt-2 ${
                            theme === 'dark' ? 'bg-white/5 border-white/10' : 'bg-slate-100 border-slate-200'
                        }`}>
                            {[
                                { id: 'exact', icon: MapPin, label: 'Exact (5m)', desc: 'Live GPS Pin' },
                                { id: 'blurred', icon: EyeOff, label: 'Blurred (~1.5mi)', desc: 'Neighborhood Halo' },
                                { id: 'invisible', icon: EyeOff, label: 'Invisible', desc: 'Hide from circle' }
                            ].map(mode => {
                                const isCurrent = (localSettings.privacyMode || 'exact') === mode.id;
                                const ModeIcon = mode.icon;
                                return (
                                    <button
                                        key={mode.id}
                                        type="button"
                                        onClick={() => {
                                            updateSetting('privacyMode', mode.id as PrivacyMode);
                                            updateSetting('locationSharing', mode.id !== 'invisible');
                                            localStorage.setItem('myway_privacy_mode', mode.id);
                                            if (circleId) setCirclePrivacyMode(circleId, mode.id as PrivacyMode);
                                        }}
                                        className={`p-2 rounded-lg text-left transition-all border ${
                                            isCurrent
                                                ? 'bg-purple-600 text-white border-purple-400 shadow-md ring-1 ring-purple-400/50'
                                                : theme === 'dark'
                                                    ? 'bg-white/5 border-white/5 text-slate-300 hover:bg-white/10'
                                                    : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                                        }`}
                                    >
                                        <div className="flex items-center gap-1.5">
                                            <ModeIcon className={`w-3.5 h-3.5 ${isCurrent ? 'text-white' : 'text-purple-400'}`} />
                                            <span className="text-[11px] font-black">{mode.label}</span>
                                        </div>
                                        <div className={`text-[9px] mt-0.5 ${isCurrent ? 'text-purple-200' : 'text-slate-400'}`}>{mode.desc}</div>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                </AccordionSection>

                {/* 2. Notifications & Alerts */}
                <AccordionSection
                    id="alerts"
                    title="Notifications & Alerts"
                    icon={Bell}
                    subtitle={`${localSettings.notifications ? 'Push On' : 'Push Off'} • ${localSettings.batteryAlerts ? 'Battery On' : 'Battery Off'} • ${localSettings.speedAlerts ? 'Speed On' : 'Speed Off'}`}
                >
                    <SettingRow label="Push Notifications" description="Receive alerts on your device">
                        <ToggleSwitch enabled={localSettings.notifications} onChange={(v) => updateSetting('notifications', v)} />
                    </SettingRow>
                    <SettingRow label="Low Battery Alerts" description="Alert when family members are below 15%">
                        <ToggleSwitch enabled={localSettings.batteryAlerts} onChange={(v) => updateSetting('batteryAlerts', v)} />
                    </SettingRow>
                    <SettingRow label="Arrival Alerts" description="Notify when members arrive at places">
                        <ToggleSwitch enabled={localSettings.arrivalAlerts} onChange={(v) => updateSetting('arrivalAlerts', v)} />
                    </SettingRow>
                    <SettingRow label="Speed Alerts" description="Alert when members exceed speed limits">
                        <ToggleSwitch enabled={!!localSettings.speedAlerts} onChange={(v) => {
                            try {
                                localStorage.setItem('setting_speed_alerts', JSON.stringify(v));
                                localStorage.setItem('myway_speed_alerts', JSON.stringify(v));
                            } catch (e) {}
                            updateSetting('speedAlerts', v);
                        }} />
                    </SettingRow>
                </AccordionSection>

                {/* Navigation & Route Preferences */}
                <AccordionSection
                    id="navigation_routing"
                    title="Navigation & Routing"
                    icon={Compass}
                    subtitle={`${localSettings.avoidTolls ? 'Avoiding Tolls' : 'Allow Tolls'} • ${localSettings.avoidHighways ? 'Avoiding Highways' : 'Use Highways'}`}
                >
                    <SettingRow label="Avoid Toll Roads & Bridges" description="Prioritize toll-free routes and calculate toll fees">
                        <ToggleSwitch enabled={!!localSettings.avoidTolls} onChange={(v) => {
                            updateSetting('avoidTolls', v);
                            localStorage.setItem('myway_avoid_tolls', String(v));
                        }} />
                    </SettingRow>
                    <SettingRow label="Avoid Highways & Freeways" description="Prefer local avenues and scenic boulevards">
                        <ToggleSwitch enabled={!!localSettings.avoidHighways} onChange={(v) => {
                            updateSetting('avoidHighways', v);
                            localStorage.setItem('myway_avoid_highways', String(v));
                        }} />
                    </SettingRow>
                    <SettingRow
                        label="Road & Rail Alerts"
                        description="Show signals, crossings, speed cameras, and stop signs while navigating"
                    >
                        <ToggleSwitch
                            enabled={localSettings.showTrafficControls !== false}
                            onChange={(v) => updateSetting('showTrafficControls', v)}
                        />
                    </SettingRow>
                    <SettingRow label="Auto-record trips" description="Record local rear-camera footage while navigating">
                        <ToggleSwitch enabled={localSettings.autoRoadRecording !== false} onChange={(v) => updateSetting('autoRoadRecording', v)} />
                    </SettingRow>
                </AccordionSection>


                {/* 5. Map & Offline */}
                <AccordionSection
                    id="map_offline_storage"
                    title="Map & Offline"
                    icon={Map}
                    subtitle={localSettings.buildingScale === 'none' ? 'Clean Map' : localSettings.buildingScale === 'flat' ? 'Flat 2D' : 'Realistic 3D'}
                >
                    <div className="flex flex-col gap-4">
                        {/* 3D Building Scale */}
                        <div>
                            <div className="flex items-center justify-between mb-2">
                                <div>
                                    <h4 className={`text-xs font-black ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>3D Building Height</h4>
                                    <p className="text-[11px] text-slate-500">Scale skyline & downtown structures</p>
                                </div>
                                <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-md bg-indigo-500/20 text-indigo-400">
                                    {localSettings.buildingScale === 'none' ? 'None (Clean)' : localSettings.buildingScale === 'flat' ? 'Flat (0x)' : '1.0x'}
                                </span>
                            </div>
                            <div className={`grid grid-cols-2 sm:flex p-1 rounded-xl border gap-1 ${
                                theme === 'dark' ? 'bg-white/5 border-white/10' : 'bg-slate-100 border-slate-200'
                            }`}>
                                {[
                                    { id: 'none', label: 'None', icon: Minus },
                                    { id: 'flat', label: 'Flat', icon: Square },
                                    { id: 'realistic', label: 'Real (1x)', icon: Building2 }
                                ].map(scale => {
                                    const ScaleIcon = scale.icon;
                                    const isSelected = (localSettings.buildingScale || 'realistic') === scale.id;
                                    return (
                                        <button
                                            key={scale.id}
                                            onClick={() => updateSetting('buildingScale', scale.id as any)}
                                            className={`flex-1 py-1.5 px-1.5 text-[9.5px] font-black uppercase rounded-lg transition-all min-w-0 flex items-center justify-center gap-1 truncate ${
                                                isSelected
                                                    ? 'bg-indigo-600 text-white shadow-md'
                                                    : theme === 'dark' ? 'text-slate-400 hover:text-slate-200' : 'text-slate-600 hover:text-slate-900'
                                            }`}
                                        >
                                            <ScaleIcon className={`w-3 h-3 shrink-0 ${isSelected ? 'text-white' : 'text-slate-400'}`} />
                                            <span className="truncate">{scale.label}</span>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Map Skin Selector */}
                        <div className="order-first">
                            <div className="flex items-center justify-between mb-2">
                                <h4 className={`text-xs font-black ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>Map Theme & Skin</h4>
                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${theme === 'dark' ? 'bg-white/10 text-slate-400' : 'bg-slate-100 text-slate-500'}`}>
                                    {MAP_SKINS.length} Themes
                                </span>
                            </div>
                            <div className="grid grid-cols-3 gap-1.5">
                                {MAP_SKINS.map((skin) => {
                                    const selectedSkinId = localSettings.mapSkin || 'default';
                                    const isSelected = selectedSkinId === skin.id || (selectedSkinId === 'warm_cream' && skin.id === 'default');
                                    return (
                                        <button
                                            key={skin.id}
                                            onClick={() => updateSetting('mapSkin', skin.id)}
                                            title={skin.description}
                                            aria-label={`${skin.name}: ${skin.description}`}
                                            className={`min-w-0 rounded-xl border px-2 py-2 text-left transition-all relative overflow-hidden ${
                                                isSelected
                                                    ? 'bg-indigo-600/20 border-indigo-500 ring-2 ring-indigo-500/40 text-white shadow-lg'
                                                    : theme === 'dark'
                                                        ? 'bg-white/5 border-white/10 text-slate-300 hover:bg-white/10'
                                                        : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                                            }`}
                                        >
                                            <div className="flex items-center gap-1.5 min-w-0">
                                                <span className="text-sm shrink-0">{skin.preview}</span>
                                                <span className="font-black text-[10px] leading-tight truncate flex-1">{skin.name}</span>
                                                {isSelected && (
                                                    <span className="w-1.5 h-1.5 shrink-0 rounded-full bg-emerald-400 animate-pulse" />
                                                )}
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    </div>

                    <div className={`border-t pt-4 ${theme === 'dark' ? 'border-white/10' : 'border-slate-200'}`}>
                        <SettingRow label="Downloads" description="Manage saved map areas">
                            <button
                                onClick={onOpenOfflineMaps}
                                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all border ${theme === 'dark'
                                    ? 'bg-white/5 text-slate-300 border-white/10 hover:bg-white/10'
                                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                                    } `}
                            >
                                Manage Maps
                            </button>
                        </SettingRow>
                    </div>
                </AccordionSection>

                {/* 6. Account & Security */}
                <AccordionSection
                    id="account"
                    title="Membership & Security"
                    icon={User}
                    subtitle="Circle Locker & Billing"
                >
                    <div className="space-y-3">
                        <div className={`rounded-2xl border p-3.5 ${theme === 'dark'
                            ? 'bg-emerald-500/10 border-emerald-400/20'
                            : 'bg-emerald-50/70 border-emerald-100'
                            }`}>
                            <div className="flex items-start gap-2.5">
                                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-emerald-500 text-white">
                                    <User className="h-4 w-4" />
                                </div>
                                <div className="min-w-0">
                                    <p className={`text-sm font-black ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>Signed-in account</p>
                                    <p className="mt-0.5 break-all text-xs font-bold text-slate-600 dark:text-slate-300">{userEmail || 'Email unavailable for this sign-in method'}</p>
                                    <p className="mt-1 text-[10px] leading-relaxed text-slate-500">This is the account currently connected to MyWay.</p>
                                </div>
                            </div>
                        </div>
                        <div className={`rounded-2xl border p-3.5 ${theme === 'dark'
                            ? 'bg-indigo-500/10 border-indigo-400/20'
                            : 'bg-indigo-50/70 border-indigo-100'
                            }`}>
                            <div className="flex items-start justify-between gap-3 mb-3">
                                <div className="flex gap-2.5">
                                    <div className="w-8 h-8 rounded-xl bg-indigo-500 text-white flex items-center justify-center shrink-0">
                                        <Smartphone className="w-4 h-4" />
                                    </div>
                                    <div>
                                        <p className={`text-sm font-black ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>This device</p>
                                        <p className="text-[11px] leading-relaxed text-slate-500">The device currently open in MyWay.</p>
                                    </div>
                                </div>
                                <span className={`rounded-full px-2 py-1 text-[9px] font-black whitespace-nowrap ${currentDeviceIsMobile ? 'bg-emerald-500/15 text-emerald-600' : 'bg-sky-500/15 text-sky-600'}`}>
                                    {currentDeviceIsMobile ? 'PHONE GPS READY' : 'COMPANION SCREEN'}
                                </span>
                            </div>

                            <div className={`flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 ${theme === 'dark' ? 'bg-slate-950/35' : 'bg-white/80'}`}>
                                <div className="min-w-0 flex items-center gap-2">
                                    {currentDevice.platform === 'web' ? <Monitor className="w-4 h-4 shrink-0 text-slate-400" /> : <Smartphone className="w-4 h-4 shrink-0 text-slate-400" />}
                                    <div className="min-w-0">
                                        <p className={`truncate text-xs font-bold ${theme === 'dark' ? 'text-slate-100' : 'text-slate-800'}`}>{currentDevice.label} · This device</p>
                                        <p className="text-[10px] text-slate-500">{currentDevice.isLocationPublisher ? 'Sharing live location' : 'Alerts & map access'} · My Way v{APP_VERSION}</p>
                                    </div>
                                </div>
                                {currentDevice.isLocationPublisher && <span className="rounded-full bg-emerald-500/15 px-2 py-1 text-[9px] font-black text-emerald-600">LIVE GPS</span>}
                            </div>
                            {currentDeviceIsMobile && !currentDevice.isLocationPublisher && (
                                <button type="button" disabled={deviceActionPending} onClick={claimThisDeviceForLocation} className="mt-2 w-full rounded-lg bg-indigo-600 px-2.5 py-2 text-[10px] font-black text-white disabled:opacity-50">
                                    Share location from this phone
                                </button>
                            )}
                            {nativeBackgroundTrackingService.isSupported() && currentDevice.isLocationPublisher && (
                                <div className={`mt-2 flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 ${isNativeBackgroundTrackingActive ? (theme === 'dark' ? 'border-emerald-400/25 bg-emerald-500/10' : 'border-emerald-200 bg-emerald-50') : (theme === 'dark' ? 'border-amber-400/25 bg-amber-500/10' : 'border-amber-200 bg-amber-50')}`}>
                                    <div>
                                        <p className={`text-[11px] font-black ${theme === 'dark' ? 'text-slate-100' : 'text-slate-800'}`}>Background location</p>
                                        <p className="mt-0.5 text-[10px] text-slate-500">{isNativeBackgroundTrackingActive ? 'Continues after you close the MyWay screen.' : 'Open MyWay once to activate secure background tracking.'}</p>
                                    </div>
                                    <span className={`shrink-0 rounded-full px-2 py-1 text-[9px] font-black ${isNativeBackgroundTrackingActive ? 'bg-emerald-500/15 text-emerald-600' : 'bg-amber-500/15 text-amber-600'}`}>
                                        {isNativeBackgroundTrackingActive ? 'ACTIVE' : 'NOT ACTIVE'}
                                    </span>
                                </div>
                            )}
                            {deviceActionError && <p className="mt-2 text-[11px] font-semibold text-red-500">{deviceActionError}</p>}
                            <button
                                type="button"
                                disabled={deviceActionPending}
                                onClick={() => {
                                    if (confirm('Sign out of My Way on every device? You will need to sign in again.')) void handleSignOutEverywhere();
                                }}
                                className="mt-3 w-full rounded-xl border border-red-200 bg-white/60 px-3 py-2 text-xs font-black text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50"
                            >
                                Sign out of all devices
                            </button>
                        </div>

                        <button
                            onClick={handleOpenContributions}
                            className={`w-full py-3 px-4 rounded-xl font-medium transition-colors flex items-center justify-between ${theme === 'dark'
                                ? 'bg-white/5 text-slate-300 hover:bg-white/10'
                                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                } `}>
                            <span className="flex items-center gap-2">
                                <Award className="w-4 h-4 text-indigo-400 shrink-0" />
                                <span>Contribution History</span>
                            </span>
                            <span className="text-xs text-indigo-400 font-bold">View →</span>
                        </button>
                    </div>
                </AccordionSection>

                {/* 7. Contribution History Menu Item */}
                <div className={`border-b ${theme === 'dark' ? 'border-white/5' : 'border-slate-100'} pb-3`}>
                    <button
                        onClick={handleOpenContributions}
                        className="w-full flex items-center justify-between py-3 text-left focus:outline-none group/btn transition-colors cursor-pointer"
                    >
                        <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-xl bg-indigo-500/10 flex items-center justify-center shrink-0">
                                <Award className="w-4 h-4 text-indigo-500" />
                            </div>
                            <div>
                                <p className={`font-semibold text-sm ${theme === 'dark' ? 'text-white' : 'text-slate-900'} group-hover/btn:text-indigo-400 transition-colors`}>
                                    Contribution History
                                </p>
                                <p className="text-[10px] text-slate-500 font-bold mt-0.5 uppercase tracking-wider">
                                    Map edits, added places & reports
                                </p>
                            </div>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <span className="text-xs text-indigo-400 font-bold hidden sm:inline-block">View</span>
                            <ChevronRight className="w-4 h-4 text-slate-400 group-hover/btn:text-indigo-400 group-hover/btn:translate-x-0.5 transition-all shrink-0" />
                        </div>
                    </button>
                </div>

                {/* Upgrade Banner */}
                {!isPremium && onUpgrade && (
                    <div className="pt-4">
                        <button
                            onClick={onUpgrade}
                            className="w-full py-3 rounded-xl bg-gradient-to-r from-amber-400 via-amber-500 to-orange-500 text-black font-black text-sm uppercase tracking-wider
                                hover:shadow-lg hover:shadow-amber-500/30 hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-2"
                        >
                            <Sparkles className="w-4 h-4 text-black shrink-0" />
                            <span>Upgrade to Gold</span>
                        </button>
                    </div>
                )}

                {isMapAdmin && (
                    <AccordionSection
                        id="operations"
                        title="My Way Operations"
                        icon={ShieldCheck}
                        subtitle="Community map review & admin recovery"
                        badge={pendingReviewCount && pendingReviewCount > 0 ? (
                            <span className="min-w-5 h-5 px-1.5 rounded-full bg-violet-600 text-white text-[10px] font-black grid place-items-center shadow-sm" aria-label={`${pendingReviewCount} submissions pending review`}>
                                {pendingReviewCount > 99 ? '99+' : pendingReviewCount}
                            </span>
                        ) : undefined}
                    >
                        <div className="space-y-3">
                            <button
                                type="button"
                                onClick={() => setIsMapReviewOpen(true)}
                                className={`w-full flex items-center justify-between rounded-2xl border p-3.5 text-left transition-colors ${theme === 'dark' ? 'bg-violet-500/10 border-violet-400/25 hover:bg-violet-500/15' : 'bg-violet-50 border-violet-200 hover:bg-violet-100'}`}
                            >
                                <span className="flex items-center gap-2.5"><ShieldCheck className="w-5 h-5 text-violet-500" /><span><span className="block text-sm font-black">Review community submissions</span><span className="block text-[11px] text-slate-500">Resolve exceptional map edits and reports</span></span></span>
                                <ChevronRight className="w-4 h-4 text-slate-400" />
                            </button>
                            {!hasRecoveryAdmin && (
                                <div className={`rounded-2xl border p-3 ${theme === 'dark' ? 'bg-amber-500/10 border-amber-400/25' : 'bg-amber-50 border-amber-200'}`}>
                                    <p className="text-xs font-black text-amber-500">Add a recovery admin</p>
                                    <p className="mt-1 text-[11px] text-slate-500">Required before this app-admin account can be deleted.</p>
                                    <div className="mt-2 flex gap-2"><input value={recoveryAdminEmail} onChange={event => setRecoveryAdminEmail(event.target.value)} placeholder="trusted@email.com" type="email" className="min-w-0 flex-1 rounded-xl border border-slate-300/30 bg-white/5 px-3 py-2 text-xs outline-none" /><button type="button" disabled={!recoveryAdminEmail.trim() || isAssigningRecoveryAdmin} onClick={() => void addRecoveryAdmin()} className="rounded-xl bg-amber-500 px-3 py-2 text-xs font-black text-slate-950 disabled:opacity-50">{isAssigningRecoveryAdmin ? 'Adding…' : 'Add'}</button></div>
                                    {recoveryAdminMessage && <p className="mt-2 text-[11px] text-slate-500">{recoveryAdminMessage}</p>}
                                </div>
                            )}
                        </div>
                    </AccordionSection>
                )}

                {/* Version */}
                <div className={`pt-6 pb-2 text-center border-t ${theme === 'dark' ? 'border-white/10' : 'border-slate-200'} `}>
                    <p className="text-xs text-slate-500">My Way v1.0.13</p>
                </div>
            </div>

            {/* Delete Account In-App Confirmation Modal */}
            {showDeleteModal && (
                <div className="fixed inset-0 z-[300] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className={`w-full max-w-md rounded-2xl p-6 shadow-2xl border ${
                        theme === 'dark'
                            ? 'bg-[#0f172a] border-red-500/30 text-white'
                            : 'bg-white border-red-200 text-slate-900'
                    } animate-in fade-in zoom-in duration-200`}>
                        {/* Header */}
                        <div className="flex items-start justify-between gap-3 mb-4">
                            <div className="flex items-center gap-3">
                                <div className="p-2.5 rounded-full bg-red-500/10 text-red-500 shrink-0">
                                    <AlertTriangle className="w-5 h-5" />
                                </div>
                                <div>
                                    <h3 className="text-base font-bold text-red-500">Delete Account & Erase Data</h3>
                                    <p className={`text-xs ${theme === 'dark' ? 'text-slate-400' : 'text-slate-500'}`}>
                                        This action is permanent and irreversible.
                                    </p>
                                </div>
                            </div>
                            <button
                                type="button"
                                disabled={isDeleting}
                                onClick={() => setShowDeleteModal(false)}
                                className="p-1 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        {/* Warning Text */}
                        <div className={`p-3 rounded-xl mb-4 text-xs leading-relaxed border ${
                            theme === 'dark' 
                                ? 'bg-red-950/40 border-red-900/50 text-red-300' 
                                : 'bg-red-50 border-red-200 text-red-700'
                        }`}>
                            ⚠️ All your data, circle memberships, location history, saved places, and cryptographic keys will be permanently deleted from the servers and Google Firebase Authentication.
                            {isMapAdmin && !hasRecoveryAdmin && (
                                <span className="mt-2 block font-bold">This is your only My Way Operations account. Add a recovery admin above before this account can be deleted.</span>
                            )}
                        </div>

                        {/* Error Message */}
                        {deleteError && (
                            <div className="mb-4 p-3 rounded-xl bg-red-500/15 border border-red-500/40 text-red-400 text-xs font-semibold">
                                {deleteError}
                            </div>
                        )}

                        {/* Confirmation input: Type DELETE */}
                        <div className="space-y-3 mb-5">
                            <div>
                                <label className={`block text-[11px] font-bold uppercase tracking-wider mb-1.5 ${
                                    theme === 'dark' ? 'text-slate-300' : 'text-slate-700'
                                }`}>
                                    Type <span className="text-red-500 font-mono font-black">DELETE</span> to confirm:
                                </label>
                                <input
                                    type="text"
                                    value={deleteConfirmText}
                                    onChange={(e) => setDeleteConfirmText(e.target.value)}
                                    placeholder="DELETE"
                                    disabled={isDeleting}
                                    className={`w-full px-3 py-2 text-sm rounded-xl outline-none font-mono text-center tracking-widest uppercase transition-all ${
                                        theme === 'dark'
                                            ? 'bg-white/5 border border-white/10 text-white focus:border-red-500'
                                            : 'bg-slate-50 border border-slate-200 text-slate-900 focus:border-red-500'
                                    }`}
                                />
                            </div>

                            {/* Password input for re-auth */}
                            <div>
                                <label className={`block text-[11px] font-bold uppercase tracking-wider mb-1.5 ${
                                    theme === 'dark' ? 'text-slate-300' : 'text-slate-700'
                                }`}>
                                    Account Password:
                                </label>
                                <input
                                    type="password"
                                    value={deletePassword}
                                    onChange={(e) => setDeletePassword(e.target.value)}
                                    placeholder="Enter your password"
                                    disabled={isDeleting}
                                    className={`w-full px-3 py-2 text-sm rounded-xl outline-none transition-all ${
                                        theme === 'dark'
                                            ? 'bg-white/5 border border-white/10 text-white focus:border-red-500'
                                            : 'bg-slate-50 border border-slate-200 text-slate-900 focus:border-red-500'
                                    }`}
                                />
                                <p className="text-[10px] text-slate-400 mt-1">
                                    Required by Firebase security to verify identity before deleting credentials. (Leave blank if you signed in with Google).
                                </p>
                            </div>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-3">
                            <button
                                type="button"
                                disabled={isDeleting}
                                onClick={() => setShowDeleteModal(false)}
                                className={`flex-1 py-2.5 px-4 rounded-xl text-xs font-bold transition-all border ${
                                    theme === 'dark'
                                        ? 'bg-white/5 border-white/10 hover:bg-white/10 text-white'
                                        : 'bg-slate-100 border-slate-200 hover:bg-slate-200 text-slate-700'
                                }`}
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                disabled={deleteConfirmText.trim() !== 'DELETE' || isDeleting}
                                onClick={async () => {
                                    if (deleteConfirmText.trim() !== 'DELETE') return;
                                    setIsDeleting(true);
                                    setDeleteError(null);
                                    try {
                                        if (onDeleteAccount) {
                                            await onDeleteAccount(deletePassword || undefined);
                                        } else {
                                            const { deleteAccount } = await import('../services/authService');
                                            await deleteAccount(userId, circleId, deletePassword || undefined);
                                        }
                                        setShowDeleteModal(false);
                                        onSignOut?.();
                                    } catch (err: any) {
                                        console.error('Delete account error:', err);
                                        setDeleteError(err.message || 'Failed to delete account. Please verify your password.');
                                    } finally {
                                        setIsDeleting(false);
                                    }
                                }}
                                className={`flex-1 py-2.5 px-4 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 ${
                                    deleteConfirmText.trim() === 'DELETE' && !isDeleting
                                        ? 'bg-red-600 hover:bg-red-700 text-white shadow-lg shadow-red-600/30'
                                        : 'bg-red-600/40 text-white/50 cursor-not-allowed'
                                }`}
                            >
                                {isDeleting ? (
                                    <span>Deleting...</span>
                                ) : (
                                    <>
                                        <Trash2 className="w-3.5 h-3.5 shrink-0" />
                                        <span>Permanently Delete</span>
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {isMapReviewOpen && <MapReviewPanel theme={theme} onClose={() => setIsMapReviewOpen(false)} onQueueCountChange={setPendingReviewCount} />}
        </div>
    );
};

export default React.memo(SettingsPanel);
