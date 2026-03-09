import express from 'express';
import cors from 'cors';
import { ProxyAgent, setGlobalDispatcher } from 'undici';

// Use system proxy for YouTube access
const PROXY_URL = process.env.https_proxy || process.env.HTTPS_PROXY || process.env.http_proxy || process.env.HTTP_PROXY || 'http://127.0.0.1:7897';
console.log(`[API] Using proxy: ${PROXY_URL}`);
const proxyAgent = new ProxyAgent(PROXY_URL);
setGlobalDispatcher(proxyAgent);

// Now import after proxy is set
const { YoutubeTranscript } = await import('youtube-transcript-plus');

const app = express();
const PORT = 3099;

app.use(cors());
app.use(express.json());

// Extract video ID from various YouTube URL formats
function extractVideoId(url) {
  if (!url) return null;
  // Already a video ID (11 chars)
  if (/^[a-zA-Z0-9_-]{11}$/.test(url)) return url;
  
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes('youtu.be')) {
      return parsed.pathname.slice(1).split('/')[0];
    }
    if (parsed.hostname.includes('youtube.com')) {
      return parsed.searchParams.get('v');
    }
  } catch (e) {
    // Not a valid URL
  }
  
  // Regex fallback
  const match = url.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  return match ? match[1] : null;
}

function extractJsonObject(source, marker) {
  const markerIndex = source.indexOf(marker);
  if (markerIndex === -1) return null;

  const startIndex = source.indexOf('{', markerIndex);
  if (startIndex === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = startIndex; i < source.length; i++) {
    const char = source[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === '{') {
      depth += 1;
      continue;
    }

    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(startIndex, i + 1);
      }
    }
  }

  return null;
}

async function fetchWatchPageHtml(videoId) {
  const watchUrl = `https://www.youtube.com/watch?v=${videoId}&hl=en`;
  const response = await fetch(watchUrl, {
    headers: {
      'accept-language': 'en-US,en;q=0.9',
      'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36'
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch watch page (${response.status})`);
  }

  return await response.text();
}

function extractDescriptionChapters(playerResponse) {
  const markersMap = playerResponse?.playerOverlays?.playerOverlayRenderer
    ?.decoratedPlayerBarRenderer?.decoratedPlayerBarRenderer?.playerBar
    ?.multiMarkersPlayerBarRenderer?.markersMap;

  if (!Array.isArray(markersMap)) {
    return [];
  }

  for (const marker of markersMap) {
    if (marker?.key !== 'DESCRIPTION_CHAPTERS') {
      continue;
    }

    const chapterMarkers = marker.value?.chapters || [];
    const chapters = chapterMarkers
      .map((chapter) => {
        const renderer = chapter?.chapterRenderer;
        const title = (renderer?.title?.simpleText || '').trim();
        const start = Number(renderer?.timeRangeStartMillis || 0) / 1000;
        if (!title || !Number.isFinite(start)) {
          return null;
        }
        return { title, start };
      })
      .filter(Boolean);

    if (chapters.length > 0) {
      return chapters;
    }
  }

  return [];
}

async function fetchVideoChapters(videoId) {
  try {
    const html = await fetchWatchPageHtml(videoId);
    const playerResponseJson = extractJsonObject(html, 'var ytInitialPlayerResponse =') ||
      extractJsonObject(html, 'ytInitialPlayerResponse =');

    if (!playerResponseJson) {
      return [];
    }

    const playerResponse = JSON.parse(playerResponseJson);
    return extractDescriptionChapters(playerResponse);
  } catch (error) {
    console.warn(`[API] Failed to fetch chapters for ${videoId}:`, error.message);
    return [];
  }
}

// GET /api/transcript?url=YOUTUBE_URL&lang=zh
app.get('/api/transcript', async (req, res) => {
  const { url, lang } = req.query;
  
  if (!url) {
    return res.status(400).json({ error: 'Missing url parameter' });
  }
  
  const videoId = extractVideoId(url);
  if (!videoId) {
    return res.status(400).json({ error: 'Invalid YouTube URL' });
  }
  
  try {
    console.log(`[API] Fetching transcript for video: ${videoId}, lang: ${lang || 'auto'}`);
    
    const options = {};
    if (lang) {
      options.lang = lang;
    }
    
    const transcript = await YoutubeTranscript.fetchTranscript(videoId, options);
    const chapters = await fetchVideoChapters(videoId);
    
    if (!transcript || transcript.length === 0) {
      return res.status(404).json({ error: 'No transcript available for this video' });
    }
    
    // Normalize transcript data format (offset/duration already in seconds)
    const segments = transcript.map(item => ({
      start: item.offset,
      end: item.offset + item.duration,
      text: item.text.replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/\n/g, ' ').trim()
    })).filter(seg => seg.text);
    
    console.log(`[API] Got ${segments.length} segments`);
    console.log(`[API] Got ${chapters.length} chapters`);
    
    res.json({
      videoId,
      segments,
      segmentCount: segments.length,
      chapters
    });
    
  } catch (error) {
    console.error(`[API] Error fetching transcript:`, error.message);
    
    // Try different languages as fallback
    if (!lang) {
      try {
        console.log(`[API] Retrying with lang=en...`);
        const transcript = await YoutubeTranscript.fetchTranscript(videoId, { lang: 'en' });
        if (transcript && transcript.length > 0) {
          const chapters = await fetchVideoChapters(videoId);
          const segments = transcript.map(item => ({
            start: item.offset,
            end: item.offset + item.duration,
            text: item.text.replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/\n/g, ' ').trim()
          })).filter(seg => seg.text);
          
          return res.json({
            videoId,
            segments,
            segmentCount: segments.length,
            chapters,
            fallbackLang: 'en'
          });
        }
      } catch (retryError) {
        console.error(`[API] Retry also failed:`, retryError.message);
      }
    }
    
    res.status(500).json({ 
      error: 'Failed to fetch transcript',
      detail: error.message 
    });
  }
});

app.listen(PORT, () => {
  console.log(`[API] Transcript server running at http://localhost:${PORT}`);
});
