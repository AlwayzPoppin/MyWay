
/**
 * Audio Service for Web Speech API integration.
 * Provides text-to-speech capabilities for the AI Co-Pilot.
 */

class AudioService {
    private synthesis: SpeechSynthesis;
    private voice: SpeechSynthesisVoice | null = null;
    private enabled: boolean = true;

    constructor() {
        this.synthesis = window.speechSynthesis;
        this.loadVoices();
        if (this.synthesis.onvoiceschanged !== undefined) {
            this.synthesis.onvoiceschanged = () => this.loadVoices();
        }
    }

    private loadVoices() {
        const voices = this.synthesis.getVoices();
        // Try to find a specific "Grok-like" voice (Deep/Google US English)
        this.voice = voices.find(v => v.name === 'Google US English') ||
            voices.find(v => v.name.includes('Google') && v.lang.startsWith('en')) ||
            voices[0];
    }

    private settings: { personality: 'standard' | 'grok' | 'newyork', gender: 'male' | 'female' } = { personality: 'standard', gender: 'female' };

    setEnabled(enabled: boolean) {
        this.enabled = enabled;
    }

    updateSettings(settings: { personality: 'standard' | 'grok' | 'newyork', gender: 'male' | 'female' }) {
        this.settings = settings;
    }

    async speak(text: string) {
        if (!this.enabled || !text) return;

        try {
            // Try Native TTS first (Capacitor)
            // We dynamic import to avoid SSR/Web build issues if package implies native deps
            const { TextToSpeech } = await import('@capacitor-community/text-to-speech');

            // Dynamic tuning based on personality
            const isGrok = this.settings.personality === 'grok';
            const isNY = this.settings.personality === 'newyork';

            const pitch = isGrok ? 0.9 : 1.0;
            const rate = isNY ? 1.2 : (isGrok ? 1.1 : 1.0); // NY is fastest

            await TextToSpeech.speak({
                text,
                lang: 'en-US',
                rate,
                pitch,
                volume: 1.0,
                category: 'ambient',
            });
        } catch (e) {
            // Fallback to Web Speech API
            this.synthesis.cancel();
            const utterance = new SpeechSynthesisUtterance(text);
            if (this.voice) {
                utterance.voice = this.voice;
            }

            const isGrok = this.settings.personality === 'grok';
            const isNY = this.settings.personality === 'newyork';

            utterance.pitch = isGrok ? 0.9 : 1.0;
            utterance.rate = isNY ? 1.25 : (isGrok ? 1.05 : 1.0);
            utterance.volume = 1.0;
            this.synthesis.speak(utterance);
        }
    }

    async cancel() {
        try {
            const { TextToSpeech } = await import('@capacitor-community/text-to-speech');
            await TextToSpeech.stop();
        } catch {
            this.synthesis.cancel();
        }
    }
}

export const audioService = new AudioService();
