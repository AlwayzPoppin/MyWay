
import React, { useEffect, useState, useRef } from 'react';

interface CoPilotOverlayProps {
  isActive: boolean;
  isSpeaking: boolean;
  transcription: string;
  onToggle: () => void;
}

const CoPilotOverlay: React.FC<CoPilotOverlayProps> = ({ isActive, isSpeaking, transcription, onToggle }) => {
  const [bars, setBars] = useState<number[]>(new Array(12).fill(10));

  useEffect(() => {
    let interval: any;
    if (isSpeaking) {
      interval = setInterval(() => {
        setBars(new Array(12).fill(0).map(() => Math.random() * 40 + 10));
      }, 100);
    } else {
      setBars(new Array(12).fill(10));
    }
    return () => clearInterval(interval);
  }, [isSpeaking]);

  if (!isActive) return (
    <button 
      onClick={onToggle}
      className="group relative w-16 h-16 rounded-full bg-slate-900 border border-white/10 shadow-2xl flex items-center justify-center hover:scale-110 transition-all overflow-hidden"
    >
      <div className="absolute inset-0 bg-gradient-to-tr from-indigo-500/20 to-purple-500/20 opacity-0 group-hover:opacity-100 transition-opacity" />
      <svg className="w-8 h-8 text-indigo-400 group-hover:text-white transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
      </svg>
    </button>
  );

  return (
    <div className="dark-glass rounded-[2.5rem] p-6 shadow-2xl border border-indigo-500/30 w-full max-w-sm flex items-center gap-6 animate-in slide-in-from-right duration-500">
      <button 
        onClick={onToggle}
        className="w-16 h-16 rounded-full bg-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-500/40 shrink-0"
      >
        <div className="flex items-end gap-1 h-6">
          {bars.map((height, i) => (
            <div 
              key={i} 
              className="w-1 bg-white rounded-full transition-all duration-100" 
              style={{ height: `${height}%` }} 
            />
          ))}
        </div>
      </button>

      <div className="flex-1 min-w-0">
        <p className="text-[10px] text-indigo-400 font-black uppercase tracking-[0.2em] mb-1">Omni Co-Pilot Active</p>
        <p className="text-sm font-medium text-slate-200 truncate italic">
          {transcription || "Listening for 'Hey Omni'..."}
        </p>
      </div>

      <button onClick={onToggle} className="p-2 text-slate-500 hover:text-white transition-colors">
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
};

export default CoPilotOverlay;
