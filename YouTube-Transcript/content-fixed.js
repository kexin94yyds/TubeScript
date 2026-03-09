// YouTube转录侧边栏 - 简化有效版本
console.log('[YouTube转录] 插件加载开始...');

// 全局变量
let transcriptData = [];
let chaptersData = []; // 章节数据
let currentActiveIndex = -1;
let timeTrackingInterval = null;
let videoElement = null;

// 等待页面加载完成
function init() {
    try {
        console.log('[YouTube转录] 初始化开始...', {
            url: location.href,
            hasVideo: !!document.querySelector('video')
        });
        
        // 检查是否在视频页面
        if (!location.href.includes('/watch')) {
            console.log('[YouTube转录] 不在视频页面，跳过初始化');
            return;
        }
        
        // 找到视频播放器
        videoElement = document.querySelector('video');
        
        if (!videoElement) {
            console.log('[YouTube转录] 未找到视频元素，1秒后重试...');
            setTimeout(init, 1000);
            return;
        }
        
        console.log('[YouTube转录] 找到视频元素，创建侧边栏...');
        
        // 创建侧边栏
        createSidebar();
        
        // 获取字幕数据 - 使用简化方法
        fetchTranscript();
        
        // 监听视频播放
        videoElement.addEventListener('play', startTimeTracking);
        videoElement.addEventListener('pause', stopTimeTracking);
        videoElement.addEventListener('seeked', updateCurrentHighlight);
        
        console.log('[YouTube转录] 初始化完成！');
    } catch (error) {
        console.error('[YouTube转录] 初始化错误:', error);
        setTimeout(init, 2000);
    }
}

// 获取YouTube字幕 - 简化版本
async function fetchTranscript() {
    try {
        console.log('[YouTube转录] 开始获取字幕...');
        showLoadingMessage('正在获取字幕...');
        
        // 方法1: 从ytInitialPlayerResponse获取
        const playerResponse = await getYtInitialPlayerResponse();
        
        // 提取章节信息
        extractChapters(playerResponse);
        
        if (playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks) {
            const captionTracks = playerResponse.captions.playerCaptionsTracklistRenderer.captionTracks;
            console.log('[YouTube转录] 找到字幕轨道:', captionTracks.length, '个');
            
            // 选择第一个可用的字幕轨道
            let selectedTrack = captionTracks.find(track => 
                track.languageCode === 'zh-Hans' || 
                track.languageCode === 'zh-Hant' || 
                track.languageCode === 'zh'
            ) || captionTracks[0];
            
            console.log('[YouTube转录] 选择字幕:', selectedTrack.name?.simpleText || selectedTrack.languageCode);
            
            // 获取字幕内容 - 使用background script绕过CORS
            const transcriptUrl = selectedTrack.baseUrl;
            
            try {
                console.log('[YouTube转录] 发送请求到background script...');
                
                // 使用chrome.runtime.sendMessage请求background script获取字幕
                const result = await new Promise((resolve, reject) => {
                    chrome.runtime.sendMessage(
                        { type: 'FETCH_TRANSCRIPT', url: transcriptUrl },
                        (response) => {
                            if (chrome.runtime.lastError) {
                                reject(chrome.runtime.lastError);
                            } else {
                                resolve(response);
                            }
                        }
                    );
                });
                
                if (!result.success) {
                    throw new Error(result.error);
                }
                
                const xmlText = result.data;
                console.log('[YouTube转录] 字幕XML获取成功');
                
                // 解析XML字幕
                const parser = new DOMParser();
                const xmlDoc = parser.parseFromString(xmlText, 'text/xml');
                const textElements = xmlDoc.getElementsByTagName('text');
                
                transcriptData = [];
                
                for (let i = 0; i < textElements.length; i++) {
                    const element = textElements[i];
                    const start = parseFloat(element.getAttribute('start'));
                    const duration = parseFloat(element.getAttribute('dur') || '3');
                    const text = decodeHTMLEntities(element.textContent);
                    
                    if (text.trim()) {
                        transcriptData.push({
                            start: start,
                            end: start + duration,
                            text: text.trim()
                        });
                    }
                }
                
                console.log('[YouTube转录] 成功解析字幕，共', transcriptData.length, '条');
                renderTranscript();
                return;
            } catch (fetchError) {
                console.error('[YouTube转录] 获取字幕XML失败:', fetchError);
            }
        }
        
        // 如果没有找到字幕
        showNoTranscriptMessage();
        
    } catch (error) {
        console.error('[YouTube转录] 获取字幕失败:', error);
        showErrorMessage('字幕获取失败');
    }
}

// 获取ytInitialPlayerResponse - 简化版本
function getYtInitialPlayerResponse() {
    return new Promise((resolve) => {
        console.log('[YouTube转录] 获取ytInitialPlayerResponse');
        
        // 方法1: 从window对象获取
        if (window.ytInitialPlayerResponse) {
            console.log('[YouTube转录] 从window对象获取成功');
            resolve(window.ytInitialPlayerResponse);
            return;
        }
        
        // 方法2: 从页面script标签中提取
        const scripts = document.getElementsByTagName('script');
        for (let script of scripts) {
            const content = script.textContent;
            if (content && content.includes('ytInitialPlayerResponse')) {
                try {
                    const patterns = [
                        /var ytInitialPlayerResponse\s*=\s*({.+?});/,
                        /ytInitialPlayerResponse\s*=\s*({.+?});/
                    ];
                    
                    for (let pattern of patterns) {
                        const match = content.match(pattern);
                        if (match && match[1]) {
                            const parsed = JSON.parse(match[1]);
                            console.log('[YouTube转录] 从Script提取成功');
                            resolve(parsed);
                            return;
                        }
                    }
                } catch (e) {
                    console.error('[YouTube转录] 解析Script失败:', e);
                }
            }
        }
        
        // 方法3: 延迟后再次尝试
        setTimeout(() => {
            if (window.ytInitialPlayerResponse) {
                resolve(window.ytInitialPlayerResponse);
            } else {
                resolve(null);
            }
        }, 2000);
    });
}

// 提取章节信息
function extractChapters(playerResponse) {
    try {
        chaptersData = [];
        
        // 从playerResponse中提取章节
        const chapters = playerResponse?.playerOverlays?.playerOverlayRenderer
            ?.decoratedPlayerBarRenderer?.decoratedPlayerBarRenderer?.playerBar
            ?.multiMarkersPlayerBarRenderer?.markersMap;
        
        if (chapters) {
            for (let marker of chapters) {
                if (marker.key === 'DESCRIPTION_CHAPTERS') {
                    const chapterMarkers = marker.value?.chapters || [];
                    chapterMarkers.forEach(chapter => {
                        const chapterRenderer = chapter.chapterRenderer;
                        if (chapterRenderer) {
                            chaptersData.push({
                                title: chapterRenderer.title?.simpleText || '',
                                startTime: chapterRenderer.timeRangeStartMillis / 1000
                            });
                        }
                    });
                    break;
                }
            }
        }
        
        console.log('[YouTube转录] 找到章节:', chaptersData.length, '个');
    } catch (error) {
        console.error('[YouTube转录] 提取章节失败:', error);
    }
}

// 解码HTML实体
function decodeHTMLEntities(text) {
    const textarea = document.createElement('textarea');
    textarea.innerHTML = text;
    return textarea.value
        .replace(/\n/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

// 创建侧边栏
function createSidebar() {
    try {
        // 移除现有侧边栏
        const existingSidebar = document.getElementById('transcript-sidebar');
        if (existingSidebar) {
            existingSidebar.remove();
        }
        
        console.log('[YouTube转录] 创建侧边栏元素...');
        
        // 创建侧边栏容器
        const sidebar = document.createElement('div');
        sidebar.id = 'transcript-sidebar';
        sidebar.style.cssText = `
            position: fixed !important;
            top: 56px !important;
            right: 0 !important;
            width: 400px !important;
            height: calc(100vh - 56px) !important;
            background-color: #0f0f0f !important;
            border-left: 1px solid #3f3f3f !important;
            z-index: 999999 !important;
            display: flex !important;
            flex-direction: column !important;
            box-shadow: -2px 0 10px rgba(0, 0, 0, 0.5) !important;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
        `;
        
        // 创建头部
        const header = document.createElement('div');
        header.style.cssText = `
            display: flex !important;
            justify-content: space-between !important;
            align-items: center !important;
            padding: 16px 20px !important;
            border-bottom: 1px solid #3f3f3f !important;
            background-color: #212121 !important;
            color: #f1f1f1 !important;
        `;
        
        header.innerHTML = `
            <h3 style="margin: 0; font-size: 16px; color: #f1f1f1;">转录文本</h3>
            <button id="toggle-sidebar" style="background: none; border: none; color: #aaa; cursor: pointer; font-size: 14px; padding: 4px 8px; border-radius: 4px;">收起</button>
        `;
        
        // 创建内容区域
        const content = document.createElement('div');
        content.id = 'transcript-content';
        content.style.cssText = `
            flex: 1 !important;
            overflow-y: auto !important;
            padding: 12px !important;
            color: #f1f1f1 !important;
        `;
        
        sidebar.appendChild(header);
        sidebar.appendChild(content);
        document.body.appendChild(sidebar);
        
        console.log('[YouTube转录] 侧边栏已创建');
        
        // 绑定收起按钮
        const toggleBtn = document.getElementById('toggle-sidebar');
        if (toggleBtn) {
            toggleBtn.addEventListener('click', toggleSidebar);
        }
        
    } catch (error) {
        console.error('[YouTube转录] 创建侧边栏失败:', error);
    }
}

// 渲染转录文本
function renderTranscript() {
    const container = document.getElementById('transcript-content');
    if (!container) return;
    
    container.innerHTML = '';
    
    if (transcriptData.length === 0) {
        showLoadingMessage('正在加载字幕...');
        return;
    }
    
    // 为每个字幕项找到对应的章节
    let currentChapterIndex = 0;
    
    transcriptData.forEach((item, index) => {
        // 检查是否需要插入新章节标题
        if (chaptersData.length > 0) {
            while (currentChapterIndex < chaptersData.length && 
                   item.start >= chaptersData[currentChapterIndex].startTime) {
                // 如果这是该章节的第一个字幕项，插入章节标题
                if (index === 0 || transcriptData[index - 1].start < chaptersData[currentChapterIndex].startTime) {
                    const chapterHeader = createChapterHeader(
                        chaptersData[currentChapterIndex].title,
                        chaptersData[currentChapterIndex].startTime
                    );
                    container.appendChild(chapterHeader);
                }
                currentChapterIndex++;
            }
        }
        const transcriptItem = document.createElement('div');
        transcriptItem.className = 'transcript-item';
        transcriptItem.dataset.index = index;
        transcriptItem.dataset.start = item.start;
        
        transcriptItem.style.cssText = `
            padding: 12px !important;
            margin-bottom: 8px !important;
            border-radius: 8px !important;
            cursor: pointer !important;
            transition: background-color 0.2s !important;
            color: #f1f1f1 !important;
        `;
        
        const timestamp = document.createElement('span');
        timestamp.textContent = formatTime(item.start);
        timestamp.style.cssText = `
            display: inline-block !important;
            font-size: 12px !important;
            color: #aaa !important;
            margin-right: 8px !important;
            font-family: 'Courier New', monospace !important;
            min-width: 45px !important;
        `;
        
        const text = document.createElement('span');
        text.textContent = item.text;
        text.style.cssText = `
            display: inline !important;
            line-height: 1.6 !important;
        `;
        
        transcriptItem.appendChild(timestamp);
        transcriptItem.appendChild(text);
        
        // 添加hover效果
        transcriptItem.addEventListener('mouseenter', () => {
            if (!transcriptItem.classList.contains('active')) {
                transcriptItem.style.backgroundColor = '#3f3f3f';
            }
        });
        
        transcriptItem.addEventListener('mouseleave', () => {
            if (!transcriptItem.classList.contains('active')) {
                transcriptItem.style.backgroundColor = 'transparent';
            }
        });
        
        // 点击跳转
        transcriptItem.addEventListener('click', () => {
            if (videoElement) {
                videoElement.currentTime = item.start;
                highlightTranscript(index);
            }
        });
        
        container.appendChild(transcriptItem);
    });
}

// 创建章节标题
function createChapterHeader(title, startTime) {
    const header = document.createElement('div');
    header.className = 'chapter-header';
    header.style.cssText = `
        padding: 16px 12px 8px 12px !important;
        margin-top: 8px !important;
        font-size: 14px !important;
        font-weight: 600 !important;
        color: #f1f1f1 !important;
        cursor: pointer !important;
        display: flex !important;
        align-items: center !important;
        gap: 8px !important;
    `;
    
    const timestamp = document.createElement('span');
    timestamp.style.cssText = `
        color: #3ea6ff !important;
        font-family: 'Courier New', monospace !important;
        font-size: 12px !important;
    `;
    timestamp.textContent = formatTime(startTime);
    
    const titleSpan = document.createElement('span');
    titleSpan.textContent = title;
    
    header.appendChild(timestamp);
    header.appendChild(titleSpan);
    
    // 点击章节标题跳转
    header.addEventListener('click', () => {
        if (videoElement) {
            videoElement.currentTime = startTime;
        }
    });
    
    // hover效果
    header.addEventListener('mouseenter', () => {
        header.style.backgroundColor = '#3f3f3f';
    });
    
    header.addEventListener('mouseleave', () => {
        header.style.backgroundColor = 'transparent';
    });
    
    return header;
}

// 格式化时间
function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

// 显示加载消息
function showLoadingMessage(message = '加载中...') {
    const container = document.getElementById('transcript-content');
    if (container) {
        container.innerHTML = `
            <div style="padding: 20px; text-align: center; color: #aaa;">
                <div style="margin-bottom: 10px;">⏳</div>
                <p>${message}</p>
            </div>
        `;
    }
}

// 显示错误消息
function showErrorMessage(message) {
    const container = document.getElementById('transcript-content');
    if (container) {
        container.innerHTML = `
            <div style="padding: 20px; text-align: center; color: #ff6b6b;">
                <div style="margin-bottom: 10px;">❌</div>
                <p>${message}</p>
                <button onclick="fetchTranscript()" style="margin-top: 10px; padding: 8px 16px; background: #3f3f3f; color: #fff; border: none; border-radius: 4px; cursor: pointer;">重试</button>
            </div>
        `;
    }
}

// 显示无字幕消息
function showNoTranscriptMessage() {
    const container = document.getElementById('transcript-content');
    if (container) {
        container.innerHTML = `
            <div style="padding: 20px; text-align: center; color: #aaa;">
                <div style="margin-bottom: 10px;">📝</div>
                <p>此视频没有可用的字幕</p>
                <p style="font-size: 12px; margin-top: 10px;">请尝试其他有字幕的视频</p>
            </div>
        `;
    }
}

// 开始时间跟踪
function startTimeTracking() {
    stopTimeTracking();
    timeTrackingInterval = setInterval(() => {
        if (videoElement) {
            updateTranscriptHighlight(videoElement.currentTime);
        }
    }, 100);
}

// 停止时间跟踪
function stopTimeTracking() {
    if (timeTrackingInterval) {
        clearInterval(timeTrackingInterval);
        timeTrackingInterval = null;
    }
}

// 更新高亮
function updateTranscriptHighlight(currentTime) {
    const currentIndex = transcriptData.findIndex((item, index) => {
        const nextItem = transcriptData[index + 1];
        return currentTime >= item.start && (!nextItem || currentTime < nextItem.start);
    });
    
    if (currentIndex !== -1 && currentIndex !== currentActiveIndex) {
        highlightTranscript(currentIndex);
    }
}

// 手动更新当前高亮
function updateCurrentHighlight() {
    if (videoElement) {
        updateTranscriptHighlight(videoElement.currentTime);
    }
}

// 高亮指定项
function highlightTranscript(index) {
    try {
        // 移除之前的高亮
        const previousActive = document.querySelector('.transcript-item.active');
        if (previousActive) {
            previousActive.classList.remove('active');
            previousActive.style.backgroundColor = 'transparent';
            const prevTimestamp = previousActive.querySelector('span');
            if (prevTimestamp) {
                prevTimestamp.style.color = '#aaa';
            }
        }
        
        // 添加新的高亮
        const items = document.querySelectorAll('.transcript-item');
        if (items[index]) {
            items[index].classList.add('active');
            items[index].style.backgroundColor = '#065fd4';
            items[index].style.color = '#fff';
            
            const timestamp = items[index].querySelector('span');
            if (timestamp) {
                timestamp.style.color = '#fff';
            }
            
            // 滚动到可视区域
            items[index].scrollIntoView({
                behavior: 'smooth',
                block: 'center'
            });
        }
        
        currentActiveIndex = index;
    } catch (error) {
        console.error('[YouTube转录] 高亮失败:', error);
    }
}

// 切换侧边栏显示/隐藏
function toggleSidebar() {
    const sidebar = document.getElementById('transcript-sidebar');
    const btn = document.getElementById('toggle-sidebar');
    
    if (sidebar.style.transform === 'translateX(100%)') {
        sidebar.style.transform = 'translateX(0)';
        btn.textContent = '收起';
    } else {
        sidebar.style.transform = 'translateX(100%)';
        btn.textContent = '展开';
    }
}

// 初始化
console.log('[YouTube转录] 准备初始化');

function initWhenReady() {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            setTimeout(init, 1000);
        });
    } else {
        setTimeout(init, 1000);
    }
}

initWhenReady();

// 监听URL变化（YouTube单页应用导航）
let lastUrl = location.href;
let urlObserver = new MutationObserver(() => {
    const url = location.href;
    if (url !== lastUrl) {
        lastUrl = url;
        if (url.includes('/watch')) {
            console.log('[YouTube转录] 检测到页面导航，重新初始化...');
            // 清理旧侧边栏
            const existingSidebar = document.getElementById('transcript-sidebar');
            if (existingSidebar) {
                existingSidebar.remove();
            }
            setTimeout(init, 2000);
        }
    }
});

urlObserver.observe(document, { subtree: true, childList: true });