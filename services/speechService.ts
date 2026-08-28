/**
 * Speech Service: High-Precision Turn-by-Turn Voice Navigation & Audio Synthesizer
 * Provides spoken voice guidance and hardware-accelerated chimes for navigation events.
 */

import { audioService } from './audioService';
import { LaneGuidance } from '../types';

export type ManeuverProximity = 'initial' | 'far' | 'near' | 'immediate' | 'arrival' | 'reroute';

class SpeechService {
    private isMuted: boolean = false;
    private lastSpokenText: string = '';
    private lastSpokenTime: number = 0;
    private audioCtx: AudioContext | null = null;
    private listeners: Array<(muted: boolean) => void> = [];

    constructor() {
        if (typeof window !== 'undefined') {
            const saved = localStorage.getItem('myway_voice_muted');
            this.isMuted = saved === 'true';
        }
    }

    /**
     * Check if voice navigation is muted
     */
    public getIsMuted(): boolean {
        return this.isMuted;
    }

    /**
     * Set voice navigation mute state and persist
     */
    public setMuted(muted: boolean): void {
        this.isMuted = muted;
        if (typeof window !== 'undefined') {
            localStorage.setItem('myway_voice_muted', String(muted));
        }
        this.listeners.forEach(cb => cb(this.isMuted));
    }

    /**
     * Toggle voice navigation mute state
     */
    public toggleMuted(): boolean {
        this.setMuted(!this.isMuted);
        return this.isMuted;
    }

    /**
     * Subscribe to mute state changes
     */
    public onMuteChange(listener: (muted: boolean) => void): () => void {
        this.listeners.push(listener);
        return () => {
            this.listeners = this.listeners.filter(cb => cb !== listener);
        };
    }

    /**
     * Initialize Web Audio Context for low-latency chimes
     */
    private getAudioContext(): AudioContext | null {
        if (typeof window === 'undefined') return null;
        if (!this.audioCtx) {
            const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
            if (AudioContextClass) {
                this.audioCtx = new AudioContextClass();
            }
        }
        if (this.audioCtx && this.audioCtx.state === 'suspended') {
            this.audioCtx.resume().catch(() => {});
        }
        return this.audioCtx;
    }

    /**
     * Play synthesized chime sounds for navigation cues
     */
    public playChime(type: 'turn' | 'arrival' | 'reroute' | 'alert'): void {
        if (this.isMuted) return;
        const ctx = this.getAudioContext();
        if (!ctx) return;

        try {
            const now = ctx.currentTime;
            const gain = ctx.createGain();
            gain.connect(ctx.destination);

            if (type === 'turn') {
                // Ascending two-tone chime (440Hz ➔ 660Hz)
                const osc1 = ctx.createOscillator();
                const osc2 = ctx.createOscillator();
                osc1.type = 'sine';
                osc2.type = 'sine';
                osc1.frequency.setValueAtTime(440, now);
                osc2.frequency.setValueAtTime(660, now + 0.1);

                gain.gain.setValueAtTime(0.2, now);
                gain.gain.exponentialRampToValueAtTime(0.01, now + 0.35);

                osc1.connect(gain);
                osc2.connect(gain);

                osc1.start(now);
                osc1.stop(now + 0.1);
                osc2.start(now + 0.1);
                osc2.stop(now + 0.35);
            } else if (type === 'arrival') {
                // Celebratory chord chime (C5 ➔ E5 ➔ G5)
                [523.25, 659.25, 783.99].forEach((freq, i) => {
                    const osc = ctx.createOscillator();
                    osc.type = 'sine';
                    osc.frequency.setValueAtTime(freq, now + i * 0.12);
                    osc.connect(gain);
                    osc.start(now + i * 0.12);
                    osc.stop(now + 0.6);
                });
                gain.gain.setValueAtTime(0.25, now);
                gain.gain.exponentialRampToValueAtTime(0.01, now + 0.6);
            } else if (type === 'reroute') {
                // Subtle descending alert (520Hz ➔ 380Hz)
                const osc = ctx.createOscillator();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(520, now);
                osc.frequency.exponentialRampToValueAtTime(380, now + 0.2);
                gain.gain.setValueAtTime(0.15, now);
                gain.gain.exponentialRampToValueAtTime(0.01, now + 0.25);
                osc.connect(gain);
                osc.start(now);
                osc.stop(now + 0.25);
            } else if (type === 'alert') {
                // Double high-pitch warning beep (880Hz)
                const osc = ctx.createOscillator();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(880, now);
                osc.frequency.setValueAtTime(880, now + 0.12);
                gain.gain.setValueAtTime(0.2, now);
                gain.gain.exponentialRampToValueAtTime(0.01, now + 0.28);
                osc.connect(gain);
                osc.start(now);
                osc.stop(now + 0.28);
            }
        } catch (e) {
            console.warn('[SpeechService] Chime audio error:', e);
        }
    }

    /**
     * Speak text with debounce and duplicate suppression
     */
    public async speak(text: string, options?: { priority?: boolean; chime?: 'turn' | 'arrival' | 'reroute' | 'alert' }): Promise<void> {
        if (this.isMuted || !text) return;

        const now = Date.now();
        // Prevent duplicate statements within 3.5 seconds
        if (this.lastSpokenText === text && now - this.lastSpokenTime < 3500 && !options?.priority) {
            return;
        }

        this.lastSpokenText = text;
        this.lastSpokenTime = now;

        if (options?.chime) {
            this.playChime(options.chime);
            // Give chime 150ms before speech
            await new Promise(r => setTimeout(r, 150));
        }

        try {
            await audioService.speak(text);
        } catch (err) {
            console.warn('[SpeechService] Voice synthesis failed:', err);
        }
    }

    /**
     * Format spoken lane recommendation
     */
    private formatLaneHint(lanes?: LaneGuidance[]): string {
        if (!lanes || lanes.length <= 1) return '';
        const validCount = lanes.filter(l => l.valid || l.active).length;
        const totalCount = lanes.length;
        if (validCount === 0 || validCount === totalCount) return '';

        const validIndices = lanes
            .map((l, i) => ((l.valid || l.active) ? i : -1))
            .filter(i => i !== -1);

        if (validIndices.length === 1) {
            const idx = validIndices[0];
            if (idx === 0) return totalCount === 2 ? 'use the left lane' : 'use the far left lane';
            if (idx === totalCount - 1) return totalCount === 2 ? 'use the right lane' : 'use the far right lane';
            return `use the ${idx === 1 ? 'second' : idx === 2 ? 'third' : 'middle'} lane from the left`;
        }

        // Check if rightmost block
        const isRightBlock = validIndices.every((val, i) => val === totalCount - validIndices.length + i);
        if (isRightBlock) {
            return `use the right ${validIndices.length} lanes`;
        }

        // Check if leftmost block
        const isLeftBlock = validIndices.every((val, i) => val === i);
        if (isLeftBlock) {
            return `use the left ${validIndices.length} lanes`;
        }

        return 'use the designated lanes';
    }

    /**
     * Natural speech formatter for navigation maneuvers
     */
    public announceManeuver(
        instruction: string,
        distanceMeters: number,
        proximity: ManeuverProximity,
        destinationName?: string,
        lanes?: LaneGuidance[]
    ): void {
        if (this.isMuted) return;

        let speechText = '';
        let chimeType: 'turn' | 'arrival' | 'reroute' | 'alert' = 'turn';

        const feet = Math.round(distanceMeters * 3.28084);
        const laneHint = (proximity === 'far' || proximity === 'near') ? this.formatLaneHint(lanes) : '';

        switch (proximity) {
            case 'initial':
                chimeType = 'turn';
                if (destinationName) {
                    speechText = `Starting route to ${destinationName}. In ${feet > 1000 ? `${(feet / 5280).toFixed(1)} miles` : `${feet} feet`}, ${instruction}.`;
                } else {
                    speechText = `In ${feet} feet, ${instruction}.`;
                }
                break;

            case 'far': // ~500-1000 ft advance warning
                chimeType = 'turn';
                if (laneHint) {
                    const cleanInstruction = instruction.replace(/^(turn|take|make|head)\s+/i, '');
                    speechText = feet >= 1000
                        ? `In a quarter mile, ${laneHint} to ${cleanInstruction}.`
                        : `In ${Math.round(feet / 100) * 100} feet, ${laneHint} to ${cleanInstruction}.`;
                } else if (feet >= 1000) {
                    speechText = `In a quarter mile, ${instruction}.`;
                } else {
                    speechText = `In ${Math.round(feet / 100) * 100} feet, ${instruction}.`;
                }
                break;

            case 'near': // ~150-250 ft approach warning
                chimeType = 'turn';
                if (laneHint) {
                    const cleanInstruction = instruction.replace(/^(turn|take|make|head)\s+/i, '');
                    speechText = `In ${feet} feet, ${laneHint} to ${cleanInstruction}.`;
                } else {
                    speechText = `In ${feet} feet, ${instruction}.`;
                }
                break;

            case 'immediate': // Right at the turn
                chimeType = 'turn';
                speechText = `${instruction} now.`;
                break;

            case 'arrival':
                chimeType = 'arrival';
                speechText = destinationName
                    ? `You have arrived at ${destinationName}.`
                    : `You have arrived at your destination.`;
                break;

            case 'reroute':
                chimeType = 'reroute';
                speechText = `Rerouting navigation.`;
                break;
        }

        if (speechText) {
            this.speak(speechText, { chime: chimeType });
        }
    }

    /**
     * Speed limit warning with alert chime
     */
    public announceSpeedWarning(speedLimit: number): void {
        if (this.isMuted) return;
        this.speak(`Caution: Speed limit is ${speedLimit} miles per hour.`, { chime: 'alert' });
    }

    /**
     * Safety / speed camera zone alert
     */
    public announceSafetyCamera(type: string = 'speed'): void {
        if (this.isMuted) return;
        this.speak(`Caution: Speed camera reported ahead.`, { chime: 'alert' });
    }
}

export const speechService = new SpeechService();
