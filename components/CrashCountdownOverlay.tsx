import React, { useCallback, useState } from 'react';
import { cancelCrashCountdown } from '../services/crashDetectionService';

interface CrashCountdownOverlayProps {
    remainingSeconds: number;
    onDismiss: () => void;
    onFindHospital?: () => void;
    onImmediateSOS?: () => void;
}

const CrashCountdownOverlay: React.FC<CrashCountdownOverlayProps> = ({
    remainingSeconds,
    onDismiss,
    onFindHospital,
    onImmediateSOS
}) => {
    const [isExpanded, setIsExpanded] = useState(false);

    const handleImOkay = useCallback(() => {
        cancelCrashCountdown();
        onDismiss();
    }, [onDismiss]);

    const progress = (remainingSeconds / 30) * 100;
    const isUrgent = remainingSeconds <= 10;

    return (
        <div 
            className="fixed top-0 inset-x-0 z-[9999] pointer-events-none flex justify-center px-3 sm:px-4 transition-all duration-300"
            style={{ paddingTop: 'max(calc(env(safe-area-inset-top, 0px) + 8px), 12px)' }}
        >
            {/* Dynamic Island Floating Pill Container — Tactile, Non-Blocking */}
            <div className={`pointer-events-auto bg-gradient-to-b from-slate-950/98 via-slate-900/95 to-slate-950/98 backdrop-blur-2xl border-2 ${
                isUrgent ? 'border-red-500 shadow-[0_12px_45px_rgba(239,68,68,0.5)]' : 'border-amber-500/80 shadow-[0_12px_45px_rgba(245,158,11,0.35)]'
            } rounded-3xl p-3 sm:px-5 sm:py-3.5 max-w-xl w-full flex flex-col gap-2.5 animate-in slide-in-from-top duration-300 transition-all`}>
                
                {/* Main Dynamic Island Header Row */}
                <div className="flex items-center justify-between gap-3">
                    {/* Countdown Radial Dial */}
                    <div className="relative w-11 h-11 sm:w-13 sm:h-13 shrink-0">
                        <svg className="w-full h-full -rotate-90" viewBox="0 0 120 120">
                            <circle cx="60" cy="60" r="48" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="12" />
                            <circle
                                cx="60" cy="60" r="48" fill="none"
                                stroke={isUrgent ? '#ef4444' : '#f59e0b'}
                                strokeWidth="12"
                                strokeLinecap="round"
                                strokeDasharray={`${2 * Math.PI * 48}`}
                                strokeDashoffset={`${2 * Math.PI * 48 * (1 - progress / 100)}`}
                                className="transition-all duration-1000"
                            />
                        </svg>
                        <div className="absolute inset-0 flex items-center justify-center">
                            <span className={`text-base sm:text-lg font-black tracking-tight ${isUrgent ? 'text-red-400 animate-pulse' : 'text-amber-400'}`}>
                                {remainingSeconds}
                            </span>
                        </div>
                    </div>

                    {/* Crash Status Text */}
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-base animate-bounce">🚨</span>
                            <h2 className="text-xs sm:text-sm font-black text-white truncate uppercase tracking-wide">
                                Crash Impact Detected
                            </h2>
                        </div>
                        <p className={`text-[11px] sm:text-xs truncate font-bold mt-0.5 ${isUrgent ? 'text-red-300 animate-pulse' : 'text-amber-300'}`}>
                            Auto-dispatching SOS in <span className="underline">{remainingSeconds}s</span>
                        </p>
                    </div>

                    {/* Primary Action: I'm Okay */}
                    <button
                        type="button"
                        onClick={handleImOkay}
                        className="px-4 py-2 sm:px-5 sm:py-2.5 bg-emerald-500 hover:bg-emerald-400 active:scale-95 text-slate-950 font-black text-xs sm:text-sm rounded-2xl shadow-lg shadow-emerald-500/30 whitespace-nowrap transition-all flex items-center gap-1.5 shrink-0"
                    >
                        <span>✅</span>
                        <span>I'm OK</span>
                    </button>
                </div>

                {/* Secondary Tactical Toolbar (Hospital routing & Instant SOS) */}
                <div className="flex items-center justify-between gap-2 pt-1 border-t border-white/10">
                    <p className="text-[10px] text-slate-400 font-semibold hidden sm:block">
                        Map & routing active in background
                    </p>

                    <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                        {onFindHospital && (
                            <button
                                type="button"
                                onClick={() => {
                                    onFindHospital();
                                    setIsExpanded(false);
                                }}
                                className="flex-1 sm:flex-initial px-3 py-1.5 bg-sky-500/20 hover:bg-sky-500/30 border border-sky-500/40 active:scale-95 text-sky-200 hover:text-white font-bold text-[11px] rounded-xl transition-all flex items-center justify-center gap-1.5"
                                title="Search nearest hospitals and route immediately"
                            >
                                <span>🏥</span>
                                <span>Route Hospital</span>
                            </button>
                        )}

                        {onImmediateSOS && (
                            <button
                                type="button"
                                onClick={onImmediateSOS}
                                className="flex-1 sm:flex-initial px-3 py-1.5 bg-red-600 hover:bg-red-500 active:scale-95 text-white font-bold text-[11px] rounded-xl shadow-md transition-all flex items-center justify-center gap-1.5"
                                title="Dispatch emergency beacon immediately"
                            >
                                <span>⚡</span>
                                <span>Send SOS Now</span>
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default CrashCountdownOverlay;
