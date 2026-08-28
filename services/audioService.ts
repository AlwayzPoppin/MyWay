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
     * Play a synthesized audio chirp (e.g. for action abort/cancellation)
     */
    public playChirp(frequency = 520, durationMs = 120): void {
        if (!this.enabled || typeof window === 'undefined') return;
        try {
            const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
            if (!AudioCtx) return;
            const ctx = new AudioCtx();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();

            osc.type = 'sine';
            osc.frequency.setValueAtTime(frequency, ctx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(frequency * 0.5, ctx.currentTime + durationMs / 1000);

            gain.gain.setValueAtTime(0.2, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + durationMs / 1000);

            osc.connect(gain);
            gain.connect(ctx.destination);

            osc.start();
            osc.stop(ctx.currentTime + durationMs / 1000);
        } catch (e) {
            // AudioContext not allowed before user gesture or unavailable
        }
    }
}

export const audioService = new AudioService();

