
import React from 'react';
import { NavigationRoute } from '../types';

interface NavigationOverlayProps {
  route: NavigationRoute;
  onCancel: () => void;
  isGigMode?: boolean;
  theme: 'light' | 'dark';
}

const NavigationOverlay: React.FC<NavigationOverlayProps> = ({ route, onCancel, theme }) => {
  const currentStep = route.steps[0];

  const bgColor = theme === 'dark' ? 'bg-[#0f172a]/95 border-white/10' : 'bg-white/95 border-slate-200';
  const textColor = theme === 'dark' ? 'text-white' : 'text-slate-900';
  const subTextColor = theme === 'dark' ? 'text-slate-400' : 'text-slate-500';

  return (
    <div className={`backdrop-blur-3xl rounded-t-[2.5rem] md:rounded-[3rem] p-6 md:p-8 shadow-[0_-20px_80px_rgba(0,0,0,0.5)] border animate-in slide-in-from-bottom duration-700 ease-out safe-bottom ${bgColor}`}>
      {/* Visual drag handle for mobile */}
      <div className="md:hidden w-12 h-1.5 bg-white/10 rounded-full mx-auto mb-6" />

      {/* HUD Header */}
      <div className="flex justify-between items-start mb-6 md:mb-8">
        <div className="flex items-center gap-4 md:gap-8">
          <div className={`w-16 h-16 md:w-24 md:h-24 rounded-2xl md:rounded-[2.5rem] flex items-center justify-center shadow-2xl bg-indigo-600 ring-4 md:ring-8 ring-indigo-500/10 shrink-0`}>
            <svg className="w-8 h-8 md:w-14 md:h-14 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={4} d="M5 10l7-7m0 0l7 7m-7-7v18" />
            </svg>
          </div>
          <div>
            <div className="flex items-baseline gap-1 md:gap-2">
              <p className={`text-4xl md:text-6xl font-black tracking-tighter ${textColor}`}>{currentStep.distance.split(' ')[0]}</p>
              <p className={`text-sm md:text-xl font-black uppercase tracking-widest ${subTextColor}`}>{currentStep.distance.split(' ')[1]}</p>
            </div>
            <p className={`font-bold text-lg md:text-2xl leading-tight mt-1 ${theme === 'dark' ? 'text-indigo-400' : 'text-indigo-600'}`}>{currentStep.instruction}</p>
          </div>
        </div>
        
        <button 
          onClick={onCancel} 
          className={`p-4 md:p-5 rounded-full transition-all border shadow-lg ${theme === 'dark' ? 'bg-white/5 border-white/10 text-red-400' : 'bg-slate-100 border-slate-200 text-red-600'}`}
        >
          <svg className="w-6 h-6 md:w-8 md:h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" /></svg>
        </button>
      </div>

      {/* Stats Cockpit */}
      <div className="grid grid-cols-3 gap-2 md:gap-8 py-4 md:py-8 border-y border-white/5 bg-white/5 rounded-2xl md:rounded-3xl mb-4 md:mb-6">
        <div className="text-center">
          <p className="text-[9px] md:text-[12px] uppercase font-black tracking-[0.1em] mb-1 md:mb-3 text-slate-500">Remaining</p>
          <p className="text-lg md:text-3xl font-black text-green-400">{route.totalTime}</p>
        </div>
        <div className="text-center border-x border-white/10 px-1">
          <p className="text-[9px] md:text-[12px] uppercase font-black tracking-[0.1em] mb-1 md:mb-3 text-slate-500">Arrival</p>
          <p className={`text-lg md:text-3xl font-black ${textColor}`}>4:52 PM</p>
        </div>
        <div className="text-center">
          <p className="text-[9px] md:text-[12px] uppercase font-black tracking-[0.1em] mb-1 md:mb-3 text-slate-500">Distance</p>
          <p className={`text-lg md:text-3xl font-black ${textColor}`}>{route.totalDistance}</p>
        </div>
      </div>
      
      {route.safetyAdvisory && (
        <div className={`p-4 md:p-6 rounded-2xl md:rounded-3xl flex items-center gap-4 md:gap-6 border ${theme === 'dark' ? 'bg-indigo-500/5 border-indigo-500/20' : 'bg-indigo-50 border-indigo-100'}`}>
          <div className="w-10 h-10 md:w-12 md:h-12 rounded-xl md:rounded-2xl bg-indigo-600 flex items-center justify-center text-xl md:text-2xl shadow-lg shrink-0">🤖</div>
          <div className="flex-1 overflow-hidden">
            <p className="text-[9px] md:text-[11px] font-black uppercase tracking-[0.2em] mb-0.5 text-indigo-400">Omni AI Advisory</p>
            <p className={`text-xs md:text-base font-medium leading-tight truncate md:whitespace-normal italic ${theme === 'dark' ? 'text-slate-200' : 'text-slate-800'}`}>
              "{route.safetyAdvisory}"
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default NavigationOverlay;
