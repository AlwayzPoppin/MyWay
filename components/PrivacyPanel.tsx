
import React from 'react';
import { PrivacyZone } from '../types';

interface PrivacyPanelProps {
  zones: PrivacyZone[];
  isGhostMode: boolean;
  onToggleGhost: () => void;
  onClose: () => void;
  theme: 'light' | 'dark';
}

const PrivacyPanel: React.FC<PrivacyPanelProps> = ({ zones, isGhostMode, onToggleGhost, onClose, theme }) => {
  const panelBg = theme === 'dark' ? 'bg-slate-900/95 border-white/10' : 'bg-white/95 border-slate-200';
  const subBg = theme === 'dark' ? 'bg-white/5 border-white/5' : 'bg-slate-50 border-slate-100';
  const textColor = theme === 'dark' ? 'text-white' : 'text-slate-900';

  return (
    <div className={`backdrop-blur-xl rounded-[2.5rem] shadow-2xl border overflow-hidden animate-in slide-in-from-left duration-500 ${panelBg}`}>
      <div className="bg-indigo-600 p-6 text-white flex justify-between items-center">
        <div>
          <h3 className="font-bold text-base leading-none">Security & Privacy</h3>
          <p className="text-[10px] opacity-70 mt-1 uppercase tracking-widest font-black">Control your visibility</p>
        </div>
        <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full transition-colors">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" /></svg>
        </button>
      </div>

      <div className="p-6 space-y-6">
        {/* Ghost Mode Toggle */}
        <div className={`p-5 rounded-[2rem] border transition-all ${isGhostMode ? 'bg-indigo-500/20 border-indigo-400' : subBg}`}>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-3">
              <span className="text-2xl">{isGhostMode ? '👻' : '👁️'}</span>
              <h4 className={`font-black text-sm ${textColor}`}>Ghost Mode</h4>
            </div>
            <button 
              onClick={onToggleGhost}
              className={`w-12 h-6 rounded-full relative transition-all ${isGhostMode ? 'bg-indigo-500' : 'bg-slate-700'}`}
            >
              <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${isGhostMode ? 'right-1' : 'left-1'}`} />
            </button>
          </div>
          <p className="text-[10px] text-slate-500 leading-relaxed font-medium">
            When active, your exact location is hidden. Family will only see your general area.
          </p>
        </div>

        {/* Privacy Zones */}
        <div className="space-y-4">
          <div className="flex justify-between items-center">
             <p className="text-[10px] font-black uppercase tracking-widest text-indigo-400">Privacy Zones</p>
             <button className="text-[10px] font-black text-indigo-400">+ Add New</button>
          </div>
          
          <div className="space-y-2">
            {zones.map(zone => (
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
            ))}
          </div>
        </div>

        <div className="pt-4 border-t border-white/5">
           <button className="w-full py-4 rounded-2xl bg-slate-800 text-white text-[10px] font-black uppercase tracking-widest hover:bg-slate-700 transition-all border border-white/5">
             Privacy Audit Log
           </button>
        </div>
      </div>
    </div>
  );
};

export default PrivacyPanel;
