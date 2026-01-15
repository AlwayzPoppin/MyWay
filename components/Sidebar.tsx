
import React from 'react';
import { FamilyMember } from '../types';

interface SidebarProps {
  members: FamilyMember[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onTogglePlaces: () => void;
  onToggleHome: () => void;
  theme: 'light' | 'dark';
  isMobile?: boolean;
}

const Sidebar: React.FC<SidebarProps> = ({ members, selectedId, onSelect, onTogglePlaces, onToggleHome, theme, isMobile = false }) => {
  const containerClasses = isMobile
    ? `w-full h-20 safe-bottom border-t px-4 flex-row justify-around items-center`
    : `w-24 border-r py-6 flex-col items-center gap-4`;

  const bgClasses = theme === 'dark'
    ? 'bg-gradient-to-b from-[#0f172a]/98 to-[#0f172a]/95 border-white/5'
    : 'bg-gradient-to-b from-white/98 to-white/95 border-slate-200';

  const getBatteryColor = (battery: number) => {
    if (battery <= 20) return '#ef4444';
    if (battery <= 50) return '#f59e0b';
    return '#22c55e';
  };

  return (
    <aside className={`flex z-50 transition-all duration-500 backdrop-blur-2xl ${containerClasses} ${bgClasses}`}>
      {/* Navigation buttons with hover effects */}
      <div className={`flex ${isMobile ? 'flex-row gap-2' : 'flex-col gap-3'}`}>
        <button
          onClick={onTogglePlaces}
          className={`group w-14 h-14 rounded-2xl flex items-center justify-center transition-all duration-300 shadow-lg border relative overflow-hidden
            ${theme === 'dark'
              ? 'bg-gradient-to-br from-indigo-600/30 to-purple-600/20 border-indigo-500/30 hover:border-indigo-400/50'
              : 'bg-gradient-to-br from-indigo-50 to-purple-50 border-indigo-100 hover:border-indigo-200'}`}
        >
          <div className="absolute inset-0 bg-gradient-to-r from-indigo-500/0 via-indigo-500/20 to-indigo-500/0 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700" />
          <span className="text-2xl relative z-10 group-hover:scale-110 transition-transform">📍</span>
        </button>

        <button
          onClick={onToggleHome}
          className={`group w-14 h-14 rounded-2xl flex items-center justify-center transition-all duration-300 shadow-lg border relative overflow-hidden
            ${theme === 'dark'
              ? 'bg-gradient-to-br from-emerald-600/30 to-teal-600/20 border-emerald-500/30 hover:border-emerald-400/50'
              : 'bg-gradient-to-br from-emerald-50 to-teal-50 border-emerald-100 hover:border-emerald-200'}`}
        >
          <div className="absolute inset-0 bg-gradient-to-r from-emerald-500/0 via-emerald-500/20 to-emerald-500/0 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700" />
          <span className="text-2xl relative z-10 group-hover:scale-110 transition-transform">🏠</span>
        </button>
      </div>

      {!isMobile && <div className="w-12 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent my-2" />}

      {/* Family members with enhanced styling */}
      <div className={`flex ${isMobile ? 'flex-row gap-4' : 'flex-col gap-5'}`}>
        {members.map((member, index) => (
          <button
            key={member.id}
            onClick={() => onSelect(member.id)}
            className={`group relative transition-all duration-300 ${selectedId === member.id ? 'scale-110' : 'hover:scale-105 opacity-80 hover:opacity-100'}`}
            style={{ animationDelay: `${index * 100}ms` }}
          >
            {/* Selection glow ring */}
            <div className={`absolute -inset-2 rounded-2xl transition-all duration-500 ${selectedId === member.id
              ? 'bg-gradient-to-r from-indigo-500 via-purple-500 to-indigo-500 opacity-40 blur-lg animate-pulse'
              : 'opacity-0'}`}
            />

            {/* Avatar container */}
            <div className="relative">
              <div className={`absolute -inset-0.5 rounded-2xl bg-gradient-to-br transition-opacity duration-300 ${selectedId === member.id
                  ? 'from-indigo-500 to-purple-500 opacity-100'
                  : 'from-white/20 to-white/5 opacity-50 group-hover:opacity-80'
                }`} />

              <img
                src={member.avatar}
                alt={member.name}
                className={`relative w-14 h-14 rounded-2xl object-cover shadow-xl transition-all duration-300
                  ${selectedId === member.id ? 'ring-2 ring-white/30 ring-offset-2 ring-offset-transparent' : ''}`}
              />

              {/* Status badge */}
              {member.status === 'Driving' && (
                <div className="absolute -bottom-1 -right-1 w-6 h-6 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl flex items-center justify-center text-xs shadow-xl border-2 border-[#0f172a] animate-pulse">
                  🏎️
                </div>
              )}
              {member.status === 'Moving' && (
                <div className="absolute -bottom-1 -right-1 w-6 h-6 bg-gradient-to-br from-blue-500 to-cyan-600 rounded-xl flex items-center justify-center text-xs shadow-xl border-2 border-[#0f172a]">
                  🚶
                </div>
              )}
              {member.status === 'Stationary' && (
                <div className="absolute -bottom-1 -right-1 w-6 h-6 bg-gradient-to-br from-green-500 to-emerald-600 rounded-xl flex items-center justify-center text-xs shadow-xl border-2 border-[#0f172a]">
                  📍
                </div>
              )}

              {/* Battery indicator */}
              {!isMobile && (
                <div className="absolute -left-1 top-1/2 -translate-y-1/2 h-8 w-1.5 rounded-full bg-black/30 overflow-hidden">
                  <div
                    className="absolute bottom-0 w-full rounded-full transition-all duration-500"
                    style={{
                      height: `${member.battery}%`,
                      backgroundColor: getBatteryColor(member.battery),
                      boxShadow: `0 0 8px ${getBatteryColor(member.battery)}`
                    }}
                  />
                </div>
              )}

              {/* Name tag on hover */}
              <div className={`absolute -right-2 top-1/2 -translate-y-1/2 translate-x-full opacity-0 group-hover:opacity-100 transition-all duration-300 pointer-events-none
                ${theme === 'dark' ? 'bg-slate-800' : 'bg-white'} 
                px-3 py-1 rounded-lg shadow-xl text-xs font-bold whitespace-nowrap`}
              >
                {member.name}
                <div className="text-[10px] font-normal opacity-60">{member.status}</div>
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* Add member button */}
      {!isMobile && (
        <div className="mt-auto">
          <button className={`group w-14 h-14 rounded-2xl border-2 border-dashed flex items-center justify-center transition-all duration-300 hover:scale-105
            ${theme === 'dark'
              ? 'border-white/10 text-white/30 hover:border-indigo-500/50 hover:text-indigo-400 hover:bg-indigo-500/10'
              : 'border-slate-200 text-slate-300 hover:border-indigo-300 hover:text-indigo-500'}`}
          >
            <svg className="w-6 h-6 transition-transform group-hover:rotate-90 duration-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </button>
        </div>
      )}
    </aside>
  );
};

export default Sidebar;
