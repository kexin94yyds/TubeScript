// 调试脚本 - 在浏览器控制台中运行此代码来测试侧边栏
console.log('=== YouTube转录插件调试 ===');

// 1. 检查基本环境
console.log('当前URL:', location.href);
console.log('是否在视频页面:', location.href.includes('/watch'));
console.log('视频元素:', document.querySelector('video'));

// 2. 检查是否已有侧边栏
const existingSidebar = document.getElementById('transcript-sidebar');
console.log('现有侧边栏:', existingSidebar);

// 3. 强制创建侧边栏进行测试
function createTestSidebar() {
    // 移除现有的侧边栏
    if (existingSidebar) {
        existingSidebar.remove();
    }
    
    // 创建测试侧边栏
    const sidebar = document.createElement('div');
    sidebar.id = 'transcript-sidebar-test';
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
    `;
    
    sidebar.innerHTML = `
        <div style="padding: 20px; color: #f1f1f1;">
            <h3>测试侧边栏</h3>
            <p>如果你能看到这个，说明侧边栏可以正常显示</p>
            <button onclick="this.parentElement.parentElement.remove()">关闭测试</button>
        </div>
    `;
    
    document.body.appendChild(sidebar);
    console.log('测试侧边栏已创建:', sidebar);
}

// 4. 运行测试
createTestSidebar();

// 5. 检查插件脚本是否加载
console.log('插件相关函数:', {
    init: typeof init,
    createSidebar: typeof createSidebar,
    fetchTranscript: typeof fetchTranscript
});