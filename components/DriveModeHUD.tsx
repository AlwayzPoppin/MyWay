
import React, { useState, useEffect } from 'react';
import { NavigationRoute } from '../types';
import { SafetyAdvisory } from '../services/geminiService';

interface DriveModeHUDProps {
  route: NavigationRoute;
  speed: number;
  onCancel: () => void;
  theme: 'light' | 'dark';
  stepIndex: number;
  advisory?: SafetyAdvisory | null;
  safetyScore?: number;
  sessionPoints?: number;
}

const DriveModeHUD: React.FC<DriveModeHUDProps> = ({ route, speed, onCancel, theme, stepIndex, advisory, safetyScore, sessionPoints }) => {
  const steps = route?.steps || [];
  const currentStep = steps[stepIndex] || steps[0] || { instruction: 'Navigating...', distance: '0 ft' };

  // Calculate remaining distance
  const totalSteps = steps.length;
  const progress = totalSteps > 0 ? ((stepIndex + 1) / totalSteps) * 100 : 0;

  return (
    <div className="absolute inset-0 z-[100] flex flex-col pointer-events-none">
      {/* Top Navigation Bar - Glassmorphism */}
      <div className="w-full pt-12 px-6 pointer-events-auto">
        <div className="max-w-xl mx-auto bg-black/40 backdrop-blur-2xl rounded-[2.5rem] border border-white/10 p-6 shadow-[0_20px_50px_rgba(0,0,0,0.5)] flex items-center gap-6 overflow-hidden relative">
          {/* Animated Glow Background */}
          <div className="absolute -left-20 -top-20 w-40 h-40 bg-indigo-500/20 blur-[80px]" />

          {/* Next Turn Icon */}
          <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white shadow-lg shrink-0">
            <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={4} d="M5 10l7-7m0 0l7 7m-7-7v18" />
            </svg>
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-2">
              <span className="text-5xl font-black text-white tracking-tighter">{currentStep.distance}</span>
            </div>
            <p className="text-xl font-bold text-slate-300 truncate">{currentStep.instruction}</p>
          </div>

          {/* Progress Indicator */}
          <div className="absolute bottom-0 left-0 h-1 bg-indigo-500 transition-all duration-500" style={{ width: `${progress}%` }} />
        </div>
      </div>

      {/* Center Focus Area - Speed & Status */}
      <div className="flex-1 flex flex-col items-center justify-center p-6 gap-8">
        {advisory && (
          <div className={`p-5 rounded-[2rem] border backdrop-blur-3xl animate-in slide-in-from-bottom duration-700 shadow-2xl max-w-sm
            ${advisory.severity === 'high' ? 'bg-red-500/20 border-red-500/30' :
              advisory.severity === 'medium' ? 'bg-amber-500/20 border-amber-500/30' :
                'bg-indigo-500/20 border-indigo-500/30'}
          `}>
            <div className="flex items-center gap-3 mb-2">
              <span className="text-2xl">
                {advisory.type === 'weather' ? '⛈️' : advisory.type === 'traffic' ? '🚗' : advisory.type === 'crime' ? '🛡️' : '⚠️'}
              </span>
              <h4 className="text-white font-black uppercase tracking-widest text-[11px]">{advisory.title}</h4>
            </div>
            <p className="text-slate-200 text-sm font-medium leading-relaxed">{advisory.description}</p>
          </div>
        )}

        <div className="relative">
          {/* Ripple Effect around speed */}
          <div className="absolute inset-0 bg-indigo-500/20 rounded-full blur-3xl animate-pulse" />

          <div className="relative bg-black/60 backdrop-blur-3xl rounded-full w-64 h-64 border-8 border-indigo-500/30 flex flex-col items-center justify-center shadow-2xl">
            <p className="text-[10px] font-black uppercase text-indigo-400 tracking-[0.3em] mb-1">Live Velocity</p>
            <span className="text-8xl font-black text-white tracking-tighter leading-none">{speed}</span>
            <span className="text-xl font-black text-indigo-300 mt-2">MPH</span>

            {/* Speed Gauge Trace */}
            <svg className="absolute inset-0 w-full h-full -rotate-90">
              <circle
                cx="128"
                cy="128"
                r="120"
                fill="none"
                stroke="currentColor"
                strokeWidth="4"
                strokeDasharray="753"
                strokeDashoffset={753 - (753 * (Math.min(speed, 80) / 80))}
                className="text-indigo-500 drop-shadow-[0_0_8px_rgba(99,102,241,0.8)] transition-all duration-1000"
              />
            </svg>
          </div>
        </div>
      </div>

      {/* Bottom Controls & Info */}
      <div className="w-full pb-10 px-6 pointer-events-auto">
        <div className="max-w-4xl mx-auto flex items-end justify-between gap-4">
          {/* Arrival Stats */}
          <div className="bg-black/60 backdrop-blur-2xl rounded-3xl p-6 border border-white/10 flex gap-8">
            <div>
              <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">Arrival</p>
              <p className="text-3xl font-black text-white">{route.totalTime}</p>
            </div>
            <div className="w-px h-full bg-white/10" />
            <div>
              <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">Safety</p>
              <p className="text-3xl font-black text-emerald-400">{safetyScore}%</p>
            </div>
            {sessionPoints && sessionPoints > 0 && (
              <>
                <div className="w-px h-full bg-white/10" />
                <div>
                  <p className="text-[10px] font-black text-amber-500 uppercase tracking-widest mb-1">Points</p>
                  <p className="text-3xl font-black text-amber-500">+{sessionPoints}</p>
                </div>
              </>
            )}
          </div>

          {/* Simulation/Stop Controls */}
          <div className="flex gap-4">
            <button
              className="h-20 px-8 rounded-3xl bg-white/10 border border-white/20 text-white font-black text-sm uppercase tracking-widest hover:bg-white/20 transition-all flex items-center gap-3 backdrop-blur-xl opacity-50 cursor-not-allowed"
            >
              <span className="text-xl">🤖</span> Auto-Nav
            </button>
            <button
              onClick={onCancel}
              className="h-20 w-20 rounded-3xl bg-red-500/20 border border-red-500/40 text-red-500 flex items-center justify-center shadow-2xl hover:bg-red-500/40 transition-all backdrop-blur-xl"
            >
              <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DriveModeHUD;
