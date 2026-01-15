
import React from 'react';
import { Reward } from '../types';

interface RewardsPanelProps {
  rewards: Reward[];
  onClose: () => void;
  theme: 'light' | 'dark';
}

const RewardsPanel: React.FC<RewardsPanelProps> = ({ rewards, onClose, theme }) => {
  const panelBg = theme === 'dark' ? 'bg-[#0f172a]/95 border-white/10' : 'bg-white/95 border-slate-200';
  const subBg = theme === 'dark' ? 'bg-white/5 border-white/5' : 'bg-slate-50 border-slate-100';
  const textColor = theme === 'dark' ? 'text-white' : 'text-slate-900';

  return (
    <div className={`w-80 backdrop-blur-2xl rounded-[2.5rem] shadow-2xl border overflow-hidden animate-in slide-in-from-left duration-300 ${panelBg}`}>
      <div className="bg-amber-500 p-6 text-black flex justify-between items-center">
        <div>
          <h3 className="font-black text-base leading-none">Circle Rewards</h3>
          <p className="text-[10px] opacity-70 mt-1 uppercase tracking-widest font-black">Sponsored Partner Deals</p>
        </div>
        <button onClick={onClose} className="p-2 hover:bg-black/10 rounded-full transition-colors">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" /></svg>
        </button>
      </div>

      <div className="p-4 space-y-3">
        {rewards.map(reward => (
          <div key={reward.id} className={`p-4 rounded-3xl border transition-all hover:scale-[1.02] ${subBg}`}>
            <div className="flex items-center gap-4 mb-4">
               <div className="w-12 h-12 rounded-2xl bg-black flex items-center justify-center text-2xl shadow-xl">{reward.icon}</div>
               <div>
                 <h4 className={`text-sm font-black ${textColor}`}>{reward.brand}</h4>
                 <p className="text-xs text-amber-500 font-bold">{reward.title}</p>
               </div>
            </div>
            
            <div className="flex items-center gap-2">
               <div className={`flex-1 px-4 py-2 rounded-xl text-center text-xs font-black tracking-widest ${theme === 'dark' ? 'bg-slate-800' : 'bg-slate-200'} text-slate-400`}>
                 {reward.code}
               </div>
               <button className="px-6 py-2 bg-amber-500 text-black rounded-xl text-[10px] font-black uppercase hover:bg-amber-400 transition-all">Copy</button>
            </div>
            <p className="text-[9px] text-slate-600 mt-2 font-bold uppercase tracking-widest text-center">Expires: {reward.expiry}</p>
          </div>
        ))}
        
        <div className={`p-4 rounded-3xl border border-dashed text-center ${theme === 'dark' ? 'border-white/10' : 'border-slate-200'}`}>
          <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">More perks unlocking soon</p>
        </div>
      </div>
    </div>
  );
};

export default RewardsPanel;
