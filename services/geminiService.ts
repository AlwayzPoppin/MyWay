
import { GoogleGenAI, Type, Modality } from "@google/genai";
import { FamilyMember, NavigationRoute, DailyInsight, Place } from "../types";

const getAi = () => new GoogleGenAI({ apiKey: process.env.API_KEY });

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
  
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-preview-tts",
    contents: [{ parts: [{ text: prompt }] }],
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } },
      },
    },
  });

  return response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data || "";
};

export const searchPlacesOnMap = async (query: string, currentLoc: {lat: number, lng: number}): Promise<Place[]> => {
  const ai = getAi();
  const prompt = `Find 5 ${query} near [${currentLoc.lat}, ${currentLoc.lng}]. Return a JSON list of places. Each place must have name, location {lat, lng}, type (gas, food, coffee, other), and icon (emoji). Include brand colors if known.`;
  
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
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
    const results = JSON.parse(response.text || "[]");
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

export const getRouteToDestination = async (start: {lat: number, lng: number}, endName: string, members: FamilyMember[]): Promise<NavigationRoute> => {
  const ai = getAi();
  const prompt = `Driving from [${start.lat}, ${start.lng}] to ${endName}. Family: ${members.map(m=>m.name).join(',')}. Return JSON.`;
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: prompt,
    config: { 
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          destinationName: { type: Type.STRING },
          destinationLoc: { type: Type.OBJECT, properties: { lat: { type: Type.NUMBER }, lng: { type: Type.NUMBER } }, required: ["lat", "lng"] },
          steps: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { instruction: { type: Type.STRING }, distance: { type: Type.STRING } } } },
          totalDistance: { type: Type.STRING },
          totalTime: { type: Type.STRING },
          safetyAdvisory: { type: Type.STRING }
        },
        required: ["destinationName", "destinationLoc", "steps", "totalDistance", "totalTime"]
      }
    }
  });
  return JSON.parse(response.text || "{}");
};

export const getFamilyInsights = async (members: FamilyMember[]): Promise<DailyInsight[]> => {
  const ai = getAi();
  const context = members.map(m => `${m.name}: ${m.status}, ${m.battery}%`).join('\n');
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
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
};

export const askOmni = async (query: string, members: FamilyMember[], history: any[]) => {
  const ai = getAi();
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [{ role: 'user', parts: [{ text: query }] }],
    config: { tools: [{ googleMaps: {} }] },
  });
  const links = response.candidates?.[0]?.groundingMetadata?.groundingChunks?.map((c: any) => c.maps ? { title: c.maps.title, uri: c.maps.uri } : null).filter(Boolean);
  return { text: response.text || "", links };
};

export const predictETA = async (member: FamilyMember, dest: string) => {
  const ai = getAi();
  const resp = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: `Predict ETA for ${member.name} to ${dest}.`,
  });
  return resp.text || "";
};

export const connectCoPilot = (callbacks: any) => {
  const ai = getAi();
  return ai.live.connect({
    model: 'gemini-2.5-flash-native-audio-preview-12-2025',
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } } },
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
