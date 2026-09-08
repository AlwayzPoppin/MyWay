// Auth Context - React Context for authentication and multi-circle state
import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef, ReactNode } from 'react';
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
    updateUserProfile,
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
    deleteFamilyCircle,
    updateCircleColor as updateCircleColorService,
    deleteAccount as deleteAccountService,
    resetPassword as resetPasswordService
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
    sendPasswordReset: (email: string) => Promise<void>;
    logout: () => Promise<void>;
    clearError: () => void;
    createCircle: (name: string, color?: string) => Promise<FamilyCircle>;
    joinCircle: (code: string) => Promise<FamilyCircle | null>;
    switchCircle: (circleId: string) => Promise<void>;
    leaveCurrentCircle: (circleId: string) => Promise<void>;
    renameCircle: (circleId: string, name: string) => Promise<void>;
    updateCircleColor: (circleId: string, color: string) => Promise<void>;
    deleteCircle: (circleId: string) => Promise<void>;
    deleteUserAccount: (password?: string) => Promise<void>;
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

    const isRefreshingRef = useRef(false);
    const userRef = useRef(user);
    userRef.current = user;
    const profileRef = useRef(profile);
    profileRef.current = profile;

    const refreshCircles = useCallback(async () => {
        const currentUser = userRef.current;
        if (!currentUser) {
            setUserCircles(prev => prev.length === 0 ? prev : []);
            setCurrentCircle(null);
            return;
        }
        if (isRefreshingRef.current) return;
        isRefreshingRef.current = true;
        try {
            const circles = await getUserCircles(currentUser.uid);
            setUserCircles(prev => {
                if (prev.length === circles.length && prev.every((c, i) => c.id === circles[i].id && c.name === circles[i].name && c.color === circles[i].color)) {
                    return prev;
                }
                return circles;
            });

            const currentProf = profileRef.current;
            if (currentProf?.familyCircleId) {
                const active = circles.find(c => c.id === currentProf.familyCircleId) || await getFamilyCircle(currentProf.familyCircleId);
                setCurrentCircle(prev => {
                    if (prev?.id === active?.id && prev?.name === active?.name && prev?.color === active?.color) {
                        return prev;
                    }
                    return active;
                });
            } else if (circles.length > 0) {
                await switchActiveCircle(currentUser.uid, circles[0].id);
                setCurrentCircle(prev => prev?.id === circles[0].id ? prev : circles[0]);
            } else {
                setCurrentCircle(null);
            }
        } catch (e) {
            console.warn('⚠️ Error refreshing circles:', e);
        } finally {
            isRefreshingRef.current = false;
        }
    }, []);

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
                setUserCircles(prev => prev.length === 0 ? prev : []);
            }
            setLoading(false);
        });
 
        return () => {
            unsubscribe();
            if (profileUnsubscribe) profileUnsubscribe();
        };
    }, []);

    const lastSyncedUidRef = useRef<string | null>(null);
    const lastSyncedCircleIdRef = useRef<string | null>(null);

    useEffect(() => {
        if (!user?.uid) {
            lastSyncedUidRef.current = null;
            lastSyncedCircleIdRef.current = null;
            setUserCircles(prev => prev.length === 0 ? prev : []);
            setCurrentCircle(null);
            return;
        }

        const circleId = profile?.familyCircleId || null;
        if (lastSyncedUidRef.current !== user.uid || lastSyncedCircleIdRef.current !== circleId) {
            lastSyncedUidRef.current = user.uid;
            lastSyncedCircleIdRef.current = circleId;
            refreshCircles();
        }
    }, [user?.uid, profile?.familyCircleId, refreshCircles]);
 
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

const formatAuthError = (err: any, defaultMsg: string): string => {
    const code = err?.code || '';
    const msg = err?.message || '';
    if (code === 'auth/email-already-in-use' || msg.includes('auth/email-already-in-use') || msg.includes('EMAIL_EXISTS')) {
        return 'This email is already in use. Please sign in instead, or use "Forgot password?" to reset your credentials.';
    }
    if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || msg.includes('auth/invalid-credential') || msg.includes('INVALID_LOGIN_CREDENTIALS')) {
        return 'Incorrect email or password. Please check your credentials or click "Forgot password?".';
    }
    if (code === 'auth/user-not-found' || msg.includes('auth/user-not-found')) {
        return 'No account found with this email. Please click "Sign Up" below to create an account.';
    }
    if (code === 'auth/weak-password' || msg.includes('auth/weak-password')) {
        return 'Password should be at least 6 characters.';
    }
    if (code === 'auth/too-many-requests' || msg.includes('auth/too-many-requests')) {
        return 'Too many failed attempts. Account temporarily locked. Please reset your password or try again later.';
    }
    if (code === 'auth/invalid-email' || msg.includes('auth/invalid-email')) {
        return 'Please enter a valid email address.';
    }
    return err?.message || defaultMsg;
};

    const handleSignInWithGoogle = async () => {
        try {
            setError(null);
            setLoading(true);
            await signInWithGoogle();
        } catch (err: any) {
            setError(formatAuthError(err, 'Failed to sign in with Google'));
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
            setError(formatAuthError(err, 'Failed to sign in'));
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
            setError(formatAuthError(err, 'Failed to create account'));
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
            setUserCircles(prev => prev.length === 0 ? prev : []);
        } catch (err: any) {
            setError(err.message || 'Failed to sign out');
        }
    };

    const clearError = () => setError(null);

    const handleCreateCircle = async (name: string, color?: string) => {
        if (!user) throw new Error('Must be logged in');
        const circle = await createFamilyCircle(name, user.uid, color);
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

    const handleUpdateCircleColor = async (circleId: string, color: string) => {
        await updateCircleColorService(circleId, color);
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

    const handleSendPasswordReset = async (email: string) => {
        try {
            setError(null);
            setLoading(true);
            await resetPasswordService(email);
        } catch (err: any) {
            setError(err.message || 'Failed to send password reset email');
            throw err;
        } finally {
            setLoading(false);
        }
    };

    const handleDeleteUserAccount = async (password?: string) => {
        if (!user) return;
        await deleteAccountService(user.uid, profile?.familyCircleId || undefined, password);
        setUser(null);
        setProfile(null);
        setCurrentCircle(null);
        setUserCircles([]);
    };

    const value: AuthContextType = useMemo(() => ({
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
        sendPasswordReset: handleSendPasswordReset,
        logout: handleLogout,
        clearError,
        createCircle: handleCreateCircle,
        joinCircle: handleJoinCircle,
        switchCircle: handleSwitchCircle,
        leaveCurrentCircle: handleLeaveCurrentCircle,
        renameCircle: handleRenameCircle,
        updateCircleColor: handleUpdateCircleColor,
        deleteCircle: handleDeleteCircle,
        deleteUserAccount: handleDeleteUserAccount,
        refreshCircles
    }), [
        user,
        profile,
        currentCircle,
        userCircles,
        loading,
        error,
        emailLinkSent,
        refreshCircles
    ]);

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    );
};

export default AuthContext;
