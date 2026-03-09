# 奇偶循环问题记录

## 问题现象

用户报告了一个奇怪的循环模式：

1. **刷新后点击视频** → 字幕一次加载成功 ✅
2. **点击下一个视频** → 需要刷新才能加载 ❌
3. **刷新后点击视频** → 又一次加载成功 ✅
4. **点击下一个视频** → 又需要刷新 ❌
5. 循环往复...

## 用户原话

> "我不知道我们的问题是什么，不过现在每次刷新后，它在点击其他的问题它就又可以出现了，现在的情况就是什么呢，就是我被刷新后点击其他视频，它一次即可加载字幕，而当我这次的下一次点击，它就会被刷新，然后下次又可以一次出现了🤣，这是什么原因呢"

## 初步分析

### 可能的原因

#### 1. sessionStorage 标记问题

```javascript
// 当前逻辑（在 URL 变化时）
new MutationObserver(() => {
    if (url !== lastUrl) {
        // 清除刷新标记
        sessionStorage.removeItem('yt-transcript-refreshed');  // ← 可能导致循环
        sessionStorage.removeItem('yt-transcript-auto-open');
        sessionStorage.removeItem('yt-transcript-loaded');
    }
}).observe(document, { subtree: true, childList: true });
```

**问题流程**：
```
刷新后 → hasRefreshed = true → 等待8秒 → 成功 ✅
  ↓
切换视频 → URL变化，清除标记 → hasRefreshed = false → 等待3.5秒 → 失败并刷新 ❌
  ↓
刷新后 → hasRefreshed = true → 等待8秒 → 成功 ✅
  ↓
循环开始...
```

#### 2. 等待时间差异

```javascript
// 第一次加载（hasRefreshed = false）
Ultra: 1500ms
Fast:  2000ms
总计:  3.5秒 → 可能不够

// 刷新后加载（hasRefreshed = true）
Ultra: 3000ms
Fast:  5000ms
总计:  8秒 → 足够可靠
```

### 可能的解决方案

#### 方案 1：保留刷新标记（已测试但撤回）

```javascript
// 不清除 yt-transcript-refreshed 标记
new MutationObserver(() => {
    if (url !== lastUrl) {
        // sessionStorage.removeItem('yt-transcript-refreshed'); // ← 不清除
        sessionStorage.removeItem('yt-transcript-auto-open');
        sessionStorage.removeItem('yt-transcript-loaded');
    }
}).observe(document, { subtree: true, childList: true });
```

**优点**：
- 一旦触发过刷新，后续都使用长等待时间
- 稳定可靠

**缺点**（用户撤回的原因，待确认）：
- 待用户说明

#### 方案 2：优化首次加载等待时间

增加首次加载的等待时间，使其与刷新后相同：

```javascript
// 统一使用长等待时间
async function waitForTranscriptSegmentsFast(panel) {
    let segs = panel?.querySelectorAll('ytd-transcript-segment-renderer');
    if (segs && segs.length) return segs;
    
    // 统一等待策略
    segs = await waitForTranscriptSegments(panel, 15, 30); // ~450ms
    if (segs && segs.length) return segs;
    segs = await waitForTranscriptSegments(panel, 50, 40); // ~2s
    if (segs && segs.length) return segs;
    return await waitForTranscriptSegments(panel, 60, 40); // ~2.4s（总共5s+）
}

function waitForTranscriptSegmentsUltra(panel) {
    return new Promise(done => {
        const getSegs = () => panel?.querySelectorAll('ytd-transcript-segment-renderer');
        const segs = getSegs();
        if (segs && segs.length) return done(segs);
        
        const ob = new MutationObserver(() => {
            const s = getSegs();
            if (s && s.length) { ob.disconnect(); done(s); }
        });
        ob.observe(panel, { childList: true, subtree: true });
        
        // 统一超时时间
        setTimeout(() => done(getSegs()), 3000); // 统一使用3s
    });
}
```

**优点**：
- 不依赖刷新机制
- 等待时间足够长，更可靠

**缺点**：
- 首次加载会比较慢（~8秒）

#### 方案 3：智能检测 YouTube 状态

在点击 transcript 按钮前，检测 YouTube 是否已经准备好：

```javascript
async function waitForYouTubeReady() {
    // 等待视频元素完全加载
    const video = await waitForElement('video.html5-main-video');
    
    // 等待 player 初始化
    await new Promise(r => setTimeout(r, 1000));
    
    // 检查 video.readyState
    if (video.readyState < 2) {
        await new Promise(resolve => {
            video.addEventListener('loadeddata', resolve, { once: true });
        });
    }
}

async function fetchTranscriptFromDOM() {
    // 先等待 YouTube 准备好
    await waitForYouTubeReady();
    
    // 然后再尝试获取字幕
    // ...
}
```

#### 方案 4：重试机制而不是刷新

```javascript
// 不刷新页面，而是多次重试
async function fetchTranscriptWithRetry(maxRetries = 2) {
    for (let i = 0; i < maxRetries; i++) {
        const result = await fetchTranscriptFromDOM();
        if (result && result.length > 0) {
            return result;
        }
        
        console.log(`[YouTube转录 DOM] 第 ${i + 1} 次尝试失败，等待后重试...`);
        await new Promise(r => setTimeout(r, 2000));
    }
    
    // 最后才刷新
    console.log('[YouTube转录 DOM] 多次重试失败，刷新页面...');
    sessionStorage.setItem('yt-transcript-refreshed', 'true');
    sessionStorage.setItem('yt-transcript-auto-open', 'true');
    location.reload();
}
```

## 需要进一步调查的问题

1. **为什么第一次加载（3.5秒）不够，但刷新后（8秒）就够了？**
   - 是 YouTube 的加载速度问题？
   - 还是页面状态问题？

2. **为什么切换视频后，短等待时间又不够了？**
   - YouTube SPA 切换的特殊性？
   - DOM 状态重置？

3. **用户为什么撤回了"保留刷新标记"的方案？**
   - 有其他副作用？
   - 还是想要更好的解决方案？

## 下一步

- [ ] 明天与用户确认撤回原因
- [ ] 收集更多控制台日志数据
- [ ] 测试不同的等待时间组合
- [ ] 尝试其他解决方案
- [ ] 找到最优解决方案

## 相关文件

- `content-dom.js` - 主要逻辑文件
- 函数：`fetchTranscriptFromDOM()`
- 函数：`waitForTranscriptSegmentsUltra()`
- 函数：`waitForTranscriptSegmentsFast()`

## 时间记录

- **问题发现时间**: 2025-10-29
- **计划修复时间**: 明天

