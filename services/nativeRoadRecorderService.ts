import { Capacitor, registerPlugin } from '@capacitor/core';

type RecorderState = { recording: boolean; path?: string };

export type RoadRecorderClip = {
  path: string;
  name: string;
  createdAt: number;
  sizeBytes: number;
  durationMs: number;
};

type RoadRecorderLibrary = {
  clips: RoadRecorderClip[];
  totalBytes: number;
  maxBytes: number;
};

interface NativeRoadRecorderPlugin {
  start(): Promise<RecorderState>;
  stop(): Promise<RecorderState>;
  getStatus(): Promise<RecorderState>;
  listClips(): Promise<RoadRecorderLibrary>;
  deleteClip(options: { path: string }): Promise<void>;
  openClip(options: { path: string }): Promise<void>;
}

const NativeRoadRecorder = registerPlugin<NativeRoadRecorderPlugin>('NativeRoadRecorder');

export const nativeRoadRecorderService = {
  isSupported: () => Capacitor.getPlatform() === 'android',
  start: () => NativeRoadRecorder.start(),
  stop: () => NativeRoadRecorder.stop(),
  getStatus: () => NativeRoadRecorder.getStatus(),
  listClips: () => NativeRoadRecorder.listClips(),
  deleteClip: (path: string) => NativeRoadRecorder.deleteClip({ path }),
  openClip: (path: string) => NativeRoadRecorder.openClip({ path })
};
