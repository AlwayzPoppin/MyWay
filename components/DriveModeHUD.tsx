
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

      {/* Advisory Alert - Top Right (doesn't block map center) */}
      {advisory && (
        <div className="absolute top-28 right-6 z-10 pointer-events-auto">
          <div className={`p-4 rounded-2xl border backdrop-blur-xl animate-in slide-in-from-right duration-500 shadow-xl max-w-xs
            ${advisory.severity === 'high' ? 'bg-red-500/30 border-red-500/40' :
              advisory.severity === 'medium' ? 'bg-amber-500/30 border-amber-500/40' :
                'bg-indigo-500/30 border-indigo-500/40'}
          `}>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-lg">
                {advisory.type === 'weather' ? '⛈️' : advisory.type === 'traffic' ? '🚗' : advisory.type === 'crime' ? '🛡️' : '⚠️'}
              </span>
              <h4 className="text-white font-bold uppercase tracking-wider text-[10px]">{advisory.title}</h4>
            </div>
            <p className="text-slate-200 text-xs leading-snug">{advisory.description}</p>
          </div>
        </div>
      )}

      {/* Spacer - Map is visible in the center */}
      <div className="flex-1" />

      {/* Bottom Controls & Info */}
      <div className="w-full pb-6 px-4 pointer-events-auto">
        <div className="max-w-5xl mx-auto flex items-end justify-between gap-3">
          {/* Left Side: Compact Speedometer + Stats */}
          <div className="flex items-end gap-3">
            {/* Compact Speedometer */}
            <div className="relative">
              <div className="bg-black/70 backdrop-blur-xl rounded-2xl w-24 h-24 border-4 border-indigo-500/40 flex flex-col items-center justify-center shadow-xl">
                <span className="text-4xl font-black text-white leading-none">{speed}</span>
                <span className="text-[10px] font-bold text-indigo-300 uppercase">MPH</span>
                {/* Speed Gauge Arc */}
                <svg className="absolute inset-0 w-full h-full -rotate-90">
                  <circle
                    cx="48"
                    cy="48"
                    r="44"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeDasharray="276"
                    strokeDashoffset={276 - (276 * (Math.min(speed, 80) / 80))}
                    className="text-indigo-500 transition-all duration-500"
                  />
                </svg>
              </div>
            </div>

            {/* Stats */}
            <div className="bg-black/60 backdrop-blur-2xl rounded-2xl p-4 border border-white/10 flex gap-6">
              <div>
                <p className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">ETA</p>
                <p className="text-2xl font-black text-white">{route.totalTime}</p>
              </div>
              <div className="w-px bg-white/10" />
              <div>
                <p className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">Safety</p>
                <p className="text-2xl font-black text-emerald-400">{safetyScore}%</p>
              </div>
              {sessionPoints && sessionPoints > 0 && (
                <>
                  <div className="w-px bg-white/10" />
                  <div>
                    <p className="text-[9px] font-bold text-amber-500 uppercase tracking-wider">Points</p>
                    <p className="text-2xl font-black text-amber-400">+{sessionPoints}</p>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Navigation Controls */}
        <div className="flex gap-4">
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
  );
};

export default DriveModeHUD;
