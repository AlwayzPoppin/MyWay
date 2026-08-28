
import React from 'react';
import { PrivacyZone } from '../types';

interface PrivacyPanelProps {
  zones: PrivacyZone[];
  isGhostMode: boolean;
  onToggleGhost: () => void;
  onClose: () => void;
  theme: 'light' | 'dark';
}

// Audit #3: Unified "Visibility" panel — replaces confusing separate Ghost Mode / Privacy Zones
const PrivacyPanel: React.FC<PrivacyPanelProps> = ({ zones, isGhostMode, onToggleGhost, onClose, theme }) => {
  const panelBg = theme === 'dark' ? 'bg-slate-900/95 border-white/10' : 'bg-white/95 border-slate-200';
  const subBg = theme === 'dark' ? 'bg-white/5 border-white/5' : 'bg-slate-50 border-slate-100';
  const textColor = theme === 'dark' ? 'text-white' : 'text-slate-900';

  return (
    <div className={`backdrop-blur-xl rounded-[2.5rem] shadow-2xl border overflow-hidden animate-in slide-in-from-left duration-500 ${panelBg}`}>
      {/* Header — unified "Visibility" branding */}
      <div className="bg-indigo-600 p-6 text-white flex justify-between items-center">
        <div>
          <h3 className="font-bold text-base leading-none">👁️ Visibility</h3>
          <p className="text-[10px] opacity-70 mt-1 uppercase tracking-widest font-black">Who can see you</p>
        </div>
        <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full transition-colors">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" /></svg>
        </button>
      </div>

      <div className="p-6 space-y-5">
        {/* Section 1: Global Visibility (Ghost Mode) */}
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest text-indigo-400 mb-3">🌐 Global Visibility</p>
          <div className={`p-5 rounded-[2rem] border transition-all ${isGhostMode ? 'bg-indigo-500/20 border-indigo-400' : subBg}`}>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-3">
                <span className="text-2xl">{isGhostMode ? '👻' : '📍'}</span>
                <div>
                  <h4 className={`font-black text-sm ${textColor}`}>
                    {isGhostMode ? 'Ghost Mode Active' : 'Visible to Circle'}
                  </h4>
                  <p className="text-[9px] text-slate-500 font-medium">
                    {isGhostMode ? 'Showing fuzzy location only' : 'Precise location shared'}
                  </p>
                </div>
              </div>
              <button 
                onClick={onToggleGhost}
                className={`w-12 h-6 rounded-full relative transition-all ${isGhostMode ? 'bg-indigo-500' : 'bg-slate-700'}`}
              >
                <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${isGhostMode ? 'right-1' : 'left-1'}`} />
              </button>
            </div>
            <p className="text-[10px] text-slate-500 leading-relaxed font-medium">
              {isGhostMode 
                ? '🔒 Your exact location is hidden from everyone. Family sees only your general area.'
                : '✅ Your precise location is visible to all circle members in real-time.'
              }
            </p>
          </div>
        </div>

        {/* Section 2: Zone-Based Visibility (Privacy Zones) */}
        <div>
          <div className="flex justify-between items-center mb-3">
            <p className="text-[10px] font-black uppercase tracking-widest text-indigo-400">📍 Zone-Based Privacy</p>
            <button className="text-[10px] font-black text-indigo-400 hover:text-indigo-300 transition-colors">+ Add Zone</button>
          </div>

          <p className="text-[9px] text-slate-500 mb-3 font-medium">
            Automatically blur your location near specific places. Works independently of Ghost Mode.
          </p>

          <div className="space-y-2">
            {zones.length === 0 ? (
              <div className={`p-4 rounded-2xl border text-center ${subBg}`}>
                <p className="text-[10px] text-slate-500">No privacy zones configured</p>
                <p className="text-[9px] text-slate-600 mt-1">Add zones like Home or Work to auto-blur your location</p>
              </div>
            ) : (
              zones.map(zone => (
                <div key={zone.id} className={`p-4 rounded-2xl border flex items-center justify-between ${subBg}`}>
                  <div className="flex items-center gap-3">
                    <span className="text-lg">📍</span>
                    <div>
                      <p className={`text-xs font-bold ${textColor}`}>{zone.name}</p>
                      <p className="text-[9px] text-slate-500 uppercase font-black">Blurred Radius: 200m</p>
                    </div>
                  </div>
                  <div className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />
                </div>
              ))
            )}
          </div>
        </div>

        {/* Explainer: How they work together */}
        <div className={`p-4 rounded-2xl border ${theme === 'dark' ? 'bg-indigo-500/10 border-indigo-500/20' : 'bg-indigo-50 border-indigo-100'}`}>
          <p className="text-[9px] font-bold text-indigo-400 mb-1">How it works</p>
          <p className="text-[9px] text-slate-500 leading-relaxed">
            <strong>Ghost Mode</strong> hides you everywhere. <strong>Privacy Zones</strong> only blur you near specific spots. 
            You can use both — Ghost Mode takes priority when active.
          </p>
        </div>

        <div className="pt-2 border-t border-white/5">
           <button className="w-full py-4 rounded-2xl bg-slate-800 text-white text-[10px] font-black uppercase tracking-widest hover:bg-slate-700 transition-all border border-white/5">
             Privacy Audit Log
           </button>
        </div>
      </div>
    </div>
  );
};

export default PrivacyPanel;
