import React, { useState, useEffect, useRef } from 'react';
import { audioService } from '../services/audioService';

interface EmergencySOSModalProps {
    isOpen: boolean;
    onClose: () => void;
    isSosActive: boolean;
    onTriggerSOS: () => void;
    onCancelSOS: () => void;
    theme?: 'light' | 'dark';
    userLocation?: { lat: number; lng: number } | null;
}

const EmergencySOSModal: React.FC<EmergencySOSModalProps> = ({
    isOpen,
    onClose,
    isSosActive,
    onTriggerSOS,
    onCancelSOS,
    theme = 'dark',
    userLocation
}) => {
    const [countdown, setCountdown] = useState<number>(5);
    const [isAutoSending, setIsAutoSending] = useState(!isSosActive);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    useEffect(() => {
        if (!isOpen) {
            setCountdown(5);
            setIsAutoSending(false);
            if (timerRef.current) clearInterval(timerRef.current);
            return;
        }

        if (!isSosActive) {
            setCountdown(5);
            setIsAutoSending(true);
            try {
                audioService.playChirp(880, 150);
            } catch {}

            timerRef.current = setInterval(() => {
                setCountdown(prev => {
                    if (prev <= 1) {
                        if (timerRef.current) clearInterval(timerRef.current);
                        onTriggerSOS();
                        setIsAutoSending(false);
                        return 0;
                    }
                    try {
                        audioService.playChirp(880, 100);
                    } catch {}
                    return prev - 1;
                });
            }, 1000);
        } else {
            setIsAutoSending(false);
        }

        return () => {
            if (timerRef.current) clearInterval(timerRef.current);
        };
    }, [isOpen, isSosActive, onTriggerSOS]);

    if (!isOpen) return null;

    const handleSendNow = () => {
        if (timerRef.current) clearInterval(timerRef.current);
        setIsAutoSending(false);
        onTriggerSOS();
    };

    const handleStopCountdown = () => {
        if (timerRef.current) clearInterval(timerRef.current);
        setIsAutoSending(false);
        onClose();
    };

    const handleCall911 = () => {
        window.open('tel:911', '_system');
    };

    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/80 backdrop-blur-xl animate-in fade-in duration-200 pointer-events-auto">
            <div className={`relative w-full max-w-sm rounded-3xl border p-6 shadow-2xl overflow-hidden transition-all ${
                theme === 'dark'
                    ? 'bg-slate-900/95 border-red-500/40 text-white shadow-[0_0_50px_rgba(239,68,68,0.3)]'
                    : 'bg-white/95 border-red-500/30 text-slate-900 shadow-2xl'
            }`}>
                {/* Background Ambient Glow */}
                <div className="absolute -top-24 -left-24 w-48 h-48 bg-red-600/20 rounded-full blur-3xl pointer-events-none" />
                <div className="absolute -bottom-24 -right-24 w-48 h-48 bg-amber-600/20 rounded-full blur-3xl pointer-events-none" />

                {/* Header */}
                <div className="flex items-center justify-between pb-4 border-b border-red-500/20 relative z-10">
                    <div className="flex items-center gap-2.5">
                        <span className="text-2xl animate-bounce">🚨</span>
                        <div>
                            <h3 className="text-lg font-black tracking-tight text-red-500 uppercase leading-none">
                                {isSosActive ? 'SOS Active' : 'Emergency SOS'}
                            </h3>
                            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mt-0.5">
                                {isSosActive ? 'Broadcast in progress' : 'Safety Dispatch'}
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-slate-400 hover:text-white transition-all text-sm"
                    >
                        ✕
                    </button>
                </div>

                {/* Main Body */}
                <div className="py-5 text-center relative z-10 space-y-4">
                    {isSosActive ? (
                        <div className="space-y-3">
                            <div className="w-20 h-20 mx-auto rounded-full bg-red-500/20 border-2 border-red-500 flex items-center justify-center shadow-[0_0_30px_rgba(239,68,68,0.5)] animate-pulse">
                                <span className="text-3xl">🛡️</span>
                            </div>
                            <div>
                                <h4 className="text-base font-black text-white">Emergency Broadcast Active</h4>
                                <p className="text-xs text-slate-400 mt-1 max-w-xs mx-auto leading-relaxed">
                                    Your live GPS coordinates are being shared with your Circle & Caravan members in real time.
                                </p>
                            </div>

                            {userLocation && (
                                <div className="p-2.5 rounded-xl bg-black/40 border border-white/10 text-[11px] font-mono text-slate-300">
                                    📍 {userLocation.lat.toFixed(5)}, {userLocation.lng.toFixed(5)}
                                </div>
                            )}

                            <button
                                type="button"
                                onClick={() => {
                                    onCancelSOS();
                                    onClose();
                                }}
                                className="w-full py-3.5 px-4 bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white font-black text-sm rounded-2xl shadow-lg transition-all flex items-center justify-center gap-2 cursor-pointer"
                            >
                                <span>✅</span>
                                <span>I'm Safe — Cancel SOS</span>
                            </button>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {/* Auto-Dispatch Ring Countdown */}
                            <div className="relative w-28 h-28 mx-auto flex items-center justify-center">
                                <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
                                    <circle
                                        cx="50"
                                        cy="50"
                                        r="42"
                                        stroke="currentColor"
                                        strokeWidth="6"
                                        className="text-slate-800"
                                        fill="transparent"
                                    />
                                    <circle
                                        cx="50"
                                        cy="50"
                                        r="42"
                                        stroke="currentColor"
                                        strokeWidth="6"
                                        className="text-red-500 transition-all duration-1000 ease-linear"
                                        fill="transparent"
                                        strokeDasharray={264}
                                        strokeDashoffset={264 - (264 * countdown) / 5}
                                        strokeLinecap="round"
                                    />
                                </svg>
                                <div className="absolute flex flex-col items-center justify-center">
                                    <span className="text-3xl font-black text-red-500 leading-none">{countdown}</span>
                                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mt-0.5">sec</span>
                                </div>
                            </div>

                            <p className="text-xs text-slate-300 max-w-xs mx-auto leading-relaxed">
                                {isAutoSending 
                                    ? 'Broadcasting distress beacon & GPS to Circle in ' + countdown + 's...' 
                                    : 'Confirm emergency distress beacon'}
                            </p>

                            {/* Action Buttons */}
                            <div className="space-y-2 pt-2">
                                <button
                                    type="button"
                                    onClick={handleSendNow}
                                    className="w-full py-3 px-4 bg-red-600 hover:bg-red-500 active:scale-95 text-white font-black text-sm rounded-2xl shadow-[0_0_20px_rgba(239,68,68,0.4)] transition-all flex items-center justify-center gap-2 cursor-pointer"
                                >
                                    <span>🚨</span>
                                    <span>Send SOS Now</span>
                                </button>

                                <button
                                    type="button"
                                    onClick={handleCall911}
                                    className="w-full py-2.5 px-4 bg-white/10 hover:bg-white/20 active:scale-95 text-white font-bold text-xs rounded-2xl border border-white/15 transition-all flex items-center justify-center gap-2 cursor-pointer"
                                >
                                    <span>📞</span>
                                    <span>Call 911 (Emergency Dispatch)</span>
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer Cancel */}
                {!isSosActive && (
                    <div className="pt-2 text-center border-t border-white/10 relative z-10">
                        <button
                            type="button"
                            onClick={handleStopCountdown}
                            className="text-xs font-bold text-slate-400 hover:text-white py-1 px-4 rounded-lg transition-colors cursor-pointer"
                        >
                            Cancel
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

export default EmergencySOSModal;
