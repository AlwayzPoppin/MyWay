import React, { useCallback } from 'react';
import { cancelCrashCountdown } from '../services/crashDetectionService';

interface CrashCountdownOverlayProps {
    remainingSeconds: number;
    onDismiss: () => void;
}

const CrashCountdownOverlay: React.FC<CrashCountdownOverlayProps> = ({
    remainingSeconds,
    onDismiss
}) => {
    const handleImOkay = useCallback(() => {
        cancelCrashCountdown();
        onDismiss();
    }, [onDismiss]);

    const progress = (remainingSeconds / 30) * 100;
    const isUrgent = remainingSeconds <= 10;

    return (
        <div className="fixed top-0 inset-x-0 z-[9999] bg-slate-950/95 border-b-2 border-red-500 shadow-2xl backdrop-blur-xl p-4 sm:p-5 animate-in slide-in-from-top duration-300">
            <div className="max-w-xl mx-auto flex items-center justify-between gap-4">
                {/* Left: Icon & Countdown Ring */}
                <div className="relative w-14 h-14 sm:w-16 sm:h-16 shrink-0">
                    <svg className="w-full h-full -rotate-90" viewBox="0 0 120 120">
                        <circle cx="60" cy="60" r="50" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="10" />
                        <circle
                            cx="60" cy="60" r="50" fill="none"
                            stroke={isUrgent ? '#ef4444' : '#f59e0b'}
                            strokeWidth="10"
                            strokeLinecap="round"
                            strokeDasharray={`${2 * Math.PI * 50}`}
                            strokeDashoffset={`${2 * Math.PI * 50 * (1 - progress / 100)}`}
                            className="transition-all duration-1000"
                        />
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center">
                        <span className={`text-xl sm:text-2xl font-black ${isUrgent ? 'text-red-400' : 'text-amber-400'}`}>
                            {remainingSeconds}
                        </span>
                    </div>
                </div>

                {/* Center: Message */}
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                        <span className="text-xl animate-bounce">🚨</span>
                        <h2 className="text-base sm:text-lg font-black text-white truncate">Crash Detected — Are you okay?</h2>
                    </div>
                    <p className={`text-xs sm:text-sm truncate mt-0.5 ${isUrgent ? 'text-red-300 font-semibold' : 'text-amber-300'}`}>
                        Sending Emergency SOS in {remainingSeconds}s
                    </p>
                </div>

                {/* Right: I'm Okay Button */}
                <button
                    onClick={handleImOkay}
                    className="px-5 py-3 sm:px-6 sm:py-3.5 bg-emerald-500 hover:bg-emerald-400 active:scale-95 text-white text-sm sm:text-base font-black rounded-xl shadow-lg shadow-emerald-500/30 whitespace-nowrap transition-all"
                >
                    ✅ I'm Okay
                </button>
            </div>
        </div>
    );
};

export default CrashCountdownOverlay;
