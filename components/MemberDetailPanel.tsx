
import React, { useState } from 'react';
import { FamilyMember } from '../types';
import { predictETA } from '../services/geminiService';

interface MemberDetailPanelProps {
  member: FamilyMember;
  onClose: () => void;
  onQuickSearch?: (query: string) => void;
  onToggleGhost?: () => void;
  theme: 'light' | 'dark';
}

const MemberDetailPanel: React.FC<MemberDetailPanelProps> = ({ member, onClose, onQuickSearch, onToggleGhost, theme }) => {
  const [eta, setEta] = useState<string | null>(null);
  const [loadingEta, setLoadingEta] = useState(false);

  const handlePredictEta = async () => {
    setLoadingEta(true);
    const result = await predictETA(member, "Home");
    setEta(result);
    setLoadingEta(false);
  };

  const handleShortcut = (type: string) => {
    if (!onQuickSearch) return;
    const queries: Record<string, string> = {
      gas: `Where is the nearest gas station for ${member.name}?`,
      safe: `Find safe meeting points or police stations near ${member.name}'s current location.`,
      coffee: `Find a coffee shop near ${member.name}.`
    };
    onQuickSearch(queries[type]);
  };

  const panelBg = theme === 'dark' ? 'bg-slate-900/95 border-white/10' : 'bg-white/95 border-slate-200';
  const subBg = theme === 'dark' ? 'bg-white/5 border-white/5' : 'bg-slate-50 border-slate-100';
  const textColor = theme === 'dark' ? 'text-white' : 'text-slate-900';
  const labelColor = theme === 'dark' ? 'text-slate-400' : 'text-slate-500';

  return (
    <div className={`w-72 backdrop-blur-xl rounded-[2.5rem] shadow-2xl border overflow-hidden animate-in slide-in-from-left duration-300 ${panelBg}`}>
      <div className={`${member.isGhostMode ? 'bg-slate-800' : 'bg-indigo-600'} p-5 text-white flex justify-between items-start transition-colors duration-500`}>
        <div className="flex items-center gap-3">
          <div className="relative">
            <img src={member.avatar} alt={member.name} className={`w-12 h-12 rounded-2xl border-2 border-white/30 object-cover ${member.isGhostMode ? 'grayscale opacity-50' : ''}`} />
            {member.isGhostMode && <div className="absolute inset-0 flex items-center justify-center text-xl">👻</div>}
          </div>
          <div>
            <h3 className="font-bold text-base leading-none">{member.name}</h3>
            <p className="text-[10px] opacity-80 uppercase tracking-widest mt-1">{member.isGhostMode ? 'INCognito' : member.role}</p>
          </div>
        </div>
        <button onClick={onClose} className="hover:bg-white/10 p-2 rounded-full transition-colors">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="p-5 space-y-5">
        <div className="grid grid-cols-2 gap-3">
          <div className={`p-3 rounded-2xl border ${subBg}`}>
            <p className={`text-[10px] font-black uppercase tracking-widest mb-1 ${labelColor}`}>Safety</p>
            <p className={`text-xl font-black ${member.safetyScore > 90 ? 'text-green-500' : 'text-amber-500'}`}>
              {member.isGhostMode ? '??' : member.safetyScore}
            </p>
          </div>
          <div className={`p-3 rounded-2xl border ${subBg}`}>
            <p className={`text-[10px] font-black uppercase tracking-widest mb-1 ${labelColor}`}>Battery</p>
            <p className={`text-xl font-black ${member.battery < 20 ? 'text-red-500' : theme === 'dark' ? 'text-white' : 'text-slate-800'}`}>
              {member.battery}%
            </p>
          </div>
        </div>

        {onToggleGhost && (
          <button 
            onClick={onToggleGhost}
            className={`w-full py-3 rounded-2xl flex items-center justify-center gap-3 border transition-all font-black text-xs uppercase tracking-widest ${member.isGhostMode ? 'bg-indigo-600 text-white border-transparent' : 'bg-slate-800 text-slate-300 border-white/5'}`}
          >
            <span>{member.isGhostMode ? '👁️ Become Visible' : '👻 Go Private'}</span>
          </button>
        )}

        {!member.isGhostMode && (
          <div className="space-y-3">
            <p className={`text-[10px] font-black uppercase tracking-[0.2em] ${labelColor}`}>Omni Shortcuts</p>
            <div className="flex flex-wrap gap-2">
              {['gas', 'safe', 'coffee'].map(type => (
                <button 
                  key={type}
                  onClick={() => handleShortcut(type)}
                  className={`px-3 py-1.5 border rounded-xl text-[11px] font-bold transition-all flex items-center gap-2 ${theme === 'dark' ? 'bg-white/5 border-white/5 text-slate-300 hover:bg-white/10' : 'bg-slate-100 border-slate-200 text-slate-700 hover:bg-slate-200'}`}
                >
                  {type === 'gas' ? '⛽' : type === 'safe' ? '🛡️' : '☕'} 
                  {type.charAt(0).toUpperCase() + type.slice(1)}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="pt-4 border-t border-white/5">
          {eta ? (
            <div className={`p-3 rounded-2xl border animate-in fade-in zoom-in duration-300 ${theme === 'dark' ? 'bg-indigo-500/10 border-indigo-500/20 text-indigo-200' : 'bg-indigo-50 border-indigo-100 text-indigo-700'}`}>
              <p className="text-[9px] font-black uppercase tracking-widest mb-1">AI Arrival Intel</p>
              <p className="text-[12px] leading-tight italic font-medium">"{eta}"</p>
            </div>
          ) : !member.isGhostMode && (
            <button 
              onClick={handlePredictEta}
              disabled={loadingEta}
              className="w-full py-3 bg-indigo-600 text-white rounded-2xl text-xs font-black hover:bg-indigo-700 transition-all shadow-xl shadow-indigo-500/20 disabled:opacity-50"
            >
              {loadingEta ? 'Calculating...' : 'Predict Arrival with AI'}
            </button>
          )}
          {member.isGhostMode && (
            <div className="text-center p-4">
              <p className="text-[10px] text-slate-500 italic font-medium">Tracking paused in Ghost Mode</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default MemberDetailPanel;
