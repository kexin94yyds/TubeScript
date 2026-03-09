export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

export interface Chapter {
  title: string;
  content: string; // Markdown content
  index: number;
  startTime?: number; // Start time in seconds (from real transcript)
}

export interface ProcessingState {
  status: 'idle' | 'fetching_info' | 'transcribing' | 'generating_epub' | 'running_script' | 'completed' | 'error';
  logs: string[];
  progress: number;
  error?: string;
}

export interface VirtualFile {
  name: string;
  type: 'file' | 'directory';
  content?: string;
  children?: VirtualFile[];
  path: string;
}

export interface VideoMetadata {
  id: string;
  title: string;
  author: string;
  thumbnailUrl: string;
}

// Mimicking the ZSH script structure
export interface ProcessedOutput {
  baseDir: string;
  htmlDir: VirtualFile[];
  markdownDir: VirtualFile[];
  txtDir: VirtualFile[];
  fullMarkdown: VirtualFile;
  fullTxt: VirtualFile;
  indexMd: VirtualFile;
  indexTxt: VirtualFile;
}
