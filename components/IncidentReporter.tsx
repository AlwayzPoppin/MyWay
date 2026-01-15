
import React from 'react';
import { IncidentReport } from '../types';

interface IncidentReporterProps {
  onReport: (type: IncidentReport['type']) => void;
  onClose: () => void;
  theme: 'light' | 'dark';
}

const IncidentReporter: React.FC<IncidentReporterProps> = ({ onReport, onClose, theme }) => {
  const items: { type: IncidentReport['type']; label: string; icon: string; color: string }[] = [
    { type: 'police', label: 'Police', icon: '👮', color: 'bg-blue-600' },
    { type: 'hazard', label: 'Hazard', icon: '🚧', color: 'bg-yellow-600' },
    { type: 'traffic', label: 'Traffic', icon: '🚗', color: 'bg-orange-600' },
    { type: 'safety_alert', label: 'Safety Alert', icon: '🛑', color: 'bg-red-600' },
  ];

  return (
    <div className={`glass rounded-[2rem] p-6 shadow-2xl border flex gap-4 animate-in fade-in zoom-in duration-300 ${theme === 'dark' ? 'dark-glass border-white/10' : 'bg-white/90 border-slate-200'}`}>
      {items.map(item => (
        <button 
          key={item.type}
          onClick={() => onReport(item.type)}
          className="flex flex-col items-center gap-2 group"
        >
          <div className={`w-14 h-14 rounded-2xl flex items-center justify-center text-2xl shadow-lg transition-transform group-hover:scale-110 ${item.color} text-white`}>
            {item.icon}
          </div>
          <span className={`text-[10px] font-black uppercase tracking-widest ${theme === 'dark' ? 'text-slate-400' : 'text-slate-600'}`}>{item.label}</span>
        </button>
      ))}
      <div className="w-px bg-white/10 mx-2" />
      <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors">
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" /></svg>
      </button>
    </div>
  );
};

export default IncidentReporter;
