import { GoogleGenAI } from "@google/genai";

// Initialize Gemini Client
// Note: process.env.API_KEY is assumed to be available as per instructions.
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });

export const generateSpriteSheet = async (prompt: string): Promise<string> => {
  try {
    const enhancedPrompt = `
      Create a sprite sheet for a game character animation. 
      Subject: ${prompt}.
      Layout: Grid arrangement, separate frames clearly.
      Style: Pixel art or clean 2D vector style.
      Background: Solid distinct color (e.g., bright green or magenta) for easy removal.
    `;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: {
        parts: [
          { text: enhancedPrompt }
        ]
      },
      config: {
        imageConfig: {
            aspectRatio: "1:1" // Defaulting to square for sprite sheets usually works best
        }
      }
    });

    // Find image part
    if (response.candidates && response.candidates[0].content.parts) {
      for (const part of response.candidates[0].content.parts) {
        if (part.inlineData && part.inlineData.data) {
          return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
        }
      }
    }
    
    throw new Error("No image generated.");
  } catch (error) {
    console.error("Gemini Generation Error:", error);
    throw error;
  }
};
