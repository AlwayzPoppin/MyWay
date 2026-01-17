import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';

interface UIContextType {
    theme: 'light' | 'dark';
    setTheme: (theme: 'light' | 'dark') => void;
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
    const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
    const [isUpsellOpen, setUpsellOpen] = useState(false);
    const [isRewardsOpen, setRewardsOpen] = useState(false);
    const [isPrivacyOpen, setPrivacyOpen] = useState(false);
    const [isQuickStopOpen, setQuickStopOpen] = useState(false);
    const [isMessagingOpen, setMessagingOpen] = useState(false);
    const [isSettingsOpen, setSettingsOpen] = useState(false);
    const [isOfflineMapsOpen, setOfflineMapsOpen] = useState(false);
    const [isDriveMode, setDriveMode] = useState(false);
    const [is3DMode, set3DMode] = useState(false);
    const [notification, setNotification] = useState<string | null>(null);

    useEffect(() => {
        const handleResize = () => setIsMobile(window.innerWidth < 768);
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    const showNotification = (msg: string | null, duration = 5000) => {
        setNotification(msg);
        if (msg) {
            setTimeout(() => setNotification(null), duration);
        }
    };

    const value: UIContextType = {
        theme,
        setTheme,
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
        notification,
        showNotification
    };

    return <UIContext.Provider value={value}>{children}</UIContext.Provider>;
};
