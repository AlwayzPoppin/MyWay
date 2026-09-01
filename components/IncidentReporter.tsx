import React, { useState } from 'react';
import { IncidentType } from '../types';

interface IncidentReporterProps {
  onReport: (type: IncidentType, details?: string) => void;
  onClose: () => void;
  theme?: 'light' | 'dark';
  isMobile?: boolean;
}

interface IncidentOption {
  type: IncidentType;
  label: string;
  sublabel: string;
  icon: string;
  bgColor: string;
  textColor: string;
  borderColor: string;
  glowColor: string;
}

const INCIDENT_OPTIONS: IncidentOption[] = [
  {
    type: 'police',
    label: 'Police Trap',
    sublabel: 'Radar / Hidden',
    icon: '🚔',
    bgColor: 'from-blue-600 to-indigo-700 hover:from-blue-500 hover:to-indigo-600',
    textColor: 'text-blue-100',
    borderColor: 'border-blue-400/40',
    glowColor: 'shadow-[0_0_25px_rgba(59,130,246,0.5)]'
  },
  {
    type: 'hazard',
    label: 'Road Hazard',
    sublabel: 'Debris / Object',
    icon: '⚠️',
    bgColor: 'from-amber-600 to-yellow-600 hover:from-amber-500 hover:to-yellow-500',
    textColor: 'text-amber-100',
    borderColor: 'border-amber-400/40',
    glowColor: 'shadow-[0_0_25px_rgba(245,158,11,0.5)]'
  },
  {
    type: 'shoulder',
    label: 'On Shoulder',
    sublabel: 'Stopped Vehicle',
    icon: '🚗',
    bgColor: 'from-purple-600 to-pink-700 hover:from-purple-500 hover:to-pink-600',
    textColor: 'text-purple-100',
    borderColor: 'border-purple-400/40',
    glowColor: 'shadow-[0_0_25px_rgba(168,85,247,0.5)]'
  },
  {
    type: 'construction',
    label: 'Construction',
    sublabel: 'Work / Lane Closed',
    icon: '🚧',
    bgColor: 'from-orange-600 to-amber-700 hover:from-orange-500 hover:to-amber-600',
    textColor: 'text-orange-100',
    borderColor: 'border-orange-400/40',
    glowColor: 'shadow-[0_0_25px_rgba(249,115,22,0.5)]'
  },
  {
    type: 'traffic',
    label: 'Traffic Jam',
    sublabel: 'Standstill / Slow',
    icon: '🚙',
    bgColor: 'from-red-600 to-rose-700 hover:from-red-500 hover:to-rose-600',
    textColor: 'text-red-100',
    borderColor: 'border-red-400/40',
    glowColor: 'shadow-[0_0_25px_rgba(239,68,68,0.5)]'
  },
  {
    type: 'safety_alert',
    label: 'Safety Alert',
    sublabel: 'Weather / Fog',
    icon: '🛡️',
    bgColor: 'from-emerald-600 to-teal-700 hover:from-emerald-500 hover:to-teal-600',
    textColor: 'text-emerald-100',
    borderColor: 'border-emerald-400/40',
    glowColor: 'shadow-[0_0_25px_rgba(16,185,129,0.5)]'
  }
];

const IncidentReporter: React.FC<IncidentReporterProps> = ({ onReport, onClose, theme = 'dark', isMobile = false }) => {
  const [submittedType, setSubmittedType] = useState<IncidentType | null>(null);

  const handleSelect = (type: IncidentType) => {
    setSubmittedType(type);
    onReport(type);
    setTimeout(() => {
      onClose();
    }, 1200);
  };

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-in fade-in duration-200">
      <div 
        className={`w-full max-w-lg rounded-3xl p-6 shadow-2xl border relative overflow-hidden transition-all ${
          theme === 'dark' 
            ? 'bg-slate-900/95 border-white/15 text-white' 
            : 'bg-white/95 border-slate-200 text-slate-900'
        }`}
      >
        {/* Top Header */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-2xl bg-gradient-to-tr from-amber-500 to-orange-500 flex items-center justify-center text-lg shadow-lg">
              📢
            </div>
            <div>
              <h3 className="text-base font-black tracking-tight">1-Tap Road Incident Report</h3>
              <p className="text-[11px] font-bold text-slate-400">Instantly alerts circle & convoy members ahead</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-slate-400 hover:text-white flex items-center justify-center transition-all cursor-pointer"
          >
            ✕
          </button>
        </div>

        {/* Success Confirmation State */}
        {submittedType ? (
          <div className="py-8 flex flex-col items-center justify-center gap-3 animate-in zoom-in-95 duration-200">
            <div className="w-16 h-16 rounded-full bg-emerald-500/20 border-2 border-emerald-400 text-3xl flex items-center justify-center shadow-[0_0_30px_rgba(16,185,129,0.6)] animate-bounce">
              ✓
            </div>
            <h4 className="text-lg font-black text-white">Report Broadcasted!</h4>
            <p className="text-xs text-emerald-400 font-bold">Shared with all drivers in your area & circle</p>
          </div>
        ) : (
          /* 6-Grid 1-Tap Quick Action Buttons */
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {INCIDENT_OPTIONS.map(opt => (
              <button
                key={opt.type}
                onClick={() => handleSelect(opt.type)}
                className={`p-3.5 rounded-2xl bg-gradient-to-br border flex flex-col items-center justify-center gap-2 transition-all active:scale-95 cursor-pointer group ${opt.bgColor} ${opt.borderColor} ${opt.glowColor} text-white shadow-lg`}
              >
                <span className="text-3xl filter drop-shadow-md transform transition-transform group-hover:scale-110 group-active:scale-90">
                  {opt.icon}
                </span>
                <div className="text-center">
                  <p className="text-xs font-black tracking-tight leading-tight">{opt.label}</p>
                  <p className="text-[9px] font-bold text-white/70 leading-tight mt-0.5">{opt.sublabel}</p>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Bottom Tip */}
        <div className="mt-4 pt-3 border-t border-white/10 flex items-center justify-between text-[10px] text-slate-400 font-bold">
          <span>📍 Uses current GPS coordinates</span>
          <span>⏱️ Auto-expires if not confirmed</span>
        </div>
      </div>
    </div>
  );
};

export default IncidentReporter;
