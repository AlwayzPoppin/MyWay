import React, { useState, useEffect, useCallback } from 'react';
import { FamilyMember } from '../types';

interface CircleAdminPanelProps {
    members: FamilyMember[];
    circleOwnerId?: string;
    currentUserId?: string;
    onClose: () => void;
    onRemoveMember?: (memberId: string) => void;
    onUpdateRole?: (memberId: string, role: string) => void;
    showNotification?: (msg: string, duration?: number) => void;
    theme: 'light' | 'dark';
}

const ROLES = ['Admin', 'Member', 'Child', 'Guest'] as const;

const CircleAdminPanel: React.FC<CircleAdminPanelProps> = ({
    members,
    circleOwnerId,
    currentUserId,
    onClose,
    onRemoveMember,
    onUpdateRole,
    showNotification,
    theme
}) => {
    const [editingRole, setEditingRole] = useState<string | null>(null);
    const isOwner = currentUserId === circleOwnerId;
    const isDark = theme === 'dark';

    const handleRemove = useCallback((member: FamilyMember) => {
        if (!isOwner) {
            showNotification?.('Only the circle owner can remove members');
            return;
        }
        if (member.id === currentUserId) {
            showNotification?.('You cannot remove yourself');
            return;
        }
        if (confirm(`Remove ${member.name} from the circle?`)) {
            onRemoveMember?.(member.id);
            showNotification?.(`${member.name} has been removed`, 3000);
        }
    }, [isOwner, currentUserId, onRemoveMember, showNotification]);

    const handleRoleChange = useCallback((memberId: string, role: string) => {
        onUpdateRole?.(memberId, role);
        setEditingRole(null);
        showNotification?.(`Role updated to ${role}`, 2000);
    }, [onUpdateRole, showNotification]);

    const getRoleBadgeColor = (role: string): string => {
        switch (role) {
            case 'Admin': return 'bg-amber-500/20 text-amber-400 border-amber-500/30';
            case 'Child': return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
            case 'Guest': return 'bg-slate-500/20 text-slate-400 border-slate-500/30';
            default: return 'bg-white/10 text-white/70 border-white/20';
        }
    };

    return (
        <div className="h-full flex flex-col max-h-[70vh]">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-white/10">
                <div className="flex items-center gap-3">
                    <span className="text-2xl">👥</span>
                    <div>
                        <h2 className={`text-lg font-bold ${isDark ? 'text-white' : 'text-slate-900'}`}>
                            MyFamily Admin
                        </h2>
                        <p className="text-xs text-slate-400">{members.length} members</p>
                    </div>
                </div>
                <button
                    onClick={onClose}
                    className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-slate-400 transition-all"
                >
                    ✕
                </button>
            </div>

            {/* Member List */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {members.map(member => (
                    <div
                        key={member.id}
                        className={`flex items-center gap-3 p-3 rounded-2xl border transition-all ${
                            isDark ? 'bg-white/5 border-white/8' : 'bg-white border-slate-100'
                        }`}
                    >
                        {/* Avatar */}
                        <img
                            src={member.avatar}
                            className="w-12 h-12 rounded-xl object-cover"
                        />

                        {/* Info */}
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                                <h3 className={`font-semibold text-sm truncate ${isDark ? 'text-white' : 'text-slate-900'}`}>
                                    {member.name}
                                </h3>
                                {member.id === circleOwnerId && (
                                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 font-bold">
                                        OWNER
                                    </span>
                                )}
                            </div>

                            {/* Role Selector */}
                            {editingRole === member.id ? (
                                <div className="flex gap-1 mt-1 flex-wrap">
                                    {ROLES.map(role => (
                                        <button
                                            key={role}
                                            onClick={() => handleRoleChange(member.id, role)}
                                            className={`text-[10px] px-2 py-0.5 rounded-full border transition-all hover:scale-105 ${getRoleBadgeColor(role)}`}
                                        >
                                            {role}
                                        </button>
                                    ))}
                                </div>
                            ) : (
                                <button
                                    onClick={() => isOwner && setEditingRole(member.id)}
                                    className={`text-[10px] px-2 py-0.5 rounded-full border mt-1 transition-all ${
                                        getRoleBadgeColor(member.role)
                                    } ${isOwner ? 'cursor-pointer hover:scale-105' : 'cursor-default'}`}
                                >
                                    {member.role} {isOwner && '▾'}
                                </button>
                            )}
                        </div>

                        {/* Actions */}
                        {isOwner && member.id !== currentUserId && (
                            <button
                                onClick={() => handleRemove(member)}
                                className="w-8 h-8 rounded-full bg-red-500/10 hover:bg-red-500/20 flex items-center justify-center text-red-400 transition-all hover:scale-110"
                                title="Remove member"
                            >
                                <span className="text-xs">✕</span>
                            </button>
                        )}
                    </div>
                ))}
            </div>

            {/* Footer */}
            {!isOwner && (
                <div className="p-4 border-t border-white/10">
                    <p className="text-xs text-slate-500 text-center">
                        🔒 Only circle owners can manage members
                    </p>
                </div>
            )}
        </div>
    );
};

export default CircleAdminPanel;
