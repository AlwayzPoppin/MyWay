// Auth Context - React Context for authentication state
import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { User } from 'firebase/auth';
import {
    onAuthChange,
    signInWithGoogle,
    signInWithEmail,
    signUpWithEmail,
    signOut,
    getUserProfile,
    UserProfile
} from '../services/authService';

interface AuthContextType {
    user: User | null;
    profile: UserProfile | null;
    loading: boolean;
    error: string | null;
    signInWithGoogle: () => Promise<void>;
    signInWithEmail: (email: string, password: string) => Promise<void>;
    signUpWithEmail: (email: string, password: string, displayName: string) => Promise<void>;
    logout: () => Promise<void>;
    clearError: () => void;
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

    useEffect(() => {
        const unsubscribe = onAuthChange(async (firebaseUser) => {
            setUser(firebaseUser);
            if (firebaseUser) {
                const userProfile = await getUserProfile(firebaseUser.uid);
                setProfile(userProfile);
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
        signInWithGoogle: handleSignInWithGoogle,
        signInWithEmail: handleSignInWithEmail,
        signUpWithEmail: handleSignUpWithEmail,
        logout: handleLogout,
        clearError
    };

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    );
};

export default AuthContext;
