import React, { useState, useEffect } from 'react';
import { FamilyMember } from '../types';
import { getLocationFreshness } from '../utils/safetyAlerts';

interface SafetyAlertsProps {
    members: FamilyMember[];
    currentUserId?: string;
    currentUserName?: string;
    onDismiss: (alertId: string) => void;
    onSendReminder: (memberId: string, type: 'charge' | 'checkin') => void;
    onResolveOwnSOS: () => void;
    theme: 'light' | 'dark';
    compact?: boolean;
}

interface Alert {
    id: string;
    type: 'low_battery' | 'crash_detected' | 'traffic' | 'unsafe_area' | 'arrived' | 'prediction' | 'sos_alert' | 'geofence_transition';
    memberId: string;
    memberName: string;
    message: string;
    icon: string;
    priority: 'critical' | 'warning' | 'info';
    timestamp: Date;
    actionLabel?: string;
    actionType?: 'charge' | 'checkin' | 'call' | 'navigate' | 'resolve_sos';
}

const SafetyAlerts: React.FC<SafetyAlertsProps> = ({
    members,
    currentUserId,
    currentUserName,
    onDismiss,
    onSendReminder,
    onResolveOwnSOS,
    theme,
    compact = false
}) => {
    const [alerts, setAlerts] = useState<Alert[]>([]);
    const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());

    // Generate alerts based on member status
    useEffect(() => {
        const newAlerts: Alert[] = [];

        members.forEach(member => {
            // Check if this member is the logged-in user
            const isSelf = Boolean(
                (currentUserId && member.id === currentUserId) ||
                (currentUserName && member.name && member.name.trim().toLowerCase() === currentUserName.trim().toLowerCase()) ||
                member.name?.trim().toLowerCase() === 'you' ||
                (member as any).isCurrentUser
            );

            // Low battery alert
            if (member.battery <= 20 && member.battery > 0) {
                const alertId = `battery-${member.id}`;
                if (!dismissedIds.has(alertId)) {
                    if (isSelf) {
                        // For self: Inform user directly to charge their phone, do NOT prompt to remind oneself!
                        newAlerts.push({
                            id: alertId,
                            type: 'low_battery',
                            memberId: member.id,
                            memberName: 'You',
                            message: `Your phone battery is low (${member.battery}%). Please plug in your charger.`,
                            icon: '🪫',
                            priority: 'info',
                            timestamp: new Date(),
                            actionLabel: 'Got It',
                            actionType: undefined
                        });
                    } else {
                        // For other circle members: Offer Send Reminder action to family
                        newAlerts.push({
                            id: alertId,
                            type: 'low_battery',
                            memberId: member.id,
                            memberName: member.name,
                            message: `${member.name}'s phone is at ${member.battery}%`,
                            icon: '🔋',
                            priority: 'info',
                            timestamp: new Date(),
                            actionLabel: 'Send Reminder',
                            actionType: 'charge'
                        });
                    }
                }
            }

            // Predictive destination (only alert about other circle members)
            if (!isSelf && member.status === 'Driving' && member.destination) {
                const alertId = `predict-${member.id}`;
                if (!dismissedIds.has(alertId)) {
                    newAlerts.push({
                        id: alertId,
                        type: 'prediction',
                        memberId: member.id,
                        memberName: member.name,
                        message: `${member.name} is heading to ${member.destination}`,
                        icon: '🎯',
                        priority: 'info',
                        timestamp: new Date()
                    });
                }
            }

            // SOS alert
            if (member.sosActive) {
                const alertId = `sos-${member.id}`;
                const freshness = getLocationFreshness(member.lastUpdated);
                if (!dismissedIds.has(alertId)) {
                    if (isSelf) {
                        newAlerts.push({
                            id: alertId,
                            type: 'sos_alert',
                            memberId: member.id,
                            memberName: 'You',
                            message: '🚨 Emergency SOS is active. Your Circle can see your latest shared location.',
                            icon: '🛡️',
                            priority: 'critical',
                            timestamp: new Date(),
                            actionLabel: 'I’m Safe — End SOS',
                            actionType: 'resolve_sos'
                        });
                    } else {
                        newAlerts.push({
                            id: alertId,
                            type: 'sos_alert',
                            memberId: member.id,
                            memberName: member.name,
                            message: `🚨 Emergency SOS: ${member.name} needs help. ${freshness.label}`,
                            icon: '🛡️',
                            priority: 'critical',
                            timestamp: new Date(),
                            actionLabel: 'Navigate to Them',
                            actionType: 'navigate'
                        });
                    }
                }
            }

            // Arrival notification (only for other circle members)
            if (!isSelf && member.status === 'Arrived' && member.currentPlace) {
                const alertId = `arrived-${member.id}-${member.currentPlace}`;
                if (!dismissedIds.has(alertId)) {
                    const wayText = member.wayType ? member.wayType.replace('Way', ' Way') : 'their Way';
                    newAlerts.push({
                        id: alertId,
                        type: 'arrived',
                        memberId: member.id,
                        memberName: member.name,
                        message: `${member.name} made ${wayText} to ${member.currentPlace}`,
                        icon: '📍',
                        priority: 'info',
                        timestamp: new Date()
                    });
                }
            }
        });

        setAlerts(newAlerts);
    }, [members, dismissedIds, currentUserId, currentUserName]);

    const handleDismiss = (alertId: string) => {
        setDismissedIds(prev => new Set(prev).add(alertId));
        onDismiss(alertId);
    };

    const handleAction = (alert: Alert) => {
        if (alert.actionType === 'resolve_sos') {
            if (window.confirm('End your active SOS? Your Circle will be told that you are safe.')) {
                onResolveOwnSOS();
            }
            return;
        }
        if (alert.actionType === 'charge' || alert.actionType === 'checkin') {
            onSendReminder(alert.memberId, alert.actionType);
        }
        handleDismiss(alert.id);
    };

    const getPriorityStyles = (priority: Alert['priority'], type: Alert['type']) => {
        // Specific override for low battery
        if (type === 'sos_alert') {
            return 'bg-red-600 border-red-400 text-white shadow-red-500/50 animate-pulse';
        }
        if (type === 'low_battery') {
            return 'bg-amber-500/10 border-amber-500/20 text-amber-700 dark:text-amber-300';
        }
        if (type === 'prediction' || type === 'arrived') {
            return 'bg-blue-500/10 border-blue-500/20 text-blue-600 dark:text-blue-400';
        }

        switch (priority) {
            case 'critical':
                return 'bg-red-500/20 border-red-500/50 text-red-400';
            case 'warning':
                return 'bg-amber-500/20 border-amber-500/50 text-amber-400';
            default:
                return theme === 'dark'
                    ? 'bg-white/5 border-white/10 text-slate-300'
                    : 'bg-white border-slate-200 text-slate-600 shadow-sm';
        }
    };

    if (alerts.length === 0) return null;

    return (
        <div className="flex flex-col gap-2 max-h-56 overflow-y-auto no-scrollbar py-2">
            {alerts.map((alert, index) => (
                <div
                    key={alert.id}
                    className={`flex items-center gap-3 p-3 rounded-2xl border backdrop-blur-xl transition-all duration-300 ${getPriorityStyles(alert.priority, alert.type)}`}
                    style={{ animationDelay: `${index * 50}ms` }}
                >
                    <span className="text-2xl filter drop-shadow-sm">{alert.icon}</span>

                    <div className="flex-1 min-w-0">
                        <p className={`text-sm font-bold leading-tight ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>
                            {alert.message}
                        </p>
                        <p className="text-xs text-slate-500 mt-0.5 font-medium">
                            {new Date(alert.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </p>
                    </div>

                    <div className="flex items-center gap-2">
                        {alert.actionLabel && (
                            <button
                                onClick={() => handleAction(alert)}
                                className={`px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wide transition-all hover:scale-105 shadow-lg
                                    ${alert.actionType === 'charge'
                                        ? 'bg-red-600 text-white hover:bg-red-700 shadow-red-500/40'
                                        : alert.actionLabel === 'Got It'
                                        ? (theme === 'dark' ? 'bg-white/10 hover:bg-white/20 text-white border border-white/15' : 'bg-slate-200 hover:bg-slate-300 text-slate-800')
                                        : 'bg-gradient-to-r from-amber-400 to-orange-500 text-white border-transparent hover:shadow-lg'}`}
                            >
                                {alert.actionLabel}
                            </button>
                        )}

                        {alert.type !== 'sos_alert' && (
                            <button
                                onClick={() => handleDismiss(alert.id)}
                                className="p-1.5 rounded-lg hover:bg-white/10 transition-colors"
                            >
                                ✕
                            </button>
                        )}
                    </div>
                </div>
            ))}
        </div>
    );
};

export default SafetyAlerts;
