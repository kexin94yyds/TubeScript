import { Chapter, TranscriptSegment } from '../types';

export interface TranscriptResult {
  segments: TranscriptSegment[];
  chapters: Chapter[];
  segmentCount: number;
  fallbackLang?: string;
}

// Auto-detect chapters from transcript using gap/topic heuristics
function autoChapterize(segments: TranscriptSegment[], videoTitle: string): Chapter[] {
  if (segments.length === 0) return [];

  // Strategy: split into chapters every ~3 minutes or at long pauses (>5s gap)
  const CHAPTER_INTERVAL = 180; // 3 minutes
  const LONG_PAUSE_THRESHOLD = 5; // 5 seconds gap

  const chapters: Chapter[] = [];
  let currentSegments: TranscriptSegment[] = [];
  let chapterStart = segments[0].start;
  let chapterIndex = 1;
  let lastEnd = segments[0].start;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const timeSinceChapterStart = seg.start - chapterStart;
    const gapFromLast = seg.start - lastEnd;

    // Start new chapter if: time interval exceeded OR long pause detected
    const shouldSplit = currentSegments.length > 0 && (
      (timeSinceChapterStart >= CHAPTER_INTERVAL && gapFromLast > 1) ||
      gapFromLast >= LONG_PAUSE_THRESHOLD
    );

    if (shouldSplit) {
      const content = currentSegments.map(s => s.text).join(' ');
      chapters.push({
        index: chapterIndex,
        title: chapterIndex === 1 ? 'Intro' : `Part ${chapterIndex}`,
        content,
        startTime: chapterStart
      });
      chapterIndex++;
      currentSegments = [];
      chapterStart = seg.start;
    }

    currentSegments.push(seg);
    lastEnd = seg.end;
  }

  // Last chapter
  if (currentSegments.length > 0) {
    const content = currentSegments.map(s => s.text).join(' ');
    chapters.push({
      index: chapterIndex,
      title: chapters.length === 0 ? 'Intro' : `Part ${chapterIndex}`,
      content,
      startTime: chapterStart
    });
  }

  // If only 1 chapter, just use the video title
  if (chapters.length === 1) {
    chapters[0].title = videoTitle;
  }

  return chapters;
}

export async function fetchTranscript(videoUrl: string): Promise<TranscriptResult> {
  const response = await fetch(`/api/transcript?url=${encodeURIComponent(videoUrl)}`);
  
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Failed to fetch transcript (${response.status})`);
  }

  const data = await response.json();
  const segments: TranscriptSegment[] = data.segments || [];

  if (segments.length === 0) {
    throw new Error('No transcript segments found for this video');
  }

  // Auto-generate chapters from segments
  // In future, could also try to extract YouTube chapters from video description
  const chapters = autoChapterize(segments, 'Transcript');

  return {
    segments,
    chapters,
    segmentCount: data.segmentCount,
    fallbackLang: data.fallbackLang
  };
}
