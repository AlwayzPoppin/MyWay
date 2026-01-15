
import React from 'react';
import { HomeState, SmartDevice } from '../types';

interface SmartHomePanelProps {
  homeState: HomeState;
  onUpdate: (deviceId: string, action: string, value: any) => void;
  onClose: () => void;
  theme: 'light' | 'dark';
}

const SmartHomePanel: React.FC<SmartHomePanelProps> = ({ homeState, onUpdate, onClose, theme }) => {
  const bgColor = theme === 'dark' ? 'bg-[#0f172a]/95 border-white/10' : 'bg-white/95 border-slate-200';
  const itemBg = theme === 'dark' ? 'bg-white/5 border-white/5' : 'bg-slate-50 border-slate-200';
  const textColor = theme === 'dark' ? 'text-white' : 'text-slate-900';

  return (
    <div className={`w-80 backdrop-blur-2xl rounded-[2rem] shadow-[0_25px_60px_rgba(0,0,0,0.4)] border overflow-hidden animate-in slide-in-from-left duration-300 ${bgColor}`}>
      <div className="bg-indigo-600 p-5 text-white flex justify-between items-center">
        <div>
          <h3 className="font-bold text-base leading-none">Smart Home</h3>
          <p className="text-[10px] opacity-70 mt-1 uppercase tracking-widest font-black">Family Estate Status</p>
        </div>
        <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full transition-colors">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" /></svg>
        </button>
      </div>

      <div className="p-5 space-y-4">
        <div className={`p-4 rounded-2xl flex items-center justify-between border ${theme === 'dark' ? 'bg-indigo-500/10 border-indigo-500/20' : 'bg-indigo-50 border-indigo-200'}`}>
          <div className="flex items-center gap-3">
             <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center text-white">🛡️</div>
             <div>
               <p className="text-[10px] font-black uppercase tracking-widest text-indigo-400">Security</p>
               <p className={`font-bold text-sm ${textColor}`}>{homeState.securityMode.toUpperCase()}</p>
             </div>
          </div>
          <div className="w-2.5 h-2.5 rounded-full bg-green-500 animate-pulse" />
        </div>

        <div className="space-y-2">
          {homeState.devices.map(device => (
            <div key={device.id} className={`p-4 rounded-2xl border flex items-center justify-between ${itemBg}`}>
              <div className="flex items-center gap-3">
                <span className="text-xl">
                  {device.type === 'thermostat' ? '🌡️' : device.type === 'light' ? '💡' : device.type === 'garage' ? '🚗' : '🔒'}
                </span>
                <div>
                  <h4 className={`text-xs font-bold ${textColor}`}>{device.name}</h4>
                  <p className="text-[9px] text-slate-500 uppercase font-black">{device.room}</p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {device.type === 'thermostat' ? (
                  <div className="flex items-center gap-3">
                    <button onClick={() => onUpdate(device.id, 'set_temperature', (device.value as number) - 1)} className="p-1 hover:bg-white/10 rounded text-indigo-400 font-bold">-</button>
                    <span className={`text-sm font-black ${textColor}`}>{device.value}{device.unit}</span>
                    <button onClick={() => onUpdate(device.id, 'set_temperature', (device.value as number) + 1)} className="p-1 hover:bg-white/10 rounded text-indigo-400 font-bold">+</button>
                  </div>
                ) : (
                  <button 
                    onClick={() => onUpdate(device.id, device.type === 'garage' ? 'toggle' : 'turn', !device.value)}
                    className={`w-10 h-5 rounded-full relative transition-colors ${device.value ? 'bg-green-500' : 'bg-slate-700'}`}
                  >
                    <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all ${device.value ? 'left-5.5' : 'left-0.5'}`} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default SmartHomePanel;
