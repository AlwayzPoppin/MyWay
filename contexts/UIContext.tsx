import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, ReactNode } from 'react';
import { MapSkinId, resolveMapSkinId } from '../services/mapSkinService';
import { solarService } from '../services/solarService';

interface UIContextType {
    theme: 'light' | 'dark';
    setTheme: (theme: 'light' | 'dark') => void;
    mapSkin: MapSkinId;
    setMapSkin: (skin: MapSkinId) => void;
    effectiveSkin: MapSkinId;
    isDefaultSkin: boolean;
    isMobile: boolean;
    isUpsellOpen: boolean;
    setUpsellOpen: (open: boolean) => void;
    isRewardsOpen: boolean;
    setRewardsOpen: (open: boolean) => void;
    isPrivacyOpen: boolean;
    setPrivacyOpen: (open: boolean) => void;
    isQuickStopOpen: boolean;
    setQuickStopOpen: (open: boolean) => void;
    isMessagingOpen: boolean;
    setMessagingOpen: (open: boolean) => void;
    isSettingsOpen: boolean;
    setSettingsOpen: (open: boolean) => void;
    isOfflineMapsOpen: boolean;
    setOfflineMapsOpen: (open: boolean) => void;
    isDriveMode: boolean;
    setDriveMode: (mode: boolean) => void;
    is3DMode: boolean;
    set3DMode: (mode: boolean) => void;
    isLowDataMode: boolean;
    setIsLowDataMode: (mode: boolean) => void;
    notification: string | null;
    showNotification: (msg: string | null, duration?: number) => void;
}

const UIContext = createContext<UIContextType | undefined>(undefined);

export const useUI = () => {
    const context = useContext(UIContext);
    if (!context) throw new Error('useUI must be used within a UIProvider');
    return context;
};

export const UIProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [theme, setTheme] = useState<'light' | 'dark'>('dark');
    const [mapSkin, setMapSkinState] = useState<MapSkinId>(() => {
        if (typeof window !== 'undefined') {
            return (localStorage.getItem('myway_map_skin') as MapSkinId) || 'default';
        }
        return 'default';
    });
    const [isDaylight, setIsDaylight] = useState(() => solarService.getSolarInfo().isDaylight);

    useEffect(() => {
        return solarService.subscribe((info) => {
            setIsDaylight(info.isDaylight);
        });
    }, []);

    const effectiveSkin = useMemo<MapSkinId>(() => {
        return resolveMapSkinId(mapSkin, isDaylight);
    }, [mapSkin, isDaylight]);

    const isDefaultSkin = effectiveSkin === 'default' || effectiveSkin === 'warm_cream';

    const setMapSkin = useCallback((newSkin: MapSkinId) => {
        setMapSkinState(newSkin);
        if (typeof window !== 'undefined') {
            localStorage.setItem('myway_map_skin', newSkin);
        }
    }, []);

    // Inject theme-default / light-mode on document.body
    useEffect(() => {
        if (typeof document !== 'undefined') {
            if (isDefaultSkin || theme === 'light') {
                document.body.classList.add('theme-default', 'light-mode');
                document.body.classList.remove('theme-dark', 'dark-mode');
            } else {
                document.body.classList.remove('theme-default', 'light-mode');
                document.body.classList.add('theme-dark', 'dark-mode');
            }
        }
    }, [isDefaultSkin, theme]);
    const checkIsMobileDevice = () => {
        if (typeof window === 'undefined') return false;
        const isTouch = 'ontouchstart' in window || (navigator.maxTouchPoints && navigator.maxTouchPoints > 0);
        const shortEdge = Math.min(window.innerWidth, window.innerHeight);
        // Handheld phone devices have a short edge < 600px; they remain mobile in both portrait and landscape
        if (shortEdge < 600) return true;
        if (isTouch && shortEdge < 768) return true;
        return window.innerWidth < 768;
    };

    const [isMobile, setIsMobile] = useState(checkIsMobileDevice);
    const [isUpsellOpen, setUpsellOpen] = useState(false);
    const [isRewardsOpen, setRewardsOpen] = useState(false);
    const [isPrivacyOpen, setPrivacyOpen] = useState(false);
    const [isQuickStopOpen, setQuickStopOpen] = useState(false);
    const [isMessagingOpen, setMessagingOpen] = useState(false);
    const [isSettingsOpen, setSettingsOpen] = useState(false);
    const [isOfflineMapsOpen, setOfflineMapsOpen] = useState(false);
    const [isDriveMode, setDriveMode] = useState(false);
    const [is3DMode, set3DMode] = useState(false);
    const [isLowDataMode, setIsLowDataMode] = useState(() => {
        // Auto-detect based on browser hint if available
        return (navigator as any).connection?.saveData || false;
    });
    const [notification, setNotification] = useState<string | null>(null);

    useEffect(() => {
        let timeoutId: ReturnType<typeof setTimeout> | null = null;
        const handleResize = () => {
            if (timeoutId) clearTimeout(timeoutId);
            timeoutId = setTimeout(() => {
                const nextIsMobile = checkIsMobileDevice();
                setIsMobile(prev => (prev !== nextIsMobile ? nextIsMobile : prev));
            }, 150);
        };
        window.addEventListener('resize', handleResize, { passive: true });
        window.addEventListener('orientationchange', handleResize, { passive: true });
        return () => {
            if (timeoutId) clearTimeout(timeoutId);
            window.removeEventListener('resize', handleResize);
            window.removeEventListener('orientationchange', handleResize);
        };
    }, []);

    const showNotification = useCallback((msg: string | null, duration = 5000) => {
        setNotification(msg);
        if (msg) {
            setTimeout(() => setNotification(null), duration);
        }
    }, []);

    const value: UIContextType = useMemo(() => ({
        theme,
        setTheme,
        mapSkin,
        setMapSkin,
        effectiveSkin,
        isDefaultSkin,
        isMobile,
        isUpsellOpen,
        setUpsellOpen,
        isRewardsOpen,
        setRewardsOpen,
        isPrivacyOpen,
        setPrivacyOpen,
        isQuickStopOpen,
        setQuickStopOpen,
        isMessagingOpen,
        setMessagingOpen,
        isSettingsOpen,
        setSettingsOpen,
        isOfflineMapsOpen,
        setOfflineMapsOpen,
        isDriveMode,
        setDriveMode,
        is3DMode,
        set3DMode,
        isLowDataMode,
        setIsLowDataMode,
        notification,
        showNotification
    }), [
        theme,
        setTheme,
        mapSkin,
        setMapSkin,
        effectiveSkin,
        isDefaultSkin,
        isMobile,
        isUpsellOpen,
        setUpsellOpen,
        isRewardsOpen,
        setRewardsOpen,
        isPrivacyOpen,
        setPrivacyOpen,
        isQuickStopOpen,
        setQuickStopOpen,
        isMessagingOpen,
        setMessagingOpen,
        isSettingsOpen,
        setSettingsOpen,
        isOfflineMapsOpen,
        setOfflineMapsOpen,
        isDriveMode,
        setDriveMode,
        is3DMode,
        set3DMode,
        isLowDataMode,
        setIsLowDataMode,
        notification,
        showNotification
    ]);

    return <UIContext.Provider value={value}>{children}</UIContext.Provider>;
};
