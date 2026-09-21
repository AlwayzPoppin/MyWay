import React, { useEffect, useState } from 'react';

interface LoadingScreenProps {
    theme: 'light' | 'dark';
    stage?: 'startup' | 'map';
}

const LoadingScreen: React.FC<LoadingScreenProps> = ({ theme, stage = 'startup' }) => {
    const isDark = theme === 'dark';
    const [isSlow, setIsSlow] = useState(false);
    const initialMessage = stage === 'map' ? 'Preparing your map...' : 'Initializing My Way...';
    const slowMessage = stage === 'map' ? 'Loading map details...' : 'Securing your circle...';

    useEffect(() => {
        const timer = window.setTimeout(() => setIsSlow(true), 1000);
        return () => window.clearTimeout(timer);
    }, [stage]);
    
    return (
        <div className={`min-h-screen flex flex-col items-center justify-center p-6 transition-colors duration-500 ${
            isDark ? 'bg-[#0f172a]' : 'bg-[#f8f6f0]'
        }`}>
            {/* Logo container with pulse effect */}
            <div className="relative mb-8">
                <div className={`absolute -inset-4 rounded-full blur-2xl opacity-25 animate-pulse ${
                    isDark ? 'bg-purple-600' : 'bg-indigo-500'
                }`} />
                <div className="relative w-24 h-24">
                    <img 
                        src="/logo.png" 
                        alt="MyWay Logo" 
                        className="w-full h-full object-contain animate-bounce"
                        style={{ animationDuration: '2s' }}
                    />
                </div>
            </div>

            {/* Spinner */}
            <div className="relative w-16 h-16 mb-6">
                <div className="absolute inset-0 border-4 border-indigo-500/20 rounded-full" />
                <div className="absolute inset-0 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            </div>

            {/* Message */}
            <div className="text-center">
                <h2 className={`text-xl font-bold tracking-widest mb-2 ${
                    isDark ? 'text-white' : 'text-slate-800'
                }`}>
                    MY WAY<span className="text-orange-500">.</span>
                </h2>
                <p className={`text-sm font-medium animate-pulse ${
                    isDark ? 'text-slate-400' : 'text-slate-500'
                }`}>
                    {isSlow ? slowMessage : initialMessage}
                </p>
            </div>

            {/* Bottom Tagline */}
            <div className="absolute bottom-12 text-center pointer-events-none">
                <p className={`text-xs uppercase tracking-[0.2em] font-bold ${
                    isDark ? 'text-slate-600' : 'text-slate-300'
                }`}>
                    Family GPS & Safety
                </p>
            </div>
        </div>
    );
};

export default LoadingScreen;
