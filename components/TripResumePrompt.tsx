import React from 'react';
import { MapPinned, Navigation, X } from 'lucide-react';

interface TripResumePromptProps {
  destinationName: string;
  isResuming?: boolean;
  onResume: () => void;
  onEndTrip: () => void;
}

const TripResumePrompt: React.FC<TripResumePromptProps> = ({
  destinationName,
  isResuming = false,
  onResume,
  onEndTrip
}) => (
  <div className="fixed inset-0 z-[500] flex items-end sm:items-center justify-center bg-slate-950/55 backdrop-blur-sm p-4">
    <section
      role="dialog"
      aria-modal="true"
      aria-labelledby="resume-trip-title"
      className="w-full max-w-md rounded-[28px] bg-white p-6 shadow-2xl"
    >
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-violet-100 text-violet-700">
          <Navigation className="h-6 w-6" strokeWidth={2.5} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-black uppercase tracking-[0.14em] text-violet-600">Trip still active</p>
          <h2 id="resume-trip-title" className="mt-1 text-xl font-black text-slate-900">Continue your trip?</h2>
        </div>
        <button
          type="button"
          onClick={onEndTrip}
          aria-label="End saved trip"
          className="rounded-full bg-slate-100 p-2 text-slate-500 transition-colors hover:bg-slate-200 hover:text-slate-800"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="mt-5 flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <MapPinned className="h-5 w-5 shrink-0 text-violet-600" />
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Destination</p>
          <p className="truncate font-bold text-slate-900">{destinationName}</p>
        </div>
      </div>

      <p className="mt-4 text-sm leading-5 text-slate-600">We’ll refresh the route from your current location.</p>

      <div className="mt-6 grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={onEndTrip}
          disabled={isResuming}
          className="h-12 rounded-xl border border-slate-200 bg-white font-bold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-60"
        >
          End trip
        </button>
        <button
          type="button"
          onClick={onResume}
          disabled={isResuming}
          className="h-12 rounded-xl bg-violet-600 font-black text-white shadow-lg shadow-violet-200 transition-colors hover:bg-violet-700 disabled:opacity-60"
        >
          {isResuming ? 'Resuming…' : 'Continue trip'}
        </button>
      </div>
    </section>
  </div>
);

export default TripResumePrompt;
