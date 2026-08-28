import React, { useState, useEffect } from 'react';
import { Capacitor } from '@capacitor/core';

interface BatteryOptimizationPromptProps {
    onDismiss: () => void;
    theme: 'light' | 'dark';
}

const STORAGE_KEY = 'myway_battery_prompt_dismissed';
const REPROMPT_DAYS = 7;

/** Check if prompt should be shown */
export const shouldShowBatteryPrompt = (): boolean => {
    // Only show on Android
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') {
        return false;
    }

    const dismissed = localStorage.getItem(STORAGE_KEY);
    if (!dismissed) return true;

    const dismissedAt = parseInt(dismissed, 10);
    const daysSince = (Date.now() - dismissedAt) / (1000 * 60 * 60 * 24);
    return daysSince >= REPROMPT_DAYS;
};

const BatteryOptimizationPrompt: React.FC<BatteryOptimizationPromptProps> = ({ onDismiss, theme }) => {
    const isDark = theme === 'dark';

    const handleOpenSettings = () => {
        // Android: Open battery optimization settings for this app
        try {
            // This intent opens the battery optimization exclusion screen
            // On native, this would use the App plugin to launch the intent
            window.open('intent:#Intent;action=android.settings.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS;data=package:com.mywaygps.app;end', '_system');
        } catch {
            // Fallback: open general battery settings
            window.open('intent:#Intent;action=android.settings.BATTERY_SAVER_SETTINGS;end', '_system');
        }
        handleDismiss();
    };

    const handleDismiss = () => {
        localStorage.setItem(STORAGE_KEY, Date.now().toString());
        onDismiss();
    };

    return (
        <div className="fixed inset-0 z-[250] flex items-center justify-center bg-black/70 backdrop-blur-sm">
            <div className={`relative max-w-sm w-full mx-4 rounded-3xl overflow-hidden border shadow-2xl ${
                isDark ? 'bg-slate-900 border-white/10' : 'bg-white border-slate-200'
            }`}>
                {/* Gradient header */}
                <div className="bg-gradient-to-r from-amber-500 to-orange-500 p-6 text-center">
                    <span className="text-5xl block mb-3">🛡️</span>
                    <h2 className="text-xl font-black text-white">Keep Your Family Safe</h2>
                    <p className="text-amber-100 text-sm mt-1">One quick setting change</p>
                </div>

                <div className="p-6 space-y-4">
                    <p className={`text-sm ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>
                        Android may stop MyWay from running in the background to save battery. 
                        This can prevent:
                    </p>

                    <ul className="space-y-2.5">
                        {[
                            { icon: '🆘', text: 'SOS alerts from reaching your family' },
                            { icon: '📍', text: 'Your location updating for your circle' },
                            { icon: '🚨', text: 'Crash detection while driving' },
                            { icon: '🏠', text: 'Arrival/departure geofence alerts' }
                        ].map((item, i) => (
                            <li key={i} className="flex items-center gap-3">
                                <span className="text-lg">{item.icon}</span>
                                <span className={`text-sm ${isDark ? 'text-white' : 'text-slate-800'}`}>{item.text}</span>
                            </li>
                        ))}
                    </ul>

                    <div className={`p-3 rounded-2xl text-xs ${isDark ? 'bg-amber-500/10 text-amber-300' : 'bg-amber-50 text-amber-700'}`}>
                        💡 This setting only affects MyWay — your other apps won't change.
                    </div>

                    <div className="flex flex-col gap-2 pt-2">
                        <button
                            onClick={handleOpenSettings}
                            className="w-full py-4 rounded-2xl font-black text-lg bg-gradient-to-r from-amber-400 to-orange-500 text-black shadow-lg hover:shadow-amber-500/30 transition-all transform hover:scale-[1.02] active:scale-95"
                        >
                            Open Settings
                        </button>
                        <button
                            onClick={handleDismiss}
                            className={`w-full py-3 rounded-2xl font-bold text-sm transition-all ${
                                isDark ? 'text-slate-400 hover:text-white hover:bg-white/10' : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'
                            }`}
                        >
                            Remind me later
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default BatteryOptimizationPrompt;
