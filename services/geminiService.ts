
import { GoogleGenAI, Type, Modality } from "@google/genai";
import { FamilyMember, NavigationRoute, DailyInsight, Place } from "../types";

const getAi = () => {
  const key = (import.meta as any).env.VITE_GEMINI_API_KEY;
  if (!key) {
    console.warn("VITE_GEMINI_API_KEY is not defined");
  }
  return new GoogleGenAI({ apiKey: key || '' });
};

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
  const ai = getAi();
  const text = insights.map(i => `${i.title}. ${i.description}`).join(' ');
  const prompt = `Read this family safety briefing cheerfully: ${text}`;

  return withRetry(async () => {
    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash-exp",
      contents: [{ parts: [{ text: prompt }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } },
        },
      },
    });

    return response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data || "";
  });
};

export const searchPlacesOnMap = async (query: string, currentLoc: { lat: number, lng: number }): Promise<Place[]> => {
  const ai = getAi();
  const prompt = `You are a map search engine for the MyWay GPS app. 
  User query: "${query}"
  Current vicinity: [${currentLoc.lat}, ${currentLoc.lng}]
  
  If the query is a specific address or a famous landmark, find its exact coordinates. 
  If it's a category (like "coffee" or "gas"), find 5 of the best/closest options.
  
  Return a JSON list of places. Each place must have:
  - name: string
  - location: {lat, lng}
  - type: 'home' | 'work' | 'school' | 'gym' | 'gas' | 'food' | 'coffee' | 'other' | 'search_result'
  - icon: string (emoji)
  - brandColor: string (hex, optional)
  
  Exclude the user's current location from results.`;

  try {
    const results = await withRetry(async () => {
      const response = await ai.models.generateContent({
        model: 'gemini-2.0-flash-exp',
        contents: prompt,
        config: {
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
        }
      });
      return JSON.parse(response.text || "[]");
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
    const ai = getAi();
    const prompt = `Driving from [${start.lat}, ${start.lng}] to ${endName}. Family: ${members.map(m => m.name).join(',')}. Return JSON.`;
    const data = await withRetry(async () => {
      const response = await ai.models.generateContent({
        model: 'gemini-2.0-flash-exp',
        contents: prompt,
        config: {
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
                  required: ["instruction", "distance"] // endLocation optional for resilience
                }
              },
              totalDistance: { type: Type.STRING },
              totalTime: { type: Type.STRING },
              safetyAdvisory: { type: Type.STRING }
            },
            required: ["destinationName", "destinationLoc", "steps", "totalDistance", "totalTime"]
          }
        }
      });
      return JSON.parse(response.text || "{}");
    });
    if (!data.steps || !Array.isArray(data.steps) || data.steps.length === 0) {
      throw new Error("Invalid route data received from AI");
    }
    return data;
  } catch (e) {
    console.error("Routing Error:", e);
    return null as any;
  }
};

export const getFamilyInsights = async (members: FamilyMember[]): Promise<DailyInsight[]> => {
  const ai = getAi();
  const context = members.map(m => `${m.name}: ${m.status}, ${m.battery}%`).join('\n');
  return withRetry(async () => {
    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash-exp',
      contents: `Insights for: ${context}. Return JSON array.`,
      config: {
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
      }
    });
    return JSON.parse(response.text || "[]");
  });
};

export const askOmni = async (query: string, members: FamilyMember[], history: any[]) => {
  const ai = getAi();
  return withRetry(async () => {
    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash-exp",
      contents: [{ role: 'user', parts: [{ text: query }] }],
      config: { tools: [{ googleMaps: {} }] },
    });
    const links = response.candidates?.[0]?.groundingMetadata?.groundingChunks?.map((c: any) => c.maps ? { title: c.maps.title, uri: c.maps.uri } : null).filter(Boolean);
    return { text: response.text || "", links };
  });
};

export const predictETA = async (member: FamilyMember, dest: string) => {
  const ai = getAi();
  return withRetry(async () => {
    const resp = await ai.models.generateContent({
      model: 'gemini-2.0-flash-exp',
      contents: `Predict ETA for ${member.name} to ${dest}.`,
    });
    return resp.text || "";
  });
};

export interface SafetyAdvisory {
  title: string;
  description: string;
  severity: 'low' | 'medium' | 'high';
  type: 'weather' | 'traffic' | 'crime' | 'other';
}

export const getSafetyAdvisory = async (loc: { lat: number, lng: number }, context?: string): Promise<SafetyAdvisory | null> => {
  const ai = getAi();
  const prompt = `Analyze safety risks at [${loc.lat}, ${loc.lng}]. Context: ${context || 'Driving'}. 
  Include weather (mock potential local weather if not provided) and general traffic risks.
  Return JSON: { title, description, severity, type }. High severity only for immediate danger.`;

  try {
    return withRetry(async () => {
      const response = await ai.models.generateContent({
        model: 'gemini-2.0-flash-exp',
        contents: prompt,
        config: {
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
        }
      });

      return JSON.parse(response.text || "null");
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
  const ai = getAi();
  const prompt = `Analyze this family message: "${text}". 
  Is the sender asking for location, ETA, or a check-in? 
  Return JSON: { intent: 'ask_location' | 'ask_eta' | 'check_in' | 'none', suggestedAction: string (short label like "Share ETA") }.`;

  try {
    return withRetry(async () => {
      const response = await ai.models.generateContent({
        model: 'gemini-2.0-flash-exp',
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              intent: { type: Type.STRING, enum: ['ask_location', 'ask_eta', 'check_in', 'none'] },
              suggestedAction: { type: Type.STRING }
            },
            required: ["intent"]
          }
        }
      });

      return JSON.parse(response.text || '{"intent":"none"}');
    });
  } catch (e) {
    console.error("Intent Detection Error", e);
    return { intent: 'none' };
  }
};

export const connectCoPilot = (callbacks: any, settings: { personality: 'standard' | 'grok' | 'newyork', gender: 'male' | 'female' } = { personality: 'standard', gender: 'female' }) => {
  const ai = getAi();

  // Voice Mapping (Gemini 2.0 Models)
  const voiceMap = {
    standard: { male: 'Fenrir', female: 'Kore' },
    grok: { male: 'Zephyr', female: 'Aoede' },
    newyork: { male: 'Orion', female: 'Puck' }
  };
  const selectedVoice = voiceMap[settings.personality][settings.gender];

  // Personality Mapping
  const instructions = {
    standard: `You are MyWay Co-Pilot, a helpful and safety-conscious driving assistant.
               - Keep alerts brief and clear.
               - Prioritize safety above all else.
               - Maintain a professional, calm demeanor.`,
    grok: `You are MyWay Grok, a witty, edgy, and brutally honest AI Co-Pilot. 
           - Speak concisely and punchily. No long monologues.
           - Use sarcasm when appropriate, especially for bad driving.
           - If the user is safe, complement them with dry wit.
           - Keep it cool, calm, and slightly detached.`,
    newyork: `You are MyWay NY, a fast-talking, no-nonsense New York driving assistant.
              - Speak fast and direct. Time is money.
              - Don't sugarcoat safety alerts. "Yo, watch the road!"
              - If traffic is bad, commiserate with typical NY frustration.
              - Be helpful but brisk. You got places to be.`
  };

  return ai.live.connect({
    model: 'gemini-2.0-flash-exp',
    config: {
      systemInstruction: {
        parts: [{ text: instructions[settings.personality] }]
      },
      responseModalities: [Modality.AUDIO],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: selectedVoice } } },
      inputAudioTranscription: {},
      outputAudioTranscription: {},
    },
    callbacks: {
      onmessage: async (msg) => {
        if (msg.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data) callbacks.onAudio(msg.serverContent.modelTurn.parts[0].inlineData.data);
        if (msg.serverContent?.interrupted) callbacks.onInterrupted();
        if (msg.serverContent?.outputTranscription) callbacks.onTranscription(msg.serverContent.outputTranscription.text, false);
        if (msg.serverContent?.inputTranscription) callbacks.onTranscription(msg.serverContent.inputTranscription.text, true);
        if (msg.toolCall && callbacks.onFunctionCall) {
          for (const fc of msg.toolCall.functionCalls) {
            const result = await callbacks.onFunctionCall(fc);
          }
        }
      }
    }
  });
};
