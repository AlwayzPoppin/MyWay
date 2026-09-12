import { useEffect, useState } from 'react';

export interface ViewportSize {
  width: number;
  height: number;
}

const readViewport = (): ViewportSize => {
  const visualViewport = window.visualViewport;
  return {
    width: Math.round(visualViewport?.width || window.innerWidth),
    height: Math.round(visualViewport?.height || window.innerHeight),
  };
};

/**
 * Keeps the app shell aligned to Android's real visible WebView after rotation.
 * Android can report the former landscape height briefly when an activity handles
 * config changes itself, so each orientation change is sampled through its settle.
 */
export const useViewportRecovery = (): ViewportSize => {
  const [viewport, setViewport] = useState<ViewportSize>(() =>
    typeof window === 'undefined' ? { width: 0, height: 0 } : readViewport(),
  );

  useEffect(() => {
    let settleTimers: number[] = [];

    const applyViewport = () => {
      const nextViewport = readViewport();
      const height = `${nextViewport.height}px`;

      document.documentElement.style.setProperty('--myway-viewport-height', height);
      document.body.style.setProperty('--myway-viewport-height', height);
      document.getElementById('root')?.style.setProperty('--myway-viewport-height', height);

      setViewport(previous =>
        previous.width === nextViewport.width && previous.height === nextViewport.height
          ? previous
          : nextViewport,
      );

      window.dispatchEvent(new CustomEvent('myway:viewportchange', { detail: nextViewport }));
    };

    const settleViewport = () => {
      settleTimers.forEach(window.clearTimeout);
      settleTimers = [];
      applyViewport();
      requestAnimationFrame(applyViewport);
      settleTimers.push(window.setTimeout(applyViewport, 120) as unknown as number);
      settleTimers.push(window.setTimeout(applyViewport, 360) as unknown as number);
    };

    const visualViewport = window.visualViewport;
    settleViewport();
    window.addEventListener('resize', settleViewport, { passive: true });
    window.addEventListener('orientationchange', settleViewport, { passive: true });
    window.addEventListener('pageshow', settleViewport, { passive: true });
    visualViewport?.addEventListener('resize', settleViewport, { passive: true });
    screen.orientation?.addEventListener('change', settleViewport);

    return () => {
      settleTimers.forEach(window.clearTimeout);
      window.removeEventListener('resize', settleViewport);
      window.removeEventListener('orientationchange', settleViewport);
      window.removeEventListener('pageshow', settleViewport);
      visualViewport?.removeEventListener('resize', settleViewport);
      screen.orientation?.removeEventListener('change', settleViewport);
    };
  }, []);

  return viewport;
};
