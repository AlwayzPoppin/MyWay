import React, { useState, useEffect } from 'react';
import { DailyInsight } from '../types';

interface InsightsBarProps {
  insights: DailyInsight[];
  theme: 'light' | 'dark';
  onReconnect?: () => void;
}

const InsightsBar: React.FC<InsightsBarProps> = ({ insights, theme, onReconnect }) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isBriefing, setIsBriefing] = useState(false);
  const [dismissedTitles, setDismissedTitles] = useState<Set<string>>(new Set());
  const [isVisible, setIsVisible] = useState(true);

  // Audit #4: Track online/offline status
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [showReconnected, setShowReconnected] = useState(false);

  useEffect(() => {
    const goOnline = () => {
      setIsOnline(true);
      setShowReconnected(true);
      setTimeout(() => setShowReconnected(false), 3000);
    };
    const goOffline = () => {
      setIsOnline(false);
      setShowReconnected(false);
    };

    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  const activeInsights = insights.filter(i => !dismissedTitles.has(i.title));

  const safeIndex = activeInsights.length > 0 ? currentIndex % activeInsights.length : 0;
  const insight = activeInsights[safeIndex];

  // Rotate between active insights every 8 seconds if visible and not single
  useEffect(() => {
    if (activeInsights.length > 1) {
      const interval = setInterval(() => {
        setIsVisible(false);
        setTimeout(() => {
          setCurrentIndex(prev => (prev + 1) % activeInsights.length);
          setIsVisible(true);
        }, 300);
      }, 8000);
      return () => clearInterval(interval);
    }
  }, [activeInsights.length]);

  // Auto-dismiss timeout: 5 seconds for non-critical informational statuses
  useEffect(() => {
    if (!insight) return;
    setIsVisible(true);

    const isSystemOffline = insight.category === 'System' && insight.title === 'System Offline';
    const isCritical = isSystemOffline || insight.category === 'sos' || insight.category === 'SOS';

    if (!isCritical) {
      const timer = setTimeout(() => {
        setIsVisible(false);
        setTimeout(() => {
          setDismissedTitles(prev => {
            const next = new Set(prev);
            next.add(insight.title);
            return next;
          });
          setCurrentIndex(prev => {
            const nextLen = activeInsights.length - 1;
            if (nextLen <= 0) return 0;
            return prev % nextLen;
          });
        }, 300);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [insight?.title, activeInsights.length]);

  const handleDismiss = () => {
    if (!insight) return;
    setIsVisible(false);
    setTimeout(() => {
      setDismissedTitles(prev => {
        const next = new Set(prev);
        next.add(insight.title);
        return next;
      });
      setCurrentIndex(prev => {
        const nextLen = activeInsights.length - 1;
        if (nextLen <= 0) return 0;
        return prev % nextLen;
      });
    }, 300);
  };

  if (activeInsights.length === 0) return null;
  const isSystemOffline = insight.category === 'System' && insight.title === 'System Offline';

  return (
    <div className="flex flex-col items-center gap-2 w-full select-none pointer-events-none">
      {/* Audit #4: Offline connectivity indicator */}
      {(!isOnline || showReconnected) && (
        <div className={`backdrop-blur-xl rounded-full px-4 py-1.5 shadow-lg flex items-center gap-2 border transition-all duration-300 pointer-events-auto ${
          !isOnline 
            ? 'bg-amber-500/20 border-amber-500/40 text-amber-400 animate-pulse' 
            : 'bg-emerald-500/20 border-emerald-500/40 text-emerald-400'
        }`}>
          <div className={`w-2 h-2 rounded-full ${!isOnline ? 'bg-amber-400' : 'bg-emerald-400'}`} />
          <span className="text-[9px] font-black uppercase tracking-wider">
            {!isOnline ? '📡 OFFLINE — Using cached tiles' : '✅ BACK ONLINE'}
          </span>
        </div>
      )}

      {/* Floating Compact Alert Pill */}
      <div className={`backdrop-blur-md rounded-full py-1.5 px-4 shadow-2xl flex items-center gap-2.5 border transition-all duration-300 transform pointer-events-auto
        ${isVisible ? 'translate-y-0 opacity-100 scale-100' : '-translate-y-4 opacity-0 scale-95'}
        ${isBriefing ? 'ring-4 ring-indigo-500/30' : ''} 
        ${isSystemOffline 
          ? 'border-[#fbbf24]/50 bg-[#fbbf24]/20 text-[#fbbf24]' 
          : theme === 'dark' 
            ? 'bg-slate-900/80 border-white/10 text-slate-200' 
            : 'bg-white/90 border-slate-200 text-slate-800'
        }
        w-max max-w-[85vw] mx-auto md:max-w-xl
      `}>
        {/* Yellow Warning Lightbulb Icon */}
        <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs shrink-0 border
          ${isBriefing ? 'bg-indigo-600 animate-pulse text-white' : isSystemOffline ? 'bg-[#fbbf24] text-black border-transparent' : theme === 'dark' ? 'bg-white/10 border-white/5' : 'bg-slate-100 border-slate-200'}
        `}>
          {isBriefing ? (
            <div className="flex gap-0.5 h-2.5 items-end">
              {[1, 2, 3].map(i => <div key={i} className="w-0.5 bg-white rounded-full animate-bounce" style={{ animationDelay: `${i * 0.1}s` }} />)}
            </div>
          ) : isSystemOffline ? '⚠️' : '💡'}
        </div>

        {/* Labels grouped as a single row */}
        <div className="flex items-center gap-2 min-w-0 text-sm">
          <span className={`text-[10px] font-black uppercase tracking-wider shrink-0 leading-none
            ${isBriefing ? 'text-indigo-400' : isSystemOffline ? 'text-[#fbbf24]' : 'text-amber-400 dark:text-amber-300'}
          `}>
            {isBriefing ? 'AI BRIEFING' : insight.category}
          </span>
          <span className="text-slate-500 text-[10px] shrink-0">•</span>
          <h4 className="text-xs font-bold truncate leading-none">
            {insight.title}
          </h4>
        </div>

        {/* Reconnect button for system offline */}
        {isSystemOffline && onReconnect && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onReconnect();
            }}
            className="px-2 py-1 bg-[#fbbf24] text-black text-[9px] font-black rounded-full hover:scale-105 active:scale-95 transition-all shrink-0"
          >
            RECONNECT
          </button>
        )}

        {/* Manual Dismiss (✕ button) */}
        {!isSystemOffline && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleDismiss();
            }}
            className={`p-1 rounded-full shrink-0 transition-all hover:scale-110 active:scale-90
              ${theme === 'dark' ? 'hover:bg-white/10 text-slate-400 hover:text-white' : 'hover:bg-slate-200 text-slate-500 hover:text-slate-800'}
            `}
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
};

export default React.memo(InsightsBar);
