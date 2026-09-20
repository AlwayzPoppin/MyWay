import { Capacitor, registerPlugin } from '@capacitor/core';

type RecorderState = { recording: boolean; path?: string };

interface NativeRoadRecorderPlugin {
  start(): Promise<RecorderState>;
  stop(): Promise<RecorderState>;
  getStatus(): Promise<RecorderState>;
}

const NativeRoadRecorder = registerPlugin<NativeRoadRecorderPlugin>('NativeRoadRecorder');

export const nativeRoadRecorderService = {
  isSupported: () => Capacitor.getPlatform() === 'android',
  start: () => NativeRoadRecorder.start(),
  stop: () => NativeRoadRecorder.stop(),
  getStatus: () => NativeRoadRecorder.getStatus()
};
