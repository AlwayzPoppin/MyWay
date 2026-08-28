import React, { useState, useEffect, useCallback } from 'react';
import { Geolocation } from '@capacitor/geolocation';
import { App } from '@capacitor/app';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Capacitor } from '@capacitor/core';

interface PermissionGuardProps {
    children: React.ReactNode;
    theme: 'light' | 'dark';
}

/**
 * Audit #5: Permission Recovery Flow
 * High-fidelity guard that ensures critical safety permissions are granted.
 * If permissions are missing, it blocks the app with a recovery UI.
 */
const PermissionGuard: React.FC<PermissionGuardProps> = ({ children, theme }) => {
    const [status, setStatus] = useState<{
        location: PermissionState | 'loading';
        notifications: PermissionState | 'loading';
    }>({
        location: 'loading',
        notifications: 'loading',
    });

    const checkPermissions = useCallback(async () => {
        try {
            const locPerm = await Geolocation.checkPermissions();
            const notifPerm = await LocalNotifications.checkPermissions();

            setStatus({
                location: locPerm.location,
                notifications: notifPerm.display,
            });
        } catch (err) {
            console.error('Permission check failed:', err);
        }
    }, []);

    useEffect(() => {
        checkPermissions();

        // Re-check when app returns from background (user coming back from settings)
        const sub = App.addListener('appStateChange', ({ isActive }) => {
            if (isActive) checkPermissions();
        });

        return () => {
            sub.then(s => s.remove());
        };
    }, [checkPermissions]);

    const requestLocation = async () => {
        try {
            if (Capacitor.getPlatform() === 'web') {
                // web doesn't support requestPermissions directly for geolocation, 
                // it prompts on the first use of getCurrentPosition/watchPosition
                return new Promise((resolve) => {
                    navigator.geolocation.getCurrentPosition(
                        () => { checkPermissions(); resolve(null); },
                        () => { checkPermissions(); resolve(null); },
                        { timeout: 10000 }
                    );
                });
            } else {
                await Geolocation.requestPermissions();
            }
        } catch (err) {
            console.warn('Location request failed (likely user denied):', err);
        }
        checkPermissions();
    };

    const requestNotifications = async () => {
        try {
            if (Capacitor.getPlatform() === 'web') {
                if ('Notification' in window) {
                    await Notification.requestPermission();
                }
            } else {
                await LocalNotifications.requestPermissions();
            }
        } catch (err) {
            console.warn('Notification request failed:', err);
        }
        checkPermissions();
    };

    const isAllGranted = status.location === 'granted' && status.notifications === 'granted';

    if (status.location === 'loading' || status.notifications === 'loading') {
        return (
            <div className={`fixed inset-0 flex items-center justify-center ${theme === 'dark' ? 'bg-slate-900' : 'bg-white'}`}>
                <div className="w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            </div>
        );
    }

    if (!isAllGranted) {
        return (
            <div className={`fixed inset-0 z-[10000] flex flex-col items-center justify-center p-8 text-center ${
                theme === 'dark' ? 'bg-slate-950 text-white' : 'bg-slate-50 text-slate-900'
            }`}>
                <div className="mb-8 p-4 bg-red-500/10 rounded-full">
                    <svg className="w-16 h-16 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                </div>

                <h1 className="text-3xl font-bold mb-4">Safety Sync Lost</h1>
                <p className="max-w-md text-lg opacity-80 mb-10 leading-relaxed">
                    MyWay GPS requires <b>Always</b> location and notifications to keep you and your family safe. Without these, SOS and Geofences are inactive.
                </p>

                <div className="w-full max-w-sm space-y-4">
                    {status.location !== 'granted' && (
                        <button
                            onClick={requestLocation}
                            className="w-full py-4 bg-indigo-600 hover:bg-indigo-500 text-white rounded-2xl font-bold text-lg shadow-lg transition-all active:scale-95"
                        >
                            Enable Precise Location
                        </button>
                    )}

                    {status.notifications !== 'granted' && (
                        <button
                            onClick={requestNotifications}
                            className="w-full py-4 bg-slate-800 hover:bg-slate-700 text-white rounded-2xl font-bold text-lg shadow-lg transition-all active:scale-95 border border-white/10"
                        >
                            Enable Notifications
                        </button>
                    )}
                </div>

                <p className="mt-12 text-sm opacity-60">
                    MyWay GPS uses your location <b>only</b> for safety features and E2EE messaging within your family circle.
                </p>
            </div>
        );
    }

    return <>{children}</>;
};

export default PermissionGuard;
