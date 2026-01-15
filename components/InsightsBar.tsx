
import React, { useState } from 'react';
import { DailyInsight } from '../types';

interface InsightsBarProps {
  insights: DailyInsight[];
  theme: 'light' | 'dark';
  isBriefing?: boolean;
}

const InsightsBar: React.FC<InsightsBarProps> = ({ insights, theme, isBriefing = false }) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  if (insights.length === 0) return null;
  const insight = insights[currentIndex];

  return (
    <div className={`backdrop-blur-xl rounded-[2rem] p-5 shadow-2xl flex items-center gap-5 border cursor-pointer group transition-all ${isBriefing ? 'ring-4 ring-indigo-500/30 scale-105' : ''} ${theme === 'dark' ? 'bg-[#0f172a]/90 border-white/10' : 'bg-white/90 border-slate-200'}`}>
      <div className={`w-12 h-12 rounded-2xl flex items-center justify-center text-xl shrink-0 border ${isBriefing ? 'bg-indigo-600 animate-pulse' : theme === 'dark' ? 'bg-white/5 border-white/5' : 'bg-slate-100 border-slate-200'}`}>
        {isBriefing ? (
          <div className="flex gap-0.5 h-4 items-end">
            {[1, 2, 3].map(i => <div key={i} className="w-1 bg-white rounded-full animate-bounce" style={{ animationDelay: `${i*0.1}s` }} />)}
          </div>
        ) : '💡'}
      </div>
      
      <div className="flex-1 min-w-0">
        <p className={`text-[10px] font-black uppercase tracking-[0.2em] mb-1 ${isBriefing ? 'text-indigo-400' : 'text-slate-500'}`}>
          {isBriefing ? 'AI Briefing Playing...' : `${insight.category} Insight`}
        </p>
        <h4 className={`text-sm font-bold leading-tight ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>{insight.title}</h4>
      </div>
    </div>
  );
};

export default InsightsBar;
