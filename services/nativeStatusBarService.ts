import { Capacitor, registerPlugin } from '@capacitor/core';
import type { MapSkinId } from './mapSkinService';

interface NativeStatusBarPlugin {
  setAppearance(options: { color: string; useDarkIcons: boolean }): Promise<void>;
}

const NativeStatusBar = registerPlugin<NativeStatusBarPlugin>('NativeStatusBar');

const MAP_STATUS_BAR_APPEARANCE: Record<'light' | 'dark', { color: string; useDarkIcons: boolean }> = {
  // Matches the Default map/UI canvas while retaining strong dark glyph contrast.
  light: { color: '#F8F6F0', useDarkIcons: true },
  // Carbon Amber uses a deep backdrop so white system glyphs remain readable.
  dark: { color: '#17213E', useDarkIcons: false }
};

export const nativeStatusBarService = {
  async applyMapSkin(skin: MapSkinId | string): Promise<void> {
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') return;
    const appearance = skin === 'default' || skin === 'warm_cream'
      ? MAP_STATUS_BAR_APPEARANCE.light
      : MAP_STATUS_BAR_APPEARANCE.dark;
    try {
      await NativeStatusBar.setAppearance(appearance);
    } catch (error) {
      console.warn('[NativeStatusBar] Could not apply status bar appearance:', error);
    }
  }
};
