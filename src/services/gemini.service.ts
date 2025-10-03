import { Injectable, signal } from '@angular/core';
import { GoogleGenAI, Type, Content } from '@google/genai';
import { Progress, VideoSegment, Character } from '../models/story.model';

@Injectable({
  providedIn: 'root'
})
export class GeminiService {
  progress = signal<Progress | null>(null);

  constructor() {
    // API keys are managed via environment variables.
  }

  private async fileToGenerativePart(file: File) {
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve((reader.result as string).split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    return { inlineData: { data: base64, mimeType: file.type } };
  }

  async transcribeAndSegmentAudio(audioFile: File, storyContext: string, characters: Character[]): Promise<VideoSegment[]> {
    const ai = new GoogleGenAI({ apiKey: (process as any).env.API_KEY });

    this.progress.set({ stage: 'Analyzing audio', current: 0, total: 1, message: 'Transcribing and creating scenes...' });

    const audioPart = await this.fileToGenerativePart(audioFile);
    const characterDescriptions = characters.map(c => `- ${c.name} (${c.id}): ${c.description}`).join('\n');

    const systemInstruction = `You are a film director's assistant. Your task is to analyze an audio file and create a synchronized visual story.
1. Transcribe the audio verbatim.
2. Analyze the transcript and break it down into short, visually distinct video segments.
3. Each segment's duration must be between 5 and 8 seconds to feel natural and not rushed.
4. For each segment, provide the precise 'startTime' and 'endTime' in seconds from the audio.
5. For each segment, provide a concise 'topicSummary' and a detailed 'videoPrompt' for an AI video generator.
6. If a specific character is the main focus, identify them by their 'characterId'.
7. The final output must be a valid JSON array of objects.

Character Descriptions:
${characterDescriptions}

Story Context:
${storyContext || 'No additional context provided.'}
`;

    try {
      const contents: Content[] = [{ parts: [{text: systemInstruction}, audioPart] }];

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                topicSummary: {
                  type: Type.STRING,
                  description: 'A brief summary of what happens in this segment.',
                },
                videoPrompt: {
                  type: Type.STRING,
                  description: 'A detailed, vivid visual prompt for the AI video generator. Describe the scene, character actions, emotions, and camera angle. Include character names where applicable.',
                },
                characterId: {
                  type: Type.STRING,
                  description: 'The ID of the character who is the main focus of this segment. Use one of the provided character IDs. If no single character is the focus, omit this field.',
                },
                startTime: {
                    type: Type.NUMBER,
                    description: "The start time of this segment in seconds."
                },
                endTime: {
                    type: Type.NUMBER,
                    description: "The end time of this segment in seconds."
                }
              },
              required: ['topicSummary', 'videoPrompt', 'startTime', 'endTime'],
            },
          },
        },
      });

      const jsonStr = response.text.trim().replace(/```json|```/g, '');
      const segments = JSON.parse(jsonStr) as VideoSegment[];
      this.progress.set({ stage: 'Analyzing audio', current: 1, total: 1, message: 'Audio analysis complete.' });
      return segments;
    } catch (error) {
      console.error('Error processing audio:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.progress.set({ stage: 'Error', current: 1, total: 1, message: `Failed to analyze audio: ${errorMessage}` });
      throw new Error(`Failed to analyze audio: ${errorMessage}`);
    }
  }

  async generateVideoClip(segment: VideoSegment, characterPhoto: File | null): Promise<string> {
    const apiKey = (process as any).env.API_KEY;
    if (!apiKey) {
      throw new Error('API Key is not available. Ensure the API_KEY environment variable is set.');
    }
    const ai = new GoogleGenAI({ apiKey });

    let imagePart;
    if (characterPhoto) {
      const base64Image = await this.fileToBase64(characterPhoto);
      imagePart = {
        imageBytes: base64Image,
        mimeType: characterPhoto.type,
      };
    }

    const duration = Math.round(segment.endTime - segment.startTime);
    const clipDuration = Math.max(5, Math.min(8, duration));

    let operation;
    try {
      operation = await ai.models.generateVideos({
        model: 'veo-2.0-generate-001',
        prompt: segment.videoPrompt,
        image: imagePart,
        config: {
          numberOfVideos: 1,
          aspectRatio: '16:9',
          durationSeconds: clipDuration,
          personGeneration: 'ALLOW_ALL' as const,
        }
      });
    } catch (error) {
        console.error('Error starting video generation:', error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to start video generation: ${errorMessage}`);
    }

    let wait = 5000;
    const deadline = Date.now() + 10 * 60 * 1000;

    while (!operation.done) {
      if (Date.now() > deadline) {
        throw new Error('Video generation timed out after 10 minutes.');
      }
      await new Promise(resolve => setTimeout(resolve, wait));
      wait = Math.min(wait * 1.5, 15000);

      try {
          operation = await ai.operations.getVideosOperation({ operation });
      } catch (error) {
          console.error('Error polling video generation status:', error);
          const errorMessage = error instanceof Error ? error.message : String(error);
          throw new Error(`Polling for video failed: ${errorMessage}`);
      }
    }

    if (operation.error) {
        throw new Error(`Video generation failed: ${operation.error.message}`);
    }

    const downloadLink = operation.response?.generatedVideos?.[0]?.video?.uri;
    if (!downloadLink) {
      throw new Error('Video generation succeeded, but no download link was returned.');
    }

    try {
        const response = await fetch(`${downloadLink}&key=${apiKey}`);
        if (!response.ok) {
            throw new Error(`Failed to download video: ${response.statusText}`);
        }
        const blob = await response.blob();
        return URL.createObjectURL(blob);
    } catch (error) {
        console.error('Error downloading video:', error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        throw new Error(`Downloading video failed: ${errorMessage}`);
    }
  }

  private fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        resolve(result.split(',')[1]);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }
}