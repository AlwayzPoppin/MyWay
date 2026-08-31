import React, { useState, useEffect, useCallback } from 'react';
import { CrashImpactMetadata } from '../types';

export interface AppNotification {
    id: string;
    type: 'arrival' | 'departure' | 'sos' | 'geofence' | 'crash' | 'eta' | 'system' | 'safety' | 'EMERGENCY' | 'SOS';
    title: string;
    message: string;
    timestamp: number;
    icon: string;
    isRead: boolean;
    memberId?: string;
    isResolved?: boolean;
    impact?: CrashImpactMetadata;
}

const NOTIFICATIONS_KEY = 'myway_notifications';
const MAX_NOTIFICATIONS = 100;

/** Add a notification to the store */
export const addNotification = (
    type: AppNotification['type'],
    title: string,
    message: string,
    icon: string,
    memberId?: string,
    impact?: CrashImpactMetadata
): AppNotification => {
    const notification: AppNotification = {
        id: `notif_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        type,
        title,
        message,
        timestamp: Date.now(),
        icon,
        isRead: false,
        memberId,
        impact
    };

    const existing = getNotifications();
    existing.unshift(notification);
    if (existing.length > MAX_NOTIFICATIONS) existing.pop();
    localStorage.setItem(NOTIFICATIONS_KEY, JSON.stringify(existing));

    return notification;
};

/** Get all notifications */
export const getNotifications = (): AppNotification[] => {
    try {
        const stored = localStorage.getItem(NOTIFICATIONS_KEY);
        return stored ? JSON.parse(stored) : [];
    } catch {
        return [];
    }
};

/** Mark notification as read */
export const markRead = (id: string): void => {
    const notifications = getNotifications().map(n =>
        n.id === id ? { ...n, isRead: true } : n
    );
    localStorage.setItem(NOTIFICATIONS_KEY, JSON.stringify(notifications));
};

/** Mark all as read */
export const markAllRead = (): void => {
    const notifications = getNotifications().map(n => ({ ...n, isRead: true }));
    localStorage.setItem(NOTIFICATIONS_KEY, JSON.stringify(notifications));
};

/** Get unread count */
export const getUnreadCount = (): number => {
    return getNotifications().filter(n => !n.isRead).length;
};

/** Clear all notifications */
export const clearNotifications = (): void => {
    localStorage.removeItem(NOTIFICATIONS_KEY);
};

interface NotificationCenterProps {
    onClose: () => void;
    onBack?: () => void;
    theme: 'light' | 'dark';
}

const NotificationCenter: React.FC<NotificationCenterProps> = ({ onClose, onBack, theme }) => {
    const [notifications, setNotifications] = useState<AppNotification[]>([]);
    const [filter, setFilter] = useState<string>('all');
    const isDark = theme === 'dark';

    useEffect(() => {
        setNotifications(getNotifications());
        markAllRead();
    }, []);

    const filtered = filter === 'all'
        ? notifications
        : notifications.filter(n => n.type === filter);

    const getTimeAgo = (timestamp: number): string => {
        const mins = Math.floor((Date.now() - timestamp) / 60000);
        if (mins < 1) return 'Just now';
        if (mins < 60) return `${mins}m ago`;
        const hrs = Math.floor(mins / 60);
        if (hrs < 24) return `${hrs}h ago`;
        const days = Math.floor(hrs / 24);
        return `${days}d ago`;
    };

    const filters = [
        { key: 'all', label: 'All' },
        { key: 'arrival', label: '📍 Arrivals' },
        { key: 'sos', label: '🆘 SOS' },
        { key: 'safety', label: '🛡️ Safety' },
        { key: 'system', label: '⚙️ System' }
    ];

    return (
        <div className="h-full flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-white/10">
                <div className="flex items-center gap-3">
                    {onBack && (
                        <button
                            onClick={onBack}
                            className={`w-8 h-8 rounded-full flex items-center justify-center transition-all mr-1 ${
                                isDark ? 'bg-white/5 hover:bg-indigo-500/20 text-slate-400 hover:text-indigo-400' : 'bg-slate-100 hover:bg-indigo-100 text-slate-500 hover:text-indigo-600'
                            }`}
                            title="Back to Settings"
                        >
                            <span className="text-lg">←</span>
                        </button>
                    )}
                    <span className="text-2xl">🔔</span>
                    <div>
                        <h2 className={`text-lg font-bold ${isDark ? 'text-white' : 'text-slate-900'}`}>
                            My Alerts
                        </h2>
                        <p className="text-xs text-slate-400">{notifications.length} total</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {notifications.length > 0 && (
                        <button
                            onClick={() => {
                                clearNotifications();
                                setNotifications([]);
                            }}
                            className="text-xs text-red-400/60 hover:text-red-400 transition-colors"
                        >
                            Clear
                        </button>
                    )}
                    <button
                        onClick={onClose}
                        className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-slate-400"
                    >
                        ✕
                    </button>
                </div>
            </div>

            {/* Filters */}
            <div className="flex gap-1.5 px-4 py-2 overflow-x-auto no-scrollbar">
                {filters.map(f => (
                    <button
                        key={f.key}
                        onClick={() => setFilter(f.key)}
                        className={`text-xs px-3 py-1.5 rounded-full whitespace-nowrap transition-all ${
                            filter === f.key
                                ? 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30'
                                : isDark
                                    ? 'bg-white/5 text-slate-400 hover:bg-white/10'
                                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                        }`}
                    >
                        {f.label}
                    </button>
                ))}
            </div>

            {/* Notification List */}
            <div className="flex-1 overflow-y-auto">
                {filtered.length === 0 ? (
                    <div className="text-center py-12">
                        <span className="text-4xl block mb-3">🔕</span>
                        <p className="text-slate-400 text-sm">No notifications yet</p>
                    </div>
                ) : (
                    <div className="divide-y divide-white/5">
                        {filtered.map(notif => (
                            <div
                                key={notif.id}
                                className={`px-4 py-3 flex items-start gap-3 transition-all hover:bg-white/5 ${
                                    !notif.isRead ? (isDark ? 'bg-white/3' : 'bg-indigo-50') : ''
                                }`}
                            >
                                <span className="text-xl mt-0.5">{notif.icon}</span>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center justify-between">
                                        <h4 className={`text-sm font-semibold truncate ${isDark ? 'text-white' : 'text-slate-900'}`}>
                                            {notif.title}
                                        </h4>
                                        <span className="text-[10px] text-slate-500 ml-2 whitespace-nowrap">
                                            {getTimeAgo(notif.timestamp)}
                                        </span>
                                    </div>
                                    <p className="text-xs text-slate-400 mt-0.5 line-clamp-2">
                                        {notif.message}
                                    </p>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

export default NotificationCenter;
