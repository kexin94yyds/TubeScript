// Background Service Worker

console.log('[YouTube转录 Background] Service Worker启动');

// 监听扩展图标点击事件
async function injectContentIfNeeded(tabId) {
    try {
        // 尝试向页面发送一次 ping，检测是否已有接收端
        const ping = await chrome.tabs.sendMessage(tabId, { type: 'PING_TRANSCRIPT' }).catch(() => null);
        if (ping && ping.ok) return true;
    } catch (_) {}

    try {
        // 页面刚切换时 content script 可能还没就绪，给一次短暂重试机会，避免重复注入。
        await new Promise((resolve) => setTimeout(resolve, 150));
        const retryPing = await chrome.tabs.sendMessage(tabId, { type: 'PING_TRANSCRIPT' }).catch(() => null);
        if (retryPing && retryPing.ok) return true;
    } catch (_) {}

    try {
        await chrome.scripting.insertCSS({ target: { tabId }, files: ['sidebar.css'] }).catch(() => {});
        await chrome.scripting.executeScript({
            target: { tabId },
            files: ['jszip.min.js', 'epub-generator.js', 'content-dom.js']
        });
        return true;
    } catch (e) {
        console.error('[YouTube转录 Background] 注入失败:', e);
        return false;
    }
}

chrome.action.onClicked.addListener(async (tab) => {
    console.log('[YouTube转录 Background] 扩展图标被点击');
    
    // 检查是否是YouTube视频页面
    if (tab.url && tab.url.includes('youtube.com/watch')) {
        // 确保content script在目标页可用
        await injectContentIfNeeded(tab.id);
        // 再发送切换消息
        chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_SIDEBAR' }, (response) => {
            if (chrome.runtime.lastError) {
                console.error('[YouTube转录 Background] 发送消息失败:', chrome.runtime.lastError);
            } else {
                console.log('[YouTube转录 Background] 侧边栏状态:', response?.visible ? '显示' : '隐藏');
            }
        });
    } else {
        console.log('[YouTube转录 Background] 不在YouTube视频页面');
    }
});

// 监听来自content script的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'FETCH_TRANSCRIPT') {
        // 使用background script获取字幕，绕过CORS
        fetch(request.url)
            .then(response => response.text())
            .then(text => {
                sendResponse({ success: true, data: text });
            })
            .catch(error => {
                console.error('[YouTube转录 Background] 获取字幕失败:', error);
                sendResponse({ success: false, error: error.message });
            });
        
        // 返回true表示异步响应
        return true;
    }
});
