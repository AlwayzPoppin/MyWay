// Login Screen Component
import React, { useState } from 'react';

interface LoginScreenProps {
    theme: 'light' | 'dark';
    onSignInWithGoogle: () => Promise<void>;
    onSignInWithEmail: (email: string, password: string) => Promise<void>;
    onSignUpWithEmail: (email: string, password: string, displayName: string) => Promise<void>;
    onSendMagicLink: (email: string) => Promise<void>;
    magicLinkSent: boolean;
    loading: boolean;
    error: string | null;
    onClearError: () => void;
}

const LoginScreen: React.FC<LoginScreenProps> = ({
    theme,
    onSignInWithGoogle,
    onSignInWithEmail,
    onSignUpWithEmail,
    onSendMagicLink,
    magicLinkSent,
    loading,
    error,
    onClearError
}) => {
    const [isSignUp, setIsSignUp] = useState(false);
    const [useMagicLink, setUseMagicLink] = useState(false);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [displayName, setDisplayName] = useState('');

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (useMagicLink) {
            await onSendMagicLink(email);
        } else if (isSignUp) {
            await onSignUpWithEmail(email, password, displayName);
        } else {
            await onSignInWithEmail(email, password);
        }
    };

    const isDark = theme === 'dark';

    return (
        <div className={`min-h-screen flex items-center justify-center p-6 ${isDark
            ? 'bg-gradient-to-br from-[#050914] via-[#0f172a] to-[#1e1b4b]'
            : 'bg-gradient-to-br from-slate-100 via-white to-blue-50'
            }`}>
            <div className={`w-full max-w-md rounded-3xl p-8 shadow-2xl ${isDark
                ? 'bg-white/5 border border-white/10 backdrop-blur-xl'
                : 'bg-white border border-slate-200'
                }`}>
                {/* Logo */}
                <div className="text-center mb-8">
                    <div className="w-20 h-20 mx-auto mb-4">
                        <img src="/logo.png" alt="MyWay" className="w-full h-full object-contain" />
                    </div>
                    <h1 className="text-3xl font-bold" style={{ fontFamily: 'Poppins, sans-serif' }}>
                        <span className={isDark ? 'text-white' : 'text-slate-800'}>My</span>
                        <span className="bg-gradient-to-r from-amber-400 via-orange-500 to-amber-500 bg-clip-text text-transparent">Way</span>
                    </h1>
                    <p className={`text-sm mt-2 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                        Family GPS - Stay Connected
                    </p>
                </div>

                {/* Status Messages */}
                {error && (
                    <div className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-sm flex items-center justify-between animate-in fade-in zoom-in">
                        <span>{error}</span>
                        <button onClick={onClearError} className="text-red-300 hover:text-white">✕</button>
                    </div>
                )}

                {magicLinkSent && (
                    <div className="mb-6 p-4 rounded-xl bg-green-500/10 border border-green-500/30 text-green-400 text-sm animate-in fade-in zoom-in">
                        ✨ Magic link sent! Check your inbox to sign in.
                    </div>
                )}

                {/* Google Sign In */}
                <button
                    onClick={onSignInWithGoogle}
                    disabled={loading}
                    className={`w-full flex items-center justify-center gap-3 py-4 rounded-xl font-semibold transition-all ${isDark
                        ? 'bg-white text-slate-900 hover:bg-slate-100'
                        : 'bg-slate-900 text-white hover:bg-slate-800'
                        } ${loading ? 'opacity-50 cursor-not-allowed' : 'hover:scale-[1.02]'}`}
                >
                    <svg className="w-5 h-5" viewBox="0 0 24 24">
                        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                    </svg>
                    Continue with Google
                </button>

                {/* Divider */}
                <div className="flex items-center my-6">
                    <div className={`flex-1 h-px ${isDark ? 'bg-white/10' : 'bg-slate-200'}`} />
                    <span className={`px-4 text-sm ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>or</span>
                    <div className={`flex-1 h-px ${isDark ? 'bg-white/10' : 'bg-slate-200'}`} />
                </div>

                {/* Email Form */}
                <form onSubmit={handleSubmit} className="space-y-4">
                    {isSignUp && (
                        <input
                            type="text"
                            placeholder="Display Name"
                            value={displayName}
                            onChange={(e) => setDisplayName(e.target.value)}
                            className={`w-full px-4 py-3 rounded-xl outline-none transition-all ${isDark
                                ? 'bg-white/5 border border-white/10 text-white placeholder-slate-500 focus:border-amber-500/50'
                                : 'bg-slate-50 border border-slate-200 text-slate-900 placeholder-slate-400 focus:border-amber-500'
                                }`}
                            required={isSignUp}
                        />
                    )}
                    <input
                        type="email"
                        placeholder="Email Address"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className={`w-full px-4 py-3 rounded-xl outline-none transition-all ${isDark
                            ? 'bg-white/5 border border-white/10 text-white placeholder-slate-500 focus:border-amber-500/50'
                            : 'bg-slate-50 border border-slate-200 text-slate-900 placeholder-slate-400 focus:border-amber-500'
                            }`}
                        required
                    />
                    {!useMagicLink && (
                        <input
                            type="password"
                            placeholder="Password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            className={`w-full px-4 py-3 rounded-xl outline-none transition-all ${isDark
                                ? 'bg-white/5 border border-white/10 text-white placeholder-slate-500 focus:border-amber-500/50'
                                : 'bg-slate-50 border border-slate-200 text-slate-900 placeholder-slate-400 focus:border-amber-500'
                                }`}
                            required={!useMagicLink}
                            minLength={6}
                        />
                    )}
                    <button
                        type="submit"
                        disabled={loading || magicLinkSent}
                        className={`w-full py-4 rounded-xl font-bold uppercase tracking-wider transition-all
              bg-gradient-to-r from-amber-400 via-orange-500 to-amber-500 text-black
              ${(loading || magicLinkSent) ? 'opacity-50 cursor-not-allowed' : 'hover:shadow-lg hover:shadow-amber-500/30 hover:scale-[1.02]'}`}
                    >
                        {loading ? '...' : useMagicLink ? 'Send Magic Link' : isSignUp ? 'Create Account' : 'Sign In'}
                    </button>
                </form>

                {/* Magic Link Toggle */}
                {!isSignUp && (
                    <div className="text-center mt-4">
                        <button
                            onClick={() => {
                                setUseMagicLink(!useMagicLink);
                                onClearError();
                            }}
                            className={`text-sm font-medium ${isDark ? 'text-slate-400 hover:text-white' : 'text-slate-500 hover:text-slate-800'} transition-colors`}
                        >
                            {useMagicLink ? 'Use password instead' : 'Sign in with Magic Link (Passwordless)'}
                        </button>
                    </div>
                )}

                {/* Toggle Sign Up / Sign In */}
                <p className={`text-center mt-6 text-sm ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                    {isSignUp ? 'Already have an account?' : "Don't have an account?"}
                    <button
                        onClick={() => {
                            setIsSignUp(!isSignUp);
                            setUseMagicLink(false);
                            onClearError();
                        }}
                        className="ml-2 text-amber-500 hover:text-amber-400 font-semibold"
                    >
                        {isSignUp ? 'Sign In' : 'Sign Up'}
                    </button>
                </p>
            </div>
        </div>
    );
};

export default LoginScreen;
