import React from 'react';
import { Flag, Play, X } from 'lucide-react';
import { RouteWaypoint } from '../types';

export interface MultiStopArrivalState {
  stop: RouteWaypoint;
  stopNumber: number;
  totalStops: number;
  phase: 'approaching' | 'arrived';
}

interface MultiStopArrivalCardProps {
  state: MultiStopArrivalState | null;
  theme: 'light' | 'dark';
  onResume: () => void;
  onEndTrip: () => void;
  onDismissApproach: () => void;
}

/** A compact stop-by-stop transition that keeps the remaining route order intact. */
const MultiStopArrivalCard: React.FC<MultiStopArrivalCardProps> = ({ state, theme, onResume, onEndTrip, onDismissApproach }) => {
  if (!state) return null;
  const isDark = theme === 'dark';
  const isArrived = state.phase === 'arrived';

  return (
    <section className="fixed bottom-[calc(var(--drive-hud-controls-bottom,11rem)+12px)] left-3 right-3 z-[165] mx-auto max-w-md pointer-events-auto animate-in slide-in-from-bottom-3 duration-200">
      <div className={`rounded-2xl border p-3 shadow-2xl backdrop-blur-xl ${isDark ? 'border-white/15 bg-slate-950/95 text-white' : 'border-slate-200 bg-white/95 text-slate-900'}`}>
        <div className="flex items-start gap-3">
          <div className={`rounded-xl p-2 ${isArrived ? 'bg-emerald-500/15 text-emerald-500' : 'bg-amber-500/15 text-amber-500'}`}>
            <Flag className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className={`text-[10px] font-black uppercase tracking-widest ${isArrived ? 'text-emerald-500' : 'text-amber-500'}`}>
              {isArrived ? `Stop ${state.stopNumber} reached` : `Stop ${state.stopNumber} of ${state.totalStops} arriving soon`}
            </p>
            <h2 className="truncate text-sm font-black">{state.stop.name}</h2>
            <p className={`mt-0.5 text-[11px] ${isDark ? 'text-slate-300' : 'text-slate-500'}`}>
              {isArrived ? `${state.totalStops - state.stopNumber} ${state.totalStops - state.stopNumber === 1 ? 'destination remains' : 'destinations remain'}. Resume when you are ready.` : 'Your route will pause when you arrive.'}
            </p>
          </div>
          {!isArrived && <button type="button" onClick={onDismissApproach} className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100" aria-label="Dismiss approaching stop"><X className="h-4 w-4" /></button>}
        </div>
        {isArrived && (
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={onResume} className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-3 text-xs font-black text-white shadow-lg shadow-indigo-500/25">
              <Play className="h-4 w-4 fill-current" /> Continue trip
            </button>
            <button type="button" onClick={onEndTrip} className={`min-h-11 rounded-xl border px-3 text-xs font-bold ${isDark ? 'border-white/15 text-slate-200' : 'border-slate-200 text-slate-600'}`}>End trip</button>
          </div>
        )}
      </div>
    </section>
  );
};

export default MultiStopArrivalCard;
