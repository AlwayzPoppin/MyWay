// Auth Context - React Context for authentication and multi-circle state
import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { User } from 'firebase/auth';
import {
    onAuthChange,
    signInWithGoogle,
    signInWithEmail,
    signUpWithEmail,
    sendEmailLink,
    isEmailLinkSignIn,
    completeEmailLinkSignIn,
    signOut,
    getUserProfile,
    UserProfile,
    FamilyCircle,
    createFamilyCircle,
    joinFamilyCircle,
    subscribeToUserProfile,
    getFamilyCircle,
    getUserCircles,
    switchActiveCircle,
    leaveCircle,
    renameFamilyCircle,
    deleteFamilyCircle
} from '../services/authService';

interface AuthContextType {
    user: User | null;
    profile: UserProfile | null;
    currentCircle: FamilyCircle | null;
    userCircles: FamilyCircle[];
    loading: boolean;
    error: string | null;
    emailLinkSent: boolean;
    signInWithGoogle: () => Promise<void>;
    signInWithEmail: (email: string, password: string) => Promise<void>;
    signUpWithEmail: (email: string, password: string, displayName: string) => Promise<void>;
    sendMagicLink: (email: string) => Promise<void>;
    completeMagicLinkSignIn: (email?: string) => Promise<void>;
    logout: () => Promise<void>;
    clearError: () => void;
    createCircle: (name: string) => Promise<FamilyCircle>;
    joinCircle: (code: string) => Promise<FamilyCircle | null>;
    switchCircle: (circleId: string) => Promise<void>;
    leaveCurrentCircle: (circleId: string) => Promise<void>;
    renameCircle: (circleId: string, name: string) => Promise<void>;
    deleteCircle: (circleId: string) => Promise<void>;
    refreshCircles: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
};

interface AuthProviderProps {
    children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
    const [user, setUser] = useState<User | null>(null);
    const [profile, setProfile] = useState<UserProfile | null>(null);
    const [currentCircle, setCurrentCircle] = useState<FamilyCircle | null>(null);
    const [userCircles, setUserCircles] = useState<FamilyCircle[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [emailLinkSent, setEmailLinkSent] = useState(false);

    const refreshCircles = useCallback(async () => {
        if (!user) {
            setUserCircles([]);
            setCurrentCircle(null);
            return;
        }
        try {
            const circles = await getUserCircles(user.uid);
            setUserCircles(circles);

            if (profile?.familyCircleId) {
                const active = circles.find(c => c.id === profile.familyCircleId) || await getFamilyCircle(profile.familyCircleId);
                setCurrentCircle(active);
            } else if (circles.length > 0) {
                await switchActiveCircle(user.uid, circles[0].id);
                setCurrentCircle(circles[0]);
                setProfile(prev => prev ? { ...prev, familyCircleId: circles[0].id } : prev);
            } else {
                setCurrentCircle(null);
            }
        } catch (e) {
            console.warn('⚠️ Error refreshing circles:', e);
        }
    }, [user, profile?.familyCircleId]);

    useEffect(() => {
        // Check if returning from email link sign-in
        if (isEmailLinkSignIn()) {
            setLoading(true);
            completeEmailLinkSignIn()
                .then(() => setLoading(false))
                .catch((err) => {
                    setError(err.message || 'Failed to complete sign-in');
                    setLoading(false);
                });
        }

        let profileUnsubscribe: (() => void) | null = null;
        
        const unsubscribe = onAuthChange((firebaseUser) => {
            setUser(firebaseUser);
            if (profileUnsubscribe) {
                profileUnsubscribe();
                profileUnsubscribe = null;
            }
            
            if (firebaseUser) {
                profileUnsubscribe = subscribeToUserProfile(firebaseUser.uid, (userProfile) => {
                    setProfile(userProfile);
                });
            } else {
                setProfile(null);
                setCurrentCircle(null);
                setUserCircles([]);
            }
            setLoading(false);
        });
 
        return () => {
            unsubscribe();
            if (profileUnsubscribe) profileUnsubscribe();
        };
    }, []);

    useEffect(() => {
        refreshCircles();
    }, [refreshCircles]);
 
    // Side Effect: Auto-join circle from pending invite
    useEffect(() => {
        if (!user || !profile) return;
        
        const pendingInvite = localStorage.getItem('myway_pending_invite');
        if (pendingInvite && !profile.familyCircleId) {
            console.log('Detected pending invite, auto-joining:', pendingInvite);
            joinFamilyCircle(pendingInvite, user.uid)
                .then(() => {
                    localStorage.removeItem('myway_pending_invite');
                    refreshCircles();
                })
                .catch(err => console.error('Auto-join failed:', err));
        }
    }, [user?.uid, profile?.familyCircleId, refreshCircles]);

    const handleSignInWithGoogle = async () => {
        try {
            setError(null);
            setLoading(true);
            await signInWithGoogle();
        } catch (err: any) {
            setError(err.message || 'Failed to sign in with Google');
        } finally {
            setLoading(false);
        }
    };

    const handleSignInWithEmail = async (email: string, password: string) => {
        try {
            setError(null);
            setLoading(true);
            await signInWithEmail(email, password);
        } catch (err: any) {
            setError(err.message || 'Failed to sign in');
        } finally {
            setLoading(false);
        }
    };

    const handleSignUpWithEmail = async (email: string, password: string, displayName: string) => {
        try {
            setError(null);
            setLoading(true);
            await signUpWithEmail(email, password, displayName);
        } catch (err: any) {
            setError(err.message || 'Failed to create account');
        } finally {
            setLoading(false);
        }
    };

    const handleSendMagicLink = async (email: string) => {
        try {
            setError(null);
            setLoading(true);
            await sendEmailLink(email);
            setEmailLinkSent(true);
        } catch (err: any) {
            setError(err.message || 'Failed to send magic link');
        } finally {
            setLoading(false);
        }
    };

    const handleCompleteMagicLinkSignIn = async (email?: string) => {
        try {
            setError(null);
            setLoading(true);
            await completeEmailLinkSignIn(email);
            setEmailLinkSent(false);
        } catch (err: any) {
            setError(err.message || 'Failed to complete sign-in');
        } finally {
            setLoading(false);
        }
    };

    const handleLogout = async () => {
        try {
            setError(null);
            await signOut();
            setCurrentCircle(null);
            setUserCircles([]);
        } catch (err: any) {
            setError(err.message || 'Failed to sign out');
        }
    };

    const clearError = () => setError(null);

    const handleCreateCircle = async (name: string) => {
        if (!user) throw new Error('Must be logged in');
        const circle = await createFamilyCircle(name, user.uid);
        setProfile(prev => prev ? { ...prev, familyCircleId: circle.id } : prev);
        setCurrentCircle(circle);
        await refreshCircles();
        return circle;
    };

    const handleJoinCircle = async (code: string) => {
        if (!user) throw new Error('Must be logged in');
        const circle = await joinFamilyCircle(code, user.uid);
        if (circle) {
            const updatedProfile = await getUserProfile(user.uid);
            setProfile(updatedProfile);
            setCurrentCircle(circle);
            await refreshCircles();
        }
        return circle;
    };

    const handleSwitchCircle = async (circleId: string) => {
        if (!user) return;
        await switchActiveCircle(user.uid, circleId);
        setProfile(prev => prev ? { ...prev, familyCircleId: circleId } : prev);
        const target = userCircles.find(c => c.id === circleId) || await getFamilyCircle(circleId);
        setCurrentCircle(target);
        await refreshCircles();
    };

    const handleLeaveCurrentCircle = async (circleId: string) => {
        if (!user) return;
        await leaveCircle(circleId, user.uid);
        const updatedProfile = await getUserProfile(user.uid);
        setProfile(updatedProfile);
        await refreshCircles();
    };

    const handleRenameCircle = async (circleId: string, name: string) => {
        await renameFamilyCircle(circleId, name);
        await refreshCircles();
    };

    const handleDeleteCircle = async (circleId: string) => {
        await deleteFamilyCircle(circleId);
        if (profile?.familyCircleId === circleId && user) {
            await updateUserProfile(user.uid, { familyCircleId: null });
            const updatedProfile = await getUserProfile(user.uid);
            setProfile(updatedProfile);
        }
        await refreshCircles();
    };

    const value: AuthContextType = {
        user,
        profile,
        currentCircle,
        userCircles,
        loading,
        error,
        emailLinkSent,
        signInWithGoogle: handleSignInWithGoogle,
        signInWithEmail: handleSignInWithEmail,
        signUpWithEmail: handleSignUpWithEmail,
        sendMagicLink: handleSendMagicLink,
        completeMagicLinkSignIn: handleCompleteMagicLinkSignIn,
        logout: handleLogout,
        clearError,
        createCircle: handleCreateCircle,
        joinCircle: handleJoinCircle,
        switchCircle: handleSwitchCircle,
        leaveCurrentCircle: handleLeaveCurrentCircle,
        renameCircle: handleRenameCircle,
        deleteCircle: handleDeleteCircle,
        refreshCircles
    };

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    );
};

export default AuthContext;
