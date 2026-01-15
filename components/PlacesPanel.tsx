
import React from 'react';
import { Place } from '../types';

interface PlacesPanelProps {
  places: Place[];
  onSelect: (place: Place) => void;
  onClose: () => void;
  theme: 'light' | 'dark';
}

const PlacesPanel: React.FC<PlacesPanelProps> = ({ places, onSelect, onClose, theme }) => {
  const bgColor = theme === 'dark' ? 'bg-[#0f172a]/95 border-white/10' : 'bg-white/95 border-slate-200';
  const itemBg = theme === 'dark' ? 'hover:bg-white/5 border-white/5' : 'hover:bg-slate-50 border-slate-100';
  const textColor = theme === 'dark' ? 'text-white' : 'text-slate-900';

  return (
    <div className={`w-72 backdrop-blur-2xl rounded-[2rem] shadow-[0_25px_60px_rgba(0,0,0,0.4)] border overflow-hidden animate-in slide-in-from-left duration-300 ${bgColor}`}>
      <div className="bg-indigo-600 p-5 text-white flex justify-between items-center">
        <div>
          <h3 className="font-bold text-base leading-none">Your Places</h3>
          <p className="text-[10px] opacity-70 mt-1 uppercase tracking-widest font-black">Quick Navigation</p>
        </div>
        <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full transition-colors">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" /></svg>
        </button>
      </div>

      <div className="p-2 space-y-1">
        {places.map(place => (
          <button 
            key={place.id}
            onClick={() => onSelect(place)}
            className={`w-full p-4 rounded-2xl border text-left flex items-center gap-4 transition-all group ${itemBg}`}
          >
            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center text-xl shadow-inner ${theme === 'dark' ? 'bg-slate-800' : 'bg-slate-100'}`}>
              {place.icon}
            </div>
            <div className="flex-1 min-w-0">
              <h4 className={`font-bold text-sm truncate ${textColor}`}>{place.name}</h4>
              <p className={`text-[10px] uppercase font-black tracking-tighter ${theme === 'dark' ? 'text-indigo-400' : 'text-indigo-600'}`}>
                {place.type} • {Math.round(place.radius * 1000)}m Zone
              </p>
            </div>
            <div className="w-8 h-8 rounded-full flex items-center justify-center bg-indigo-600/10 text-indigo-500 opacity-0 group-hover:opacity-100 transition-opacity">
               <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M9 5l7 7-7 7" /></svg>
            </div>
          </button>
        ))}
        
        <button className={`w-full p-4 rounded-2xl border-2 border-dashed flex items-center justify-center gap-2 text-xs font-bold transition-all ${theme === 'dark' ? 'border-white/5 text-slate-500 hover:text-white hover:border-white/10' : 'border-slate-100 text-slate-400 hover:text-slate-600 hover:border-slate-200'}`}>
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M12 4v16m8-8H4" /></svg>
          Add New Place
        </button>
      </div>
    </div>
  );
};

export default PlacesPanel;
