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

function decodeHtmlEntities(text) {
  return String(text || '')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#10;/g, '\n')
    .replace(/\s+/g, ' ')
    .trim();
}

function selectPreferredCaptionTrack(captionTracks, requestedLang) {
  if (!Array.isArray(captionTracks) || captionTracks.length === 0) {
    return null;
  }

  const requested = typeof requestedLang === 'string' ? requestedLang.toLowerCase() : '';
  const priorities = requested ? [requested] : ['zh-hans', 'zh-hant', 'zh', 'en'];

  for (const language of priorities) {
    const exact = captionTracks.find((track) =>
      typeof track?.languageCode === 'string' &&
      track.languageCode.toLowerCase() === language &&
      !track.kind
    );
    if (exact) return exact;
  }

  for (const language of priorities) {
    const fuzzy = captionTracks.find((track) =>
      typeof track?.languageCode === 'string' &&
      track.languageCode.toLowerCase().startsWith(language)
    );
    if (fuzzy) return fuzzy;
  }

  return captionTracks.find((track) => !track.kind) || captionTracks[0];
}

function buildTranscriptCandidateUrls(baseUrl) {
  if (typeof baseUrl !== 'string' || !baseUrl.trim()) {
    return [];
  }

  const formats = [null, 'json3', 'srv3'];
  const urls = [];

  for (const format of formats) {
    try {
      const url = new URL(baseUrl);
      if (format) {
        url.searchParams.set('fmt', format);
      }
      const href = url.toString();
      if (!urls.includes(href)) {
        urls.push(href);
      }
    } catch (error) {
      console.warn('[API] Failed to build transcript URL:', error.message);
    }
  }

  return urls;
}

function parseJson3Transcript(jsonText) {
  const data = JSON.parse(jsonText);
  const events = Array.isArray(data?.events) ? data.events : [];

  return events.map((event) => {
    const segs = Array.isArray(event?.segs) ? event.segs : [];
    const text = segs.map((seg) => seg?.utf8 || '').join('');
    const startMs = Number(event?.tStartMs);
    const durationMs = Number(event?.dDurationMs);

    return {
      start: startMs / 1000,
      end: startMs / 1000 + (Number.isFinite(durationMs) ? durationMs / 1000 : 3),
      text: decodeHtmlEntities(text)
    };
  }).filter((segment) => Number.isFinite(segment.start) && segment.text);
}

function parseXmlTranscript(xmlText) {
  const segments = [];
  const textMatches = Array.from(xmlText.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/g));

  if (textMatches.length > 0) {
    for (const [, attrs, content] of textMatches) {
      const start = Number(attrs.match(/\bstart="([^"]+)"/)?.[1] || '');
      const duration = Number(attrs.match(/\bdur="([^"]+)"/)?.[1] || '3');
      const text = decodeHtmlEntities(content.replace(/<[^>]+>/g, ''));

      if (Number.isFinite(start) && text) {
        segments.push({
          start,
          end: start + (Number.isFinite(duration) ? duration : 3),
          text
        });
      }
    }

    return segments;
  }

  const paragraphMatches = Array.from(xmlText.matchAll(/<p\b([^>]*)>([\s\S]*?)<\/p>/g));
  for (const [, attrs, content] of paragraphMatches) {
    const startMs = Number(attrs.match(/\bt="([^"]+)"/)?.[1] || '');
    const durationMs = Number(attrs.match(/\bd="([^"]+)"/)?.[1] || '3000');
    const segMatches = Array.from(content.matchAll(/<s\b[^>]*>([\s\S]*?)<\/s>/g));
    const rawText = segMatches.length > 0
      ? segMatches.map((match) => match[1]).join('')
      : content.replace(/<[^>]+>/g, '');
    const text = decodeHtmlEntities(rawText);

    if (Number.isFinite(startMs) && text) {
      segments.push({
        start: startMs / 1000,
        end: startMs / 1000 + (Number.isFinite(durationMs) ? durationMs / 1000 : 3),
        text
      });
    }
  }

  return segments;
}

function parseTranscriptPayload(payloadText) {
  const trimmed = typeof payloadText === 'string' ? payloadText.trim() : '';
  if (!trimmed) {
    return [];
  }

  try {
    if (trimmed.startsWith('{')) {
      return parseJson3Transcript(trimmed);
    }
    return parseXmlTranscript(trimmed);
  } catch (error) {
    console.warn('[API] Failed to parse transcript payload:', error.message);
    return [];
  }
}

async function fetchTranscriptPayload(url) {
  const response = await fetch(url, {
    headers: {
      'accept-language': 'en-US,en;q=0.9',
      'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36'
    }
  });

  if (!response.ok) {
    throw new Error(`Transcript track request failed (${response.status})`);
  }

  return await response.text();
}

// Fetch chapters + metadata from watch page in a single request
async function fetchVideoPageData(videoId) {
  const result = { chapters: [], title: '', author: '', thumbnailUrl: '', playerResponse: null };
  try {
    const html = await fetchWatchPageHtml(videoId);
    const playerResponseJson = extractJsonObject(html, 'var ytInitialPlayerResponse =') ||
      extractJsonObject(html, 'ytInitialPlayerResponse =');

    if (!playerResponseJson) return result;

    const playerResponse = JSON.parse(playerResponseJson);
    result.playerResponse = playerResponse;
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

async function fetchTranscriptViaCaptionTracks(videoId, requestedLang) {
  const pageData = await fetchVideoPageData(videoId);
  const playerResponse = pageData.playerResponse;
  const captionTracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;

  if (!Array.isArray(captionTracks) || captionTracks.length === 0) {
    return {
      segments: [],
      chapters: pageData.chapters,
      languageCode: null
    };
  }

  const selectedTrack = selectPreferredCaptionTrack(captionTracks, requestedLang);
  if (!selectedTrack?.baseUrl) {
    return {
      segments: [],
      chapters: pageData.chapters,
      languageCode: null
    };
  }

  const candidateUrls = buildTranscriptCandidateUrls(selectedTrack.baseUrl);
  for (const candidateUrl of candidateUrls) {
    try {
      const payloadText = await fetchTranscriptPayload(candidateUrl);
      const segments = parseTranscriptPayload(payloadText);
      if (segments.length > 0) {
        return {
          segments,
          chapters: pageData.chapters,
          languageCode: selectedTrack.languageCode || null
        };
      }
    } catch (error) {
      console.warn(`[API] Caption track fetch failed for ${candidateUrl}:`, error.message);
    }
  }

  return {
    segments: [],
    chapters: pageData.chapters,
    languageCode: selectedTrack.languageCode || null
  };
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

    const captionTrackResult = await fetchTranscriptViaCaptionTracks(videoId, lang);
    if (captionTrackResult.segments.length > 0) {
      console.log(`[API] Got ${captionTrackResult.segments.length} segments via captionTracks`);
      console.log(`[API] Got ${captionTrackResult.chapters.length} chapters via watch page`);

      return res.json({
        videoId,
        segments: captionTrackResult.segments,
        segmentCount: captionTrackResult.segments.length,
        chapters: captionTrackResult.chapters,
        fallbackLang: !lang && captionTrackResult.languageCode ? captionTrackResult.languageCode : undefined
      });
    }

    const options = {};
    if (lang) {
      options.lang = lang;
    }
    
    const transcript = await YoutubeTranscript.fetchTranscript(videoId, options);
    const chapters = captionTrackResult.chapters.length > 0
      ? captionTrackResult.chapters
      : await fetchVideoChapters(videoId);
    
    if (!transcript || transcript.length === 0) {
      return res.status(404).json({ error: 'No transcript available for this video' });
    }
    
    // Normalize transcript data format (offset/duration already in seconds)
    const segments = transcript.map(item => ({
      start: item.offset,
      end: item.offset + item.duration,
      text: decodeHtmlEntities((item.text || '').replace(/\n/g, ' '))
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
        const captionTrackResult = await fetchTranscriptViaCaptionTracks(videoId, 'en');
        if (captionTrackResult.segments.length > 0) {
          return res.json({
            videoId,
            segments: captionTrackResult.segments,
            segmentCount: captionTrackResult.segments.length,
            chapters: captionTrackResult.chapters,
            fallbackLang: captionTrackResult.languageCode || 'en'
          });
        }

        const transcript = await YoutubeTranscript.fetchTranscript(videoId, { lang: 'en' });
        if (transcript && transcript.length > 0) {
          const chapters = captionTrackResult.chapters.length > 0
            ? captionTrackResult.chapters
            : await fetchVideoChapters(videoId);
          const segments = transcript.map(item => ({
            start: item.offset,
            end: item.offset + item.duration,
            text: decodeHtmlEntities((item.text || '').replace(/\n/g, ' '))
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

// ─── Server-side EPUB generation helpers ───

function escapeXml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function epubFormatTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function buildChaptersFromSegments(segments, chapterMarkers, fallbackTitle = 'Transcript') {
  if (!segments || segments.length === 0) return [];

  // If we have chapter markers, use them to split segments
  if (chapterMarkers && chapterMarkers.length > 0) {
    const chapters = [];
    for (let i = 0; i < chapterMarkers.length; i++) {
      const marker = chapterMarkers[i];
      const nextStart = i + 1 < chapterMarkers.length ? chapterMarkers[i + 1].start : Infinity;
      const chapterSegments = segments.filter(seg => seg.start >= marker.start && seg.start < nextStart);
      const content = chapterSegments.map(seg => seg.text).join(' ');
      if (content.trim()) {
        chapters.push({
          title: marker.title,
          startTime: marker.start,
          content: content.trim()
        });
      }
    }
    if (chapters.length > 0) return chapters;
  }

  // Auto-chapterize: split into ~5-minute chunks
  const CHUNK_SECONDS = 300;
  const totalDuration = segments[segments.length - 1].end || segments[segments.length - 1].start + 5;
  const numChunks = Math.max(1, Math.ceil(totalDuration / CHUNK_SECONDS));
  const chapters = [];

  for (let i = 0; i < numChunks; i++) {
    const chunkStart = i * CHUNK_SECONDS;
    const chunkEnd = (i + 1) * CHUNK_SECONDS;
    const chunkSegs = segments.filter(seg => seg.start >= chunkStart && seg.start < chunkEnd);
    const content = chunkSegs.map(seg => seg.text).join(' ');
    if (content.trim()) {
      chapters.push({
        title: numChunks === 1 ? fallbackTitle : `Part ${i + 1}`,
        startTime: chunkStart,
        content: content.trim()
      });
    }
  }
  return chapters;
}

function generateEpubStyle() {
  return `body {
  font-family: "PingFang SC", "Microsoft YaHei", "Hiragino Sans GB", sans-serif;
  line-height: 1.8;
  margin: 1em;
  padding: 0;
  color: #333;
  background: #fff;
}
h1 {
  font-size: 1.5em;
  color: #1a1a1a;
  margin-bottom: 1em;
  padding-bottom: 0.5em;
  border-bottom: 2px solid #3b82f6;
}
p {
  margin: 0.5em 0;
  text-align: justify;
}
.merged-paragraph {
  text-indent: 2em;
  margin: 1em 0;
  line-height: 2;
}
.chapter-header {
  margin-top: 2em;
  margin-bottom: 1em;
}
.chapter-time {
  color: #3b82f6;
  font-size: 0.9em;
  font-weight: normal;
}
nav#toc ol {
  list-style-type: decimal;
  padding-left: 1.5em;
}
nav#toc li { margin: 0.5em 0; }
nav#toc a { color: #3b82f6; text-decoration: none; }`;
}

function generateEpubCoverPage(title, videoUrl, coverHref) {
  const titleHtml = videoUrl
    ? `<a href="${escapeXml(videoUrl)}" style="color:inherit;text-decoration:none;">${escapeXml(title)}</a>`
    : escapeXml(title);

  const copyAction = videoUrl
    ? escapeXml(`navigator.clipboard.writeText(${JSON.stringify(videoUrl)})`)
    : '';
  const copyBtnHtml = videoUrl
    ? `\n      <button class="copy-btn" onclick="${copyAction}">Copy</button>`
    : '';

  const imageHtml = coverHref
    ? `\n    <div class="cover-image-container">\n      <img src="${escapeXml(coverHref)}" alt="封面"/>\n    </div>`
    : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8"/>
  <title>${escapeXml(title)}</title>
  <style>
    html, body {
      margin: 0;
      padding: 0;
      text-align: center;
      background: #fff;
    }
    .page-wrapper {
      padding: 2em 1em;
      box-sizing: border-box;
    }
    .cover-image-container {
      margin: 0 auto 1.5em auto;
      text-align: center;
    }
    img {
      width: 60%;
      max-width: 300px;
      height: auto;
      display: block;
      margin: 0 auto;
    }
    .title-section {
      margin: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
    }
    h1 {
      font-size: 1.2em;
      margin: 0;
      line-height: 1.4;
      font-family: "PingFang SC", "Microsoft YaHei", sans-serif;
      color: #1a1a1a;
    }
    .title-link {
      color: inherit;
      text-decoration: none;
    }
    .title-link:hover { color: #3b82f6; }
    .copy-btn {
      padding: 3px 12px;
      font-size: 0.85em;
      color: #333;
      background-color: #ffffff;
      border: 1px solid #d1d1d1;
      border-radius: 6px;
      cursor: pointer;
      white-space: nowrap;
      flex-shrink: 0;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      transition: all 0.1s ease;
    }
    .copy-btn:hover {
      background-color: #f5f5f5;
    }
    .copy-btn:active {
      background-color: #ebebeb;
      box-shadow: none;
      transform: scale(0.98);
    }
  </style>
</head>
<body>
  <div class="page-wrapper">${imageHtml}
    <div class="title-section">
      <h1>${titleHtml}</h1>${copyBtnHtml}
    </div>
  </div>
</body>
</html>`;
}

function generateEpubChapterXhtml(chapter) {
  const timeStr = chapter.startTime != null
    ? ` <span class="chapter-time">[${epubFormatTime(chapter.startTime)}]</span>`
    : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><meta charset="UTF-8"/><title>${escapeXml(chapter.title)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body>
  <div class="chapter-header"><h1>${escapeXml(chapter.title)}${timeStr}</h1></div>
  <div class="chapter-content"><p class="merged-paragraph">${escapeXml(chapter.content)}</p></div>
</body>
</html>`;
}

function generateEpubNavXhtml(chapters) {
  const items = chapters.map((ch, i) => `        <li><a href="chapter${i + 1}.xhtml">${escapeXml(ch.title)}</a></li>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><meta charset="UTF-8"/><title>目录</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>目录</h1>
    <ol>
${items}
    </ol>
  </nav>
</body>
</html>`;
}

function generateEpubTocNcx(bookId, title, chapters) {
  const navPoints = chapters.map((ch, i) => `
    <navPoint id="navpoint${i + 1}" playOrder="${i + 1}">
      <navLabel><text>${escapeXml(ch.title)}</text></navLabel>
      <content src="chapter${i + 1}.xhtml"/>
    </navPoint>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="urn:uuid:${bookId}"/>
    <meta name="dtb:depth" content="1"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle><text>${escapeXml(title)}</text></docTitle>
  <navMap>${navPoints}
  </navMap>
</ncx>`;
}

function generateEpubContentOpf(bookId, title, author, chapters, coverHref, coverMediaType) {
  const now = new Date().toISOString();
  const coverImageManifest = coverHref && coverMediaType
    ? `\n    <item id="cover-image" href="${escapeXml(coverHref)}" media-type="${escapeXml(coverMediaType)}" properties="cover-image"/>`
    : '';
  const coverMeta = coverHref && coverMediaType ? '\n    <meta name="cover" content="cover-image"/>' : '';
  const manifestItems = chapters.map((_, i) => `    <item id="chapter${i + 1}" href="chapter${i + 1}.xhtml" media-type="application/xhtml+xml"/>`).join('\n');
  const spineItems = chapters.map((_, i) => `    <itemref idref="chapter${i + 1}"/>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">urn:uuid:${bookId}</dc:identifier>
    <dc:title>${escapeXml(title)}</dc:title>
    <dc:creator>${escapeXml(author)}</dc:creator>
    <dc:language>zh-CN</dc:language>
    <dc:date>${now}</dc:date>
    <meta property="dcterms:modified">${now.split('.')[0]}Z</meta>${coverMeta}
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="css" href="style.css" media-type="text/css"/>
    <item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>${coverImageManifest}
${manifestItems}
  </manifest>
  <spine toc="ncx">
    <itemref idref="cover"/>
${spineItems}
  </spine>
</package>`;
}

async function generateEpubBuffer(title, author, chapters, coverUrl, videoUrl) {
  const zip = new JSZip();
  const bookId = crypto.randomUUID();

  // mimetype must be first, uncompressed
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });

  // META-INF/container.xml
  zip.folder('META-INF').file('container.xml', `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
   <rootfiles>
      <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
   </rootfiles>
</container>`);

  const oebps = zip.folder('OEBPS');

  // Try to fetch cover image
  let coverHref = '';
  let coverMediaType = '';
  if (coverUrl) {
    try {
      const imgResp = await fetch(coverUrl);
      if (imgResp.ok) {
        const imgBuf = Buffer.from(await imgResp.arrayBuffer());
        const ct = imgResp.headers.get('content-type') || 'image/jpeg';
        const ext = ct.includes('png') ? 'png' : ct.includes('webp') ? 'webp' : 'jpeg';
        coverHref = `images/cover.${ext}`;
        coverMediaType = ct.split(';')[0].trim();
        oebps.folder('images').file(`cover.${ext}`, imgBuf);
      }
    } catch (e) {
      console.warn('[EPUB] Failed to fetch cover image:', e.message);
    }
  }

  oebps.file('cover.xhtml', generateEpubCoverPage(title, videoUrl, coverHref || undefined));
  oebps.file('style.css', generateEpubStyle());
  oebps.file('nav.xhtml', generateEpubNavXhtml(chapters));
  oebps.file('toc.ncx', generateEpubTocNcx(bookId, title, chapters));
  oebps.file('content.opf', generateEpubContentOpf(bookId, title, author, chapters, coverHref || undefined, coverMediaType || undefined));

  chapters.forEach((chapter, index) => {
    oebps.file(`chapter${index + 1}.xhtml`, generateEpubChapterXhtml(chapter));
  });

  return await zip.generateAsync({ type: 'nodebuffer', mimeType: 'application/epub+zip' });
}

// GET /api/generate-epub?url=YOUTUBE_URL&lang=zh
app.get('/api/generate-epub', async (req, res) => {
  const { url, lang } = req.query;

  if (!url) {
    return res.status(400).json({ error: 'Missing url parameter' });
  }

  const videoId = extractVideoId(url);
  if (!videoId) {
    return res.status(400).json({ error: 'Invalid YouTube URL' });
  }

  try {
    console.log(`[EPUB] Generating EPUB for video: ${videoId}, lang: ${lang || 'auto'}`);

    // 1. Fetch transcript
    const options = lang ? { lang } : {};
    let transcript;
    try {
      transcript = await YoutubeTranscript.fetchTranscript(videoId, options);
    } catch (e) {
      if (!lang) {
        console.log('[EPUB] Retrying with lang=en...');
        transcript = await YoutubeTranscript.fetchTranscript(videoId, { lang: 'en' });
      } else {
        throw e;
      }
    }

    if (!transcript || transcript.length === 0) {
      return res.status(404).json({ error: 'No transcript available for this video' });
    }

    const segments = transcript.map(item => ({
      start: item.offset,
      end: item.offset + item.duration,
      text: item.text.replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/\n/g, ' ').trim()
    })).filter(seg => seg.text);

    // 2. Fetch metadata + chapters from watch page
    const pageData = await fetchVideoPageData(videoId);
    const title = pageData.title || `YouTube Video ${videoId}`;
    const author = pageData.author || 'YouTube Creator';
    const coverUrl = pageData.thumbnailUrl || `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

    // 3. Build chapters
    const chapters = buildChaptersFromSegments(segments, pageData.chapters, title);
    if (!chapters || chapters.length === 0) {
      return res.status(404).json({ error: 'Could not build chapters from transcript' });
    }

    console.log(`[EPUB] ${segments.length} segments, ${chapters.length} chapters, title: ${title}`);

    // 4. Generate EPUB buffer
    const buffer = await generateEpubBuffer(title, author, chapters, coverUrl, videoUrl);

    // 5. Send response
    const safeFilename = title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 200);
    const encodedFilename = encodeURIComponent(safeFilename);

    res.set({
      'Content-Type': 'application/epub+zip',
      'Content-Disposition': `attachment; filename="${safeFilename}.epub"; filename*=UTF-8''${encodedFilename}.epub`,
      'Content-Length': buffer.length
    });
    res.send(buffer);

    console.log(`[EPUB] Sent ${buffer.length} bytes: ${safeFilename}.epub`);
  } catch (error) {
    console.error('[EPUB] Error:', error.message);
    res.status(500).json({ error: 'Failed to generate EPUB', detail: error.message });
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
