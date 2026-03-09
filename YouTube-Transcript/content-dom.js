// YouTube转录侧边栏 - 使用DOM版本（无需网络请求）
console.log('%c[YouTube转录 DOM] 插件加载开始...', 'background: #4CAF50; color: white; padding: 2px 6px; border-radius: 3px;');

const TRANSCRIPT_PANEL_SELECTOR = [
    'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"]',
    'ytd-engagement-panel-section-list-renderer[target-id="PAmodern_transcript_view"]'
].join(', ');
const TRANSCRIPT_PANEL_HIDDEN_SELECTOR = [
    'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"].transcript-hidden',
    'ytd-engagement-panel-section-list-renderer[target-id="PAmodern_transcript_view"].transcript-hidden'
].join(', ');

// 提前隐藏原生转录面板（不使用 display:none，避免阻断加载）
(function ensureNativeTranscriptHiddenEarly() {
    try {
        if (document.getElementById('ext-hide-native-transcript-style')) return;
        const style = document.createElement('style');
        style.id = 'ext-hide-native-transcript-style';
        style.textContent = `
          ${TRANSCRIPT_PANEL_SELECTOR},
          ytd-transcript-search-panel-renderer,
          ytd-transcript-renderer {
            opacity: 0 !important;
            pointer-events: none !important;
            transition: none !important;
          }
          /* 一旦我们加上 transcript-hidden 类，彻底不占位 */
          ${TRANSCRIPT_PANEL_HIDDEN_SELECTOR} {
            display: none !important;
            width: 0 !important;
            max-width: 0 !important;
          }
        `;
        (document.documentElement || document.head || document.body)?.appendChild(style);
    } catch (e) {}
})();

let transcriptData = [];
let transcriptStructure = [];
let chapters = [];
let chapterSourcePriority = 0;
let currentActiveIndex = -1;
let timeTrackingInterval = null;
let videoElement = null;
let searchQuery = '';
// 用户手动滚动后的自动跟随冷却时间（毫秒）
const AUTOSCROLL_COOLDOWN_MS = 2000;
let blockAutoScrollUntil = 0; // 时间戳：在此时间前不自动滚动

function applyChapters(nextChapters, sourcePriority) {
    if (!Array.isArray(nextChapters) || nextChapters.length === 0) {
        return;
    }

    const normalized = nextChapters
        .filter((chapter) => Number.isFinite(chapter.start) && (chapter.title || '').trim())
        .sort((a, b) => a.start - b.start)
        .filter((chapter, index, arr) => index === 0 || chapter.start !== arr[index - 1].start);

    if (normalized.length === 0 || sourcePriority < chapterSourcePriority) {
        return;
    }

    chapters = normalized;
    chapterSourcePriority = sourcePriority;
}

function resetTranscriptStructure() {
    transcriptStructure = [];
}

function getNativeTranscriptPanels(root = document) {
    return Array.from(root.querySelectorAll(TRANSCRIPT_PANEL_SELECTOR));
}

function getTranscriptSegments(panel) {
    const localSegments = panel ? Array.from(panel.querySelectorAll('ytd-transcript-segment-renderer')) : [];
    if (localSegments.length > 0) {
        return localSegments;
    }

    const globalSegments = Array.from(document.querySelectorAll('ytd-transcript-segment-renderer'));
    if (globalSegments.length > 0) {
        return globalSegments;
    }

    return [];
}

function findNativeTranscriptPanel(root = document) {
    const panels = getNativeTranscriptPanels(root);
    if (panels.length === 0) {
        return null;
    }

    const scored = panels.map((panel) => {
        const visibility = panel.getAttribute('visibility');
        const targetId = panel.getAttribute('target-id') || '';
        const segments = getTranscriptSegments(panel).length;
        const isExpanded = visibility === 'ENGAGEMENT_PANEL_VISIBILITY_EXPANDED';
        const isDisplayed = panel.style.display !== 'none' && !panel.classList.contains('transcript-hidden');
        let score = 0;

        if (segments > 0) score += 10;
        if (isExpanded) score += 5;
        if (isDisplayed) score += 2;
        if (targetId === 'PAmodern_transcript_view') score += 1;

        return { panel, score };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored[0].panel;
}

function getVideoId() {
    return new URLSearchParams(window.location.search).get('v');
}

// 初始化
function init() {
    try {
        if (!location.href.includes('/watch')) {
            return;
        }
        
        videoElement = document.querySelector('video');
        
        if (!videoElement) {
            setTimeout(init, 1000);
            return;
        }
        
        createSidebar();
        
        // 等待一下再获取字幕
        setTimeout(() => {
            fetchTranscriptFromDOM();
        }, 2000);
        
        videoElement.addEventListener('play', startTimeTracking);
        videoElement.addEventListener('pause', updateCurrentHighlight);
        videoElement.addEventListener('seeked', updateCurrentHighlight);
        videoElement.addEventListener('timeupdate', onTimeUpdate);
        
    } catch (error) {
        console.error('[YouTube转录 DOM] 初始化错误:', error);
    }
}

// 从YouTube DOM获取字幕
async function fetchTranscriptFromDOM() {
    try {
        console.log('[YouTube转录 DOM] 开始获取字幕...');
        isLoadingTranscript = true;
        resetTranscriptStructure();
        showLoadingMessage('正在获取字幕...');

        const playerResponse = await getYtInitialPlayerResponse();
        if (playerResponse) {
            extractChaptersFromPlayerResponse(playerResponse);
        }

        // 优先复用 YouTube 原生 transcript，避免被字幕直连请求的 token 校验卡住。
        if (await fetchTranscriptViaDOMFallback()) {
            finalizeTranscriptLoad('dom-primary');
            return;
        }

        if (await fetchTranscriptFromTextTracks()) {
            finalizeTranscriptLoad('textTracks');
            return;
        }

        if (await fetchTranscriptFromCaptionTracks(playerResponse)) {
            finalizeTranscriptLoad('captionTracks');
            return;
        }

        const videoId = getVideoId();
        if (videoId && await fetchTranscriptFromInnertube(videoId)) {
            finalizeTranscriptLoad('innertube');
            return;
        }

        console.log('[YouTube转录 DOM] 所有自动路径失败，尝试备用提示...');
        await fetchFromPlayerResponse();
        
    } catch (error) {
        console.error('[YouTube转录 DOM] 获取失败:', error);
        showErrorMessage('无法获取字幕');
    } finally {
        // 🔧 确保无论成功失败都恢复监控
        isLoadingTranscript = false;
    }
}

function finalizeTranscriptLoad(source) {
    console.log('[YouTube转录 DOM] 通过', source, '成功获取', transcriptData.length, '条字幕');
    console.log('[YouTube转录 DOM] 章节数量:', chapters.length);
    renderTranscript();

    setTimeout(() => {
        if (videoElement) {
            updateCurrentHighlight();
            startTimeTracking();
        }
    }, 100);

    const transcriptPanel = findNativeTranscriptPanel();
    if (transcriptPanel) {
        closeNativeTranscript(transcriptPanel);
    }

    setTimeout(() => {
        if (isPinned()) {
            applyPinnedState();
            updatePinnedSpace();
            window.dispatchEvent(new Event('resize'));
        }
    }, 100);

    sessionStorage.setItem('yt-transcript-loaded', 'true');
    sessionStorage.removeItem('yt-transcript-refreshed');
}

function selectPreferredCaptionTrack(captionTracks) {
    if (!Array.isArray(captionTracks) || captionTracks.length === 0) {
        return null;
    }

    return captionTracks.find(track =>
        !track.kind &&
        (track.languageCode === 'zh-Hans' || track.languageCode === 'zh-Hant' || track.languageCode === 'zh')
    ) || captionTracks.find(track =>
        track.languageCode === 'zh-Hans' || track.languageCode === 'zh-Hant' || track.languageCode === 'zh'
    ) || captionTracks.find(track => !track.kind) || captionTracks[0];
}

async function fetchTranscriptFromCaptionTracks(playerResponse) {
    try {
        const captionTracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
        if (!Array.isArray(captionTracks) || captionTracks.length === 0) {
            return false;
        }

        const selectedTrack = selectPreferredCaptionTrack(captionTracks);
        if (!selectedTrack || typeof selectedTrack.baseUrl !== 'string' || !selectedTrack.baseUrl.trim()) {
            return false;
        }

        const candidateUrls = buildTranscriptCandidateUrls(selectedTrack.baseUrl);
        if (candidateUrls.length === 0) {
            return false;
        }

        for (const candidateUrl of candidateUrls) {
            try {
                const payloadText = await fetchTranscriptText(candidateUrl);
                if (!payloadText || !payloadText.trim()) {
                    continue;
                }

                if (parseTranscriptPayload(payloadText)) {
                    return true;
                }
            } catch (error) {
                console.error('[YouTube转录 DOM] 字幕轨道获取失败:', error);
            }
        }
    } catch (error) {
        console.error('[YouTube转录 DOM] captionTracks 路径失败，继续尝试其他兜底:', error);
    }

    return false;
}

function buildTranscriptCandidateUrls(baseUrl) {
    if (typeof baseUrl !== 'string' || !baseUrl.trim()) {
        return [];
    }

    const formats = [null, 'json3', 'srv3'];
    const result = [];

    formats.forEach((fmt) => {
        try {
            const url = new URL(baseUrl);
            if (fmt) {
                url.searchParams.set('fmt', fmt);
            }
            const href = url.toString();
            if (!result.includes(href)) {
                result.push(href);
            }
        } catch (error) {
            console.warn('[YouTube转录 DOM] 无法构造字幕轨道 URL:', error);
        }
    });

    return result;
}

async function fetchTranscriptText(url) {
    try {
        const directText = await fetchTranscriptTextDirect(url);
        if (directText && directText.trim()) {
            return directText;
        }
    } catch (error) {
        console.warn('[YouTube转录 DOM] 页面上下文抓取失败，回退 background:', error);
    }

    return await fetchTranscriptTextViaBackground(url);
}

async function fetchTranscriptTextDirect(url) {
    const response = await fetch(url, {
        credentials: 'include',
        cache: 'no-store'
    });
    const text = await response.text();
    if (!response.ok) {
        throw new Error(`直连抓取失败: ${response.status}`);
    }

    return text;
}

async function fetchTranscriptTextViaBackground(url) {
    return await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(
            { type: 'FETCH_TRANSCRIPT', url },
            (response) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }
                if (!response?.success || typeof response.data !== 'string') {
                    reject(new Error(response?.error || '字幕请求失败'));
                    return;
                }
                resolve(response.data);
            }
        );
    });
}

function parseTranscriptPayload(payloadText) {
    if (!payloadText) {
        return false;
    }

    const trimmed = payloadText.trim();
    if (trimmed.startsWith('{')) {
        return parseTranscriptJson3(trimmed);
    }

    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(payloadText, 'text/xml');
    const parseError = xmlDoc.querySelector('parsererror');
    if (parseError) {
        console.error('[YouTube转录 DOM] 字幕 XML 解析失败，响应片段:', trimmed.slice(0, 160));
        return false;
    }

    const textElements = Array.from(xmlDoc.getElementsByTagName('text'));
    const paragraphElements = Array.from(xmlDoc.getElementsByTagName('p'));
    transcriptData = [];
    resetTranscriptStructure();

    if (textElements.length > 0) {
        textElements.forEach((element) => {
            const start = parseFloat(element.getAttribute('start') || '');
            const duration = parseFloat(element.getAttribute('dur') || '3');
            const text = decodeHTMLEntities(element.textContent || '');

            if (Number.isFinite(start) && text.trim()) {
                transcriptData.push({
                    start,
                    end: start + (Number.isFinite(duration) ? duration : 3),
                    text: text.trim()
                });
            }
        });
        return transcriptData.length > 0;
    }

    if (paragraphElements.length > 0) {
        paragraphElements.forEach((element) => {
            const startMs = parseFloat(element.getAttribute('t') || '');
            const durationMs = parseFloat(element.getAttribute('d') || '3000');
            const segNodes = Array.from(element.getElementsByTagName('s'));
            const rawText = segNodes.length > 0
                ? segNodes.map((node) => decodeHTMLEntities(node.textContent || '')).join('')
                : decodeHTMLEntities(element.textContent || '');
            const text = rawText.replace(/\s+/g, ' ').trim();

            if (Number.isFinite(startMs) && text) {
                const start = startMs / 1000;
                const duration = Number.isFinite(durationMs) ? durationMs / 1000 : 3;
                transcriptData.push({
                    start,
                    end: start + duration,
                    text
                });
            }
        });
        return transcriptData.length > 0;
    }

    console.warn('[YouTube转录 DOM] 未识别的字幕格式，响应片段:', trimmed.slice(0, 160));
    return false;
}

function parseTranscriptJson3(jsonText) {
    try {
        const data = JSON.parse(jsonText);
        const events = Array.isArray(data?.events) ? data.events : [];
        transcriptData = [];
        resetTranscriptStructure();

        events.forEach((event) => {
            const segs = Array.isArray(event?.segs) ? event.segs : [];
            const text = segs.map((seg) => seg?.utf8 || '').join('').replace(/\s+/g, ' ').trim();
            const startMs = parseFloat(event?.tStartMs || '');
            const durationMs = parseFloat(event?.dDurationMs || '3000');

            if (Number.isFinite(startMs) && text) {
                const start = startMs / 1000;
                const duration = Number.isFinite(durationMs) ? durationMs / 1000 : 3;
                transcriptData.push({
                    start,
                    end: start + duration,
                    text
                });
            }
        });

        return transcriptData.length > 0;
    } catch (error) {
        console.error('[YouTube转录 DOM] json3 解析失败:', error);
        return false;
    }
}

async function fetchTranscriptFromInnertube(videoId) {
    let apiKey = null;
    let context = null;

    if (window.ytcfg?.get) {
        apiKey = window.ytcfg.get('INNERTUBE_API_KEY');
        context = window.ytcfg.get('INNERTUBE_CONTEXT');
    }

    if (!apiKey) {
        return false;
    }

    try {
        const response = await fetch(`https://www.youtube.com/youtubei/v1/get_transcript?key=${apiKey}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                context: context || {
                    client: {
                        clientName: 'WEB',
                        clientVersion: '2.20231219.01.00'
                    }
                },
                params: btoa(`\n\x0b${videoId}`)
            })
        });

        if (!response.ok) {
            console.error('[YouTube转录 DOM] innertube 请求失败:', response.status);
            return false;
        }

        const data = await response.json();
        const parsed = parseTranscriptApiResponse(data);
        if (!Array.isArray(parsed) || parsed.length === 0) {
            return false;
        }

        transcriptData = parsed;
        resetTranscriptStructure();
        return true;
    } catch (error) {
        console.error('[YouTube转录 DOM] innertube 获取失败:', error);
        return false;
    }
}

function parseTranscriptApiResponse(data) {
    const actions = data?.actions;
    if (!Array.isArray(actions) || actions.length === 0) {
        return null;
    }

    const segments = [];

    actions.forEach((action) => {
        const initialSegments = action?.updateEngagementPanelAction?.content
            ?.transcriptRenderer?.content?.transcriptSearchPanelRenderer
            ?.body?.transcriptSegmentListRenderer?.initialSegments;

        if (Array.isArray(initialSegments)) {
            segments.push(...initialSegments);
        }
    });

    if (segments.length === 0) {
        return null;
    }

    return segments.map((segment) => {
        const renderer = segment?.transcriptSegmentRenderer;
        const text = renderer?.snippet?.runs?.map((run) => run.text).join('') || '';
        const start = parseInt(renderer?.startMs || '0', 10) / 1000;
        const end = start + 5;

        return {
            start,
            end,
            text: text.trim()
        };
    }).filter((item) => Number.isFinite(item.start) && item.text);
}

async function fetchTranscriptFromTextTracks() {
    if (!videoElement?.textTracks || videoElement.textTracks.length === 0) {
        return false;
    }

    const tracks = Array.from(videoElement.textTracks);
    const originalModes = tracks.map((track) => track.mode);
    const sortedTracks = tracks.slice().sort((a, b) => scoreTextTrack(b) - scoreTextTrack(a));

    try {
        for (const track of sortedTracks) {
            const originalMode = track.mode;
            if (track.mode === 'disabled') {
                track.mode = 'hidden';
            }

            const cues = await waitForTrackCues(track);
            if (Array.isArray(cues) && cues.length > 0) {
                transcriptData = cuesToTranscriptData(cues);
                if (transcriptData.length > 0) {
                    resetTranscriptStructure();
                    return true;
                }
            }

            track.mode = originalMode;
        }
    } catch (error) {
        console.error('[YouTube转录 DOM] textTracks 兜底失败:', error);
    } finally {
        tracks.forEach((track, index) => {
            try {
                track.mode = originalModes[index];
            } catch (_) {}
        });
    }

    return false;
}

function scoreTextTrack(track) {
    const kind = (track.kind || '').toLowerCase();
    const language = (track.language || '').toLowerCase();
    const label = (track.label || '').toLowerCase();
    let score = 0;

    if (track.mode === 'showing') score += 5;
    if (kind === 'captions' || kind === 'subtitles') score += 4;
    if (language.startsWith('zh')) score += 3;
    if (label.includes('english') || language.startsWith('en')) score += 2;

    return score;
}

async function waitForTrackCues(track, maxTries = 10, intervalMs = 250) {
    for (let i = 0; i < maxTries; i++) {
        const cues = track?.cues ? Array.from(track.cues) : [];
        if (cues.length > 0) {
            return cues;
        }
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    return track?.cues ? Array.from(track.cues) : [];
}

function cuesToTranscriptData(cues) {
    const seen = new Set();

    return cues.map((cue) => {
        const text = normalizeCueText(cue.text || cue.getCueAsHTML?.().textContent || '');
        const start = Number(cue.startTime);
        const end = Number(cue.endTime);

        return {
            start,
            end,
            text,
            key: `${start}-${end}-${text}`
        };
    }).filter((item) => {
        if (!Number.isFinite(item.start) || !item.text) {
            return false;
        }
        if (seen.has(item.key)) {
            return false;
        }
        seen.add(item.key);
        return true;
    }).map(({ start, end, text }) => ({
        start,
        end: Number.isFinite(end) ? end : start + 3,
        text
    }));
}

function normalizeCueText(text) {
    return String(text || '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

async function fetchTranscriptViaDOMFallback() {
    let transcriptButton = await findTranscriptButton();
    if (!transcriptButton) {
        transcriptButton = await openMenuAndFindTranscript();
    }

    if (!transcriptButton) {
        console.log('[YouTube转录 DOM] DOM 兜底未找到 transcript 按钮');
        return false;
    }

    console.log('[YouTube转录 DOM] 找到 transcript 按钮，尝试 DOM 兜底...');

    try {
        const nativePanelPre = findNativeTranscriptPanel();
        if (nativePanelPre) {
            const visibility = nativePanelPre.getAttribute('visibility');
            if (visibility === 'ENGAGEMENT_PANEL_VISIBILITY_EXPANDED' || visibility === 'ENGAGEMENT_PANEL_VISIBILITY_COLLAPSED') {
                console.log('[YouTube转录 DOM] 检测到旧 transcript 面板状态，先关闭清理...');
                transcriptButton.click();
                await new Promise(r => setTimeout(r, 400));
            }

            nativePanelPre.style.opacity = '0';
            nativePanelPre.style.pointerEvents = 'none';
            nativePanelPre.style.transform = '';
            nativePanelPre.style.position = '';
            nativePanelPre.style.right = '';
            nativePanelPre.style.top = '';
            nativePanelPre.style.overflow = '';
        }
    } catch (_) {}

    transcriptButton.click();
    await new Promise((resolve) => setTimeout(resolve, 300));
    activateTranscriptTabChip();

    const transcriptPanel = await waitForTranscriptPanelUltra();
    const activeTranscriptSurface = transcriptPanel || document;

    await extractChapters(activeTranscriptSurface);

    const hasRefreshed = sessionStorage.getItem('yt-transcript-refreshed');
    let segments = await waitForTranscriptSegmentsUltra(activeTranscriptSurface, hasRefreshed);
    if (!segments || segments.length === 0) {
        segments = await waitForTranscriptSegmentsFast(activeTranscriptSurface, hasRefreshed);
    }

    transcriptData = [];
    resetTranscriptStructure();
    segments.forEach((segment) => {
        const timestamp = segment.querySelector('.segment-timestamp');
        const text = segment.querySelector('.segment-text');

        if (timestamp && text) {
            const timeText = timestamp.textContent.trim();
            const seconds = parseTimestamp(timeText);
            const cleanedText = sanitizeTranscriptText(text.textContent.trim());
            if (!cleanedText || !isValidTranscriptText(cleanedText)) {
                return;
            }

            transcriptData.push({
                start: seconds,
                end: seconds + 3,
                text: cleanedText
            });
        }
    });

    if (transcriptData.length === 0) {
        transcriptData = extractGenericTranscriptDataFromPage();
        resetTranscriptStructure();
    }

    if (transcriptData.length > 0) {
        return true;
    }

    if (!hasRefreshed) {
        console.log('[YouTube转录 DOM] ⚡ DOM 兜底第一次未找到字幕，刷新页面重试...');
        sessionStorage.setItem('yt-transcript-refreshed', 'true');
        sessionStorage.setItem('yt-transcript-auto-open', 'true');
        location.reload();
    } else {
        console.log('[YouTube转录 DOM] ❌ DOM 兜底刷新后仍未找到字幕');
    }

    return false;
}

function activateTranscriptTabChip() {
    const labels = ['transcript', '文字记录', '文字稿'];
    const candidates = Array.from(document.querySelectorAll('button, [role="tab"], yt-button-shape button, yt-chip-cloud-chip-renderer'));

    for (const el of candidates) {
        const text = (el.textContent || '').trim().toLowerCase();
        if (!text) continue;
        if (labels.some((label) => text === label || text.includes(label))) {
            try {
                el.click();
                return true;
            } catch (_) {}
        }
    }

    return false;
}

function extractGenericTranscriptDataFromPage() {
    const timestampRegex = /^(?:\d+:)?\d{1,2}:\d{2}$/;
    const timestampNodes = Array.from(document.querySelectorAll('button, span, div, yt-formatted-string'))
        .filter((el) => timestampRegex.test((el.textContent || '').trim()));

    if (timestampNodes.length === 0) {
        return [];
    }

    const items = [];
    const seen = new Set();

    timestampNodes.forEach((timestampNode) => {
        const timestampText = (timestampNode.textContent || '').trim();
        const row = timestampNode.closest('ytd-transcript-segment-renderer, li, yt-formatted-string, button, div');
        const rowText = sanitizeTranscriptText((row?.textContent || '').replace(timestampText, ' '));
        const nearbyText = sanitizeTranscriptText(collectNearbyTranscriptText(timestampNode));
        const text = pickBestTranscriptText(rowText, nearbyText);
        const start = parseTimestamp(timestampText);
        const key = `${start}-${text}`;

        if (!text || seen.has(key)) {
            return;
        }

        seen.add(key);
        items.push({
            start,
            end: start + 3,
            text
        });
    });

    return items.sort((a, b) => a.start - b.start);
}

function collectNearbyTranscriptText(timestampNode) {
    const siblings = [];
    let current = timestampNode.nextElementSibling;

    while (current && siblings.length < 3) {
        const text = (current.textContent || '').replace(/\s+/g, ' ').trim();
        if (text) {
            siblings.push(text);
        }
        current = current.nextElementSibling;
    }

    return siblings.join(' ').trim();
}

function sanitizeTranscriptText(text) {
    return String(text || '')
        .replace(/(?:^|\s)(?:\d+:)?\d{1,2}:\d{2}(?=\s|$)/g, ' ')
        .replace(/^\d+\s+(?:hours?|minutes?|seconds?)(?:,\s*\d+\s+seconds?)?\s*/i, ' ')
        .replace(/\bnow playing\b/gi, ' ')
        .replace(/\bwatch full video\b/gi, ' ')
        .replace(/\blive\b/gi, ' ')
        .replace(/[·•]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function pickBestTranscriptText(primaryText, fallbackText) {
    const primary = sanitizeTranscriptText(primaryText);
    const fallback = sanitizeTranscriptText(fallbackText);

    if (isValidTranscriptText(primary)) {
        return primary;
    }

    if (isValidTranscriptText(fallback)) {
        return fallback;
    }

    return primary || fallback;
}

function isValidTranscriptText(text) {
    if (!text) {
        return false;
    }

    const normalized = text.trim().toLowerCase();
    if (!normalized) {
        return false;
    }

    const junk = new Set([
        'now playing',
        'watch full video',
        'live',
        'live watch full video'
    ]);

    if (junk.has(normalized)) {
        return false;
    }

    const alphaNumeric = normalized.replace(/[^\p{L}\p{N}一-鿿]+/gu, '');
    return alphaNumeric.length > 0;
}

// 提取章节信息
async function extractChapters(transcriptPanel) {
    try {
        const nativeSectionHeaders = [];
        const sectionHeaders = transcriptPanel.querySelectorAll('ytd-transcript-section-header-renderer');
        sectionHeaders.forEach((header) => {
            const titleElement = header.querySelector('#header-title');
            const timestampElement = header.querySelector('.segment-timestamp');

            if (!titleElement || !timestampElement) {
                return;
            }

            const title = titleElement.textContent.trim();
            const timeText = timestampElement.textContent.trim();
            const seconds = parseTimestamp(timeText);
            if (!title || !Number.isFinite(seconds)) {
                return;
            }

            nativeSectionHeaders.push({
                title,
                start: seconds
            });
        });

        if (nativeSectionHeaders.length > 0) {
            applyChapters(nativeSectionHeaders, 3);
            return;
        }

        const descriptionChapters = [];
        const chaptersFromDescription = document.querySelectorAll('ytd-macro-markers-list-item-renderer');
        chaptersFromDescription.forEach((item) => {
            const titleElement = item.querySelector('#details h4');
            const timeButton = item.querySelector('#endpoint');

            if (!titleElement || !timeButton) {
                return;
            }

            const title = titleElement.textContent.trim();
            const timeAttr = timeButton.getAttribute('aria-label') || timeButton.textContent;
            const match = timeAttr.match(/(\d+):(\d+)/);
            if (!match) {
                return;
            }

            const seconds = parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
            descriptionChapters.push({
                title,
                start: seconds
            });
        });

        if (descriptionChapters.length > 0) {
            applyChapters(descriptionChapters, 1);
        }
    } catch (error) {
        console.error('[YouTube转录 DOM] 提取章节失败:', error);
    }
}

// 关闭YouTube原生转录面板
function closeNativeTranscript(panel) {
    try {
        console.log('[YouTube转录 DOM] 开始关闭原生面板...');
        
        // 直接隐藏面板（不点击关闭按钮，避免触发YouTube的布局重置）
        if (panel) {
            // 彻底隐藏，不再占位
            panel.classList.add('transcript-hidden');
            panel.style.opacity = '0';
            panel.style.pointerEvents = 'none';
            panel.style.display = 'none';
            panel.style.width = '0';
            panel.style.maxWidth = '0';
            try { panel.setAttribute('visibility', 'ENGAGEMENT_PANEL_VISIBILITY_HIDDEN'); } catch (_) {}
            console.log('[YouTube转录 DOM] 原生面板已隐藏（不触发布局重置）');
        }
        
        // 持续监控，防止被重新打开
        keepNativeTranscriptHidden();
        
    } catch (error) {
        console.error('[YouTube转录 DOM] 关闭原生面板失败:', error);
    }
}

// 持续隐藏原生transcript面板
let nativeTranscriptObserver = null;
let isLoadingTranscript = false; // 🔧 新增：标记是否正在加载字幕

function keepNativeTranscriptHidden() {
    // 避免重复创建 observer
    if (nativeTranscriptObserver) return;
    
    nativeTranscriptObserver = new MutationObserver(() => {
        // 🔧 关键修复：如果正在加载字幕，不要干扰原生面板
        if (isLoadingTranscript) {
            return;
        }
        
        const nativePanel = findNativeTranscriptPanel();
        if (nativePanel) {
            const isVisible = nativePanel.getAttribute('visibility') === 'ENGAGEMENT_PANEL_VISIBILITY_EXPANDED';
            if (isVisible && !nativePanel.classList.contains('transcript-hidden')) {
                console.log('[YouTube转录 DOM] 检测到原生面板打开，强制隐藏（不触发布局重置）');
                // 不点击关闭按钮，直接隐藏，避免触发YouTube布局重置
                nativePanel.classList.add('transcript-hidden');
                nativePanel.style.opacity = '0';
                nativePanel.style.pointerEvents = 'none';
                nativePanel.style.display = 'none';
                nativePanel.style.width = '0';
                nativePanel.style.maxWidth = '0';
                try { nativePanel.setAttribute('visibility', 'ENGAGEMENT_PANEL_VISIBILITY_HIDDEN'); } catch (_) {}
            }
        }
    });
    
    nativeTranscriptObserver.observe(document.body, {
        attributes: true,
        attributeFilter: ['visibility'],
        subtree: true,
        childList: true
    });
}

// 查找transcript按钮
async function findTranscriptButton() {
    // 等待按钮加载
    for (let i = 0; i < 10; i++) {
        const buttons = document.querySelectorAll('button[aria-label*="transcript" i], button[aria-label*="字幕" i]');
        
        for (let button of buttons) {
            const ariaLabel = button.getAttribute('aria-label') || '';
            const text = button.textContent.toLowerCase();
            const parentClass = button.closest('.ytp-chrome-controls') ? 'player-control' : 'page-button';
            
            // 排除播放器内的 CC 字幕按钮（它在 .ytp-chrome-controls 里）
            if (button.closest('.ytp-chrome-controls')) {
                continue;
            }
            
            // 修复：如果 aria-label 已经匹配 transcript，直接返回（不需要检查 textContent）
            if (ariaLabel.toLowerCase().includes('transcript') || 
                ariaLabel.toLowerCase().includes('show transcript') ||
                ariaLabel.includes('文字记录') ||
                ariaLabel.includes('文字版') ||
                text.includes('transcript') || 
                text.includes('文字版') ||
                text.includes('文字记录')) {
                return button;
            }
        }
        
        // 也尝试查找菜单中的按钮
        const menuButtons = document.querySelectorAll('ytd-menu-service-item-renderer');
        for (let button of menuButtons) {
            const text = button.textContent.toLowerCase();
            if (text.includes('transcript') || text.includes('字幕') || text.includes('文字')) {
                return button;
            }
        }
        
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    return null;
}

// 打开“更多操作 …”菜单并查找“显示文字记录/Transcript”菜单项
async function openMenuAndFindTranscript() {
    // 先等待页面加载
    await new Promise(r => setTimeout(r, 1000));
    
    // 1) 尝试定位 watch 页主操作区的"更多操作"按钮
    const selectors = [
        // 精确匹配"更多操作"按钮
        'button[aria-label*="more actions" i]',
        'button[aria-label*="更多操作" i]',
        'button[aria-label*="More actions" i]',
        // 新版 YouTube 布局
        'ytd-watch-metadata yt-button-shape button[aria-label*="more" i]',
        'ytd-watch-metadata button.yt-spec-button-shape-next[aria-label*="more" i]',
        '#actions button[aria-label*="more" i]',
        // 旧版选择器
        'ytd-watch-metadata #actions button[aria-label*="more" i]',
        'ytd-watch-metadata #actions tp-yt-paper-icon-button[aria-label*="more" i]',
        'ytd-watch-metadata #actions button[aria-label*="更多" i]',
        '#actions tp-yt-paper-icon-button[aria-label*="more" i]',
        // 通用三点菜单按钮（ytd-menu-renderer 内的）
        'ytd-menu-renderer yt-icon-button button',
    ];
    
    let moreBtn = null;
    for (const sel of selectors) {
        const btns = document.querySelectorAll(sel);
        for (const btn of btns) {
            const label = (btn.getAttribute('aria-label') || '').toLowerCase();
            
            // 排除播放器内的按钮
            if (btn.closest('.ytp-chrome-controls') || btn.closest('ytd-player')) {
                continue;
            }
            
            // 排除明显不是"更多操作"的按钮（如下载、分享等）
            if (label.includes('download') || label.includes('下载') ||
                label.includes('share') || label.includes('分享') ||
                label.includes('save') || label.includes('保存') ||
                label.includes('like') || label.includes('dislike')) {
                continue;
            }
            
            // 优先匹配包含 "more" 或 "更多" 的按钮
            if (label.includes('more') || label.includes('更多') || label.includes('菜单') || label === '') {
                moreBtn = btn;
                break;
            }
        }
        if (moreBtn) break;
    }
    
    // 备用：查找视频下方操作区的所有按钮
    if (!moreBtn) {
        const actionButtons = document.querySelectorAll('ytd-watch-metadata button, #actions button, ytd-menu-renderer button');
        for (const btn of actionButtons) {
            const label = btn.getAttribute('aria-label') || '';
            if (label.toLowerCase().includes('more') || label.includes('更多') || label.includes('菜单')) {
                if (!btn.closest('.ytp-chrome-controls') && !btn.closest('ytd-player')) {
                    moreBtn = btn;
                    break;
                }
            }
        }
    }
    
    // 找不到就不再尝试
    if (!moreBtn) {
        return null;
    }

    // 2) 打开菜单
    moreBtn.click();
    // 等待弹窗出现
    const menu = await waitForElement('ytd-menu-popup-renderer:not([hidden]) tp-yt-paper-listbox, ytd-menu-popup-renderer tp-yt-paper-listbox', 800);
    if (!menu) {
        return null;
    }
    // 3) 在弹窗中查找包含 transcript/字幕/文字 的菜单项
    const items = menu.querySelectorAll('ytd-menu-service-item-renderer');
    for (const it of items) {
        const t = (it.textContent || '').toLowerCase();
        if (t.includes('transcript') || t.includes('文字') || t.includes('字幕')) {
            return it;
        }
    }
    return null;
}

// 解析时间戳 (00:05)
function parseTimestamp(timestamp) {
    const parts = timestamp.split(':');
    if (parts.length === 2) {
        return parseInt(parts[0]) * 60 + parseInt(parts[1]);
    } else if (parts.length === 3) {
        return parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseInt(parts[2]);
    }
    return 0;
}

// 备用方法：从playerResponse获取
async function fetchFromPlayerResponse() {
    const playerResponse = window.ytInitialPlayerResponse;
    
    if (playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks) {
        const tracks = playerResponse.captions.playerCaptionsTracklistRenderer.captionTracks;
        console.log('[YouTube转录 DOM] 找到字幕轨道');
        
        // 显示提示：需要手动点击
        showManualInstructions();
    } else {
        showNoTranscriptMessage();
    }
}

// 快速等待原生Transcript面板出现
async function waitForTranscriptPanel(maxTries = 20, intervalMs = 60) {
    for (let i = 0; i < maxTries; i++) {
        const panel = findNativeTranscriptPanel();
        if (panel) return panel;
        await new Promise(r => setTimeout(r, intervalMs));
    }
    return findNativeTranscriptPanel();
}

// 等待字幕片段渲染出来（避免太早关闭）
async function waitForTranscriptSegments(panel, maxTries = 80, intervalMs = 50) {
    for (let i = 0; i < maxTries; i++) {
        const activePanel = findNativeTranscriptPanel() || panel;
        const segs = getTranscriptSegments(activePanel);
        if (segs && segs.length > 0) return segs;
        await new Promise(r => setTimeout(r, intervalMs));
    }
    return getTranscriptSegments(findNativeTranscriptPanel() || panel);
}

// 快速优先：更短间隔先试几次，失败再走稳妥方案
async function waitForTranscriptPanelFast() {
    const fast = await waitForTranscriptPanel(15, 20); // 最快 ~300ms
    if (fast) return fast;
    return await waitForTranscriptPanel(60, 35);        // 备份 ~2.1s 上限
}

async function waitForTranscriptSegmentsFast(panel, hasRefreshed) {
    let segs = getTranscriptSegments(findNativeTranscriptPanel() || panel);
    if (segs && segs.length) return segs;
    
    if (hasRefreshed) {
        // 🔧 刷新后：给足够时间加载（总共最多5s+）
        console.log('[YouTube转录 DOM] 刷新后加载，给足够时间...');
        segs = await waitForTranscriptSegments(panel, 15, 30); // ~450ms
        if (segs && segs.length) return segs;
        segs = await waitForTranscriptSegments(panel, 50, 40); // 再等 ~2s
        if (segs && segs.length) return segs;
        return await waitForTranscriptSegments(panel, 60, 40); // 再等 ~2.4s（总共5s+）
    } else {
        // 🚀 第一次：给合理时间（总共最多2s），大部分情况能成功
        console.log('[YouTube转录 DOM] 第一次加载，等待字幕渲染...');
        segs = await waitForTranscriptSegments(panel, 15, 30); // ~450ms
        if (segs && segs.length) return segs;
        return await waitForTranscriptSegments(panel, 50, 30); // 再等 ~1.5s（总共2s）
    }
}

// Ultra 级：MutationObserver 捕捉出现，最低延迟；超时则回退
function waitForElement(selector, timeoutMs = 600) {
    return new Promise((resolve) => {
        const existing = document.querySelector(selector);
        if (existing) { resolve(existing); return; }
        const obs = new MutationObserver(() => {
            const el = document.querySelector(selector);
            if (el) { obs.disconnect(); resolve(el); }
        });
        obs.observe(document.documentElement || document.body, { childList: true, subtree: true });
        setTimeout(() => { obs.disconnect(); resolve(document.querySelector(selector)); }, timeoutMs);
    });
}

async function waitForTranscriptPanelUltra() {
    const viaObserver = await waitForElement(TRANSCRIPT_PANEL_SELECTOR, 600);
    if (viaObserver) return viaObserver;
    return await waitForTranscriptPanelFast();
}

function waitForTranscriptSegmentsUltra(panel, hasRefreshed) {
    return new Promise((resolve) => {
        const getSegs = () => getTranscriptSegments(findNativeTranscriptPanel() || panel);
        let lastCount = -1;
        let stableTimer = null;
        const done = (segs) => { try { obs.disconnect(); } catch(_){}; if (stableTimer) clearTimeout(stableTimer); resolve(segs || []); };
        const check = () => {
            const segs = getSegs();
            const count = segs ? segs.length : 0;
            if (count > 0) {
                if (count === lastCount) {
                    if (!stableTimer) stableTimer = setTimeout(() => done(segs), 120);
                } else {
                    lastCount = count;
                    if (stableTimer) { clearTimeout(stableTimer); stableTimer = null; }
                }
            }
        };
        const obs = new MutationObserver(check);
        try { obs.observe(panel, { childList: true, subtree: true }); } catch(_) { /* ignore */ }
        // 初始检查
        check();
        // 🚀 优化：第一次给合理时间（1500ms），刷新后给更充分时间（3000ms）
        const timeout = hasRefreshed ? 3000 : 1500;
        setTimeout(() => done(getSegs()), timeout);
    });
}

// 从 ytInitialPlayerResponse 提取章节（优先方式）
function extractChaptersFromPlayerResponse(playerResponse) {
    try {
        const markersMap = playerResponse?.playerOverlays?.playerOverlayRenderer
            ?.decoratedPlayerBarRenderer?.decoratedPlayerBarRenderer?.playerBar
            ?.multiMarkersPlayerBarRenderer?.markersMap;

        const result = [];

        if (Array.isArray(markersMap)) {
            for (const marker of markersMap) {
                if (marker?.key === 'DESCRIPTION_CHAPTERS') {
                    const chapterMarkers = marker.value?.chapters || [];
                    chapterMarkers.forEach(ch => {
                        const r = ch.chapterRenderer;
                        if (r) {
                            result.push({
                                title: (r.title?.simpleText || '').trim(),
                                start: (r.timeRangeStartMillis || 0) / 1000
                            });
                        }
                    });
                    break;
                }
            }
        }

        if (result.length > 0) {
            applyChapters(result, 2);
            console.log('[YouTube转录 DOM] 从playerResponse提取章节:', chapters.length);
        }
    } catch (err) {
        console.error('[YouTube转录 DOM] 提取章节失败:', err);
    }
}

// 获取 ytInitialPlayerResponse（容错实现）
function getYtInitialPlayerResponse() {
    return new Promise((resolve) => {
        // 方式1：window
        if (window.ytInitialPlayerResponse) {
            resolve(window.ytInitialPlayerResponse);
            return;
        }
        // 方式2：遍历 script 标签提取
        const scripts = document.getElementsByTagName('script');
        for (const script of scripts) {
            const content = script.textContent;
            if (!content || !content.includes('ytInitialPlayerResponse')) continue;
            try {
                const patterns = [
                    /var ytInitialPlayerResponse\s*=\s*({.+?});/,
                    /ytInitialPlayerResponse\s*=\s*({.+?});/
                ];
                for (const p of patterns) {
                    const m = content.match(p);
                    if (m && m[1]) {
                        const obj = JSON.parse(m[1]);
                        resolve(obj);
                        return;
                    }
                }
            } catch (_) { /* ignore */ }
        }
        // 方式3：延时回查
        setTimeout(() => resolve(window.ytInitialPlayerResponse || null), 1200);
    });
}

// 显示手动指引
function showManualInstructions() {
    const container = document.getElementById('transcript-content');
    if (container) {
        container.innerHTML = `
            <div style="padding: 20px; color: #f1f1f1;">
                <h4 style="margin-bottom: 15px;">📝 手动获取字幕</h4>
                <p style="line-height: 1.6; margin-bottom: 10px;">请按以下步骤操作：</p>
                <ol style="line-height: 1.8; padding-left: 20px;">
                    <li>在视频下方点击 <strong>"更多"</strong> 按钮 (...)</li>
                    <li>选择 <strong>"显示文字记录"</strong></li>
                    <li>字幕将自动显示在这里</li>
                </ol>
                <button onclick="location.reload()" style="margin-top: 15px; padding: 8px 16px; background: #065fd4; color: #fff; border: none; border-radius: 4px; cursor: pointer;">刷新重试</button>
            </div>
        `;
    }
}

// 创建侧边栏
function createSidebar() {
    // 清除所有之前的清理定时器，防止与新侧边栏冲突
    clearAllCleanupTimers();
    
    // 🔧 关键：首次加载时确保是浮动模式，不挤压视频
    // 清除所有可能残留的固定模式样式
    _isPinned = false;
    document.documentElement.classList.remove('yt-transcript-pinned');
    document.documentElement.style.removeProperty('--yt-transcript-sidebar-width');
    document.body.style.setProperty('margin-right', '0', 'important');
    
    const existingSidebar = document.getElementById('transcript-sidebar');
    if (existingSidebar) {
        existingSidebar.remove();
    }
    
    const sidebar = document.createElement('div');
    sidebar.id = 'transcript-sidebar';
    sidebar.className = 'transcript-sidebar';
    
    const header = document.createElement('div');
    header.className = 'transcript-header';
    
    header.innerHTML = `
        <div class="header-top">
            <h3>Transcript</h3>
            <div class="header-controls">
                <button id="pin-sidebar" class="control-btn" title="固定侧边栏">
                    <svg viewBox="0 0 24 24"><path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5v6l1 1 1-1v-6h5v-2l-2-2z"/></svg>
                </button>
                <button id="copy-transcript" class="control-btn" title="复制全部字幕">
                    <svg viewBox="0 0 24 24"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>
                </button>
                <button id="copy-url" class="control-btn" title="复制视频链接">
                    <svg viewBox="0 0 24 24"><path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z"/></svg>
                </button>
                <button id="download-epub" class="control-btn" title="下载 EPUB 电子书">
                    <svg viewBox="0 0 24 24"><path d="M18 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 4h5v8l-2.5-1.5L6 12V4z"/></svg>
                </button>
                <div class="header-divider"></div>
                <button id="toggle-sidebar" class="toggle-btn close-btn" title="关闭">
                    <svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
                </button>
            </div>
        </div>
        <input type="text" id="search-box" class="search-box" placeholder="搜索字幕...">
    `;
    
    const content = document.createElement('div');
    content.id = 'transcript-content';
    content.className = 'transcript-content';
    
    sidebar.appendChild(header);
    sidebar.appendChild(content);

    // 创建尺寸手柄（左侧和右下角）
    const leftHandle = document.createElement('div');
    leftHandle.className = 'resize-handle-left';
    sidebar.appendChild(leftHandle);
    const brHandle = document.createElement('div');
    brHandle.className = 'resize-handle-br';
    sidebar.appendChild(brHandle);
    
    // 添加侧边栏到页面，初始状态为隐藏（准备动画）
    sidebar.style.transform = 'translateX(100%)';
    sidebar.style.opacity = '0';
    document.body.appendChild(sidebar);
    
    // 绑定事件
    const toggleBtn = document.getElementById('toggle-sidebar');
    if (toggleBtn) {
        toggleBtn.addEventListener('click', toggleSidebar);
    }
    const pinBtn = document.getElementById('pin-sidebar');
    if (pinBtn) {
        pinBtn.addEventListener('click', () => setPinned(!isPinned()));
        // 🔧 默认不固定，用户需要手动点击 pin 按钮来固定
        // 根据当前状态设置按钮样式
        if (isPinned()) {
            pinBtn.classList.add('active');
            pinBtn.title = '取消固定';
        } else {
            pinBtn.classList.remove('active');
            pinBtn.title = '固定侧边栏';
        }
    }
    const copyBtn = document.getElementById('copy-transcript');
    if (copyBtn) {
        copyBtn.addEventListener('click', () => copyTranscript());
    }
    const copyUrlBtn = document.getElementById('copy-url');
    if (copyUrlBtn) {
        copyUrlBtn.addEventListener('click', () => copyPageUrl());
    }
    
    const epubBtn = document.getElementById('download-epub');
    if (epubBtn) {
        epubBtn.addEventListener('click', () => {
            if (typeof window.downloadTranscriptAsEpub === 'function') {
                window.downloadTranscriptAsEpub();
                return;
            }

            console.error('[YouTube转录 DOM] EPUB 下载函数未加载');
            showCopyToast('EPUB 功能未加载');
        });
    }
    
    const searchBox = document.getElementById('search-box');
    if (searchBox) {
        searchBox.addEventListener('input', handleSearch);
    }
    
    // 启用拖拽和缩放
    enableSidebarDrag(sidebar, header);
    enableSidebarResize(sidebar, leftHandle, brHandle);
    
    // 恢复之前的尺寸设置
    const savedState = getSavedSidebarState();
    const targetWidth = (savedState && savedState.width) ? savedState.width : 300;
    
    // 设置侧边栏尺寸但暂不触发布局变化
    sidebar.style.width = targetWidth + 'px';
    sidebar.style.right = '0px';
    // 🔧 确保侧边栏填满整个高度（自适应窗口大小）
    sidebar.style.top = '0';
    sidebar.style.bottom = '0';
    sidebar.style.height = '100vh';
    
    // 🔧 每次打开都是浮动模式（覆盖在视频上），不挤压视频
    // 用户需要手动点击 pin 按钮才会固定并适配屏幕
    _isPinned = false;
    
    // 使用 requestAnimationFrame 实现丝滑的入场动画
    // 先让浏览器完成布局计算
    requestAnimationFrame(() => {
        // 再下一帧开始动画
        requestAnimationFrame(() => {
            // 🔧 关键：确保浮动模式，清除所有固定模式相关样式，不挤压视频
            document.documentElement.classList.remove('yt-transcript-pinned');
            document.documentElement.style.removeProperty('--yt-transcript-sidebar-width');
            document.body.style.setProperty('margin-right', '0', 'important');
            
            // 让侧边栏滑入
            sidebar.style.transition = 'transform 0.4s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.4s ease';
            sidebar.style.transform = 'translateX(0)';
            sidebar.style.opacity = '1';
            
            console.log('[YouTube转录 DOM] 侧边栏丝滑入场动画已触发（浮动模式）');
            
            // 动画完成后清理transition和margin-right
            setTimeout(() => {
                sidebar.style.transition = '';
                document.body.style.removeProperty('margin-right');
            }, 450);
        });
    });

    // 在用户与滚动区域交互时，短暂禁用自动跟随
    const markUserScroll = () => { blockAutoScrollUntil = Date.now() + AUTOSCROLL_COOLDOWN_MS; };
    content.addEventListener('wheel', markUserScroll, { passive: true });
    content.addEventListener('touchstart', markUserScroll, { passive: true });
    content.addEventListener('pointerdown', markUserScroll, { passive: true });
    content.addEventListener('scroll', markUserScroll, { passive: true });
    content.dataset.scrollHandlers = '1';

    // 双击标题，停靠到右侧并恢复默认尺寸
    header.addEventListener('dblclick', () => {
        dockSidebarRight(sidebar);
    });
}

function clamp(val, min, max) { return Math.min(Math.max(val, min), max); }

function saveSidebarState(state) {
    try {
        localStorage.setItem('transcriptSidebarState', JSON.stringify(state));
    } catch (_) {}
}

function getSavedSidebarState() {
    try {
        const s = localStorage.getItem('transcriptSidebarState');
        return s ? JSON.parse(s) : null;
    } catch (_) { return null; }
}

function applySavedSidebarState(sidebar) {
    const s = getSavedSidebarState();
    if (!s) return;
    if (s.mode === 'free') {
        sidebar.style.right = 'auto';
        sidebar.style.left = (s.left || 0) + 'px';
        sidebar.style.top = (s.top || 0) + 'px';
        const maxW = Math.min(900, window.innerWidth - 20);
        const maxH = window.innerHeight - 20;
        if (s.width) sidebar.style.width = Math.min(s.width, maxW) + 'px';
        if (s.height) sidebar.style.height = Math.min(s.height, maxH) + 'px';
    } else if (s.mode === 'dock-right') {
        dockSidebarRight(sidebar, s.width);
    }
}

function dockSidebarRight(sidebar, width = 300) {
    sidebar.style.left = '';
    sidebar.style.top = '0';  // 🔧 明确设置 top 为 0，确保从顶部开始
    sidebar.style.right = '0px';
    sidebar.style.bottom = '0';  // 🔧 设置 bottom 为 0，确保延伸到底部
    const w = Math.min(width, Math.min(600, window.innerWidth - 20));
    sidebar.style.width = w + 'px';
    sidebar.style.height = '100vh';  // 填满整个视口高度
    saveSidebarState({ mode: 'dock-right', width: w });
    // 若处于固定模式，更新右侧保留空间
    updatePinnedSpace();
}

// --- 固定模式（Pin）支持 ---
const PIN_STYLE_ID = 'yt-transcript-pin-style';

function ensurePinStyleElement() {
    if (document.getElementById(PIN_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = PIN_STYLE_ID;
    style.textContent = `
      /* 固定模式：为页面右侧预留侧边栏空间，视频自动填充剩余空间 */
      html.yt-transcript-pinned {
        --sidebar-width: var(--yt-transcript-sidebar-width, 300px);
      }
      
      /* 页面右侧预留空间（直接作用于 body，最稳妥） */
      html.yt-transcript-pinned body {
        margin-right: var(--sidebar-width) !important;
        transition: margin-right 0.4s cubic-bezier(0.4, 0, 0.2, 1);
      }

      /* 让播放器贴左，不留中间黑边（仅在固定模式下生效） */
      html.yt-transcript-pinned ytd-watch-flexy {
        width: 100% !important;
        max-width: 100% !important;
      }
      html.yt-transcript-pinned ytd-watch-flexy #columns {
        gap: 0 !important;
        column-gap: 0 !important;
      }
      /* 移除右侧推荐/次要列，避免占位造成中间黑块 */
      html.yt-transcript-pinned ytd-watch-flexy #secondary {
        display: none !important;
        width: 0 !important;
        max-width: 0 !important;
        flex: 0 0 0 !important;
      }
      html.yt-transcript-pinned ytd-watch-flexy #player-theater-container,
      html.yt-transcript-pinned ytd-watch-flexy #player-wide-container,
      html.yt-transcript-pinned ytd-watch-flexy #player-container,
      html.yt-transcript-pinned ytd-watch-flexy #player {
        margin-left: 0 !important;
        margin-right: 0 !important;
        justify-content: flex-start !important;
      }
      /* 🔧 关键：控制主容器宽度，填充剩余空间，消除中间空隙 */
      html.yt-transcript-pinned ytd-watch-flexy #primary {
        max-width: calc(100vw - var(--sidebar-width)) !important;
        width: calc(100vw - var(--sidebar-width)) !important;
      }
      
      /* 一些页面变体使用外层容器控制对齐，统一贴左 */
      html.yt-transcript-pinned #primary,
      html.yt-transcript-pinned #columns,
      html.yt-transcript-pinned #center,
      html.yt-transcript-pinned #player-container-outer {
        margin-left: 0 !important;
        margin-right: 0 !important;
        padding-right: 0 !important;
      }
      
      /* 🔧 关键：直接控制视频播放器元素，确保视频实时自适应 */
      html.yt-transcript-pinned #player-container,
      html.yt-transcript-pinned #movie_player,
      html.yt-transcript-pinned .html5-video-container,
      html.yt-transcript-pinned .html5-video-player {
        max-width: calc(100vw - var(--sidebar-width)) !important;
        width: 100% !important;
      }
      html.yt-transcript-pinned video {
        max-width: 100% !important;
        width: 100% !important;
      }
      
      /* 🔧 关键：直接控制视频播放器元素，确保视频实时自适应 */
      html.yt-transcript-pinned #player-container,
      html.yt-transcript-pinned #movie_player,
      html.yt-transcript-pinned .html5-video-container,
      html.yt-transcript-pinned .html5-video-player {
        max-width: calc(100vw - var(--sidebar-width)) !important;
        width: 100% !important;
      }
      html.yt-transcript-pinned video {
        max-width: 100% !important;
        width: 100% !important;
      }
      
      /* 取消固定时恢复 */
      html:not(.yt-transcript-pinned) body {
        margin-right: 0 !important;
        transition: margin-right 0.4s cubic-bezier(0.4, 0, 0.2, 1);
      }
      
      /* 确保侧边栏始终可见 */
      .transcript-sidebar {
        z-index: 2147483647 !important;
      }
      
      /* 全屏模式下移除预留空间 */
      html.yt-transcript-pinned:fullscreen ytd-app,
      html.yt-transcript-pinned:-webkit-full-screen ytd-app,
      html.yt-transcript-pinned:-moz-full-screen ytd-app {
        margin-right: 0 !important;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
}

// 🔧 简化：使用内存变量而非 localStorage，每次打开都是浮动模式
let _isPinned = false;

function isPinned() {
    return _isPinned;
}

function setPinned(pinned) {
    _isPinned = pinned;
    applyPinnedState();
}

function applyPinnedState() {
    const sidebar = document.getElementById('transcript-sidebar');
    const pinBtn = document.getElementById('pin-sidebar');
    const pinned = isPinned();
    if (!sidebar) return;
    ensurePinStyleElement();
    if (pinned) {
        // 固定时将侧边栏停靠在右侧，确保尺寸和位置稳定
        dockSidebarRight(sidebar, parseInt(sidebar.style.width || '300', 10));
        document.documentElement.classList.add('yt-transcript-pinned');
        if (pinBtn) { pinBtn.classList.add('active'); pinBtn.title = '取消固定'; }
    } else {
        document.documentElement.classList.remove('yt-transcript-pinned');
        if (pinBtn) { pinBtn.classList.remove('active'); pinBtn.title = '固定侧边栏'; }
    }
    updatePinnedSpace();
}

function updatePinnedSpace() {
    const sidebar = document.getElementById('transcript-sidebar');
    if (!sidebar) return;
    if (!isPinned()) return;
    const rect = sidebar.getBoundingClientRect();
    const w = Math.max(280, Math.min(900, rect.width || parseInt(sidebar.style.width || '300', 10)));
    document.documentElement.style.setProperty('--yt-transcript-sidebar-width', w + 'px');
    
    // 🔧 强制 YouTube 播放器重新计算尺寸
    try {
        const player = document.querySelector('#movie_player');
        if (player && typeof player.updateVideoElementSize === 'function') {
            player.updateVideoElementSize();
        }
        
        // 触发视频容器的尺寸重算
        const video = document.querySelector('video');
        if (video) {
            // 通过微小的样式变化触发重排
            video.style.opacity = '0.9999';
            requestAnimationFrame(() => {
                video.style.opacity = '1';
            });
        }
        
        // 触发窗口 resize 事件，让 YouTube 重新计算布局
        requestAnimationFrame(() => {
            window.dispatchEvent(new Event('resize'));
        });
    } catch (e) {
        // 忽略错误
    }
}

// 禁用布局过渡动画（拖动时用，实现实时挤压效果）
function disableLayoutTransition() {
    const body = document.body;
    if (body) {
        body.style.transition = 'none';
    }
    
    // 也禁用YouTube容器的transition
    const watchFlexy = document.querySelector('ytd-watch-flexy');
    if (watchFlexy) {
        watchFlexy.style.transition = 'none';
    }
    
    console.log('[YouTube转录 DOM] 🎯 已禁用布局过渡（拖动中，实时挤压）');
}

// 恢复布局过渡动画（拖动结束后，恢复丝滑动画）
function enableLayoutTransition() {
    const body = document.body;
    if (body) {
        // 移除内联样式，让CSS规则生效
        body.style.transition = '';
    }
    
    const watchFlexy = document.querySelector('ytd-watch-flexy');
    if (watchFlexy) {
        watchFlexy.style.transition = '';
    }
    
    console.log('[YouTube转录 DOM] ✨ 已恢复布局过渡');
}

function enableSidebarDrag(sidebar, handle) {
    let dragging = false;
    let startX = 0, startY = 0;
    let origLeft = 0, origTop = 0;

    const onMouseMove = (e) => {
        if (!dragging) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        const newLeft = clamp(origLeft + dx, 0, window.innerWidth - sidebar.offsetWidth - 10);
        const newTop = clamp(origTop + dy, 0, window.innerHeight - 80); // 留出上方空间
        sidebar.style.left = newLeft + 'px';
        sidebar.style.top = newTop + 'px';
    };

    const onMouseUp = () => {
        if (!dragging) return;
        dragging = false;
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        saveSidebarState({
            mode: 'free',
            left: parseInt(sidebar.style.left || '0'),
            top: parseInt(sidebar.style.top || '0'),
            width: parseInt(sidebar.style.width || '300'),
            height: parseInt(sidebar.style.height || (window.innerHeight)),
        });
        handle.style.cursor = 'move';
        updatePinnedSpace();
    };

    handle.addEventListener('mousedown', (e) => {
        // 避免按钮触发拖拽
        if (e.target.closest('button') || e.target.closest('input')) return;
        dragging = true;
        const rect = sidebar.getBoundingClientRect();
        // 切换为自由模式
        sidebar.style.right = 'auto';
        sidebar.style.left = rect.left + 'px';
        sidebar.style.top = rect.top + 'px';
        sidebar.style.height = rect.height + 'px';
        startX = e.clientX; startY = e.clientY;
        origLeft = rect.left; origTop = rect.top;
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
        handle.style.cursor = 'grabbing';
        e.preventDefault();
    });
}

function enableSidebarResize(sidebar, leftHandle, brHandle) {
    const minW = 280, minH = 240;

    // 左侧宽度拖拽
    leftHandle.addEventListener('mousedown', (e) => {
        const rect = sidebar.getBoundingClientRect();
        const startX = e.clientX;
        const startLeft = rect.left;
        const startWidth = rect.width;
        const dockedRight = (sidebar.style.right === '0px') || isPinned();
        if (!dockedRight) sidebar.style.right = 'auto';
        
        // 🎯 拖动开始：禁用transition，实现实时挤压
        disableLayoutTransition();
        
        const onMove = (ev) => {
            const dx = ev.clientX - startX;
            const maxW = Math.min(900, window.innerWidth - 20);
            let newWidth = startWidth - dx; // 向左拖大，向右拖小
            newWidth = clamp(newWidth, minW, maxW);
            if (dockedRight) {
                // 仍停靠右侧，仅改变宽度
                sidebar.style.width = newWidth + 'px';
            } else {
                let newLeft = startLeft + dx;
                newLeft = clamp(newLeft, 0, window.innerWidth - newWidth - 10);
                sidebar.style.left = newLeft + 'px';
                sidebar.style.width = newWidth + 'px';
            }
            updatePinnedSpace();  // 实时更新，视频立即跟随
        };
        const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            
            // ✨ 拖动结束：恢复transition，保持丝滑动画
            enableLayoutTransition();
            
            const rect2 = sidebar.getBoundingClientRect();
            if (dockedRight) {
                saveSidebarState({ mode: 'dock-right', width: rect2.width });
            } else {
                saveSidebarState({ mode: 'free', left: rect2.left, top: rect2.top, width: rect2.width, height: rect2.height });
            }
            updatePinnedSpace();
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
        e.preventDefault();
        e.stopPropagation();
    });

    // 右下角宽高拖拽
    brHandle.addEventListener('mousedown', (e) => {
        const rect = sidebar.getBoundingClientRect();
        const startX = e.clientX, startY = e.clientY;
        const startW = rect.width, startH = rect.height;
        const dockedRight = (sidebar.style.right === '0px') || isPinned();
        
        // 🎯 拖动开始：禁用transition，实现实时挤压
        disableLayoutTransition();
        
        const onMove = (ev) => {
            const dx = ev.clientX - startX;
            const dy = ev.clientY - startY;
            const maxW = Math.min(900, window.innerWidth - 20);
            const maxH = window.innerHeight - 20;
            let w = clamp(startW + dx, minW, maxW);
            let h = clamp(startH + dy, minH, maxH);
            sidebar.style.width = w + 'px';
            sidebar.style.height = h + 'px';
            updatePinnedSpace();  // 实时更新，视频立即跟随
        };
        const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            
            // ✨ 拖动结束：恢复transition，保持丝滑动画
            enableLayoutTransition();
            
            const rect2 = sidebar.getBoundingClientRect();
            if (dockedRight) {
                saveSidebarState({ mode: 'dock-right', width: rect2.width });
            } else {
                // 进入自由模式以保存大小
                sidebar.style.right = 'auto';
                sidebar.style.left = rect2.left + 'px';
                sidebar.style.top = rect2.top + 'px';
                saveSidebarState({ mode: 'free', left: rect2.left, top: rect2.top, width: rect2.width, height: rect2.height });
            }
            updatePinnedSpace();
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
        e.preventDefault();
        e.stopPropagation();
    });
}

// 一键复制整个字幕（章节+时间戳+文本）
async function copyTranscript() {
    try {
        if (!Array.isArray(transcriptData) || transcriptData.length === 0) {
            showErrorMessage('暂无字幕可复制');
            return;
        }
        const lines = [];
        let ci = 0;
        const hasCh = Array.isArray(chapters) && chapters.length > 0;
        for (let i = 0; i < transcriptData.length; i++) {
            const seg = transcriptData[i];
            if (hasCh) {
                while (ci < chapters.length && seg.start >= chapters[ci].start) {
                    const ch = chapters[ci];
                    if (i === 0 || transcriptData[i - 1].start < ch.start) {
                        lines.push(`${formatTime(ch.start)} ${ch.title}`.trim());
                        lines.push('');
                    }
                    ci++;
                }
            }
            lines.push(`${formatTime(seg.start)} ${seg.text}`);
        }
        const text = lines.join('\n');
        await writeToClipboard(text);
        const btn = document.getElementById('copy-transcript');
        if (btn) {
            const originalHtml = btn.innerHTML;
            btn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" fill="#4caf50"/></svg>';
            setTimeout(() => btn.innerHTML = originalHtml, 1500);
        }
        showCopyToast('已复制全部字幕');
    } catch (err) {
        console.error('[YouTube转录 DOM] 复制失败:', err);
    }
}

// 複制當前頁面的網址
async function copyPageUrl() {
    try {
        const url = window.location.href;
        await writeToClipboard(url);
        const btn = document.getElementById('copy-url');
        if (btn) {
            const originalHtml = btn.innerHTML;
            btn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" fill="#4caf50"/></svg>';
            setTimeout(() => btn.innerHTML = originalHtml, 1500);
        }
        showCopyToast('已复制视频链接');
    } catch (err) {
        console.error('[YouTube轉錄 DOM] 複制頁面網址失敗:', err);
    }
}

function writeToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
        return navigator.clipboard.writeText(text);
    }
    return new Promise((resolve) => {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        resolve();
    });
}

// 🔧 复制单条字幕文本并显示视觉反馈
async function copyTextToClipboard(text, element) {
    try {
        await writeToClipboard(text);
        
        // 显示复制成功的视觉反馈
        const originalBg = element.style.backgroundColor;
        const originalColor = element.style.color;
        
        // 闪烁绿色表示复制成功
        element.style.backgroundColor = '#4caf50';
        element.style.color = '#fff';
        element.style.transition = 'background-color 0.2s, color 0.2s';
        
        // 显示复制成功提示
        showCopyToast('已复制');
        
        // 0.5秒后恢复原样
        setTimeout(() => {
            element.style.backgroundColor = originalBg;
            element.style.color = originalColor;
        }, 500);
        
        console.log('[YouTube转录 DOM] 已复制文本:', text.substring(0, 30) + '...');
    } catch (err) {
        console.error('[YouTube转录 DOM] 复制失败:', err);
        showCopyToast('复制失败');
    }
}

// 显示复制提示 Toast
function showCopyToast(message) {
    // 移除已存在的 toast
    const existingToast = document.getElementById('transcript-copy-toast');
    if (existingToast) {
        existingToast.remove();
    }
    
    const toast = document.createElement('div');
    toast.id = 'transcript-copy-toast';
    toast.textContent = message;
    toast.style.cssText = `
        position: fixed;
        bottom: 80px;
        left: 50%;
        transform: translateX(-50%);
        background-color: rgba(0, 0, 0, 0.8);
        color: #fff;
        padding: 10px 20px;
        border-radius: 20px;
        font-size: 14px;
        z-index: 2147483647;
        opacity: 0;
        transition: opacity 0.3s ease;
        pointer-events: none;
    `;
    
    document.body.appendChild(toast);
    
    // 淡入
    requestAnimationFrame(() => {
        toast.style.opacity = '1';
    });
    
    // 1.5秒后淡出并移除
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => {
            toast.remove();
        }, 300);
    }, 1500);
}

function createChapterHeaderElement(chapter) {
    const chapterDiv = document.createElement('div');
    chapterDiv.className = 'chapter-header';

    const ts = document.createElement('span');
    ts.className = 'chapter-timestamp';
    ts.textContent = formatTime(chapter.start);

    const titleEl = document.createElement('span');
    titleEl.className = 'chapter-title';
    titleEl.textContent = chapter.title || '';

    chapterDiv.appendChild(ts);
    chapterDiv.appendChild(titleEl);
    chapterDiv.addEventListener('click', () => {
        if (videoElement) {
            videoElement.currentTime = chapter.start;
        }
    });

    return chapterDiv;
}

function createTranscriptItemElement(item, index, query) {
    const div = document.createElement('div');
    div.className = 'transcript-item';
    div.dataset.index = index;

    const timestamp = document.createElement('span');
    timestamp.className = 'timestamp';
    timestamp.textContent = formatTime(item.start);

    const text = document.createElement('span');
    text.className = 'text';

    if (query) {
        const regex = new RegExp(`(${query})`, 'gi');
        text.innerHTML = item.text.replace(regex, '<mark style="background-color: #ffeb3b; color: #000;">$1</mark>');
        div.classList.add('highlight');
    } else {
        text.textContent = item.text;
    }

    div.appendChild(timestamp);
    div.appendChild(text);

    timestamp.addEventListener('click', (e) => {
        e.stopPropagation();
        if (videoElement) {
            videoElement.currentTime = item.start;
            highlightTranscript(index);
        }
    });

    text.addEventListener('click', (e) => {
        e.stopPropagation();
        copyTextToClipboard(item.text, text);
    });

    div.addEventListener('click', (e) => {
        if (e.target === timestamp || e.target === text || text.contains(e.target)) {
            return;
        }
        if (videoElement) {
            videoElement.currentTime = item.start;
            highlightTranscript(index);
        }
    });

    return div;
}

// 渲染字幕
function renderTranscript(filterQuery = '') {
    const container = document.getElementById('transcript-content');
    if (!container || transcriptData.length === 0) return;

    container.innerHTML = '';

    const query = filterQuery.toLowerCase().trim();
    let currentChapterIndex = 0;

    transcriptData.forEach((item, index) => {
        if (query && !item.text.toLowerCase().includes(query)) {
            return;
        }

        if (!query && chapters.length > 0 && currentChapterIndex < chapters.length) {
            const chapter = chapters[currentChapterIndex];
            if (item.start >= chapter.start && (index === 0 || transcriptData[index - 1].start < chapter.start)) {
                container.appendChild(createChapterHeaderElement(chapter));
                currentChapterIndex++;
            }
        }

        container.appendChild(createTranscriptItemElement(item, index, query));
    });

    if (query) {
        const count = container.children.length;
        if (count === 0) {
            container.innerHTML = '<div style="padding: 20px; text-align: center; color: #606060;">No results found</div>';
        }
    }
}

function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function showLoadingMessage(msg) {
    const container = document.getElementById('transcript-content');
    if (container) {
        container.innerHTML = `<div style="padding: 20px; text-align: center; color: #aaa;"><div style="margin-bottom: 10px;">⏳</div><p>${msg}</p></div>`;
    }
}

function decodeHTMLEntities(text) {
    const textarea = document.createElement('textarea');
    textarea.innerHTML = text;
    return textarea.value;
}

function showErrorMessage(msg) {
    const container = document.getElementById('transcript-content');
    if (container) {
        container.innerHTML = `<div style="padding: 20px; text-align: center; color: #ff6b6b;"><div style="margin-bottom: 10px;">❌</div><p>${msg}</p></div>`;
    }
}

function showNoTranscriptMessage() {
    const container = document.getElementById('transcript-content');
    if (container) {
        container.innerHTML = `<div style="padding: 20px; text-align: center; color: #aaa;"><div style="margin-bottom: 10px;">📝</div><p>此视频没有可用的字幕</p></div>`;
    }
}

// 节流控制：限制更新频率，避免性能问题
let lastTimeUpdateCall = 0;
const TIME_UPDATE_THROTTLE_MS = 500; // 每500ms最多更新一次

function onTimeUpdate() {
    if (videoElement && !videoElement.paused) {
        const now = Date.now();
        if (now - lastTimeUpdateCall >= TIME_UPDATE_THROTTLE_MS) {
            lastTimeUpdateCall = now;
            updateTranscriptHighlight(videoElement.currentTime);
        }
    }
}

function startTimeTracking() {
    if (videoElement) {
        updateTranscriptHighlight(videoElement.currentTime);
    }
}

function stopTimeTracking() {
    // 保留函数，但不停止追踪，由 timeupdate 事件处理
}

function updateTranscriptHighlight(currentTime) {
    // 使用二分查找优化性能（适用于大量字幕数据）
    if (transcriptData.length === 0) return;
    
    let left = 0;
    let right = transcriptData.length - 1;
    let currentIndex = -1;
    
    while (left <= right) {
        const mid = Math.floor((left + right) / 2);
        const item = transcriptData[mid];
        const nextItem = transcriptData[mid + 1];
        
        if (currentTime >= item.start && (!nextItem || currentTime < nextItem.start)) {
            currentIndex = mid;
            break;
        } else if (currentTime < item.start) {
            right = mid - 1;
        } else {
            left = mid + 1;
        }
    }
    
    if (currentIndex !== -1 && currentIndex !== currentActiveIndex) {
        highlightTranscript(currentIndex);
    }
}

function updateCurrentHighlight() {
    if (videoElement) {
        updateTranscriptHighlight(videoElement.currentTime);
    }
}

function highlightTranscript(index) {
    // 优化：直接通过 ID 查找，避免遍历所有元素
    const previousActive = document.querySelector('.transcript-item.active');
    if (previousActive) {
        previousActive.classList.remove('active');
    }
    
    // 使用 data-index 属性直接查找目标元素
    const targetItem = document.querySelector(`.transcript-item[data-index="${index}"]`);
    
    if (targetItem) {
        targetItem.classList.add('active');
        // 仅在未处于用户滚动冷却期且目标不在可视区域内时，自动滚动到视图
        const container = document.getElementById('transcript-content');
        if (container) {
            const now = Date.now();
            if (now >= blockAutoScrollUntil) {
                const cRect = container.getBoundingClientRect();
                const iRect = targetItem.getBoundingClientRect();
                const fullyVisible = iRect.top >= cRect.top + 8 && iRect.bottom <= cRect.bottom - 8;
                if (!fullyVisible) {
                    // 使用 requestAnimationFrame 避免阻塞主线程
                    requestAnimationFrame(() => {
                        targetItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    });
                }
            }
        }
    }
    
    currentActiveIndex = index;
}

// 搜索功能
function handleSearch(event) {
    searchQuery = event.target.value;
    renderTranscript(searchQuery);
}

// 用于跟踪清理定时器，避免时序冲突
let cleanupTimers = [];

// 清除所有清理定时器（定义在前面，供多个函数使用）
function clearAllCleanupTimers() {
    cleanupTimers.forEach(timer => clearTimeout(timer));
    cleanupTimers = [];
    console.log('[YouTube转录 DOM] 已清除所有清理定时器');
}

function hideSidebar() {
    const sidebar = document.getElementById('transcript-sidebar');
    if (!sidebar) return;
    
    console.log('[YouTube转录 DOM] 🚀 隐藏侧边栏（保留字幕数据）');
    
    // 清除之前的定时器
    clearAllCleanupTimers();
    
    // 第一步：立即清除所有固定模式相关的样式
    _isPinned = false;
    document.documentElement.classList.remove('yt-transcript-pinned');
    document.documentElement.style.removeProperty('--yt-transcript-sidebar-width');
    
    // 第二步：强制设置body margin为0
    document.body.style.setProperty('margin-right', '0', 'important');
    
    // 触发布局更新，让视频立即恢复满屏
    requestAnimationFrame(() => {
        window.dispatchEvent(new Event('resize'));
    });
    
    // 第三步：启动侧边栏滑出动画
    sidebar.style.transition = 'transform 0.4s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.4s ease';
    sidebar.style.transform = 'translateX(100%)';
    sidebar.style.opacity = '0';
    
    // 🔧 关键修改：动画完成后只隐藏，不移除侧边栏（保留字幕数据）
    setTimeout(() => {
        sidebar.style.display = 'none';
        sidebar.style.transition = '';
        document.body.style.removeProperty('margin-right');
        console.log('[YouTube转录 DOM] ✅ 侧边栏已隐藏（字幕数据保留）');
    }, 450);
}

function showSidebar() {
    const sidebar = document.getElementById('transcript-sidebar');
    if (!sidebar) return;
    
    console.log('[YouTube转录 DOM] 开始显示侧边栏，启动丝滑动画...');
    
    sidebar.classList.remove('collapsed');
    sidebar.style.display = 'flex';  // 使用 flex 而不是 block，确保内部布局正确
    sidebar.style.pointerEvents = 'auto';
    
    // 恢复尺寸设置
    const savedState = getSavedSidebarState();
    const targetWidth = (savedState && savedState.width) ? savedState.width : 300;
    sidebar.style.width = targetWidth + 'px';
    sidebar.style.right = '0px';
    
    // 🔧 确保侧边栏填满整个高度
    sidebar.style.top = '0';
    sidebar.style.bottom = '0';
    sidebar.style.height = '100vh';
    
    // 🔧 每次打开都是浮动模式，用户需手动点击 pin 才固定
    _isPinned = false;
    
    // 设置初始隐藏状态（在屏幕右侧外）
    sidebar.style.transform = 'translateX(100%)';
    sidebar.style.opacity = '0';
    
    const headerEl = document.querySelector('#transcript-sidebar .transcript-header');
    if (headerEl) headerEl.style.cursor = 'move';
    
    // 确保滚动容器处于可滚动状态
    const content = document.getElementById('transcript-content');
    if (content) {
        content.style.overflowY = 'auto';
        content.style.pointerEvents = 'auto';
        // 再次绑定一次（幂等）
        if (!content.dataset.scrollHandlers) {
            const markUserScroll = () => { blockAutoScrollUntil = Date.now() + AUTOSCROLL_COOLDOWN_MS; };
            content.addEventListener('wheel', markUserScroll, { passive: true });
            content.addEventListener('touchstart', markUserScroll, { passive: true });
            content.addEventListener('pointerdown', markUserScroll, { passive: true });
            content.addEventListener('scroll', markUserScroll, { passive: true });
            content.dataset.scrollHandlers = '1';
        }
    }
    
    // 🔧 确保 pin 按钮状态为非激活（浮动模式）
    const pinBtn = document.getElementById('pin-sidebar');
    if (pinBtn) {
        pinBtn.classList.remove('active');
        pinBtn.title = '固定侧边栏';
    }
    
    // 使用 requestAnimationFrame 实现丝滑的入场动画
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            // 🔧 默认浮动模式，不应用固定状态，直接让侧边栏滑入覆盖在视频上
            // 确保移除固定类和相关样式
            document.documentElement.classList.remove('yt-transcript-pinned');
            document.documentElement.style.removeProperty('--yt-transcript-sidebar-width');
            document.body.style.removeProperty('margin-right');
            
            // 让侧边栏滑入
            sidebar.style.transition = 'transform 0.4s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.4s ease';
            sidebar.style.transform = 'translateX(0)';
            sidebar.style.opacity = '1';
            
            console.log('[YouTube转录 DOM] 侧边栏显示动画已触发（浮动模式）');
            
            // 动画完成后清理transition
            setTimeout(() => {
                sidebar.style.transition = '';
            }, 450);
        });
    });
    
    // 立即同步一次高亮和滚动
    blockAutoScrollUntil = 0;
    setTimeout(updateCurrentHighlight, 50);
}

function toggleSidebar() {
    const sidebar = document.getElementById('transcript-sidebar');
    if (!sidebar) return;
    hideSidebar();
}

// 🚀 性能优化：移除自动初始化，改为按需加载
// 只有用户点击扩展图标（或刷新后自动恢复）时才初始化
// 避免影响视频加载性能，防止卡顿
// if (document.readyState === 'loading') {
//     document.addEventListener('DOMContentLoaded', () => setTimeout(init, 1000));
// } else {
//     setTimeout(init, 1000);
// }

// 监听URL变化
let lastUrl = location.href;
new MutationObserver(() => {
    const url = location.href;
    if (url !== lastUrl) {
        lastUrl = url;
        console.log('[YouTube转录 DOM] URL 变化，清除刷新标记和旧数据');
        // 清除刷新标记
        sessionStorage.removeItem('yt-transcript-refreshed');
        sessionStorage.removeItem('yt-transcript-auto-open');
        sessionStorage.removeItem('yt-transcript-loaded');
        
        // 🔧 清除旧的字幕数据，避免显示上一个视频的字幕
        transcriptData = [];
        resetTranscriptStructure();
        chapters = [];
        chapterSourcePriority = 0;
        currentActiveIndex = -1;
        
        // 🚀 性能优化：移除旧的侧边栏，但不自动初始化
        // 让用户主动点击扩展图标来打开字幕，避免自动加载导致视频卡顿
        if (url.includes('/watch')) {
            const existingSidebar = document.getElementById('transcript-sidebar');
            if (existingSidebar) existingSidebar.remove();
            
            // ⚠️ 不在这里关闭原生面板！
            // 因为YouTube需要时间处理，过早关闭会导致下次打开时状态混乱
            // 改为在用户点击扩展时强制重置面板状态
            
            // 不再自动初始化，只有用户点击时才初始化
            // setTimeout(init, 2000);
        }
    }
}).observe(document, { subtree: true, childList: true });

// 监听来自background的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'PING_TRANSCRIPT') {
        sendResponse({ ok: true });
        return; // 同步响应
    }

    if (request.type === 'TOGGLE_SIDEBAR') {
        const sidebar = document.getElementById('transcript-sidebar');
        
        if (sidebar) {
            // 🔧 侧边栏已存在，只切换显示/隐藏，不重新加载字幕
            const isVisible = sidebar.style.display !== 'none';
            if (isVisible) {
                hideSidebar();
                console.log('[YouTube转录 DOM] 侧边栏已隐藏');
                sendResponse({ visible: false });
            } else {
                // 直接显示已存在的侧边栏，不重新加载
                showSidebar();
                console.log('[YouTube转录 DOM] 侧边栏已显示（使用缓存的字幕）');
                sendResponse({ visible: true });
            }
        } else {
            // 🔧 侧边栏不存在，首次初始化并加载字幕
            console.log('[YouTube转录 DOM] 侧边栏不存在，首次初始化...');
            init();
            sendResponse({ visible: true });
        }
        
        return true; // 异步响应
    }
});

// 适配窗口变化：确保侧边栏在屏幕内并按窗口收缩
window.addEventListener('resize', () => {
    const sidebar = document.getElementById('transcript-sidebar');
    if (!sidebar || sidebar.style.display === 'none') return;
    const rect = sidebar.getBoundingClientRect();
    const maxLeft = Math.max(0, window.innerWidth - rect.width - 10);
    const maxTop = Math.max(0, window.innerHeight - 80);
    if (sidebar.style.right !== '0px') {
        // 自由模式：限制在屏幕内
        sidebar.style.left = clamp(rect.left, 0, maxLeft) + 'px';
        sidebar.style.top = clamp(rect.top, 0, maxTop) + 'px';
        const maxW = Math.min(900, window.innerWidth - 20);
        const maxH = window.innerHeight - 20;
        sidebar.style.width = Math.min(rect.width, maxW) + 'px';
        sidebar.style.height = Math.min(rect.height, maxH) + 'px';
    } else {
        // 🔧 固定在右侧时：确保填满整个高度
        const w = Math.min(parseInt(sidebar.style.width || '300', 10), Math.min(600, window.innerWidth - 20));
        sidebar.style.width = w + 'px';
        sidebar.style.top = '0';
        sidebar.style.bottom = '0';
        sidebar.style.height = '100vh';
    }
    // 固定模式下同步预留空间
    updatePinnedSpace();
});

// 🔧 智能刷新后自动打开：检查是否是刷新后需要自动打开侧边栏
window.addEventListener('load', () => {
    const shouldAutoOpen = sessionStorage.getItem('yt-transcript-auto-open');
    if (shouldAutoOpen) {
        console.log('[YouTube转录 DOM] 检测到刷新标记，自动打开侧边栏...');
        // 清除标记
        sessionStorage.removeItem('yt-transcript-auto-open');
        // 延迟一下确保页面完全加载
        setTimeout(() => {
            init();
        }, 1000);
    }
});
