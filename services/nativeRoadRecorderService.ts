import { Capacitor, registerPlugin } from '@capacitor/core';

type RecorderState = { recording: boolean; path?: string };
type RecorderOptions = { quality?: 'standard' | 'hd'; storageGb?: 1 | 2 | 5 };

export type RoadRecorderClip = {
  path: string;
  name: string;
  createdAt: number;
  sizeBytes: number;
  durationMs: number;
  protected: boolean;
};

type RoadRecorderLibrary = {
  clips: RoadRecorderClip[];
  totalBytes: number;
  maxBytes: number;
};

interface NativeRoadRecorderPlugin {
  start(options?: RecorderOptions): Promise<RecorderState>;
  stop(): Promise<RecorderState>;
  getStatus(): Promise<RecorderState>;
  showPreview(): Promise<void>;
  listClips(): Promise<RoadRecorderLibrary>;
  deleteClip(options: { path: string }): Promise<void>;
  openClip(options: { path: string }): Promise<void>;
  setClipProtected(options: { path: string; protected: boolean }): Promise<{ path: string; protected: boolean }>;
}

const NativeRoadRecorder = registerPlugin<NativeRoadRecorderPlugin>('NativeRoadRecorder');

export const nativeRoadRecorderService = {
  isSupported: () => Capacitor.getPlatform() === 'android',
  start: (options: RecorderOptions = {}) => NativeRoadRecorder.start(options),
  stop: () => NativeRoadRecorder.stop(),
  getStatus: () => NativeRoadRecorder.getStatus(),
  showPreview: () => NativeRoadRecorder.showPreview(),
  listClips: () => NativeRoadRecorder.listClips(),
  deleteClip: (path: string) => NativeRoadRecorder.deleteClip({ path }),
  openClip: (path: string) => NativeRoadRecorder.openClip({ path }),
  setClipProtected: (path: string, isProtected: boolean) => NativeRoadRecorder.setClipProtected({ path, protected: isProtected })
};
