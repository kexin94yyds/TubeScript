// 示例转录数据 - 替换为实际的转录数据
const transcriptData = [
    { start: 0, end: 5, text: "大家好，欢迎来到今天的视频。" },
    { start: 5, end: 12, text: "今天我想和大家分享一些关于编程的经验。" },
    { start: 12, end: 20, text: "很多人在学习编程的时候会遇到各种困难。" },
    { start: 20, end: 28, text: "但是请记住，每个人都是从零开始的。" },
    { start: 28, end: 35, text: "重要的是保持学习的热情和耐心。" },
    { start: 35, end: 43, text: "当你遇到问题时，不要害怕去寻求帮助。" },
    { start: 43, end: 50, text: "社区是一个很好的资源。" },
    { start: 50, end: 58, text: "另外，多做项目练习也很重要。" },
    { start: 58, end: 65, text: "理论知识固然重要，但实践才是真正的老师。" },
    { start: 65, end: 72, text: "好了，今天的分享就到这里，感谢观看！" }
];

// YouTube视频ID - 替换为你想要的视频ID
const VIDEO_ID = 'dQw4w9WgXcQ'; // 示例视频ID

let player;
let currentActiveIndex = -1;

// YouTube IFrame API 准备就绪后调用
function onYouTubeIframeAPIReady() {
    player = new YT.Player('player', {
        height: '100%',
        width: '100%',
        videoId: VIDEO_ID,
        playerVars: {
            'playsinline': 1,
            'controls': 1,
            'rel': 0
        },
        events: {
            'onReady': onPlayerReady,
            'onStateChange': onPlayerStateChange
        }
    });
}

// 播放器准备就绪
function onPlayerReady(event) {
    console.log('播放器已准备就绪');
    renderTranscript();
}

// 播放器状态变化
function onPlayerStateChange(event) {
    if (event.data == YT.PlayerState.PLAYING) {
        startTimeTracking();
    } else {
        stopTimeTracking();
    }
}

// 渲染转录文本
function renderTranscript() {
    const transcriptContainer = document.getElementById('transcript');
    transcriptContainer.innerHTML = '';
    
    transcriptData.forEach((item, index) => {
        const transcriptItem = document.createElement('div');
        transcriptItem.className = 'transcript-item';
        transcriptItem.dataset.index = index;
        transcriptItem.dataset.start = item.start;
        
        const timestamp = document.createElement('span');
        timestamp.className = 'timestamp';
        timestamp.textContent = formatTime(item.start);
        
        const text = document.createElement('span');
        text.className = 'text';
        text.textContent = item.text;
        
        transcriptItem.appendChild(timestamp);
        transcriptItem.appendChild(text);
        
        // 点击跳转到对应时间
        transcriptItem.addEventListener('click', () => {
            player.seekTo(item.start, true);
            highlightTranscript(index);
        });
        
        transcriptContainer.appendChild(transcriptItem);
    });
}

// 格式化时间
function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

// 时间跟踪定时器
let timeTrackingInterval;

function startTimeTracking() {
    stopTimeTracking(); // 清除之前的定时器
    timeTrackingInterval = setInterval(() => {
        if (player && player.getCurrentTime) {
            const currentTime = player.getCurrentTime();
            updateTranscriptHighlight(currentTime);
        }
    }, 100); // 每100ms检查一次
}

function stopTimeTracking() {
    if (timeTrackingInterval) {
        clearInterval(timeTrackingInterval);
        timeTrackingInterval = null;
    }
}

// 更新转录文本高亮
function updateTranscriptHighlight(currentTime) {
    const currentIndex = transcriptData.findIndex((item, index) => {
        const nextItem = transcriptData[index + 1];
        return currentTime >= item.start && (!nextItem || currentTime < nextItem.start);
    });
    
    if (currentIndex !== -1 && currentIndex !== currentActiveIndex) {
        highlightTranscript(currentIndex);
    }
}

// 高亮特定的转录项
function highlightTranscript(index) {
    // 移除之前的高亮
    const previousActive = document.querySelector('.transcript-item.active');
    if (previousActive) {
        previousActive.classList.remove('active');
    }
    
    // 添加新的高亮
    const items = document.querySelectorAll('.transcript-item');
    if (items[index]) {
        items[index].classList.add('active');
        
        // 滚动到可见区域
        items[index].scrollIntoView({
            behavior: 'smooth',
            block: 'center'
        });
    }
    
    currentActiveIndex = index;
}
