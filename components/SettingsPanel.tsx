
import React, { useState, useEffect } from 'react';
import { MapSkinId } from '../services/mapSkinService';
import StorageManager from './StorageManager';
import { PrivacyMode, Vehicle } from '../types';
import { vehicleFuelService, VEHICLE_PRESETS } from '../services/vehicleFuelService';

export interface UserSettings {
    theme: 'light' | 'dark' | 'auto';
    notifications: boolean;
    locationSharing: boolean;
    batteryAlerts: boolean;
    arrivalAlerts: boolean;
    speedAlerts: boolean;
    mapStyle: 'standard' | 'satellite' | 'terrain';
    units: 'imperial' | 'metric';
    mapSkin: MapSkinId;
    buildingScale?: 'realistic' | 'enhanced' | 'monumental';
    landmarkGlow?: boolean;
    avoidTolls?: boolean;
    avoidHighways?: boolean;
    privacyMode?: PrivacyMode;
}

interface SettingsPanelProps {
    settings: UserSettings;
    onUpdateSettings: (settings: UserSettings) => void;
    onClose: () => void;
    onOpenOfflineMaps?: () => void;
    theme: 'light' | 'dark';
    userName: string;
    userAvatar: string;
    onUpgrade?: () => void;
    isPremium?: boolean;
    // New props for account management
    onSignOut?: () => void;
    onManageSubscription?: () => void;
    onShowPrivacy?: () => void;
    onManageCircle?: () => void;
    onOpenKeyRecovery?: () => void;
    onUpdateProfile?: (name: string, avatarFile?: File) => Promise<void>;
}

const SettingsPanel: React.FC<SettingsPanelProps> = ({
    settings,
    onUpdateSettings,
    onClose,
    onOpenOfflineMaps,
    theme,
    userName,
    userAvatar,
    onUpgrade,
    isPremium = false,
    onSignOut,
    onManageSubscription,
    onShowPrivacy,
    onManageCircle,
    onOpenKeyRecovery,
    onUpdateProfile
}) => {
    const [localSettings, setLocalSettings] = useState(settings);
 
    // Profile Edit State
    const [isEditingProfile, setIsEditingProfile] = useState(false);
    const [editName, setEditName] = useState(userName);
    const [isUploading, setIsUploading] = useState(false);
    const fileInputRef = React.useRef<HTMLInputElement>(null);

    // Accordion State
    const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
        alerts: true, // open by default
        vehicle_fuel: true, // Vehicle & Fuel Economy
        map_visuals: true, // 3D buildings & map customization
        system: false,
        account: false
    });

    // Vehicle Garage & Fuel States
    const [vehicles, setVehicles] = useState<Vehicle[]>(() => vehicleFuelService.getVehicles());
    const [activeVeh, setActiveVeh] = useState<Vehicle>(() => vehicleFuelService.getActiveVehicle());
    const [gasPriceInput, setGasPriceInput] = useState<string>(() => vehicleFuelService.getGasPrice().toFixed(2));
    const [isCustomAdding, setIsCustomAdding] = useState<boolean>(false);
    const [customMake, setCustomMake] = useState('');
    const [customModel, setCustomModel] = useState('');
    const [customYear, setCustomYear] = useState<number>(2023);
    const [customMpg, setCustomMpg] = useState<number>(30);
    const [customFuelType, setCustomFuelType] = useState<Vehicle['fuelType']>('gasoline');

    const handleSelectActiveVehicle = (id: string) => {
        vehicleFuelService.setActiveVehicle(id);
        setActiveVeh(vehicleFuelService.getActiveVehicle());
        setVehicles(vehicleFuelService.getVehicles());
    };

    const handleAddPreset = (preset: typeof VEHICLE_PRESETS[0]) => {
        vehicleFuelService.addVehicle(preset);
        setVehicles(vehicleFuelService.getVehicles());
        setActiveVeh(vehicleFuelService.getActiveVehicle());
    };

    const handleAddCustomVehicle = () => {
        if (!customMake.trim() || !customModel.trim()) return;
        vehicleFuelService.addVehicle({
            name: `${customYear} ${customMake} ${customModel}`.trim(),
            make: customMake.trim(),
            model: customModel.trim(),
            year: customYear,
            mpg: customMpg || 28,
            fuelType: customFuelType,
            isPrimary: vehicles.length === 0
        });
        setVehicles(vehicleFuelService.getVehicles());
        setActiveVeh(vehicleFuelService.getActiveVehicle());
        setIsCustomAdding(false);
        setCustomMake('');
        setCustomModel('');
    };

    const handleDeleteVehicle = (id: string) => {
        vehicleFuelService.deleteVehicle(id);
        setVehicles(vehicleFuelService.getVehicles());
        setActiveVeh(vehicleFuelService.getActiveVehicle());
    };

    const handleGasPriceChange = (val: string) => {
        setGasPriceInput(val);
        const parsed = parseFloat(val);
        if (!isNaN(parsed) && parsed > 0) {
            vehicleFuelService.setGasPrice(parsed);
        }
    };

    const toggleSection = (section: string) => {
        setExpandedSections(prev => ({
            ...prev,
            [section]: !prev[section]
        }));
    };

    const hasAnyExpanded = Object.values(expandedSections).some(v => v);

    const toggleAllSections = () => {
        const targetValue = !hasAnyExpanded;
        setExpandedSections({
            alerts: targetValue,
            map_visuals: targetValue,
            system: targetValue,
            account: targetValue
        });
    };

    const AccordionSection = ({
        id,
        title,
        subtitle,
        emoji,
        children
    }: {
        id: string;
        title: string;
        subtitle?: string;
        emoji: string;
        children: React.ReactNode;
    }) => {
        const isOpen = !!expandedSections[id];
        return (
            <div className={`border-b ${theme === 'dark' ? 'border-white/5' : 'border-slate-100'} pb-3`}>
                <button
                    onClick={() => toggleSection(id)}
                    className="w-full flex items-center justify-between py-3 text-left focus:outline-none group/btn transition-colors"
                >
                    <div className="flex items-center gap-3">
                        <span className="text-xl">{emoji}</span>
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
                    <span className={`text-xs text-slate-400 transition-transform duration-300 ${isOpen ? 'rotate-180 text-indigo-400' : ''}`}>
                        ▼
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

    return (
        <div className={`flex flex-col h-full max-h-full rounded-3xl overflow-hidden shadow-2xl border
      ${theme === 'dark'
                ? 'bg-slate-900/95 border-white/10'
                : 'bg-white/95 border-slate-200'
            } `}
        >
            {/* Header */}
            <div className={`p-6 border-b ${theme === 'dark' ? 'border-white/10' : 'border-slate-200'} `}>
                <div className="flex items-center justify-between mb-8">
                    <h2 className={`text-xl font-bold ${theme === 'dark' ? 'text-white' : 'text-slate-900'} `}>
                        My Settings
                    </h2>
                    <div className="flex items-center gap-2">
                        {!isEditingProfile ? (
                            <button
                                onClick={() => {
                                    setEditName(userName);
                                    setIsEditingProfile(true);
                                }}
                                className={`px-4 py-2 rounded-xl border text-sm font-bold transition-all
                                    ${theme === 'dark'
                                        ? 'bg-white/5 border-white/10 text-indigo-400 hover:bg-white/10'
                                        : 'bg-indigo-50 border-indigo-100 text-indigo-600 hover:bg-indigo-100'}`}
                            >
                                ✏️ Edit Profile
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
                            ✕
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
                                className="absolute inset-0 bg-black/40 rounded-2xl flex items-center justify-center opacity-0 group-hover/avatar:opacity-100 transition-opacity"
                            >
                                <span className="text-xl">📸</span>
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


                {/* 4. Alerts & Privacy */}
                <AccordionSection
                    id="alerts"
                    title="Alerts & Privacy"
                    emoji="🔔"
                    subtitle={`${localSettings.privacyMode === 'blurred' ? 'Neighborhood Blurred' : localSettings.privacyMode === 'status_only' ? 'Status Only' : localSettings.privacyMode === 'frozen' ? 'Location Frozen' : 'Exact GPS'} • ${localSettings.notifications ? 'Alerts On' : 'Alerts Off'}`}
                >
                    {/* Granular Ghost & Privacy Blur Selector */}
                    <div className="mb-4 pb-3 border-b border-white/10">
                        <div className="flex items-center justify-between mb-1.5">
                            <div>
                                <h4 className={`text-xs font-black flex items-center gap-1.5 ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>
                                    <span>👻</span>
                                    <span>Location Privacy Level</span>
                                </h4>
                                <p className="text-[11px] text-slate-400">Control how circle members see your location</p>
                            </div>
                            <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-md bg-purple-500/20 text-purple-300">
                                {localSettings.privacyMode === 'blurred' ? 'Blurred' : localSettings.privacyMode === 'status_only' ? 'Milestones' : localSettings.privacyMode === 'frozen' ? 'Frozen' : 'Exact'}
                            </span>
                        </div>

                        <div className={`grid grid-cols-2 gap-1.5 p-1 rounded-xl border mt-2 ${
                            theme === 'dark' ? 'bg-white/5 border-white/10' : 'bg-slate-100 border-slate-200'
                        }`}>
                            {[
                                { id: 'exact', label: '📍 Exact (5m)', desc: 'Live GPS Pin' },
                                { id: 'blurred', label: '🏙️ Blurred (~1.5mi)', desc: 'Neighborhood Halo' },
                                { id: 'status_only', label: '🏫 Status Only', desc: 'Geofences Only' },
                                { id: 'frozen', label: '❄️ Frozen', desc: 'Pause Location' }
                            ].map(mode => {
                                const isCurrent = (localSettings.privacyMode || 'exact') === mode.id;
                                return (
                                    <button
                                        key={mode.id}
                                        type="button"
                                        onClick={() => {
                                            updateSetting('privacyMode', mode.id as any);
                                            localStorage.setItem('myway_privacy_mode', mode.id);
                                        }}
                                        className={`p-2 rounded-lg text-left transition-all border ${
                                            isCurrent
                                                ? 'bg-purple-600 text-white border-purple-400 shadow-md ring-1 ring-purple-400/50'
                                                : theme === 'dark'
                                                    ? 'bg-white/5 border-white/5 text-slate-300 hover:bg-white/10'
                                                    : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                                        }`}
                                    >
                                        <div className="text-[11px] font-black">{mode.label}</div>
                                        <div className={`text-[9px] mt-0.5 ${isCurrent ? 'text-purple-200' : 'text-slate-400'}`}>{mode.desc}</div>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    <SettingRow label="Location Sharing" description="Share your location with family">
                        <ToggleSwitch enabled={localSettings.locationSharing} onChange={(v) => updateSetting('locationSharing', v)} />
                    </SettingRow>
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
                        <ToggleSwitch enabled={localSettings.speedAlerts} onChange={(v) => updateSetting('speedAlerts', v)} />
                    </SettingRow>
                </AccordionSection>

                {/* Navigation & Route Preferences */}
                <AccordionSection
                    id="navigation_routing"
                    title="Navigation & Routing"
                    emoji="🧭"
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
                </AccordionSection>

                {/* 🚗 Vehicle Profile & Fuel Economy */}
                <AccordionSection
                    id="vehicle_fuel"
                    title="Vehicle & Fuel Economy"
                    emoji="🚗"
                    subtitle={`${activeVeh.name} (${activeVeh.mpg} MPG) • $${gasPriceInput}/gal`}
                >
                    <div className="space-y-4">
                        {/* Active Vehicle Badge */}
                        <div className={`p-3.5 rounded-2xl border ${
                            theme === 'dark' ? 'bg-indigo-950/40 border-indigo-500/30' : 'bg-indigo-50/80 border-indigo-200'
                        }`}>
                            <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-2">
                                    <span className="text-xl">
                                        {activeVeh.fuelType === 'electric' ? '⚡' : activeVeh.fuelType === 'hybrid' ? '🌿' : '🚗'}
                                    </span>
                                    <div>
                                        <h4 className={`text-xs font-black ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>
                                            {activeVeh.name}
                                        </h4>
                                        <p className="text-[10px] text-indigo-400 font-bold uppercase tracking-wider">
                                            Active Driving Profile
                                        </p>
                                    </div>
                                </div>
                                <span className="text-xs font-black px-2 py-0.5 rounded-lg bg-indigo-500/20 text-indigo-300">
                                    {activeVeh.mpg} {activeVeh.fuelType === 'electric' ? 'MPGe' : 'MPG'}
                                </span>
                            </div>

                            <div className="grid grid-cols-2 gap-2 mt-2 pt-2 border-t border-indigo-500/20 text-[11px]">
                                <div>
                                    <span className="text-slate-400">Fuel Type: </span>
                                    <span className="font-bold capitalize text-slate-200">{activeVeh.fuelType}</span>
                                </div>
                                <div>
                                    <span className="text-slate-400">Gas Price: </span>
                                    <span className="font-bold text-emerald-400">${gasPriceInput}/gal</span>
                                </div>
                            </div>
                        </div>

                        {/* Local Gas Price Setting */}
                        <div className="flex items-center justify-between p-2 rounded-xl bg-white/5 border border-white/5">
                            <div>
                                <h4 className={`text-xs font-bold ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>Gas Price ($/gal)</h4>
                                <p className="text-[10px] text-slate-400">Used for per-trip and annual fuel estimates</p>
                            </div>
                            <div className="flex items-center gap-1">
                                <span className="text-xs text-slate-400">$</span>
                                <input
                                    type="number"
                                    step="0.05"
                                    value={gasPriceInput}
                                    onChange={(e) => handleGasPriceChange(e.target.value)}
                                    className={`w-16 px-2 py-1 text-xs font-bold rounded-lg text-center border ${
                                        theme === 'dark' ? 'bg-slate-900 border-white/10 text-white' : 'bg-white border-slate-300 text-slate-900'
                                    }`}
                                />
                            </div>
                        </div>

                        {/* My Garage */}
                        <div>
                            <div className="flex items-center justify-between mb-2">
                                <h4 className={`text-xs font-black uppercase tracking-wider ${theme === 'dark' ? 'text-slate-400' : 'text-slate-500'}`}>
                                    My Garage ({vehicles.length})
                                </h4>
                                <button
                                    type="button"
                                    onClick={() => setIsCustomAdding(!isCustomAdding)}
                                    className="text-[11px] font-bold text-indigo-400 hover:text-indigo-300 transition-colors"
                                >
                                    {isCustomAdding ? '✕ Cancel' : '+ Add Custom'}
                                </button>
                            </div>

                            {/* Custom Vehicle Add Form */}
                            {isCustomAdding && (
                                <div className={`p-3 rounded-2xl border mb-3 space-y-2.5 animate-in fade-in ${
                                    theme === 'dark' ? 'bg-white/5 border-white/10' : 'bg-slate-50 border-slate-200'
                                }`}>
                                    <p className="text-[11px] font-bold text-indigo-400">Add Vehicle to Garage</p>
                                    <div className="grid grid-cols-2 gap-2">
                                        <input
                                            type="text"
                                            placeholder="Make (e.g. Honda)"
                                            value={customMake}
                                            onChange={(e) => setCustomMake(e.target.value)}
                                            className={`px-2.5 py-1.5 text-xs rounded-xl border ${
                                                theme === 'dark' ? 'bg-slate-900 border-white/10 text-white' : 'bg-white border-slate-200'
                                            }`}
                                        />
                                        <input
                                            type="text"
                                            placeholder="Model (e.g. Civic)"
                                            value={customModel}
                                            onChange={(e) => setCustomModel(e.target.value)}
                                            className={`px-2.5 py-1.5 text-xs rounded-xl border ${
                                                theme === 'dark' ? 'bg-slate-900 border-white/10 text-white' : 'bg-white border-slate-200'
                                            }`}
                                        />
                                    </div>
                                    <div className="grid grid-cols-3 gap-2">
                                        <input
                                            type="number"
                                            placeholder="Year"
                                            value={customYear}
                                            onChange={(e) => setCustomYear(parseInt(e.target.value) || 2023)}
                                            className={`px-2.5 py-1.5 text-xs rounded-xl border ${
                                                theme === 'dark' ? 'bg-slate-900 border-white/10 text-white' : 'bg-white border-slate-200'
                                            }`}
                                        />
                                        <input
                                            type="number"
                                            placeholder="MPG"
                                            value={customMpg}
                                            onChange={(e) => setCustomMpg(parseInt(e.target.value) || 28)}
                                            className={`px-2.5 py-1.5 text-xs rounded-xl border ${
                                                theme === 'dark' ? 'bg-slate-900 border-white/10 text-white' : 'bg-white border-slate-200'
                                            }`}
                                        />
                                        <select
                                            value={customFuelType}
                                            onChange={(e) => setCustomFuelType(e.target.value as any)}
                                            className={`px-2 py-1.5 text-xs rounded-xl border ${
                                                theme === 'dark' ? 'bg-slate-900 border-white/10 text-white' : 'bg-white border-slate-200'
                                            }`}
                                        >
                                            <option value="gasoline">Gas</option>
                                            <option value="hybrid">Hybrid</option>
                                            <option value="electric">EV</option>
                                            <option value="diesel">Diesel</option>
                                        </select>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={handleAddCustomVehicle}
                                        className="w-full py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow-md transition-all active:scale-95"
                                    >
                                        Save Vehicle
                                    </button>
                                </div>
                            )}

                            {/* Saved Vehicles List */}
                            <div className="space-y-1.5">
                                {vehicles.map(v => {
                                    const isSelected = activeVeh.id === v.id;
                                    return (
                                        <div
                                            key={v.id}
                                            onClick={() => handleSelectActiveVehicle(v.id)}
                                            className={`p-2.5 rounded-xl border cursor-pointer flex items-center justify-between gap-2 transition-all ${
                                                isSelected
                                                    ? 'bg-indigo-600/20 border-indigo-500 shadow-sm ring-1 ring-indigo-500/40'
                                                    : theme === 'dark' ? 'bg-white/5 border-white/5 hover:bg-white/10' : 'bg-white border-slate-200 hover:bg-slate-50'
                                            }`}
                                        >
                                            <div className="flex items-center gap-2 min-w-0 flex-1">
                                                <span className="text-base">
                                                    {v.fuelType === 'electric' ? '⚡' : v.fuelType === 'hybrid' ? '🌿' : '🚗'}
                                                </span>
                                                <div className="min-w-0 flex-1">
                                                    <p className={`text-xs font-bold truncate ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>
                                                        {v.name}
                                                    </p>
                                                    <p className="text-[10px] text-slate-400 capitalize">
                                                        {v.mpg} {v.fuelType === 'electric' ? 'MPGe' : 'MPG'} • {v.fuelType}
                                                    </p>
                                                </div>
                                            </div>

                                            <div className="flex items-center gap-1.5 shrink-0">
                                                {isSelected ? (
                                                    <span className="text-[9px] font-black px-2 py-0.5 rounded-md bg-indigo-500/20 text-indigo-300">
                                                        Active
                                                    </span>
                                                ) : (
                                                    <button
                                                        type="button"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            handleDeleteVehicle(v.id);
                                                        }}
                                                        className="text-[11px] text-slate-500 hover:text-red-400 p-1 rounded transition-colors"
                                                        title="Delete vehicle"
                                                    >
                                                        🗑️
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Quick Presets */}
                        <div>
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                                Instant Vehicle Presets
                            </p>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                                {VEHICLE_PRESETS.slice(0, 4).map((preset, idx) => (
                                    <button
                                        key={idx}
                                        type="button"
                                        onClick={() => handleAddPreset(preset)}
                                        className={`p-2 rounded-xl border text-left transition-all ${
                                            theme === 'dark' ? 'bg-white/5 border-white/5 hover:bg-white/10' : 'bg-slate-50 border-slate-200 hover:bg-slate-100'
                                        }`}
                                    >
                                        <div className="text-[11px] font-bold truncate">{preset.name}</div>
                                        <div className="text-[9px] text-slate-400">{preset.mpg} MPG</div>
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                </AccordionSection>

                {/* 5. Map & 3D Visuals */}
                <AccordionSection
                    id="map_visuals"
                    title="Map & 3D Visuals"
                    emoji="🗺️"
                    subtitle={`${localSettings.buildingScale === 'monumental' ? 'Metropolis Mode' : localSettings.buildingScale === 'realistic' ? 'Realistic Scale' : 'Enhanced Heights'} • ${localSettings.landmarkGlow ? 'Glow On' : 'Glow Off'}`}
                >
                    <div className="space-y-4">
                        {/* 3D Building Scale */}
                        <div>
                            <div className="flex items-center justify-between mb-2">
                                <div>
                                    <h4 className={`text-xs font-black ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>3D Building Height</h4>
                                    <p className="text-[11px] text-slate-500">Scale skyline & downtown structures</p>
                                </div>
                                <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-md bg-indigo-500/20 text-indigo-400">
                                    {localSettings.buildingScale === 'monumental' ? '2.6x' : localSettings.buildingScale === 'realistic' ? '1.0x' : '1.8x'}
                                </span>
                            </div>
                            <div className={`flex p-1 rounded-xl border gap-1 ${
                                theme === 'dark' ? 'bg-white/5 border-white/10' : 'bg-slate-100 border-slate-200'
                            }`}>
                                {[
                                    { id: 'realistic', label: '🏢 Real (1x)' },
                                    { id: 'enhanced', label: '🏙️ Enhanced (1.8x)' },
                                    { id: 'monumental', label: '🌆 Metropolis (2.6x)' }
                                ].map(scale => (
                                    <button
                                        key={scale.id}
                                        onClick={() => updateSetting('buildingScale', scale.id as any)}
                                        className={`flex-1 py-1.5 text-[10px] font-black uppercase rounded-lg transition-all ${
                                            (localSettings.buildingScale || 'enhanced') === scale.id
                                                ? 'bg-indigo-600 text-white shadow-md'
                                                : theme === 'dark' ? 'text-slate-400 hover:text-slate-200' : 'text-slate-600 hover:text-slate-900'
                                        }`}
                                    >
                                        {scale.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Ambient Landmark Glow */}
                        <SettingRow
                            label="Ambient Landmark Glow"
                            description="Illuminated rim lighting on major structures & geofences"
                        >
                            <ToggleSwitch
                                enabled={localSettings.landmarkGlow !== false}
                                onChange={(v) => updateSetting('landmarkGlow', v)}
                            />
                        </SettingRow>

                        {/* Map Skin Selector */}
                        <div>
                            <h4 className={`text-xs font-black mb-2 ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>Map Skin</h4>
                            <div className="grid grid-cols-2 gap-2">
                                <button
                                    onClick={() => updateSetting('mapSkin', 'default')}
                                    className={`py-2.5 px-3 rounded-xl border text-xs font-bold flex items-center justify-center gap-2 transition-all ${
                                        localSettings.mapSkin === 'default'
                                            ? 'bg-indigo-600 border-indigo-500 text-white shadow-md'
                                            : theme === 'dark'
                                                ? 'bg-white/5 border-white/10 text-slate-300 hover:bg-white/10'
                                                : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100'
                                    }`}
                                >
                                    <span>🗺️</span>
                                    <span>Default</span>
                                </button>
                                <div
                                    className={`py-2.5 px-3 rounded-xl border border-dashed text-xs font-bold flex items-center justify-center gap-1.5 select-none ${
                                        theme === 'dark'
                                            ? 'bg-white/5 border-white/20 text-slate-400'
                                            : 'bg-slate-50 border-slate-300 text-slate-500'
                                    }`}
                                >
                                    <span className="text-amber-400">✨</span>
                                    <span>More coming soon</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </AccordionSection>

                {/* 6. System & Offline Storage */}
                <AccordionSection
                    id="system"
                    title="System & Storage"
                    emoji="⚙️"
                    subtitle="Cache, Space & Region Maps"
                >
                    <div className="space-y-3">
                        <StorageManager theme={theme} />
                        <SettingRow label="Offline Maps" description="Manage downloaded regions">
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

                {/* 7. Account & Security */}
                <AccordionSection
                    id="account"
                    title="Membership & Security"
                    emoji="👤"
                    subtitle="Circle Locker & Billing"
                >
                    <div className="space-y-3">
                        {onManageSubscription && (
                            <button
                                onClick={onManageSubscription}
                                className={`w-full py-3 rounded-xl font-medium transition-colors ${theme === 'dark'
                                    ? 'bg-white/5 text-slate-300 hover:bg-white/10'
                                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                    } `}
                            >
                                💳 Manage Subscription
                            </button>
                        )}
                        <button
                            onClick={onManageCircle}
                            className={`w-full py-3 rounded-xl font-medium transition-colors ${theme === 'dark'
                                ? 'bg-white/5 text-slate-300 hover:bg-white/10'
                                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                } `}>
                            Manage Family Circle
                        </button>
                        <button
                            onClick={onShowPrivacy}
                            className={`w-full py-3 rounded-xl font-medium transition-colors ${theme === 'dark'
                                ? 'bg-white/5 text-slate-300 hover:bg-white/10'
                                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                } `}>
                            Privacy Policy
                        </button>
                        {onOpenKeyRecovery && (
                            <button
                                onClick={onOpenKeyRecovery}
                                className={`w-full py-3 rounded-xl font-medium transition-colors ${theme === 'dark'
                                    ? 'bg-white/5 text-slate-300 hover:bg-white/10'
                                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                    } `}>
                                🔑 My Security Locker
                            </button>
                        )}
                        {onManageCircle && (
                            <button
                                onClick={() => {
                                    if (confirm('Are you sure you want to leave this circle? Your location data will be removed from the group.')) {
                                        onManageCircle();
                                    }
                                }}
                                className="w-full py-3 rounded-xl font-medium bg-amber-500/10 text-amber-500 hover:bg-amber-500/20 transition-colors"
                            >
                                🚪 Leave MyFamily
                            </button>
                        )}
                    </div>
                </AccordionSection>

                {/* Primary Escape hatches remain persistent at the bottom of scroll list */}
                <div className="pt-6 border-t border-white/5 space-y-3">
                    <button
                        onClick={onSignOut}
                        className="w-full py-3 rounded-xl font-medium bg-red-500/10 text-red-500 hover:bg-red-500/20 transition-colors"
                    >
                        Sign Out
                    </button>
                    <button
                        onClick={async () => {
                            const firstConfirm = confirm('⚠️ Delete your account? This will permanently remove all your data, leave any circles, and cannot be undone.');
                            if (!firstConfirm) return;
                            const typed = prompt('Type DELETE to confirm account deletion:');
                            if (typed !== 'DELETE') return;
                            try {
                                const { deleteAccount } = await import('../services/authService');
                                // @ts-ignore — circleId may be available from parent
                                await deleteAccount(userName, undefined);
                                alert('Account deleted successfully.');
                                onSignOut?.();
                            } catch (err: any) {
                                alert(`Failed: ${err.message}`);
                            }
                        }}
                        className={`w-full py-2 rounded-xl text-xs transition-colors ${
                            theme === 'dark' ? 'text-slate-600 hover:text-red-400 hover:bg-red-500/10' : 'text-slate-400 hover:text-red-500 hover:bg-red-50'
                        }`}
                    >
                        🗑️ Delete Account
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
                            <span>✨</span> Upgrade to Gold
                        </button>
                    </div>
                )}

                {/* Version */}
                <div className={`pt-6 pb-2 text-center border-t ${theme === 'dark' ? 'border-white/10' : 'border-slate-200'} `}>
                    <p className="text-xs text-slate-500">My Way v1.0.0</p>
                </div>
            </div>
        </div>
    );
};

export default React.memo(SettingsPanel);
