import { GoogleGenAI, Modality } from "@google/genai";

// Initialize Gemini Client
const getClient = () => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    throw new Error("Clé API manquante. L'application ne peut pas fonctionner sans API_KEY.");
  }
  return new GoogleGenAI({ apiKey });
};

// 1. Transcription (Audio -> Text)
export const transcribeAudio = async (
  audioFile: File, 
  prompt: string = "Transcrivez cet audio fidèlement."
): Promise<string> => {
  const ai = getClient();
  
  // Convert File to Base64
  const base64Data = await fileToBase64(audioFile);
  
  // Using gemini-flash-latest for multimodal understanding
  const response = await ai.models.generateContent({
    model: 'gemini-flash-latest', 
    contents: {
      parts: [
        {
          inlineData: {
            mimeType: audioFile.type || 'audio/mp3',
            data: base64Data
          }
        },
        { text: prompt }
      ]
    }
  });

  return response.text || "Aucune transcription générée.";
};

// 2. Text-to-Speech (Text -> Audio)
export const generateSpeech = async (
  text: string, 
  voiceName: string = 'Kore'
): Promise<ArrayBuffer> => {
  const ai = getClient();

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash-preview-tts',
    contents: [{ parts: [{ text: text }] }],
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: voiceName },
        },
      },
    },
  });

  const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!base64Audio) {
    throw new Error("La génération audio a échoué.");
  }

  // Decode base64 to ArrayBuffer
  const binaryString = atob(base64Audio);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
};


// Helper
const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const result = reader.result as string;
      // Remove data:audio/xyz;base64, prefix
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = error => reject(error);
  });
};
