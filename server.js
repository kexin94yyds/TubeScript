import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ProxyAgent, setGlobalDispatcher } from 'undici';
import JSZip from 'jszip';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DIST_DIR = path.join(__dirname, 'dist');
const INDEX_HTML = path.join(DIST_DIR, 'index.html');

// Use proxy only when explicitly configured. A hardcoded local proxy breaks cloud deployment.
const PROXY_URL = process.env.https_proxy || process.env.HTTPS_PROXY || process.env.http_proxy || process.env.HTTP_PROXY;
if (PROXY_URL) {
  console.log(`[API] Using proxy: ${PROXY_URL}`);
  const proxyAgent = new ProxyAgent(PROXY_URL);
  setGlobalDispatcher(proxyAgent);
} else {
  console.log('[API] No proxy configured, using direct outbound network');
}

// Now import after proxy is set
const { YoutubeTranscript } = await import('youtube-transcript-plus');

const app = express();
const PORT = Number(process.env.PORT || 3099);

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

// Fetch chapters + metadata from watch page in a single request
async function fetchVideoPageData(videoId) {
  const result = { chapters: [], title: '', author: '', thumbnailUrl: '' };
  try {
    const html = await fetchWatchPageHtml(videoId);
    const playerResponseJson = extractJsonObject(html, 'var ytInitialPlayerResponse =') ||
      extractJsonObject(html, 'ytInitialPlayerResponse =');

    if (!playerResponseJson) return result;

    const playerResponse = JSON.parse(playerResponseJson);
    result.chapters = extractDescriptionChapters(playerResponse);

    // Extract video metadata from playerResponse
    const vd = playerResponse?.videoDetails;
    if (vd) {
      result.title = vd.title || '';
      result.author = vd.author || '';
      const thumbs = vd.thumbnail?.thumbnails;
      if (Array.isArray(thumbs) && thumbs.length > 0) {
        result.thumbnailUrl = thumbs[thumbs.length - 1].url || '';
      }
    }
  } catch (error) {
    console.warn(`[API] Failed to fetch page data for ${videoId}:`, error.message);
  }
  return result;
}

// Backward compat wrapper
async function fetchVideoChapters(videoId) {
  const data = await fetchVideoPageData(videoId);
  return data.chapters;
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

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    hasDist: fs.existsSync(INDEX_HTML)
  });
});

if (fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR));

  app.get(/^(?!\/api).*/, (_req, res) => {
    res.sendFile(INDEX_HTML);
  });
} else {
  console.warn('[API] dist directory not found. Frontend assets are not being served.');
}

app.listen(PORT, () => {
  console.log(`[API] Server running on port ${PORT}`);
});
