import React, { useState } from 'react';
import { IncidentType, IncidentReport } from '../types';
import { hapticSuccess } from '../utils/haptics';
import { AlertTriangle, CarFront, CircleOff, Construction, LightbulbOff, MapPin, Radio, Siren, Trash2, Waves, X } from 'lucide-react';

interface IncidentReporterProps {
  onReport: (type: IncidentType, details?: string) => void;
  onClose: () => void;
  theme?: 'light' | 'dark';
  isMobile?: boolean;
  activeIncidents?: IncidentReport[];
  onRemoveIncident?: (id: string) => void;
  currentUserId?: string;
}

interface IncidentOption {
  type: IncidentType;
  label: string;
  sublabel: string;
  icon: React.ComponentType<{ className?: string }>;
  bgColor: string;
  borderColor: string;
  glowColor: string;
}

const INCIDENT_OPTIONS: IncidentOption[] = [
  { type: 'police', label: 'Police Trap', sublabel: 'Radar / hidden', icon: Siren, bgColor: 'from-blue-600 to-indigo-700 hover:from-blue-500 hover:to-indigo-600', borderColor: 'border-blue-400/40', glowColor: 'shadow-[0_0_25px_rgba(59,130,246,0.5)]' },
  { type: 'hazard', label: 'Road Hazard', sublabel: 'Debris / object', icon: AlertTriangle, bgColor: 'from-amber-600 to-yellow-600 hover:from-amber-500 hover:to-yellow-500', borderColor: 'border-amber-400/40', glowColor: 'shadow-[0_0_25px_rgba(245,158,11,0.5)]' },
  { type: 'shoulder', label: 'On Shoulder', sublabel: 'Stopped vehicle', icon: CarFront, bgColor: 'from-purple-600 to-pink-700 hover:from-purple-500 hover:to-pink-600', borderColor: 'border-purple-400/40', glowColor: 'shadow-[0_0_25px_rgba(168,85,247,0.5)]' },
  { type: 'construction', label: 'Construction', sublabel: 'Work / lane closed', icon: Construction, bgColor: 'from-orange-600 to-amber-700 hover:from-orange-500 hover:to-amber-600', borderColor: 'border-orange-400/40', glowColor: 'shadow-[0_0_25px_rgba(249,115,22,0.5)]' },
  { type: 'traffic', label: 'Traffic Jam', sublabel: 'Standstill / slow', icon: TrafficJamCars, bgColor: 'from-red-600 to-rose-700 hover:from-red-500 hover:to-rose-600', borderColor: 'border-red-400/40', glowColor: 'shadow-[0_0_25px_rgba(239,68,68,0.5)]' },
  { type: 'safety_alert', label: 'Flooded Road', sublabel: 'Water across road', icon: FloodWarning, bgColor: 'from-sky-600 to-cyan-700 hover:from-sky-500 hover:to-cyan-600', borderColor: 'border-sky-300/45', glowColor: 'shadow-[0_0_25px_rgba(14,165,233,0.5)]' },
  { type: 'road_closed', label: 'Road Closed', sublabel: 'Blocked / detour', icon: CircleOff, bgColor: 'from-rose-600 to-red-700 hover:from-rose-500 hover:to-red-600', borderColor: 'border-rose-400/40', glowColor: 'shadow-[0_0_25px_rgba(244,63,94,0.5)]' },
  { type: 'signal_out', label: 'Signal Out', sublabel: 'Traffic light', icon: LightbulbOff, bgColor: 'from-yellow-600 to-amber-700 hover:from-yellow-500 hover:to-amber-600', borderColor: 'border-yellow-400/40', glowColor: 'shadow-[0_0_25px_rgba(234,179,8,0.45)]' }
];

const ROAD_FEATURE_OPTIONS: IncidentOption[] = [
  { type: 'speed_bump', label: 'Speed Bump', sublabel: 'Permanent road feature', icon: SpeedBumpSign, bgColor: 'from-slate-600 to-slate-700 hover:from-slate-500 hover:to-slate-600', borderColor: 'border-slate-300/35', glowColor: 'shadow-[0_0_20px_rgba(100,116,139,0.35)]' }
];

function SpeedBumpSign({ className }: { className?: string }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
    <rect x="4.2" y="4.2" width="15.6" height="15.6" rx="1.3" transform="rotate(45 12 12)" fill="#facc15" stroke="#fff" strokeWidth="1.15" />
    <path d="M6.8 15.2h2.2c.55-2.7 1.5-4.05 3-4.05s2.45 1.35 3 4.05h2.2" fill="none" stroke="#111827" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}

function TrafficJamCars({ className }: { className?: string }) {
  return <svg viewBox="0 0 36 28" aria-hidden="true" className={className}>
    <g transform="translate(1 7)">
      <path d="M2 14v-7l3-5h10l3 5v7H2Z" fill="#ffffff" />
      <path d="M6 4.5h8l1.6 3H4.4l1.6-3Z" fill="#991b1b" />
      <circle cx="5.5" cy="14" r="2" fill="#991b1b" /><circle cx="14.5" cy="14" r="2" fill="#991b1b" />
    </g>
    <g transform="translate(16 1)">
      <path d="M2 16v-8l3-5h10l3 5v8H2Z" fill="#ffffff" />
      <path d="M6 5h8l1.6 3H4.4L6 5Z" fill="#991b1b" />
      <circle cx="5.5" cy="16" r="2" fill="#991b1b" /><circle cx="14.5" cy="16" r="2" fill="#991b1b" />
    </g>
  </svg>;
}

function FloodWarning({ className }: { className?: string }) {
  return <svg viewBox="0 0 28 28" aria-hidden="true" className={className} fill="none" stroke="#ffffff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 10c1.6-1.8 3.2-1.8 4.8 0 1.6 1.8 3.2 1.8 4.8 0 1.6-1.8 3.2-1.8 4.8 0 1.6 1.8 3.2 1.8 4.8 0" />
    <path d="M3 16c1.6-1.8 3.2-1.8 4.8 0 1.6 1.8 3.2 1.8 4.8 0 1.6-1.8 3.2-1.8 4.8 0 1.6 1.8 3.2 1.8 4.8 0" />
    <path d="M3 22c1.6-1.8 3.2-1.8 4.8 0 1.6 1.8 3.2 1.8 4.8 0 1.6-1.8 3.2-1.8 4.8 0 1.6 1.8 3.2 1.8 4.8 0" />
  </svg>;
}

const iconForType = (type: IncidentType): React.ComponentType<{ className?: string }> => {
  const option = [...INCIDENT_OPTIONS, ...ROAD_FEATURE_OPTIONS].find(item => item.type === type);
  return option?.icon || AlertTriangle;
};

const ReportTile: React.FC<{ option: IncidentOption; onSelect: (type: IncidentType) => void }> = ({ option, onSelect }) => {
  const Icon = option.icon;
  return <button key={option.type} onClick={() => onSelect(option.type)} className={`p-3.5 rounded-2xl bg-gradient-to-br border flex flex-col items-center justify-center gap-2 transition-all active:scale-95 cursor-pointer group ${option.bgColor} ${option.borderColor} ${option.glowColor} text-white shadow-lg`}>
    <Icon className="w-7 h-7 drop-shadow-md transition-transform group-hover:scale-110 group-active:scale-90" />
    <div className="text-center"><p className="text-xs font-black tracking-tight leading-tight">{option.label}</p><p className="text-[9px] font-bold text-white/70 leading-tight mt-0.5">{option.sublabel}</p></div>
  </button>;
};

const IncidentReporter: React.FC<IncidentReporterProps> = ({ onReport, onClose, theme = 'dark', activeIncidents = [], onRemoveIncident }) => {
  const [submittedType, setSubmittedType] = useState<IncidentType | null>(null);
  const handleSelect = (type: IncidentType) => { hapticSuccess(); setSubmittedType(type); onReport(type); window.setTimeout(onClose, 1200); };
  const isDark = theme === 'dark';

  return <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-in fade-in duration-200 pointer-events-auto">
    <div className={`w-full max-w-lg rounded-3xl p-6 shadow-2xl border relative overflow-hidden transition-all max-h-[85vh] flex flex-col ${isDark ? 'bg-slate-900/95 border-white/15 text-white' : 'bg-white/95 border-slate-200 text-slate-900'}`}>
      <div className="flex items-center justify-between mb-4 shrink-0">
        <div className="flex items-center gap-2.5"><div className="w-9 h-9 rounded-2xl bg-gradient-to-tr from-amber-500 to-orange-500 flex items-center justify-center shadow-lg"><Radio className="w-5 h-5 text-white" /></div><div><h3 className="text-base font-black tracking-tight">Report road condition</h3><p className="text-[11px] font-bold text-slate-400">Instantly alerts circle and convoy members ahead</p></div></div>
        <button onClick={onClose} aria-label="Close report menu" className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-slate-400 hover:text-white flex items-center justify-center transition-all cursor-pointer"><X className="w-4 h-4" /></button>
      </div>
      <div className="flex-1 overflow-y-auto space-y-4 no-scrollbar">
        {submittedType ? <div className="py-8 flex flex-col items-center justify-center gap-3 animate-in zoom-in-95 duration-200"><div className="w-16 h-16 rounded-full bg-emerald-500/20 border-2 border-emerald-400 flex items-center justify-center shadow-[0_0_30px_rgba(16,185,129,0.6)]"><Radio className="w-7 h-7 text-emerald-300" /></div><h4 className="text-lg font-black">Report shared</h4><p className="text-xs text-emerald-400 font-bold">Drivers nearby can now confirm or clear it</p></div> : <>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">{INCIDENT_OPTIONS.map(option => <ReportTile key={option.type} option={option} onSelect={handleSelect} />)}</div>
          <div className="pt-1"><div className="flex items-center gap-2 mb-2 text-[10px] font-black uppercase tracking-wider text-slate-400"><Waves className="w-3.5 h-3.5" /><span>Road features</span><span className="font-semibold normal-case tracking-normal text-slate-500">Stays on map until removed</span></div><div className="grid grid-cols-2 sm:grid-cols-3 gap-3">{ROAD_FEATURE_OPTIONS.map(option => <ReportTile key={option.type} option={option} onSelect={handleSelect} />)}</div></div>
        </>}
        {activeIncidents.length > 0 && onRemoveIncident && <div className="pt-3 border-t border-white/10 space-y-2"><div className="flex items-center justify-between"><p className="text-[10px] font-black uppercase tracking-wider text-amber-400 flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> Active reports ({activeIncidents.length})</p><span className="text-[9px] text-slate-400 font-bold">Tap to remove</span></div><div className="space-y-1.5 max-h-36 overflow-y-auto no-scrollbar">{activeIncidents.map(inc => { const Icon = iconForType(inc.type); return <div key={inc.id} className="p-2.5 rounded-xl bg-white/5 border border-white/10 flex items-center justify-between gap-2"><div className="flex items-center gap-2 min-w-0 flex-1"><Icon className="w-5 h-5 text-amber-300 shrink-0" /><div className="min-w-0"><p className="text-xs font-black capitalize truncate">{inc.type.replace(/_/g, ' ')}</p><p className="text-[9px] text-slate-400 truncate">Reported by {inc.reporterName || 'Driver'} · {inc.upvotes || 1} confirmations</p></div></div><button type="button" onClick={() => onRemoveIncident(inc.id)} className="px-2.5 py-1 rounded-lg bg-rose-600/80 hover:bg-rose-600 text-white font-bold text-[10px] uppercase flex items-center gap-1 active:scale-95 transition-all shrink-0 cursor-pointer shadow-sm"><Trash2 className="w-3.5 h-3.5" /> Remove</button></div>; })}</div></div>}
      </div>
      <div className="mt-3 pt-2 border-t border-white/10 flex items-center justify-between text-[10px] text-slate-400 font-bold shrink-0"><span className="flex items-center gap-1"><MapPin className="w-3 h-3" /> Uses current GPS coordinates</span><span className="flex items-center gap-1"><Radio className="w-3 h-3" /> Temporary reports auto-expire</span></div>
    </div>
  </div>;
};
export default IncidentReporter;

