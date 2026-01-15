import React, { useState } from 'react';

interface UserSettings {
    theme: 'light' | 'dark' | 'auto';
    notifications: boolean;
    locationSharing: boolean;
    batteryAlerts: boolean;
    arrivalAlerts: boolean;
    speedAlerts: boolean;
    mapStyle: 'standard' | 'satellite' | 'terrain';
    units: 'imperial' | 'metric';
}

interface SettingsPanelProps {
    settings: UserSettings;
    onUpdateSettings: (settings: UserSettings) => void;
    onClose: () => void;
    onOpenOfflineMaps?: () => void;
    theme: 'light' | 'dark';
    userName: string;
    userAvatar: string;
}

const SettingsPanel: React.FC<SettingsPanelProps> = ({
    settings,
    onUpdateSettings,
    onClose,
    onOpenOfflineMaps,
    theme,
    userName,
    userAvatar
}) => {
    const [localSettings, setLocalSettings] = useState(settings);

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
                }`}
        >
            <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-md transition-all ${enabled ? 'left-6' : 'left-0.5'
                }`} />
        </button>
    );

    const SectionTitle = ({ children }: { children: React.ReactNode }) => (
        <h3 className={`text-xs font-bold uppercase tracking-wider mb-3 ${theme === 'dark' ? 'text-slate-500' : 'text-slate-400'
            }`}>
            {children}
        </h3>
    );

    const SettingRow = ({ label, description, children }: { label: string; description?: string; children: React.ReactNode }) => (
        <div className={`flex items-center justify-between py-3 border-b ${theme === 'dark' ? 'border-white/5' : 'border-slate-100'
            }`}>
            <div>
                <p className={`font-medium ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>{label}</p>
                {description && <p className="text-xs text-slate-500 mt-0.5">{description}</p>}
            </div>
            {children}
        </div>
    );

    return (
        <div className={`flex flex-col h-full rounded-3xl overflow-hidden shadow-2xl border
      ${theme === 'dark'
                ? 'bg-slate-900/95 border-white/10'
                : 'bg-white/95 border-slate-200'}`}
        >
            {/* Header */}
            <div className={`p-6 border-b ${theme === 'dark' ? 'border-white/10' : 'border-slate-200'}`}>
                <div className="flex items-center justify-between mb-4">
                    <h2 className={`text-xl font-bold ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>
                        Settings
                    </h2>
                    <button
                        onClick={onClose}
                        className={`w-10 h-10 flex items-center justify-center rounded-full text-lg font-bold transition-all
                            ${theme === 'dark'
                                ? 'bg-white/10 text-white hover:bg-red-500/80 hover:text-white'
                                : 'bg-slate-200 text-slate-700 hover:bg-red-500 hover:text-white'
                            }`}
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
                        <p className={`font-bold text-lg ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>
                            {userName}
                        </p>
                        <p className="text-sm text-slate-500">Family Circle Admin</p>
                    </div>
                </div>
            </div>

            {/* Settings content */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6 no-scrollbar">

                {/* Appearance */}
                <div>
                    <SectionTitle>Appearance</SectionTitle>
                    <SettingRow label="Theme" description="Choose your preferred color scheme">
                        <div className="flex gap-2">
                            {(['light', 'dark', 'auto'] as const).map(t => (
                                <button
                                    key={t}
                                    onClick={() => updateSetting('theme', t)}
                                    className={`px-3 py-1.5 rounded-lg text-xs font-bold capitalize transition-all ${localSettings.theme === t
                                        ? 'bg-gradient-to-r from-indigo-500 to-purple-600 text-white'
                                        : theme === 'dark'
                                            ? 'bg-white/5 text-slate-300 hover:bg-white/10'
                                            : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                        }`}
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
                            className={`px-3 py-2 rounded-xl text-sm outline-none ${theme === 'dark'
                                ? 'bg-white/5 text-white'
                                : 'bg-slate-100 text-slate-900'
                                }`}
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
                                    className={`px-3 py-1.5 rounded-lg text-xs font-bold capitalize transition-all ${localSettings.units === u
                                        ? 'bg-gradient-to-r from-indigo-500 to-purple-600 text-white'
                                        : theme === 'dark'
                                            ? 'bg-white/5 text-slate-300 hover:bg-white/10'
                                            : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                        }`}
                                >
                                    {u === 'imperial' ? 'mi/mph' : 'km/kph'}
                                </button>
                            ))}
                        </div>
                    </SettingRow>
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

                {/* Offline Maps */}
                <div>
                    <SectionTitle>Offline Maps</SectionTitle>
                    <div className={`p-4 rounded-2xl border ${theme === 'dark' ? 'bg-white/5 border-white/10' : 'bg-slate-50 border-slate-100'}`}>
                        <div className="flex items-center gap-3 mb-3">
                            <span className="text-2xl">📥</span>
                            <div>
                                <p className={`font-semibold ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>Download Maps</p>
                                <p className="text-xs text-slate-500">Save current map view for offline use</p>
                            </div>
                        </div>
                        <button
                            onClick={() => {
                                if (onOpenOfflineMaps) {
                                    onClose();
                                    onOpenOfflineMaps();
                                }
                            }}
                            className="w-full py-3 rounded-xl bg-gradient-to-r from-amber-400 to-orange-500 text-black font-black text-sm uppercase tracking-wider
                                hover:shadow-lg hover:shadow-amber-500/30 hover:scale-[1.02] active:scale-[0.98] transition-all"
                        >
                            📥 Open Offline Maps Manager
                        </button>
                        <p className={`text-xs mt-3 text-center ${theme === 'dark' ? 'text-slate-500' : 'text-slate-400'}`}>
                            📶 Cached tiles load automatically when offline
                        </p>
                    </div>
                </div>

                {/* Account actions */}
                <div className="pt-4 space-y-3">
                    <button className={`w-full py-3 rounded-xl font-medium transition-colors ${theme === 'dark'
                        ? 'bg-white/5 text-slate-300 hover:bg-white/10'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                        }`}>
                        Manage Family Circle
                    </button>
                    <button className={`w-full py-3 rounded-xl font-medium transition-colors ${theme === 'dark'
                        ? 'bg-white/5 text-slate-300 hover:bg-white/10'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                        }`}>
                        Privacy Policy
                    </button>
                    <button className="w-full py-3 rounded-xl font-medium bg-red-500/10 text-red-500 hover:bg-red-500/20 transition-colors">
                        Sign Out
                    </button>
                </div>
            </div>

            {/* Version */}
            <div className={`p-4 text-center border-t ${theme === 'dark' ? 'border-white/10' : 'border-slate-200'}`}>
                <p className="text-xs text-slate-500">MyWay v1.0.0</p>
            </div>
        </div>
    );
};

export default SettingsPanel;
