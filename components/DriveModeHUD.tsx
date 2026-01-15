
import React from 'react';
import { NavigationRoute } from '../types';

interface DriveModeHUDProps {
  route: NavigationRoute;
  speed: number;
  onCancel: () => void;
}

const DriveModeHUD: React.FC<DriveModeHUDProps> = ({ route, speed, onCancel }) => {
  return (
    <div className="absolute inset-x-0 bottom-0 z-[100] p-6 safe-bottom">
      <div className="max-w-4xl mx-auto flex flex-col gap-4">
        {/* Speedometer Overlay */}
        <div className="flex justify-between items-end">
          <div className="bg-black/80 backdrop-blur-xl rounded-[2.5rem] p-6 border-4 border-indigo-500 shadow-2xl">
            <p className="text-[10px] font-black uppercase text-indigo-400 tracking-[0.2em] mb-1">Current Speed</p>
            <div className="flex items-baseline gap-2">
              <span className="text-6xl font-black text-white tracking-tighter">{speed}</span>
              <span className="text-xl font-bold text-slate-500">MPH</span>
            </div>
          </div>
          
          <button onClick={onCancel} className="h-16 w-16 rounded-full bg-red-600 border-4 border-white text-white flex items-center justify-center shadow-2xl text-2xl font-black">✕</button>
        </div>

        {/* Massive Turn HUD */}
        <div className="bg-indigo-600 rounded-[3rem] p-8 shadow-[0_40px_100px_rgba(79,70,229,0.4)] flex items-center gap-10">
          <div className="w-24 h-24 rounded-[2rem] bg-white flex items-center justify-center text-indigo-600 shadow-inner shrink-0">
             <svg className="w-16 h-16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={4} d="M5 10l7-7m0 0l7 7m-7-7v18" /></svg>
          </div>
          <div className="flex-1">
             <div className="flex items-baseline gap-2 text-white">
                <span className="text-7xl font-black tracking-tighter">{route.steps[0].distance.split(' ')[0]}</span>
                <span className="text-2xl font-black uppercase opacity-60">{route.steps[0].distance.split(' ')[1]}</span>
             </div>
             <p className="text-3xl font-bold text-indigo-100 leading-tight">{route.steps[0].instruction}</p>
          </div>
          <div className="text-right shrink-0">
             <p className="text-sm font-black text-indigo-300 uppercase tracking-widest mb-1">Arrival</p>
             <p className="text-5xl font-black text-white">{route.totalTime}</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DriveModeHUD;
