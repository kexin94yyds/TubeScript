import JSZip from 'jszip';
import { Chapter, ProcessedOutput, VirtualFile } from '../types';

// Escape XML special characters for valid XHTML
function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function generateUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const rand = Math.random() * 16 | 0;
    const value = char === 'x' ? rand : (rand & 0x3 | 0x8);
    return value.toString(16);
  });
}

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

function generateStyle(): string {
  return `/* EPUB 样式 */
body {
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

h2 {
  font-size: 1.3em;
  color: #1f2937;
  margin-top: 1.5em;
  margin-bottom: 0.5em;
}

p {
  margin: 0.5em 0;
  text-align: justify;
}

.timestamp {
  color: #6b7280;
  font-size: 0.85em;
  font-family: monospace;
  margin-right: 0.5em;
}

.segment {
  margin: 0.3em 0;
  padding: 0.2em 0;
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

nav#toc li {
  margin: 0.5em 0;
}

nav#toc a {
  color: #3b82f6;
  text-decoration: none;
}

nav#toc a:hover {
  text-decoration: underline;
}
`;
}

function generateCoverPage(title: string, videoUrl?: string, coverHref?: string): string {
  const titleHtml = videoUrl
    ? `<a href="${escapeXml(videoUrl)}" class="title-link">${escapeXml(title)}</a>`
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

function generateChapterXhtml(chapter: Chapter): string {
  const timeStr = chapter.startTime != null
    ? ` <span class="chapter-time">[${formatTime(chapter.startTime)}]</span>`
    : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8"/>
  <title>${escapeXml(chapter.title)}</title>
  <link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body>
  <div class="chapter-header">
    <h1>${escapeXml(chapter.title)}${timeStr}</h1>
  </div>
  <div class="chapter-content">
    <p class="merged-paragraph">${escapeXml(chapter.content)}</p>
  </div>
</body>
</html>`;
}

function generateNavXhtml(chapters: Chapter[]): string {
  const navItems = chapters
    .map((chapter, index) => `        <li><a href="chapter${index + 1}.xhtml">${escapeXml(chapter.title)}</a></li>`)
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
  <meta charset="UTF-8"/>
  <title>目录</title>
  <link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>目录</h1>
    <ol>
${navItems}
    </ol>
  </nav>
</body>
</html>`;
}

function generateTocNcx(bookId: string, title: string, chapters: Chapter[]): string {
  const navPoints = chapters.map((chapter, index) => `
    <navPoint id="navpoint${index + 1}" playOrder="${index + 1}">
      <navLabel>
        <text>${escapeXml(chapter.title)}</text>
      </navLabel>
      <content src="chapter${index + 1}.xhtml"/>
    </navPoint>`).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="urn:uuid:${bookId}"/>
    <meta name="dtb:depth" content="1"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle>
    <text>${escapeXml(title)}</text>
  </docTitle>
  <navMap>${navPoints}
  </navMap>
</ncx>`;
}

function generateContentOpf(bookId: string, title: string, author: string, chapters: Chapter[], coverHref?: string, coverMediaType?: string): string {
  const now = new Date().toISOString();
  const coverManifest = `
    <item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>${coverHref && coverMediaType ? `
    <item id="cover-image" href="${escapeXml(coverHref)}" media-type="${escapeXml(coverMediaType)}" properties="cover-image"/>` : ''}`;

  const manifestItems = chapters
    .map((_, index) => `    <item id="chapter${index + 1}" href="chapter${index + 1}.xhtml" media-type="application/xhtml+xml"/>`)
    .join('\n');

  const spineItems = chapters
    .map((_, index) => `    <itemref idref="chapter${index + 1}"/>`)
    .join('\n');

  const coverMeta = coverHref && coverMediaType ? '\n    <meta name="cover" content="cover-image"/>' : '';

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
    <item id="css" href="style.css" media-type="text/css"/>${coverManifest}
${manifestItems}
  </manifest>
  <spine toc="ncx">
    <itemref idref="cover"/>
${spineItems}
  </spine>
</package>`;
}

export const generateEpubBlob = async (title: string, author: string, chapters: Chapter[], coverUrl?: string, videoUrl?: string): Promise<Blob> => {
  const zip = new JSZip();
  const bookId = generateUuid();

  // 1. mimetype (must be first, uncompressed)
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });

  // 2. META-INF/container.xml
  zip.folder("META-INF")?.file("container.xml", `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
   <rootfiles>
      <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
   </rootfiles>
</container>`);

  // 3. OEBPS folder
  const oebps = zip.folder("OEBPS");
  if (!oebps) throw new Error("Failed to create OEBPS folder");

  let coverHref = '';
  let coverMediaType = '';
  if (coverUrl) {
    try {
        const imgResp = await fetch(coverUrl, { mode: 'cors' }).catch(() => null);
        if (imgResp && imgResp.ok) {
            const imgBlob = await imgResp.blob();
            const extension = imgBlob.type.split('/')[1] || 'jpeg';
            coverHref = `images/cover.${extension}`;
            coverMediaType = imgBlob.type || 'image/jpeg';
            oebps.folder('images')?.file(`cover.${extension}`, imgBlob);
        } else {
          console.warn("Could not fetch cover image. Skipping.");
        }
    } catch (e) {
        console.warn("Failed to process cover image", e);
    }
  }

  oebps.file("cover.xhtml", generateCoverPage(title, videoUrl, coverHref || undefined));
  oebps.file("style.css", generateStyle());
  oebps.file("nav.xhtml", generateNavXhtml(chapters));
  oebps.file("toc.ncx", generateTocNcx(bookId, title, chapters));
  oebps.file("content.opf", generateContentOpf(bookId, title, author, chapters, coverHref || undefined, coverMediaType || undefined));

  chapters.forEach((chapter, index) => {
    oebps.file(`chapter${index + 1}.xhtml`, generateChapterXhtml(chapter));
  });

  return await zip.generateAsync({ type: "blob", mimeType: "application/epub+zip" });
};

export const generateSplitZipBlob = async (data: ProcessedOutput): Promise<Blob> => {
  const zip = new JSZip();
  // Create a root folder named after the book to keep things tidy when extracting
  const root = zip.folder(data.baseDir);
  if (!root) throw new Error("Failed to create root folder");

  // Helper to add files recursively
  const addFiles = (folder: any, files: VirtualFile[]) => {
    files.forEach(f => {
      if (f.type === 'file' && f.content) {
        folder.file(f.name, f.content);
      }
    });
  };

  // Add Full Files in the book folder root
  if (data.fullMarkdown.content) root.file(data.fullMarkdown.name, data.fullMarkdown.content);
  if (data.fullTxt.content) root.file(data.fullTxt.name, data.fullTxt.content);

  // Folders
  const htmlFolder = root.folder("html");
  if (htmlFolder) addFiles(htmlFolder, data.htmlDir);

  const mdFolder = root.folder("markdown");
  if (mdFolder) {
    addFiles(mdFolder, data.markdownDir);
    // Index md
    if (data.indexMd.content) mdFolder.file(data.indexMd.name, data.indexMd.content);
  }

  const txtFolder = root.folder("txt");
  if (txtFolder) {
    addFiles(txtFolder, data.txtDir);
    // Index txt
    if (data.indexTxt.content) txtFolder.file(data.indexTxt.name, data.indexTxt.content);
  }

  return await zip.generateAsync({ type: "blob" });
};
