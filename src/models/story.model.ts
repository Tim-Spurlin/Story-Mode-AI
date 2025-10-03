export interface VideoSegment {
  topicSummary: string;
  videoPrompt: string;
  characterId?: string;
  startTime: number;
  endTime: number;
}

export interface GeneratedClip {
  segment: VideoSegment;
  blobUrl: string;
}

export interface Progress {
    stage: string;
    total: number;
    current: number;
    message: string;
}

export interface Character {
  id: string;
  name: string;
  description: string;
  photoUrl: string; // Blob URL for local preview
  photoFile: File | null;
}