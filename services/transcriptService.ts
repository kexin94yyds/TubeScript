import { Chapter, TranscriptSegment } from '../types';

export interface TranscriptResult {
  segments: TranscriptSegment[];
  chapters: Chapter[];
  segmentCount: number;
  fallbackLang?: string;
}

interface ChapterMarker {
  title: string;
  start: number;
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

function buildChaptersFromMarkers(segments: TranscriptSegment[], markers: ChapterMarker[]): Chapter[] {
  const normalizedMarkers = markers
    .filter(marker => marker && marker.title && Number.isFinite(marker.start))
    .sort((a, b) => a.start - b.start)
    .filter((marker, index, array) => index === 0 || marker.start !== array[index - 1].start);

  if (normalizedMarkers.length === 0) {
    return [];
  }

  return normalizedMarkers
    .map<Chapter | null>((marker, index) => {
      const nextMarker = normalizedMarkers[index + 1];
      const end = nextMarker ? nextMarker.start : Infinity;
      const content = segments
        .filter(segment => segment.start >= marker.start && segment.start < end)
        .map(segment => segment.text)
        .join(' ')
        .trim();

      if (!content) {
        return null;
      }

      return {
        index: index + 1,
        title: marker.title,
        content,
        startTime: marker.start
      };
    })
    .filter((chapter): chapter is Chapter => chapter !== null);
}

export async function fetchTranscript(videoUrl: string): Promise<TranscriptResult> {
  const response = await fetch(`/api/transcript?url=${encodeURIComponent(videoUrl)}`);
  
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Failed to fetch transcript (${response.status})`);
  }

  const data = await response.json();
  const segments: TranscriptSegment[] = data.segments || [];
  const chapterMarkers: ChapterMarker[] = data.chapters || [];

  if (segments.length === 0) {
    throw new Error('No transcript segments found for this video');
  }

  const chapters = buildChaptersFromMarkers(segments, chapterMarkers);
  const finalChapters = chapters.length > 0 ? chapters : autoChapterize(segments, 'Transcript');

  return {
    segments,
    chapters: finalChapters,
    segmentCount: data.segmentCount,
    fallbackLang: data.fallbackLang
  };
}
