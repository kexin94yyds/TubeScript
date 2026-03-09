import { GoogleGenAI, Type } from "@google/genai";
import { Chapter } from "../types";

// Initialize Gemini Client
const apiKey = process.env.API_KEY || '';
const ai = new GoogleGenAI({ apiKey });

// Helper to simulate "watching" the video and getting chapters
export const generateMockChapters = async (videoTitle: string): Promise<Chapter[]> => {
  if (!apiKey) {
    console.warn("No API Key provided, returning fallback data");
    return getFallbackChapters(videoTitle);
  }

  try {
    const model = 'gemini-2.5-flash';
    
    // Advanced prompt to force long-form, verbatim-style content
    const prompt = `
      Task: You are a high-fidelity Speech-to-Text engine.
      Target: A YouTube video titled "${videoTitle}".

      Goal: Output the FULL, VERBATIM SPOKEN TRANSCRIPT of this video.

      STRICT GUIDELINES:
      1. **NO SUMMARIES**: Do not summarize. Do not use bullet points. Do not say "The speaker discusses...".
      2. **FIRST PERSON**: Write exactly what the speaker says in the first person ("I", "We"). Use natural speech patterns.
      3. **LANGUAGE**: If the title is Chinese, the transcript MUST be 100% Chinese. If English, use English.
      4. **DETAIL**: Capture every example, every technical concept, every joke, and every tangent. The output should be VERY LONG (simulate a full 10-20 minute speech).
      5. **FORMAT**: Split the continuous speech into logical "Chapters" based on topic shifts, but keep the text within them as continuous prose.

      Example of desired content style:
      "So, a lot of you have been asking me in the comments, 'Is AI actually going to replace us?' and honestly, I've been thinking about this a lot. Just yesterday, I was looking at the code I wrote three years ago and comparing it to what Copilot generates today..."

      Return JSON data with this schema:
      Array of Objects: { title: string, content: string (Raw text/markdown) }
    `;

    const response = await ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        temperature: 0.5, // Lower temperature for more focused, factual adherence to the likely content
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              content: { type: Type.STRING }
            },
            required: ["title", "content"]
          }
        }
      }
    });

    let text = response.text;
    if (!text) throw new Error("No response from Gemini");

    // Clean up potential markdown formatting from the response
    text = text.trim();
    if (text.startsWith('```json')) {
      text = text.replace(/^```json\s*/, '').replace(/\s*```$/, '');
    } else if (text.startsWith('```')) {
      text = text.replace(/^```\s*/, '').replace(/\s*```$/, '');
    }

    const rawChapters = JSON.parse(text);
    return rawChapters.map((ch: any, idx: number) => ({
      index: idx + 1,
      title: ch.title,
      content: ch.content
    }));

  } catch (error) {
    console.error("Gemini API Error:", error);
    // Return a useful error chapter if parsing fails
    return [{
      index: 1,
      title: "Error Generating Transcript",
      content: `Failed to generate transcript. Error details: ${error instanceof Error ? error.message : String(error)}`
    }];
  }
};

const getFallbackChapters = (title: string): Chapter[] => {
  return [
    {
      index: 1,
      title: "Introduction / 开场",
      content: `# Introduction\n\n(Simulation Mode - No API Key)\n\nHello everyone, welcome back to the channel. Today we are diving deep into "${title}". This is a very important topic that affects all of us.\n\n大家好，欢迎回到频道。今天我们要深入探讨"${title}"。这是一个影响我们所有人的重要话题。`
    },
    {
      index: 2,
      title: "Core Analysis / 核心分析",
      content: `# Deep Dive\n\n(This is a placeholder for the verbatim text. In a real generation with an API key, this would be 1000+ words of detailed transcript.)\n\nLet me explain how this works. First, we need to understand the underlying principles...`
    },
    {
      index: 3,
      title: "Conclusion / 结论",
      content: `# Final Thoughts\n\nSo, what is the takeaway here? I think we need to be prepared. Thanks for watching, and don't forget to like and subscribe.`
    }
  ];
};