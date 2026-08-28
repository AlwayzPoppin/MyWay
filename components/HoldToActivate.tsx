import React, { useState, useRef, useEffect } from 'react';
import { audioService } from '../services/audioService';

interface HoldToActivateProps {
    onActivate: () => void;
    children: React.ReactNode;
    className?: string;
    duration?: number;
}

const HoldToActivate: React.FC<HoldToActivateProps> = ({ 
    onActivate, 
    children, 
    className = "", 
    duration = 1500 
}) => {
    const [isHolding, setIsHolding] = useState(false);
    const [progress, setProgress] = useState(0);
    const progressRef = useRef(0);
    const timerRef = useRef<any>(null);
    const startTimeRef = useRef<number>(0);

    const startHold = () => {
        setIsHolding(true);
        startTimeRef.current = Date.now();
        
        const tick = () => {
            const elapsed = Date.now() - startTimeRef.current;
            const newProgress = Math.min((elapsed / duration) * 100, 100);
            progressRef.current = newProgress;
            setProgress(newProgress);
            
            if (newProgress < 100) {
                timerRef.current = requestAnimationFrame(tick);
            } else {
                onActivate();
                cancelHold(true);
            }
        };
        
        timerRef.current = requestAnimationFrame(tick);
    };

    const cancelHold = (activated: boolean = false) => {
        if (!activated && progressRef.current > 5) {
            audioService.playChirp(480, 100);
            if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
                try { navigator.vibrate(30); } catch (e) {}
            }
        }
        setIsHolding(false);
        progressRef.current = 0;
        setProgress(0);
        if (timerRef.current) {
            cancelAnimationFrame(timerRef.current);
            timerRef.current = null;
        }
    };

    useEffect(() => {
        return () => {
            if (timerRef.current) cancelAnimationFrame(timerRef.current);
        };
    }, []);

    return (
        <button
            onMouseDown={startHold}
            onMouseUp={cancelHold}
            onMouseLeave={cancelHold}
            onTouchStart={startHold}
            onTouchEnd={cancelHold}
            className={`relative overflow-hidden transition-all active:scale-95 ${className}`}
        >
            {/* Progress Background */}
            <div 
                className="absolute inset-x-0 bottom-0 bg-red-500/30 transition-all duration-75 pointer-events-none"
                style={{ height: `${progress}%` }}
            />
            
            {/* Progress Border Glow */}
            {isHolding && (
                <div 
                    className="absolute inset-0 border-2 border-red-500/50 animate-pulse pointer-events-none"
                    style={{ opacity: progress / 100 }}
                />
            )}
            
            <div className="relative z-10">{children}</div>
        </button>
    );
};

export default HoldToActivate;
