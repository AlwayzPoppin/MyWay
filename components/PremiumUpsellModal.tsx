import { SUBSCRIPTION_TIERS, SubscriptionTier } from '../config/subscriptions';

interface PremiumUpsellModalProps {
  onClose: () => void;
  onUpgrade: (tierId: string) => void;
  theme: 'light' | 'dark';
}

const PremiumUpsellModal: React.FC<PremiumUpsellModalProps> = ({ onClose, onUpgrade, theme }) => {
  const isDark = theme === 'dark';
  const gold = SUBSCRIPTION_TIERS.gold;
  const platinum = SUBSCRIPTION_TIERS.platinum;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-xl" onClick={onClose} />

      <div className={`relative w-full max-w-lg rounded-[3rem] overflow-hidden border shadow-[0_50px_100px_rgba(0,0,0,0.8)] animate-in zoom-in duration-500 ${isDark ? 'bg-[#050914] border-white/10' : 'bg-white border-slate-200'}`}>
        <div className={`h-48 bg-gradient-to-br ${gold.color} p-10 relative overflow-hidden`}>
          <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 blur-[80px] rounded-full translate-x-20 -translate-y-20" />
          <h2 className="text-4xl font-black text-black tracking-tighter leading-none">MYWAY<br />{gold.id.toUpperCase()}</h2>
          <p className="text-black/60 text-xs font-black uppercase tracking-widest mt-2">{gold.description}</p>
          <button onClick={onClose} className="absolute top-6 right-6 w-10 h-10 rounded-full bg-black/20 flex items-center justify-center text-black hover:bg-black/30 transition-all font-bold">✕</button>
        </div>

        <div className="p-8 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {gold.features.slice(0, 4).map((feature, i) => (
              <div key={i} className="flex gap-3 items-center">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs shrink-0 ${isDark ? 'bg-amber-500/20 text-amber-500' : 'bg-amber-100 text-amber-600'}`}>✓</div>
                <p className={`text-xs font-bold ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>{feature}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4">
            <button
              onClick={() => onUpgrade(gold.id)}
              className={`relative overflow-hidden p-6 rounded-3xl transition-all shadow-xl group ${isDark ? 'bg-amber-500 text-black' : 'bg-slate-900 text-white'}`}
            >
              <div className="absolute top-0 right-0 p-2 opacity-20 group-hover:scale-125 transition-transform">🏆</div>
              <p className="text-[10px] font-black uppercase tracking-widest opacity-70 mb-1">{gold.name}</p>
              <p className="text-2xl font-black">${gold.price}<span className="text-xs opacity-60">/{gold.interval}</span></p>
            </button>

            <button
              onClick={() => onUpgrade(platinum.id)}
              className={`relative overflow-hidden p-6 rounded-3xl transition-all border shadow-xl group ${isDark ? 'bg-white/5 border-white/10 text-white' : 'bg-white border-slate-200 text-slate-900'}`}
            >
              <div className="absolute top-0 right-0 p-2 opacity-20 group-hover:scale-125 transition-transform">💎</div>
              <p className={`text-[10px] font-black uppercase tracking-widest opacity-70 mb-1 ${isDark ? 'text-indigo-400' : 'text-indigo-600'}`}>{platinum.name}</p>
              <p className="text-2xl font-black">${platinum.price}<span className="text-xs opacity-60">/{platinum.interval}</span></p>
            </button>
          </div>

          <div className="space-y-2">
            <p className={`text-center text-[10px] ${isDark ? 'text-slate-500' : 'text-slate-400'} font-black uppercase tracking-widest`}>
              Cancel anytime • Secure payments by Stripe
            </p>
            <div className="flex justify-center gap-2 opacity-30 grayscale invert">
              {/* Stripe/Card icons can go here */}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PremiumUpsellModal;
