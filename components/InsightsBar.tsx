
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

  useEffect(() => {
    if (insights.length > 1) {
      const interval = setInterval(() => {
        setCurrentIndex(prev => (prev + 1) % insights.length);
      }, 8000);
      return () => clearInterval(interval);
    }
  }, [insights.length]);

  if (insights.length === 0) return null;
  const insight = insights[currentIndex];
  const isSystemOffline = insight.category === 'System' && insight.title === 'System Offline';

  return (
    <div className={`backdrop-blur-xl rounded-full px-6 py-2 shadow-2xl flex items-center gap-3 border cursor-pointer group transition-all 
      ${isBriefing ? 'ring-4 ring-indigo-500/30 scale-105' : ''} 
      ${isSystemOffline ? 'border-[#fbbf24]/50 bg-[#fbbf24]/10' : theme === 'dark' ? 'bg-[#0f172a]/80 border-white/20' : 'bg-white/90 border-slate-200'}
    `}>
      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm shrink-0 border 
        ${isBriefing ? 'bg-indigo-600 animate-pulse' : isSystemOffline ? 'bg-[#fbbf24] text-black animate-pulse' : theme === 'dark' ? 'bg-white/10 border-white/5' : 'bg-slate-100 border-slate-200'}
      `}>
        {isBriefing ? (
          <div className="flex gap-0.5 h-3 items-end">
            {[1, 2, 3].map(i => <div key={i} className="w-0.5 bg-white rounded-full animate-bounce" style={{ animationDelay: `${i * 0.1}s` }} />)}
          </div>
        ) : isSystemOffline ? '⚠️' : '💡'}
      </div>

      <div className="flex flex-col min-w-0">
        <p className={`text-[9px] font-black uppercase tracking-[0.1em] leading-none mb-0.5 
          ${isBriefing ? 'text-indigo-400' : isSystemOffline ? 'text-[#fbbf24]' : 'text-slate-400'}
        `}>
          {isBriefing ? 'AI BRIEFING' : insight.category.toUpperCase()}
        </p>
        <div className="flex items-center gap-2">
          <h4 className={`text-xs font-bold whitespace-nowrap ${theme === 'dark' ? 'text-slate-200' : 'text-slate-800'}`}>
            {insight.title}
          </h4>
          {isSystemOffline && onReconnect && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onReconnect();
              }}
              className="ml-2 px-2 py-0.5 bg-[#fbbf24] text-black text-[9px] font-black rounded hover:scale-105 active:scale-95 transition-all"
            >
              RECONNECT
            </button>
          )}
        </div>
      </div>

      {/* Dismiss Hint (only visible on hover for non-critical) */}
      {!isSystemOffline && !isBriefing && (
        <div className="w-4 h-4 rounded-full bg-white/5 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity ml-1">
          <span className="text-[10px] text-slate-500">×</span>
        </div>
      )}
    </div>
  );
};

export default React.memo(InsightsBar);
