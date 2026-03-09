# 侧边栏丝滑动画优化

## 优化目标

实现侧边栏打开和关闭时的丝滑动画效果，让视频的缩放和侧边栏的滑动完美同步，提供流畅自然的用户体验。

## 核心改进

### 1. 🎬 侧边栏入场动画（打开时）

#### 动画流程：
```
初始状态：侧边栏在屏幕右侧外（translateX(100%)）
    ↓
触发动画：同时执行两个动作
    ├─ 侧边栏从右侧滑入（0.4秒）
    └─ 视频向左缩小，为侧边栏预留空间（0.4秒）
    ↓
完成状态：侧边栏固定在右侧，视频在左侧
```

#### 技术实现：
- **初始状态设置**：
  ```javascript
  sidebar.style.transform = 'translateX(100%)';
  sidebar.style.opacity = '0';
  ```

- **使用 requestAnimationFrame**：
  ```javascript
  requestAnimationFrame(() => {
      requestAnimationFrame(() => {
          // 确保浏览器已完成布局计算
          applyPinnedState();  // 触发视频缩小
          sidebar.style.transform = 'translateX(0)';  // 侧边栏滑入
          sidebar.style.opacity = '1';
      });
  });
  ```

- **动画参数**：
  - 时长：0.4秒
  - 曲线：`cubic-bezier(0.4, 0, 0.2, 1)` (Material Design标准)
  - 同时动画：transform + opacity

### 2. 🎬 侧边栏退场动画（关闭时）

#### 动画流程：
```
当前状态：侧边栏固定在右侧
    ↓
触发动画：同时执行两个动作
    ├─ 侧边栏向右滑出（0.4秒）
    └─ 视频向右扩展，恢复全宽（0.4秒）
    ↓
完成状态：侧边栏移除，视频全屏显示
```

#### 技术实现：
- **立即触发布局恢复**：
  ```javascript
  document.documentElement.classList.remove('yt-transcript-pinned');
  ```

- **同步执行滑出动画**：
  ```javascript
  sidebar.style.transition = 'transform 0.4s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.4s ease';
  sidebar.style.transform = 'translateX(100%)';
  sidebar.style.opacity = '0';
  ```

- **动画完成后清理DOM**：
  ```javascript
  setTimeout(() => {
      sidebar.remove();
  }, 450);  // 稍微延迟确保动画完成
  ```

### 3. 🎨 CSS过渡优化

#### 统一的动画时间：
所有相关元素都使用相同的动画时长和曲线：

```css
/* body的margin调整 */
html.yt-transcript-pinned body {
  transition: margin-right 0.4s cubic-bezier(0.4, 0, 0.2, 1);
}

/* 视频容器的宽度调整 */
html.yt-transcript-pinned ytd-watch-flexy #columns {
  transition: max-width 0.4s cubic-bezier(0.4, 0, 0.2, 1);
}

/* 播放器的宽度调整 */
html.yt-transcript-pinned ytd-watch-flexy #player-container {
  transition: max-width 0.4s cubic-bezier(0.4, 0, 0.2, 1);
}
```

#### 性能优化：
```css
.transcript-sidebar {
  will-change: transform, opacity;  /* 启用GPU加速 */
}
```

## 动画特点

### ✨ 丝滑体验的关键要素：

1. **同步动画**
   - 侧边栏滑动和视频缩放同时进行
   - 使用相同的时长（0.4秒）
   - 使用相同的缓动函数

2. **Material Design曲线**
   - `cubic-bezier(0.4, 0, 0.2, 1)` 
   - 开始时稍慢，中间加速，结束时减速
   - 符合人类感知的自然运动

3. **双缓冲动画**
   - 使用两次 `requestAnimationFrame`
   - 确保浏览器完成布局计算
   - 避免动画抖动和闪烁

4. **GPU加速**
   - 使用 `transform` 而非 `left/right`
   - 添加 `will-change` 提示
   - 提高动画性能，降低CPU负担

5. **精确的时间控制**
   - JavaScript动画：0.4秒
   - CSS过渡：0.4秒
   - 清理延迟：0.45秒
   - 完美同步，无缝衔接

## 用户体验改进

### 打开侧边栏：
- ✅ 侧边栏从右侧优雅滑入
- ✅ 视频平滑地向左缩小
- ✅ 整个过程流畅自然，无卡顿
- ✅ 动画结束后状态稳定

### 关闭侧边栏：
- ✅ 侧边栏向右滑出消失
- ✅ 视频平滑地向右扩展
- ✅ 同样丝滑的动画体验
- ✅ 视频完美恢复全屏大小

### 全屏模式：
- ✅ 全屏时打开侧边栏：视频缩小+侧边栏滑入
- ✅ 全屏时关闭侧边栏：视频扩展+侧边栏滑出
- ✅ 在所有模式下都保持一致的丝滑体验

## 技术细节

### requestAnimationFrame的双重调用：
```javascript
requestAnimationFrame(() => {       // 第一帧：浏览器准备
    requestAnimationFrame(() => {   // 第二帧：开始动画
        // 动画代码
    });
});
```

**为什么需要两次？**
1. 第一次：让浏览器完成当前帧的渲染和布局计算
2. 第二次：在新的一帧开始时触发动画
3. 结果：动画更加流畅，避免初始抖动

### 动画时间线：
```
0ms    - 触发打开
0-16ms - 浏览器准备（第一个RAF）
16ms   - 开始动画（第二个RAF）
16-416ms - 动画进行中（0.4秒）
450ms  - 清理transition属性
```

### 关闭时间线：
```
0ms    - 触发关闭
0ms    - 立即移除CSS类（视频开始扩展）
0ms    - 开始滑出动画
0-400ms - 动画进行中
450ms  - 移除DOM节点
500ms  - 最终清理和验证
```

## 测试要点

### 基础测试：
1. ✅ 打开侧边栏：流畅滑入
2. ✅ 关闭侧边栏：流畅滑出
3. ✅ 多次快速开关：不会卡顿或出错

### 场景测试：
1. ✅ 正常模式下打开/关闭
2. ✅ Theater模式下打开/关闭
3. ✅ 全屏模式下打开/关闭
4. ✅ 窗口大小调整时的表现

### 性能测试：
1. ✅ 动画期间CPU使用率合理
2. ✅ 不阻塞视频播放
3. ✅ 不影响页面其他交互
4. ✅ 60fps流畅动画

## 浏览器兼容性

- ✅ Chrome/Edge（推荐）
- ✅ Firefox
- ✅ Safari
- ✅ 支持CSS3 transition的所有现代浏览器

## 调试信息

打开控制台可以看到：

```
[YouTube转录 DOM] 侧边栏丝滑入场动画已触发
[YouTube转录 DOM] 侧边栏退场动画已触发
```

## 更新日期
2025年10月28日

## 相关文件
- `content-dom.js` - 主要优化文件
- `PIN_MODE_UPDATE.md` - 固定模式说明
- `CLOSE_SIDEBAR_FIX.md` - 关闭功能修复

