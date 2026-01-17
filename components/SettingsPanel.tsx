
import React, { useState } from 'react';
import { MAP_SKINS, MapSkinId, getAvailableSkins } from '../services/mapSkinService';
import { PremiumUpsellModal } from './PremiumUpsellModal';
import StorageManager from './StorageManager';
import { Place } from '../types';

export interface UserSettings {
    theme: 'light' | 'dark' | 'auto';
    notifications: boolean;
    locationSharing: boolean;
    batteryAlerts: boolean;
    arrivalAlerts: boolean;
    speedAlerts: boolean;
    mapStyle: 'standard' | 'satellite' | 'terrain';
    units: 'imperial' | 'metric';
    aiPersonality: 'standard' | 'grok' | 'newyork';
    aiGender: 'male' | 'female';
    mapSkin: MapSkinId;
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
    // New props for places management
    userPlaces?: Place[];
    onAddPlace?: (place: Omit<Place, 'id'>) => void;
    onDeletePlace?: (placeId: string) => void;
    // New props for account management
    onSignOut?: () => void;
    onManageSubscription?: () => void;
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
    userPlaces = [],
    onAddPlace,
    onDeletePlace,
    onSignOut,
    onManageSubscription
}) => {
    const [localSettings, setLocalSettings] = useState(settings);
    const [showAddPlace, setShowAddPlace] = useState(false);
    const [newPlaceName, setNewPlaceName] = useState('');
    const [newPlaceIcon, setNewPlaceIcon] = useState('📍');

    const updateSetting = <K extends keyof UserSettings>(key: K, value: UserSettings[K]) => {
        const updated = { ...localSettings, [key]: value };
        setLocalSettings(updated);
        onUpdateSettings(updated);
    };

    const ToggleSwitch = ({ enabled, onChange }: { enabled: boolean; onChange: (val: boolean) => void }) => (
        <button
            onClick={() => onChange(!enabled)}
            className={`relative w - 12 h - 6 rounded - full transition - all ${enabled
                    ? 'bg-gradient-to-r from-indigo-500 to-purple-600'
                    : theme === 'dark' ? 'bg-white/10' : 'bg-slate-200'
                } `}
        >
            <div className={`absolute top - 0.5 w - 5 h - 5 rounded - full bg - white shadow - md transition - all ${enabled ? 'left-6' : 'left-0.5'
                } `} />
        </button>
    );

    const SectionTitle = ({ children }: { children: React.ReactNode }) => (
        <h3 className={`text - xs font - bold uppercase tracking - wider mb - 3 ${theme === 'dark' ? 'text-slate-500' : 'text-slate-400'
            } `}>
            {children}
        </h3>
    );

    const SettingRow = ({ label, description, children }: { label: string; description?: string; children: React.ReactNode }) => (
        <div className={`flex items - center justify - between py - 3 border - b ${theme === 'dark' ? 'border-white/5' : 'border-slate-100'
            } `}>
            <div>
                <p className={`font - medium ${theme === 'dark' ? 'text-white' : 'text-slate-900'} `}>{label}</p>
                {description && <p className="text-xs text-slate-500 mt-0.5">{description}</p>}
            </div>
            {children}
        </div>
    );

    return (
        <div className={`flex flex - col max - h - full rounded - 3xl overflow - hidden shadow - 2xl border
      ${theme === 'dark'
                ? 'bg-slate-900/95 border-white/10'
                : 'bg-white/95 border-slate-200'
            } `}
        >
            {/* Header */}
            <div className={`p - 6 border - b ${theme === 'dark' ? 'border-white/10' : 'border-slate-200'} `}>
                <div className="flex items-center justify-between mb-4">
                    <h2 className={`text - xl font - bold ${theme === 'dark' ? 'text-white' : 'text-slate-900'} `}>
                        Settings
                    </h2>
                    <button
                        onClick={onClose}
                        className={`w - 10 h - 10 flex items - center justify - center rounded - full text - lg font - bold transition - all
                            ${theme === 'dark'
                                ? 'bg-white/10 text-white hover:bg-red-500/80 hover:text-white'
                                : 'bg-slate-200 text-slate-700 hover:bg-red-500 hover:text-white'
                            } `}
                        aria-label="Close settings"
                    >
                        ✕
                    </button>
                </div>

                {/* User profile */}
                <div className="flex items-center gap-4">
                    <img
                        src={userAvatar}
                        alt={userName}
                        className="w-16 h-16 rounded-2xl object-cover"
                    />
                    <div>
                        <p className={`font - bold text - lg ${theme === 'dark' ? 'text-white' : 'text-slate-900'} `}>
                            {userName}
                        </p>
                        <p className="text-sm text-slate-500">Family Circle Admin</p>
                    </div>
                </div>
            </div>

            {/* Settings content - scrollable with visible scrollbar */}
            <div
                className={`flex - 1 overflow - y - auto p - 6 space - y - 6 scrollbar - visible ${theme === 'light' ? 'scrollbar-visible-light' : ''} `}
                style={{ maxHeight: 'calc(100vh - 280px)' }}
            >

                {/* Appearance */}
                <div>
                    <SectionTitle>Appearance</SectionTitle>
                    <SettingRow label="Theme" description="Choose your preferred color scheme">
                        <div className="flex gap-2">
                            {(['light', 'dark', 'auto'] as const).map(t => (
                                <button
                                    key={t}
                                    onClick={() => updateSetting('theme', t)}
                                    className={`px - 3 py - 1.5 rounded - lg text - xs font - bold capitalize transition - all ${localSettings.theme === t
                                            ? 'bg-gradient-to-r from-indigo-500 to-purple-600 text-white'
                                            : theme === 'dark'
                                                ? 'bg-white/5 text-slate-300 hover:bg-white/10'
                                                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                        } `}
                                >
                                    {t === 'auto' ? '🌓 Auto' : t === 'light' ? '☀️ Light' : '🌙 Dark'}
                                </button>
                            ))}
                        </div>
                    </SettingRow>

                    <SettingRow label="Map Style">
                        <select
                            value={localSettings.mapStyle}
                            onChange={(e) => updateSetting('mapStyle', e.target.value as UserSettings['mapStyle'])}
                            className={`px - 3 py - 2 rounded - xl text - sm outline - none ${theme === 'dark'
                                    ? 'bg-white/5 text-white'
                                    : 'bg-slate-100 text-slate-900'
                                } `}
                        >
                            <option value="standard">Standard</option>
                            <option value="satellite">Satellite</option>
                            <option value="terrain">Terrain</option>
                        </select>
                    </SettingRow>

                    <SettingRow label="Units">
                        <div className="flex gap-2">
                            {(['imperial', 'metric'] as const).map(u => (
                                <button
                                    key={u}
                                    onClick={() => updateSetting('units', u)}
                                    className={`px - 3 py - 1.5 rounded - lg text - xs font - bold capitalize transition - all ${localSettings.units === u
                                            ? 'bg-gradient-to-r from-indigo-500 to-purple-600 text-white'
                                            : theme === 'dark'
                                                ? 'bg-white/5 text-slate-300 hover:bg-white/10'
                                                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                        } `}
                                >
                                    {u === 'imperial' ? 'mi/mph' : 'km/kph'}
                                </button>
                            ))}
                        </div>
                    </SettingRow>
                </div>

                {/* AI Co-Pilot */}
                <div>
                    <SectionTitle>AI Co-Pilot</SectionTitle>
                    <SettingRow label="Personality" description="Choose your co-pilot's vibe">
                        <div className="flex gap-2">
                            {(['standard', 'grok', 'newyork'] as const).map(p => (
                                <button
                                    key={p}
                                    onClick={() => updateSetting('aiPersonality', p)}
                                    className={`px - 3 py - 1.5 rounded - lg text - xs font - bold capitalize transition - all ${localSettings.aiPersonality === p
                                            ? 'bg-gradient-to-r from-teal-400 to-emerald-500 text-white'
                                            : theme === 'dark'
                                                ? 'bg-white/5 text-slate-300 hover:bg-white/10'
                                                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                        } `}
                                >
                                    {p === 'grok' ? '🌶️ Grok' : p === 'newyork' ? '🗽 NY' : '🛡️ Standard'}
                                </button>
                            ))}
                        </div>
                    </SettingRow>

                    <SettingRow label="Voice" description="Select voice gender">
                        <div className="flex gap-2">
                            {(['male', 'female'] as const).map(g => (
                                <button
                                    key={g}
                                    onClick={() => updateSetting('aiGender', g)}
                                    className={`px - 3 py - 1.5 rounded - lg text - xs font - bold capitalize transition - all ${localSettings.aiGender === g
                                            ? 'bg-gradient-to-r from-teal-400 to-emerald-500 text-white'
                                            : theme === 'dark'
                                                ? 'bg-white/5 text-slate-300 hover:bg-white/10'
                                                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                        } `}
                                >
                                    {g === 'male' ? '👨 Male' : '👩 Female'}
                                </button>
                            ))}
                        </div>
                    </SettingRow>
                </div>

                {/* Map Skins (Platinum Feature) */}
                <div>
                    <SectionTitle>
                        <span className="flex items-center gap-2">
                            Map Skins
                            {!isPremium && <span className="text-xs px-2 py-0.5 rounded-full bg-gradient-to-r from-amber-400 to-orange-500 text-white">PLATINUM</span>}
                        </span>
                    </SectionTitle>
                    <div className="grid grid-cols-3 gap-2">
                        {MAP_SKINS.map(skin => {
                            const isLocked = skin.isPremium && !isPremium;
                            const isSelected = localSettings.mapSkin === skin.id;
                            return (
                                <button
                                    key={skin.id}
                                    disabled={isLocked}
                                    onClick={() => !isLocked && updateSetting('mapSkin', skin.id)}
                                    className={`relative p - 3 rounded - xl text - center transition - all ${isSelected
                                            ? 'bg-gradient-to-br from-teal-400 to-emerald-500 text-white ring-2 ring-teal-300'
                                            : isLocked
                                                ? theme === 'dark' ? 'bg-white/5 text-slate-500 opacity-60' : 'bg-slate-100 text-slate-400 opacity-60'
                                                : theme === 'dark' ? 'bg-white/5 text-slate-300 hover:bg-white/10' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                        } `}
                                >
                                    <span className="text-2xl block mb-1">{skin.preview}</span>
                                    <span className="text-xs font-bold">{skin.name}</span>
                                    {isLocked && <span className="absolute top-1 right-1 text-xs">🔒</span>}
                                </button>
                            );
                        })}
                    </div>
                    {!isPremium && (
                        <button
                            onClick={onUpgrade}
                            className="w-full mt-3 py-2 rounded-xl bg-gradient-to-r from-amber-400 to-orange-500 text-white font-bold text-sm hover:scale-[1.02] active:scale-[0.98] transition-all"
                        >
                            Unlock All Skins with Platinum
                        </button>
                    )}
                </div>

                {/* Notifications */}
                <div>
                    <SectionTitle>Notifications</SectionTitle>
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
                </div>

                {/* Privacy */}
                <div>
                    <SectionTitle>Privacy</SectionTitle>
                    <SettingRow label="Location Sharing" description="Share your location with family">
                        <ToggleSwitch enabled={localSettings.locationSharing} onChange={(v) => updateSetting('locationSharing', v)} />
                    </SettingRow>
                </div>

                {/* My Places */}
                <div>
                    <SectionTitle>My Places</SectionTitle>
                    <div className={`space - y - 2 mb - 3`}>
                        {userPlaces.length === 0 ? (
                            <p className={`text - sm ${theme === 'dark' ? 'text-slate-500' : 'text-slate-400'} `}>
                                No saved places yet. Add your first place below.
                            </p>
                        ) : (
                            userPlaces.map(place => (
                                <div
                                    key={place.id}
                                    className={`flex items - center justify - between p - 3 rounded - xl ${theme === 'dark' ? 'bg-white/5' : 'bg-slate-100'
                                        } `}
                                >
                                    <div className="flex items-center gap-3">
                                        <span className="text-xl">{place.icon}</span>
                                        <div>
                                            <p className={`font - medium ${theme === 'dark' ? 'text-white' : 'text-slate-900'} `}>
                                                {place.name}
                                            </p>
                                            <p className="text-xs text-slate-500">
                                                {place.location.lat.toFixed(4)}, {place.location.lng.toFixed(4)}
                                            </p>
                                        </div>
                                    </div>
                                    {onDeletePlace && (
                                        <button
                                            onClick={() => onDeletePlace(place.id)}
                                            className="w-8 h-8 rounded-lg bg-red-500/10 text-red-500 hover:bg-red-500/20 transition-colors flex items-center justify-center"
                                        >
                                            🗑️
                                        </button>
                                    )}
                                </div>
                            ))
                        )}
                    </div>

                    {/* Add Place Form */}
                    {showAddPlace ? (
                        <div className={`p - 4 rounded - 2xl border ${theme === 'dark' ? 'bg-white/5 border-white/10' : 'bg-slate-50 border-slate-100'} `}>
                            <div className="flex items-center gap-2 mb-3">
                                <select
                                    value={newPlaceIcon}
                                    onChange={(e) => setNewPlaceIcon(e.target.value)}
                                    className={`px - 2 py - 2 rounded - lg text - lg ${theme === 'dark' ? 'bg-white/10 text-white' : 'bg-slate-200 text-slate-900'} `}
                                >
                                    <option value="📍">📍</option>
                                    <option value="🏠">🏠 Home</option>
                                    <option value="🏢">🏢 Work</option>
                                    <option value="🎓">🎓 School</option>
                                    <option value="💪">💪 Gym</option>
                                    <option value="👵">👵 Family</option>
                                    <option value="🏥">🏥 Hospital</option>
                                    <option value="⛪">⛪ Church</option>
                                </select>
                                <input
                                    type="text"
                                    placeholder="Place name..."
                                    value={newPlaceName}
                                    onChange={(e) => setNewPlaceName(e.target.value)}
                                    className={`flex - 1 px - 3 py - 2 rounded - lg outline - none ${theme === 'dark' ? 'bg-white/10 text-white placeholder-slate-500' : 'bg-slate-200 text-slate-900 placeholder-slate-400'
                                        } `}
                                />
                            </div>
                            <div className="flex gap-2">
                                <button
                                    onClick={() => {
                                        if (onAddPlace && newPlaceName.trim()) {
                                            // Uses current user location or defaults
                                            onAddPlace({
                                                name: newPlaceName.trim(),
                                                icon: newPlaceIcon,
                                                location: { lat: 35.2271, lng: -80.8431 }, // NC default (Charlotte)
                                                radius: 0.003,
                                                type: 'other'
                                            });
                                            setNewPlaceName('');
                                            setNewPlaceIcon('📍');
                                            setShowAddPlace(false);
                                        }
                                    }}
                                    className="flex-1 py-2 rounded-lg bg-gradient-to-r from-indigo-500 to-purple-600 text-white font-bold text-sm"
                                >
                                    ✓ Save Place
                                </button>
                                <button
                                    onClick={() => {
                                        setShowAddPlace(false);
                                        setNewPlaceName('');
                                    }}
                                    className={`px - 4 py - 2 rounded - lg font - bold text - sm ${theme === 'dark' ? 'bg-white/10 text-white' : 'bg-slate-200 text-slate-700'
                                        } `}
                                >
                                    Cancel
                                </button>
                            </div>
                        </div>
                    ) : (
                        <button
                            onClick={() => setShowAddPlace(true)}
                            className={`w - full py - 3 rounded - xl font - medium border - 2 border - dashed transition - all ${theme === 'dark'
                                    ? 'border-white/20 text-slate-400 hover:border-white/40 hover:text-white'
                                    : 'border-slate-300 text-slate-500 hover:border-slate-400 hover:text-slate-700'
                                } `}
                        >
                            + Add New Place
                        </button>
                    )}
                </div>

                {/* Offline Maps */}
                <div>
                    <SectionTitle>System</SectionTitle>
                    <div className="space-y-3">
                        <StorageManager theme={theme} />
                        <SettingRow label="Offline Maps" description="Manage downloaded regions">
                            <button
                                onClick={onOpenOfflineMaps}
                                className={`px - 3 py - 1.5 rounded - lg text - xs font - bold transition - all border ${theme === 'dark'
                                        ? 'bg-white/5 text-slate-300 border-white/10 hover:bg-white/10'
                                        : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                                    } `}
                            >
                                Manage Maps
                            </button>
                        </SettingRow>
                    </div>
                </div>

                {/* Account actions */}
                <div className="pt-4 space-y-3">
                    {onManageSubscription && (
                        <button
                            onClick={onManageSubscription}
                            className={`w - full py - 3 rounded - xl font - medium transition - colors ${theme === 'dark'
                                    ? 'bg-white/5 text-slate-300 hover:bg-white/10'
                                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                } `}
                        >
                            💳 Manage Subscription
                        </button>
                    )}
                    <button className={`w - full py - 3 rounded - xl font - medium transition - colors ${theme === 'dark'
                            ? 'bg-white/5 text-slate-300 hover:bg-white/10'
                            : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                        } `}>
                        Manage Family Circle
                    </button>
                    <button className={`w - full py - 3 rounded - xl font - medium transition - colors ${theme === 'dark'
                            ? 'bg-white/5 text-slate-300 hover:bg-white/10'
                            : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                        } `}>
                        Privacy Policy
                    </button>
                    <button
                        onClick={onSignOut}
                        className="w-full py-3 rounded-xl font-medium bg-red-500/10 text-red-500 hover:bg-red-500/20 transition-colors"
                    >
                        Sign Out
                    </button>
                </div>

                {/* Upgrade Banner */}
                {!isPremium && onUpgrade && (
                    <div className="pt-6 pb-2">
                        <button
                            onClick={onUpgrade}
                            className="w-full py-3 rounded-xl bg-gradient-to-r from-amber-400 via-amber-500 to-orange-500 text-black font-black text-sm uppercase tracking-wider
                                hover:shadow-lg hover:shadow-amber-500/30 hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-2"
                        >
                            <span>✨</span> Upgrade to Gold
                        </button>
                    </div>
                )}
            </div>

            {/* Version */}
            <div className={`p - 4 text - center border - t ${theme === 'dark' ? 'border-white/10' : 'border-slate-200'} `}>
                <p className="text-xs text-slate-500">MyWay v1.0.0</p>
            </div>
        </div>
    );
};

export default SettingsPanel;
