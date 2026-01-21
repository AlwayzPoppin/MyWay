
import { Type, Modality, GoogleGenAI } from "@google/genai";
import { FamilyMember, NavigationRoute, DailyInsight, Place } from "../types";
import { functions } from './firebase';
import { httpsCallable } from 'firebase/functions';

// SECURE: API keys are handled server-side in Firebase Functions
// We use a proxy function to avoid exposing keys in the client bundle.

const callGeminiProxy = async (prompt: any, config?: any, model: string = 'gemini-2.0-flash-exp') => {
  const geminiFn = httpsCallable<
    { prompt: any; config?: any; model?: string },
    { text: string; candidates: any[] }
  >(functions, 'callGeminiAI');

  const result = await geminiFn({ prompt, config, model });
  return result.data;
};

// SECURITY FIX: Direct API key access has been removed to prevent exposure in client bundle.
// The connectCoPilot function now requires a server-side WebSocket proxy which is not yet implemented.
// All other Gemini calls route through the secure callGeminiProxy function.


const withRetry = async <T>(fn: () => Promise<T>, retries = 3, delay = 1000): Promise<T> => {
  try {
    return await fn();
  } catch (e: any) {
    if (e.message?.includes('429') && retries > 0) {
      console.warn(`AI Rate Limited. Retrying in ${delay}ms...`);
      await new Promise(res => setTimeout(res, delay));
      return withRetry(fn, retries - 1, delay * 2);
    }
    throw e;
  }
};

export function encodeAudio(bytes: Uint8Array) {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function decodeAudio(base64: string) {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

export async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const buffer = ctx.createBuffer(1, dataInt16.length, sampleRate);
  const channelData = buffer.getChannelData(0);
  for (let i = 0; i < dataInt16.length; i++) {
    channelData[i] = dataInt16[i] / 32768.0;
  }
  return buffer;
}

export const generateBriefingAudio = async (insights: DailyInsight[]): Promise<string> => {
  const text = insights.map(i => `${i.title}. ${i.description}`).join(' ');
  const prompt = `Read this family safety briefing cheerfully: ${text}`;

  return withRetry(async () => {
    const data = await callGeminiProxy(prompt, {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } },
      },
    });

    return data.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data || "";
  });
};

export const searchPlacesOnMap = async (query: string, currentLoc: { lat: number, lng: number }): Promise<Place[]> => {
  const prompt = `You are a map search engine for the My Way GPS app. 
  User query: "${query}"
  Current vicinity: [${currentLoc.lat}, ${currentLoc.lng}]
  
  Return a JSON list of places. Each place must have:
  - name: string
  - location: {lat, lng}
  - type: 'home' | 'work' | 'school' | 'gym' | 'gas' | 'food' | 'coffee' | 'other' | 'search_result'
  - icon: string (emoji)
  - brandColor: string (hex, optional)
  
  Exclude the user's current location from results.`;

  try {
    const results = await withRetry(async () => {
      const data = await callGeminiProxy(prompt, {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              name: { type: Type.STRING },
              location: {
                type: Type.OBJECT,
                properties: {
                  lat: { type: Type.NUMBER },
                  lng: { type: Type.NUMBER }
                },
                required: ["lat", "lng"]
              },
              type: { type: Type.STRING, enum: ['gas', 'food', 'coffee', 'other'] },
              icon: { type: Type.STRING },
              brandColor: { type: Type.STRING }
            },
            required: ["name", "location", "type", "icon"]
          }
        }
      });
      return JSON.parse(data.text || "[]");
    });

    return results.map((r: any, idx: number) => ({
      ...r,
      id: `discovered-${idx}-${Date.now()}`,
      radius: 0.001
    }));
  } catch (e) {
    console.error("Place Search Error", e);
    return [];
  }
};

export const getRouteToDestination = async (start: { lat: number, lng: number }, endName: string, members: FamilyMember[]): Promise<NavigationRoute> => {
  try {
    const prompt = `Driving from [${start.lat}, ${start.lng}] to ${endName}. Family: ${members.map(m => m.name).join(',')}. Return JSON.`;
    const data = await withRetry(async () => {
      const respData = await callGeminiProxy(prompt, {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            destinationName: { type: Type.STRING },
            destinationLoc: { type: Type.OBJECT, properties: { lat: { type: Type.NUMBER }, lng: { type: Type.NUMBER } }, required: ["lat", "lng"] },
            steps: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  instruction: { type: Type.STRING },
                  distance: { type: Type.STRING },
                  endLocation: {
                    type: Type.OBJECT,
                    properties: { lat: { type: Type.NUMBER }, lng: { type: Type.NUMBER } },
                    required: ["lat", "lng"]
                  }
                },
                required: ["instruction", "distance"]
              }
            },
            totalDistance: { type: Type.STRING },
            totalTime: { type: Type.STRING },
            safetyAdvisory: { type: Type.STRING }
          },
          required: ["destinationName", "destinationLoc", "steps", "totalDistance", "totalTime"]
        }
      });
      return JSON.parse(respData.text || "{}");
    });
    if (!data.steps || !Array.isArray(data.steps) || data.steps.length === 0) {
      throw new Error("Invalid route data received from AI");
    }
    return { ...data, startLoc: start };
  } catch (e) {
    console.error("Routing Error:", e);
    return null as any;
  }
};

export const getFamilyInsights = async (members: FamilyMember[]): Promise<DailyInsight[]> => {
  const context = members.map(m => `${m.name}: ${m.status}, ${m.battery}%`).join('\n');
  return withRetry(async () => {
    const data = await callGeminiProxy(`Insights for: ${context}. Return JSON array.`, {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            description: { type: Type.STRING },
            category: { type: Type.STRING, enum: ['safety', 'efficiency', 'reminder'] }
          },
          required: ["title", "description", "category"]
        }
      }
    });
    return JSON.parse(data.text || "[]");
  });
};

export const askOmni = async (query: string, members: FamilyMember[], history: any[]) => {
  return withRetry(async () => {
    const data = await callGeminiProxy([{ role: 'user', parts: [{ text: query }] }], {
      tools: [{ googleMaps: {} }]
    });
    const links = data.candidates?.[0]?.groundingMetadata?.groundingChunks?.map((c: any) => c.maps ? { title: c.maps.title, uri: c.maps.uri } : null).filter(Boolean);
    return { text: data.text || "", links };
  });
};

export const predictETA = async (member: FamilyMember, dest: string) => {
  return withRetry(async () => {
    const data = await callGeminiProxy(`Predict ETA for ${member.name} to ${dest}.`);
    return data.text || "";
  });
};

export interface SafetyAdvisory {
  title: string;
  description: string;
  severity: 'low' | 'medium' | 'high';
  type: 'weather' | 'traffic' | 'crime' | 'other';
}

export const getSafetyAdvisory = async (loc: { lat: number, lng: number }, context?: string): Promise<SafetyAdvisory | null> => {
  const prompt = `Analyze safety risks at [${loc.lat}, ${loc.lng}]. Context: ${context || 'Driving'}. 
  Return JSON: { title, description, severity, type }.`;

  try {
    return withRetry(async () => {
      const data = await callGeminiProxy(prompt, {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            description: { type: Type.STRING },
            severity: { type: Type.STRING, enum: ['low', 'medium', 'high'] },
            type: { type: Type.STRING, enum: ['weather', 'traffic', 'crime', 'other'] }
          },
          required: ["title", "description", "severity", "type"]
        }
      });

      return JSON.parse(data.text || "null");
    });
  } catch (e) {
    console.error("Safety Advisory Error", e);
    return null;
  }
};

export interface MessageIntent {
  intent: 'ask_location' | 'ask_eta' | 'check_in' | 'none';
  suggestedAction?: string;
}

export const parseMessageIntent = async (text: string): Promise<MessageIntent> => {
  const prompt = `Analyze this family message: "${text}". 
  Is the sender asking for location, ETA, or a check-in? 
  Return JSON: { intent: 'ask_location' | 'ask_eta' | 'check_in' | 'none', suggestedAction: string }.`;

  try {
    return withRetry(async () => {
      const data = await callGeminiProxy(prompt, {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            intent: { type: Type.STRING, enum: ['ask_location', 'ask_eta', 'check_in', 'none'] },
            suggestedAction: { type: Type.STRING }
          },
          required: ["intent"]
        }
      });

      return JSON.parse(data.text || '{"intent":"none"}');
    });
  } catch (e) {
    console.error("Intent Detection Error", e);
    return { intent: 'none' };
  }
};

export const connectCoPilot = (callbacks: any, settings: { personality: 'standard' | 'grok' | 'newyork', gender: 'male' | 'female' } = { personality: 'standard', gender: 'female' }) => {
  // SECURITY FIX: This function previously exposed the Gemini API key in the client bundle.
  // Live streaming requires a server-side WebSocket proxy to keep the API key secure.
  // Until that's implemented, this feature is disabled.
  console.warn('🔒 CoPilot Live: Disabled for security. API key must be protected via server-side proxy.');

  throw new Error('CoPilot Live streaming is temporarily disabled. The feature requires a secure server-side WebSocket proxy to protect the API key.');
};
