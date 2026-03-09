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
    
    res.json({
      videoId,
      segments,
      segmentCount: segments.length
    });
    
  } catch (error) {
    console.error(`[API] Error fetching transcript:`, error.message);
    
    // Try different languages as fallback
    if (!lang) {
      try {
        console.log(`[API] Retrying with lang=en...`);
        const transcript = await YoutubeTranscript.fetchTranscript(videoId, { lang: 'en' });
        if (transcript && transcript.length > 0) {
          const segments = transcript.map(item => ({
            start: item.offset,
            end: item.offset + item.duration,
            text: item.text.replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/\n/g, ' ').trim()
          })).filter(seg => seg.text);
          
          return res.json({
            videoId,
            segments,
            segmentCount: segments.length,
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
