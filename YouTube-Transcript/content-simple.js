// 简化版本用于测试基本功能
console.log('[YouTube转录] 插件加载开始...');

// 立即创建测试侧边栏
function createSimpleSidebar() {
    console.log('[YouTube转录] 创建简单测试侧边栏');
    
    // 移除现有侧边栏
    const existing = document.getElementById('transcript-sidebar');
    if (existing) {
        existing.remove();
    }
    
    // 创建侧边栏
    const sidebar = document.createElement('div');
    sidebar.id = 'transcript-sidebar';
    sidebar.innerHTML = `
        <div style="padding: 20px; color: #fff; background: #0f0f0f;">
            <h3>YouTube 转录侧边栏</h3>
            <p>插件已成功加载！</p>
            <p>当前URL: ${location.href}</p>
            <p>视频元素: ${document.querySelector('video') ? '已找到' : '未找到'}</p>
            <button onclick="this.parentElement.parentElement.remove()">关闭</button>
        </div>
    `;
    
    // 设置样式
    sidebar.style.cssText = `
        position: fixed !important;
        top: 56px !important;
        right: 0 !important;
        width: 400px !important;
        height: calc(100vh - 56px) !important;
        background-color: #0f0f0f !important;
        border-left: 2px solid #ff0000 !important;
        z-index: 999999 !important;
        overflow-y: auto !important;
    `;
    
    document.body.appendChild(sidebar);
    console.log('[YouTube转录] 简单侧边栏已创建');
}

// 等待页面加载
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        setTimeout(createSimpleSidebar, 1000);
    });
} else {
    setTimeout(createSimpleSidebar, 1000);
}

console.log('[YouTube转录] 插件脚本加载完成');