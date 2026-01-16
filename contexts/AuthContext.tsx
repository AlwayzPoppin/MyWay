// Auth Context - React Context for authentication state
import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
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
    joinFamilyCircle
} from '../services/authService';

interface AuthContextType {
    user: User | null;
    profile: UserProfile | null;
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
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [emailLinkSent, setEmailLinkSent] = useState(false);

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

        const unsubscribe = onAuthChange(async (firebaseUser) => {
            setUser(firebaseUser);
            if (firebaseUser) {
                try {
                    const userProfile = await getUserProfile(firebaseUser.uid);
                    setProfile(userProfile);
                } catch (err) {
                    console.error('Profile load failed:', err);
                }
            } else {
                setProfile(null);
            }
            setLoading(false);
        });

        return () => unsubscribe();
    }, []);

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
        } catch (err: any) {
            setError(err.message || 'Failed to sign out');
        }
    };

    const clearError = () => setError(null);

    const value: AuthContextType = {
        user,
        profile,
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
        createCircle: async (name: string) => {
            if (!user) throw new Error('Must be logged in');
            const circle = await createFamilyCircle(name, user.uid);
            // Update the profile state with the new circle ID
            // If profile is null, create a minimal profile object
            setProfile(prev => {
                if (prev) {
                    return { ...prev, familyCircleId: circle.id };
                }
                // Create a minimal profile if none exists
                return {
                    uid: user.uid,
                    email: user.email,
                    displayName: user.displayName,
                    photoURL: user.photoURL,
                    phoneNumber: user.phoneNumber,
                    familyCircleId: circle.id,
                    createdAt: Date.now(),
                    lastSeen: Date.now(),
                    settings: {
                        theme: 'dark',
                        notifications: true,
                        locationSharing: true
                    }
                };
            });
            console.log('Profile updated with new circleId:', circle.id);
            return circle;
        },
        joinCircle: async (code: string) => {
            if (!user) throw new Error('Must be logged in');
            const circle = await joinFamilyCircle(code, user.uid);
            if (circle) {
                const updatedProfile = await getUserProfile(user.uid);
                setProfile(updatedProfile);
            }
            return circle;
        }
    };

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    );
};

export default AuthContext;
