
import React from 'react';

interface PremiumUpsellModalProps {
  onClose: () => void;
  onUpgrade: (tier: 'gold' | 'platinum') => void;
  theme: 'light' | 'dark';
}

const PremiumUpsellModal: React.FC<PremiumUpsellModalProps> = ({ onClose, onUpgrade, theme }) => {
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-xl" onClick={onClose} />
      
      <div className={`relative w-full max-w-lg rounded-[3rem] overflow-hidden border shadow-[0_50px_100px_rgba(0,0,0,0.8)] animate-in zoom-in duration-500 ${theme === 'dark' ? 'bg-[#050914] border-white/10' : 'bg-white border-slate-200'}`}>
        <div className="h-48 bg-gradient-to-br from-amber-400 to-orange-600 p-10 relative overflow-hidden">
           <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 blur-[80px] rounded-full translate-x-20 -translate-y-20" />
           <h2 className="text-4xl font-black text-black tracking-tighter leading-none">OMNI<br/>GOLD</h2>
           <p className="text-black/60 text-xs font-black uppercase tracking-widest mt-2">Next Gen Family Safety</p>
           <button onClick={onClose} className="absolute top-6 right-6 w-10 h-10 rounded-full bg-black/20 flex items-center justify-center text-black hover:bg-black/30 transition-all">✕</button>
        </div>

        <div className="p-8 space-y-6">
           <div className="space-y-4">
              {[
                { icon: '🚓', title: 'Emergency Dispatch', desc: 'Real-time monitoring and 911 coordination.' },
                { icon: '🏎️', title: 'Advanced Drive Stats', desc: 'Identify hard braking and rapid acceleration.' },
                { icon: '🤖', title: 'Unlimited AI Co-Pilot', desc: 'Hands-free voice intelligence anywhere.' }
              ].map((f, i) => (
                <div key={i} className="flex gap-4 items-start">
                  <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center text-xl shrink-0">{f.icon}</div>
                  <div>
                    <h4 className={`text-sm font-black ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>{f.title}</h4>
                    <p className="text-xs text-slate-500 font-medium">{f.desc}</p>
                  </div>
                </div>
              ))}
           </div>

           <div className="grid grid-cols-2 gap-4 pt-4">
              <button 
                onClick={() => onUpgrade('gold')}
                className="bg-amber-500 hover:bg-amber-400 text-black p-5 rounded-3xl transition-all shadow-xl shadow-amber-500/20"
              >
                <p className="text-[10px] font-black uppercase tracking-widest opacity-60">Omni Gold</p>
                <p className="text-lg font-black">$9.99<span className="text-xs opacity-60">/mo</span></p>
              </button>
              
              <button 
                onClick={() => onUpgrade('platinum')}
                className="bg-slate-800 hover:bg-slate-700 text-white p-5 rounded-3xl transition-all border border-white/10 shadow-xl"
              >
                <p className="text-[10px] font-black uppercase tracking-widest opacity-60">Platinum Circle</p>
                <p className="text-lg font-black">$19.99<span className="text-xs opacity-60">/mo</span></p>
              </button>
           </div>
           
           <p className="text-center text-[10px] text-slate-600 font-bold uppercase tracking-widest">Cancel anytime • 7-day free trial</p>
        </div>
      </div>
    </div>
  );
};

export default PremiumUpsellModal;
