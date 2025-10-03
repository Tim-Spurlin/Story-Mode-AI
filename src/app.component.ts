import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { GeminiService } from './services/gemini.service';
import { Character, GeneratedClip, Progress, VideoSegment } from './models/story.model';
import { IconUploadComponent } from './components/icon-upload.component';
import { IconSpinnerComponent } from './components/icon-spinner.component';
import { IconVideoComponent } from './components/icon-video.component';
import { IconErrorComponent } from './components/icon-error.component';
import { IconSettingsComponent } from './components/icon-settings.component';

type AppState = 'idle' | 'processing' | 'complete' | 'error';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, IconUploadComponent, IconSpinnerComponent, IconVideoComponent, IconErrorComponent, IconSettingsComponent],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppComponent {
  private geminiService: GeminiService;
  
  // Players
  @ViewChild('videoPlayer') videoPlayer!: ElementRef<HTMLVideoElement>;
  @ViewChild('audioPlayer') audioPlayer!: ElementRef<HTMLAudioElement>;

  // State
  status = signal<AppState>('idle');
  audioFile = signal<File | null>(null);
  audioUrl = signal<string | null>(null);
  characters = signal<Character[]>([]);
  storyContext = signal<string>('');
  generatedClips = signal<GeneratedClip[]>([]);
  errorMsg = signal<string>('');
  
  // Player State
  private currentClipIndex = signal<number>(0);
  
  // Derived State
  progress = signal<Progress>({ stage: 'Starting', current: 0, total: 1, message: ''});
  progressPercentage = computed(() => {
    const p = this.progress();
    if (p.total === 0) return 0;
    return (p.current / p.total) * 100;
  });
  currentClipUrl = computed(() => this.generatedClips()[this.currentClipIndex()]?.blobUrl ?? '');

  constructor() {
    this.geminiService = inject(GeminiService);

    effect(() => {
      const p = this.geminiService.progress();
      if (p) {
        this.progress.set(p);
      }
    });

    this.addCharacter(); // Start with one character profile
  }

  handleFileChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      const file = input.files[0];
      this.audioFile.set(file);
      this.audioUrl.set(URL.createObjectURL(file));
    }
  }

  handleContextInput(event: Event): void {
    const textarea = event.target as HTMLTextAreaElement;
    this.storyContext.set(textarea.value);
  }

  addCharacter(): void {
    this.characters.update(chars => [
      ...chars,
      { id: `char_${Date.now()}`, name: '', description: '', photoUrl: '', photoFile: null }
    ]);
  }

  removeCharacter(id: string): void {
    this.characters.update(chars => chars.filter(c => c.id !== id));
  }

  updateCharacter(id: string, field: 'name' | 'description', value: string): void {
    this.characters.update(chars =>
      chars.map(c => (c.id === id ? { ...c, [field]: value } : c))
    );
  }

  handleCharacterPhoto(event: Event, id: string): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      const file = input.files[0];
      const photoUrl = URL.createObjectURL(file);
      this.characters.update(chars =>
        chars.map(c => (c.id === id ? { ...c, photoFile: file, photoUrl } : c))
      );
    }
  }

  async generateStory(): Promise<void> {
    if (!this.audioFile()) {
      return;
    }

    this.status.set('processing');
    this.generatedClips.set([]);
    this.errorMsg.set('');

    try {
      const segments = await this.geminiService.transcribeAndSegmentAudio(this.audioFile()!, this.storyContext(), this.characters());
      
      this.progress.set({ stage: 'Generating clips', total: segments.length, current: 0, message: 'Starting video generation...' });

      for (let i = 0; i < segments.length; i++) {
        const segment = segments[i];
        this.progress.update(p => ({ ...p!, current: i, message: `Generating clip ${i + 1}/${segments.length}: ${segment.topicSummary}` }));
        
        const character = this.characters().find(c => c.id === segment.characterId);
        const blobUrl = await this.geminiService.generateVideoClip(segment, character?.photoFile ?? null);
        
        this.generatedClips.update(clips => [...clips, { segment, blobUrl }]);
      }

      this.progress.set({ stage: 'Finished', total: segments.length, current: segments.length, message: 'All clips generated!' });
      this.status.set('complete');

    } catch (error) {
      console.error('Generation failed:', error);
      const message = error instanceof Error ? error.message : String(error);
      this.errorMsg.set(message);
      this.status.set('error');
      this.progress.update(p => p ? { ...p, stage: 'Error', message } : { stage: 'Error', total: 1, current: 1, message });
    }
  }

  playStory(): void {
    if (!this.audioPlayer || !this.videoPlayer || this.generatedClips().length === 0) return;
    
    this.currentClipIndex.set(0);
    this.videoPlayer.nativeElement.src = this.currentClipUrl();
    
    this.audioPlayer.nativeElement.currentTime = 0;
    this.audioPlayer.nativeElement.play();
    this.videoPlayer.nativeElement.play();
  }

  handleVideoEnded(): void {
    const nextIndex = this.currentClipIndex() + 1;
    if (nextIndex < this.generatedClips().length) {
      this.currentClipIndex.set(nextIndex);
      this.videoPlayer.nativeElement.src = this.currentClipUrl();
      this.videoPlayer.nativeElement.play();
    } else {
      // Story finished
      this.audioPlayer.nativeElement.pause();
    }
  }
  
  startOver(): void {
    this.status.set('idle');
    this.audioFile.set(null);
    this.audioUrl.set(null);
    this.storyContext.set('');
    this.characters.set([]);
    this.generatedClips.set([]);
    this.errorMsg.set('');
    this.geminiService?.progress.set(null);
    this.addCharacter();
  }
}
