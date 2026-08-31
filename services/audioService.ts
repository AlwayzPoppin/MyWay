import { Capacitor } from '@capacitor/core';

/**
 * Audio Service for Web Speech API and Native TTS integration.
 * Provides unified, deterministic text-to-speech capabilities with audio focus management.
 */

class AudioService {
    private synthesis: SpeechSynthesis | null = null;
    private voice: SpeechSynthesisVoice | null = null;
    private enabled: boolean = true;
    private isSpeaking: boolean = false;
    private voiceReadyPromise: Promise<void> | null = null;
    private audioCtx: AudioContext | null = null;
    private suspendTimer: ReturnType<typeof setTimeout> | null = null;
    private readonly IDLE_SUSPEND_DELAY_MS = 5000;

    constructor() {
        if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
            this.synthesis = window.speechSynthesis;
            this.voiceReadyPromise = this.initVoices();
            if (this.synthesis.onvoiceschanged !== undefined) {
                this.synthesis.onvoiceschanged = () => {
                    this.initVoices();
                };
            }
        }

        // Hardware Audio Thread Management: Suspend idle audio context when app is backgrounded
        if (typeof document !== 'undefined') {
            document.addEventListener('visibilitychange', () => {
                if (document.hidden && this.audioCtx && this.audioCtx.state === 'running') {
                    this.audioCtx.suspend().catch(() => {});
                }
            });
        }
    }

    private initVoices(): Promise<void> {
        return new Promise((resolve) => {
            if (!this.synthesis) {
                resolve();
                return;
            }
            const voices = this.synthesis.getVoices();
            if (voices && voices.length > 0) {
                this.selectBestVoice(voices);
                resolve();
            } else {
                // Some browsers load voices asynchronously
                const handler = () => {
                    const loaded = this.synthesis?.getVoices() || [];
                    this.selectBestVoice(loaded);
                    resolve();
                };
                if (this.synthesis) {
                    this.synthesis.onvoiceschanged = handler;
                }
                setTimeout(resolve, 800); // Fallback timeout
            }
        });
    }

    private selectBestVoice(voices: SpeechSynthesisVoice[]) {
        if (!voices || voices.length === 0) return;

        // Check if user has a custom voice preference stored
        const savedVoiceName = typeof window !== 'undefined' ? localStorage.getItem('myway_voice_name') : null;
        if (savedVoiceName) {
            const found = voices.find(v => v.name === savedVoiceName);
            if (found) {
                this.voice = found;
                return;
            }
        }

        // Prioritize smooth, natural English voices with consistent tone
        const preferred =
            voices.find(v => v.lang.startsWith('en') && (v.name.includes('Natural') || v.name.includes('Neural') || v.name.includes('Online'))) ||
            voices.find(v => v.name.includes('Google US English')) ||
            voices.find(v => v.name.includes('Samantha') || v.name.includes('Zira') || v.name.includes('Jenny')) ||
            voices.find(v => v.lang === 'en-US') ||
            voices.find(v => v.lang.startsWith('en')) ||
            voices[0];

        this.voice = preferred || null;
    }

    public getAvailableVoices(): SpeechSynthesisVoice[] {
        if (!this.synthesis) return [];
        return this.synthesis.getVoices().filter(v => v.lang.startsWith('en'));
    }

    public setPreferredVoice(voiceName: string): void {
        if (typeof window !== 'undefined') {
            localStorage.setItem('myway_voice_name', voiceName);
        }
        if (this.synthesis) {
            const voices = this.synthesis.getVoices();
            const found = voices.find(v => v.name === voiceName);
            if (found) this.voice = found;
        }
    }

    public setEnabled(enabled: boolean) {
        this.enabled = enabled;
        if (!enabled) {
            this.cancel();
        }
    }

    public async cancel(): Promise<void> {
        this.isSpeaking = false;
        try {
            if (Capacitor.isNativePlatform()) {
                const { TextToSpeech } = await import('@capacitor-community/text-to-speech');
                await TextToSpeech.stop();
            } else if (this.synthesis) {
                this.synthesis.cancel();
            }
        } catch {
            this.synthesis?.cancel();
        } finally {
            if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('myway-audio-focus-end'));
            }
        }
    }

    public async speak(text: string): Promise<void> {
        if (!this.enabled || !text || !text.trim()) return;

        // Cancel any currently in-flight utterance first to guarantee no voices overlap
        await this.cancel();
        this.isSpeaking = true;

        // Notify audio focus systems to duck background media
        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('myway-audio-focus-start'));
        }

        try {
            // 1. Native Mobile Platform (Android / iOS app)
            if (Capacitor.isNativePlatform()) {
                const { TextToSpeech } = await import('@capacitor-community/text-to-speech');
                await TextToSpeech.speak({
                    text,
                    lang: 'en-US',
                    rate: 1.0,
                    pitch: 1.0,
                    volume: 1.0,
                    category: 'ambient',
                });
                this.isSpeaking = false;
                if (typeof window !== 'undefined') {
                    window.dispatchEvent(new CustomEvent('myway-audio-focus-end'));
                }
                return;
            }

            // 2. Web / Browser Platform (Use pure, unified Web Speech API)
            if (!this.synthesis) {
                this.isSpeaking = false;
                return;
            }

            // Wait for voices to be ready if initial load was async
            if (this.voiceReadyPromise) {
                await this.voiceReadyPromise;
            }

            return new Promise<void>((resolve) => {
                if (!this.synthesis) {
                    this.isSpeaking = false;
                    resolve();
                    return;
                }

                const utterance = new SpeechSynthesisUtterance(text);
                if (this.voice) {
                    utterance.voice = this.voice;
                }

                utterance.lang = 'en-US';
                utterance.pitch = 1.0;
                utterance.rate = 1.05; // Crisp navigation cadence
                utterance.volume = 1.0;

                const finish = () => {
                    this.isSpeaking = false;
                    if (typeof window !== 'undefined') {
                        window.dispatchEvent(new CustomEvent('myway-audio-focus-end'));
                    }
                    resolve();
                };

                utterance.onend = finish;
                utterance.onerror = (e) => {
                    console.warn('[AudioService] Speech utterance error:', e);
                    finish();
                };

                // Safety timeout in case browser drops onend event (common Web Speech API quirk)
                const estimatedMs = Math.max(2000, text.split(' ').length * 450);
                const timer = setTimeout(finish, estimatedMs);

                utterance.onend = () => {
                    clearTimeout(timer);
                    finish();
                };

                this.synthesis.speak(utterance);
            });
        } catch (e) {
            console.warn('[AudioService] Speak error:', e);
            this.isSpeaking = false;
            if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('myway-audio-focus-end'));
            }
        }
    }

    /**
     * Lazy-instantiate or retrieve existing AudioContext with automatic state management.
     */
    private getAudioContext(): AudioContext | null {
        if (typeof window === 'undefined') return null;
        try {
            if (!this.audioCtx) {
                const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
                if (!AudioContextClass) return null;
                this.audioCtx = new AudioContextClass();
            }
            if (this.audioCtx.state === 'suspended') {
                this.audioCtx.resume().catch(() => {});
            }
            return this.audioCtx;
        } catch {
            return null;
        }
    }

    /**
     * Schedules hardware audio context suspension when idle to prevent audio thread leakage and battery drain.
     */
    private scheduleIdleSuspension(): void {
        if (this.suspendTimer) {
            clearTimeout(this.suspendTimer);
        }
        this.suspendTimer = setTimeout(() => {
            if (this.audioCtx && this.audioCtx.state === 'running') {
                this.audioCtx.suspend().catch(() => {});
            }
            this.suspendTimer = null;
        }, this.IDLE_SUSPEND_DELAY_MS);
    }

    /**
     * Play a synthesized audio chirp (e.g. for action abort/cancellation)
     * Reuses the managed AudioContext and schedules suspension upon completion.
     */
    public playChirp(frequency = 520, durationMs = 120): void {
        if (!this.enabled || typeof window === 'undefined') return;
        try {
            const ctx = this.getAudioContext();
            if (!ctx) return;

            const now = ctx.currentTime;
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();

            osc.type = 'sine';
            osc.frequency.setValueAtTime(frequency, now);
            osc.frequency.exponentialRampToValueAtTime(frequency * 0.5, now + durationMs / 1000);

            gain.gain.setValueAtTime(0.2, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + durationMs / 1000);

            osc.connect(gain);
            gain.connect(ctx.destination);

            osc.start(now);
            osc.stop(now + durationMs / 1000);

            // Clean up WebAudio graph nodes when sound finishes to release memory
            osc.onended = () => {
                try {
                    osc.disconnect();
                    gain.disconnect();
                } catch {
                    // Ignore already disconnected nodes
                }
            };

            this.scheduleIdleSuspension();
        } catch (e) {
            // AudioContext not allowed before user gesture or unavailable
        }
    }

    public dispose(): void {
        if (this.suspendTimer) {
            clearTimeout(this.suspendTimer);
            this.suspendTimer = null;
        }
        if (this.audioCtx) {
            this.audioCtx.close().catch(() => {});
            this.audioCtx = null;
        }
    }
}

export const audioService = new AudioService();

