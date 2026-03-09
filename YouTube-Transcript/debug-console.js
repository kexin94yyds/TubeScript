// 在控制台运行这个脚本来调试
console.log('=== 调试YouTube转录插件 ===');

// 1. 检查window对象中的YouTube数据
console.log('1. 检查ytInitialPlayerResponse:', !!window.ytInitialPlayerResponse);

if (window.ytInitialPlayerResponse) {
    console.log('2. 有ytInitialPlayerResponse');
    const captions = window.ytInitialPlayerResponse.captions;
    console.log('3. captions对象:', captions);
    
    if (captions?.playerCaptionsTracklistRenderer?.captionTracks) {
        const tracks = captions.playerCaptionsTracklistRenderer.captionTracks;
        console.log('4. 找到字幕轨道数量:', tracks.length);
        console.log('5. 字幕轨道详情:', tracks);
        
        // 尝试获取第一个字幕
        if (tracks.length > 0) {
            const firstTrack = tracks[0];
            console.log('6. 第一个字幕轨道:', firstTrack);
            console.log('7. 字幕URL:', firstTrack.baseUrl);
            
            // 尝试获取字幕内容
            fetch(firstTrack.baseUrl)
                .then(r => r.text())
                .then(xml => {
                    console.log('8. 成功获取字幕XML，前500字符:', xml.substring(0, 500));
                    
                    // 解析XML
                    const parser = new DOMParser();
                    const xmlDoc = parser.parseFromString(xml, 'text/xml');
                    const textElements = xmlDoc.getElementsByTagName('text');
                    console.log('9. 解析出的字幕条数:', textElements.length);
                    
                    if (textElements.length > 0) {
                        console.log('10. 第一条字幕:', {
                            start: textElements[0].getAttribute('start'),
                            dur: textElements[0].getAttribute('dur'),
                            text: textElements[0].textContent
                        });
                    }
                })
                .catch(err => {
                    console.error('8. 获取字幕失败:', err);
                });
        }
    } else {
        console.log('4. 没有找到字幕轨道');
    }
} else {
    console.log('2. 没有ytInitialPlayerResponse，尝试从script提取...');
    
    // 尝试从script标签提取
    const scripts = document.getElementsByTagName('script');
    let found = false;
    
    for (let script of scripts) {
        if (script.textContent && script.textContent.includes('ytInitialPlayerResponse')) {
            console.log('3. 在script标签中找到ytInitialPlayerResponse');
            found = true;
            
            try {
                const match = script.textContent.match(/var ytInitialPlayerResponse\s*=\s*({.+?});/);
                if (match) {
                    const data = JSON.parse(match[1]);
                    console.log('4. 成功解析ytInitialPlayerResponse');
                    console.log('5. captions:', data.captions);
                } else {
                    console.log('4. 无法匹配ytInitialPlayerResponse模式');
                }
            } catch (e) {
                console.error('4. 解析失败:', e);
            }
            break;
        }
    }
    
    if (!found) {
        console.log('3. 在script标签中也没找到ytInitialPlayerResponse');
    }
}

// 检查侧边栏状态
console.log('\n=== 检查侧边栏状态 ===');
const sidebar = document.getElementById('transcript-sidebar');
console.log('侧边栏元素:', sidebar);

const content = document.getElementById('transcript-content');
console.log('内容区域:', content);
if (content) {
    console.log('内容区域HTML:', content.innerHTML);
}

// 检查全局变量
console.log('\n=== 检查全局变量 ===');
console.log('transcriptData:', typeof transcriptData !== 'undefined' ? transcriptData : '未定义');
console.log('videoElement:', typeof videoElement !== 'undefined' ? videoElement : '未定义');