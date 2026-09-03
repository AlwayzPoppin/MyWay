import React, { useState, useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { nativeSettingsService } from '../services/nativeSettingsService';

interface BatteryOptimizationPromptProps {
    onDismiss: () => void;
    theme: 'light' | 'dark';
}

/** Check if prompt should be shown synchronously on app launch */
export const shouldShowBatteryPrompt = (): boolean => {
    // Only show on Android
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') {
        return false;
    }

    if (nativeSettingsService.isPromptDisabledByUser()) {
        return false;
    }

    const dismissed = localStorage.getItem('myway_bg_tracking_prompt_dismissed');
    if (!dismissed) return true;

    const dismissedAt = parseInt(dismissed, 10);
    if (isNaN(dismissedAt)) return true;

    const daysSince = (Date.now() - dismissedAt) / (1000 * 60 * 60 * 24);
    return daysSince >= 5; // Reprompt after 5 days unless disabled
};

const BatteryOptimizationPrompt: React.FC<BatteryOptimizationPromptProps> = ({ onDismiss, theme }) => {
    const isDark = theme === 'dark';
    const [dontAskAgain, setDontAskAgain] = useState(false);
    const [isBatteryIgnored, setIsBatteryIgnored] = useState(false);
    const [batteryRequested, setBatteryRequested] = useState(false);
    const [permissionsOpened, setPermissionsOpened] = useState(false);

    useEffect(() => {
        nativeSettingsService.isIgnoringBatteryOptimizations().then(setIsBatteryIgnored);
    }, []);

    const handleOpenPermissions = async () => {
        setPermissionsOpened(true);
        await nativeSettingsService.openAppSettings();
    };

    const handleRequestBattery = async () => {
        setBatteryRequested(true);
        await nativeSettingsService.requestIgnoreBatteryOptimizations();
        // Check updated status after a brief delay
        setTimeout(() => {
            nativeSettingsService.isIgnoringBatteryOptimizations().then(setIsBatteryIgnored);
        }, 1500);
    };

    const handleDismiss = () => {
        nativeSettingsService.dismissPrompt(dontAskAgain);
        onDismiss();
    };

    return (
        <div className="fixed inset-0 z-[250] flex items-center justify-center bg-black/75 backdrop-blur-md p-4 animate-in fade-in duration-200">
            <div className={`relative max-w-md w-full rounded-3xl overflow-hidden border shadow-2xl transition-all ${
                isDark ? 'bg-slate-900/95 border-white/10 text-white' : 'bg-white border-slate-200 text-slate-900'
            }`}>
                {/* Header Gradient */}
                <div className="bg-gradient-to-r from-emerald-600 via-teal-600 to-indigo-600 p-6 text-center relative overflow-hidden">
                    <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-white/20 to-transparent pointer-events-none" />
                    <div className="relative z-10 flex flex-col items-center">
                        <div className="w-14 h-14 rounded-2xl bg-white/15 backdrop-blur-sm border border-white/20 flex items-center justify-center mb-3 shadow-lg">
                            <span className="text-3xl">📡</span>
                        </div>
                        <h2 className="text-xl font-black tracking-tight text-white">
                            Continuous Circle Safety
                        </h2>
                        <p className="text-emerald-100 text-xs font-semibold mt-1">
                            Keep tracking active when your phone is locked or app is closed
                        </p>
                    </div>
                </div>

                {/* Content */}
                <div className="p-6 space-y-4 max-h-[75vh] overflow-y-auto">
                    <p className={`text-xs leading-relaxed ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>
                        When MyWay is in the background, Android automatically pauses location and puts apps to sleep to save battery. To ensure your circle always sees your live status and gets emergency alerts, enable these two settings:
                    </p>

                    {/* Step 1: Location Always */}
                    <div className={`p-3.5 rounded-2xl border transition-all ${
                        permissionsOpened
                            ? isDark ? 'bg-indigo-950/30 border-indigo-500/40' : 'bg-indigo-50/70 border-indigo-200'
                            : isDark ? 'bg-white/5 border-white/10' : 'bg-slate-50 border-slate-200'
                    }`}>
                        <div className="flex items-start justify-between gap-3">
                            <div className="flex items-start gap-3">
                                <span className="text-xl mt-0.5">📍</span>
                                <div>
                                    <div className="flex items-center gap-2">
                                        <h4 className="text-xs font-black">1. Location: Allow All The Time</h4>
                                        {permissionsOpened && (
                                            <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-400">
                                                Opened
                                            </span>
                                        )}
                                    </div>
                                    <p className={`text-[11px] mt-0.5 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                                        Tap Permissions → Location → Select <b>"Allow all the time"</b>.
                                    </p>
                                </div>
                            </div>
                        </div>

                        <button
                            type="button"
                            onClick={handleOpenPermissions}
                            className={`mt-2.5 w-full py-2 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 border ${
                                permissionsOpened
                                    ? 'bg-indigo-600 text-white border-indigo-500 shadow-md'
                                    : isDark
                                        ? 'bg-white/10 hover:bg-white/15 text-white border-white/10'
                                        : 'bg-white hover:bg-slate-100 text-slate-800 border-slate-200 shadow-sm'
                            }`}
                        >
                            <span>Open App Permissions</span>
                            <span className="text-[11px]">⚙️</span>
                        </button>
                    </div>

                    {/* Step 2: Unrestricted Battery */}
                    <div className={`p-3.5 rounded-2xl border transition-all ${
                        isBatteryIgnored
                            ? isDark ? 'bg-emerald-950/30 border-emerald-500/40' : 'bg-emerald-50/70 border-emerald-200'
                            : isDark ? 'bg-white/5 border-white/10' : 'bg-slate-50 border-slate-200'
                    }`}>
                        <div className="flex items-start justify-between gap-3">
                            <div className="flex items-start gap-3">
                                <span className="text-xl mt-0.5">⚡</span>
                                <div>
                                    <div className="flex items-center gap-2">
                                        <h4 className="text-xs font-black">2. Battery: Unrestricted</h4>
                                        {isBatteryIgnored ? (
                                            <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                                                Active ✓
                                            </span>
                                        ) : batteryRequested ? (
                                            <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400">
                                                Prompted
                                            </span>
                                        ) : null}
                                    </div>
                                    <p className={`text-[11px] mt-0.5 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                                        Bypass Android Doze sleep so live family sync never freezes.
                                    </p>
                                </div>
                            </div>
                        </div>

                        {!isBatteryIgnored ? (
                            <button
                                type="button"
                                onClick={handleRequestBattery}
                                className="mt-2.5 w-full py-2 px-3 rounded-xl text-xs font-bold bg-gradient-to-r from-emerald-500 to-teal-500 text-white shadow-md hover:brightness-105 active:scale-98 transition-all flex items-center justify-center gap-2"
                            >
                                <span>Allow Unrestricted Battery</span>
                                <span>⚡</span>
                            </button>
                        ) : (
                            <div className="mt-2 text-center text-[11px] font-bold text-emerald-400 flex items-center justify-center gap-1.5">
                                <span>✓</span>
                                <span>Battery optimization already exempted</span>
                            </div>
                        )}
                    </div>

                    {/* What this enables */}
                    <div className={`p-3 rounded-2xl text-[11px] space-y-1.5 ${isDark ? 'bg-white/5 text-slate-300' : 'bg-slate-50 text-slate-600'}`}>
                        <div className="font-black text-xs text-indigo-400 mb-1">Why this is recommended:</div>
                        <div className="flex items-center gap-2">
                            <span>🛡️</span>
                            <span>Automatic arrival and departure geofence alerts</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <span>🚨</span>
                            <span>Crash detection and emergency SOS while driving</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <span>👥</span>
                            <span>Family circle members see your live location continuously</span>
                        </div>
                    </div>

                    {/* User Autonomy & Control Notice */}
                    <div className={`p-2.5 rounded-xl text-[10.5px] leading-tight flex items-start gap-2 ${
                        isDark ? 'bg-amber-500/10 text-amber-300/90 border border-amber-500/20' : 'bg-amber-50 text-amber-800 border border-amber-200'
                    }`}>
                        <span className="text-sm shrink-0">🔒</span>
                        <span>
                            <b>You're in total control:</b> If you don't want background tracking, you can turn it off anytime right here or in Settings.
                        </span>
                    </div>

                    {/* Don't ask again checkbox */}
                    <label className="flex items-center gap-2.5 pt-1 cursor-pointer select-none">
                        <input
                            type="checkbox"
                            checked={dontAskAgain}
                            onChange={(e) => setDontAskAgain(e.target.checked)}
                            className="w-4 h-4 rounded border-slate-600 text-indigo-600 focus:ring-indigo-500"
                        />
                        <span className={`text-xs font-semibold ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                            Don't ask me again (turn off this prompt)
                        </span>
                    </label>

                    {/* Actions */}
                    <div className="flex flex-col gap-2 pt-2">
                        <button
                            type="button"
                            onClick={handleDismiss}
                            className="w-full py-3.5 rounded-2xl font-black text-sm bg-gradient-to-r from-emerald-500 via-teal-500 to-indigo-600 text-white shadow-lg hover:brightness-105 active:scale-95 transition-all"
                        >
                            {permissionsOpened || isBatteryIgnored ? 'Done / Back to Map' : 'Got It'}
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                // Turn off completely if user chooses not now
                                nativeSettingsService.dismissPrompt(true);
                                onDismiss();
                            }}
                            className={`w-full py-2.5 rounded-xl font-bold text-xs transition-all ${
                                isDark ? 'text-slate-400 hover:text-white hover:bg-white/5' : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'
                            }`}
                        >
                            Turn Off / Maybe Later
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default BatteryOptimizationPrompt;
