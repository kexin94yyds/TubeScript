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

export const generateEpubBlob = async (title: string, author: string, chapters: Chapter[], coverUrl?: string, videoUrl?: string): Promise<Blob> => {
  const zip = new JSZip();

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

  // Handle Cover Image
  let coverImageItem = '';
  let coverImageRef = '';
  let coverPageItem = '';
  let coverPageRef = '';

  // Try to fetch cover image
  let hasCoverImage = false;
  let coverFilename = 'cover.jpeg';
  if (coverUrl) {
    try {
        const imgResp = await fetch(coverUrl, { mode: 'cors' }).catch(() => null);
        if (imgResp && imgResp.ok) {
            const imgBlob = await imgResp.blob();
            const extension = imgBlob.type.split('/')[1] || 'jpeg';
            coverFilename = `cover.${extension}`;
            oebps.file(coverFilename, imgBlob);
            coverImageItem = `<item id="cover-image" href="${coverFilename}" media-type="${imgBlob.type}" properties="cover-image"/>`;
            hasCoverImage = true;
        } else {
          console.warn("Could not fetch cover image. Skipping.");
        }
    } catch (e) {
        console.warn("Failed to process cover image", e);
    }
  }

  // Generate cover page (matching YouTube-Transcript extension style)
  {
    const titleHtml = videoUrl
      ? `<a href="${escapeXml(videoUrl)}" class="title-link">${escapeXml(title)}</a>`
      : escapeXml(title);

    const copyBtnHtml = videoUrl
      ? `\n      <button class="copy-btn" onclick="navigator.clipboard.writeText('${escapeXml(videoUrl)}')">Copy</button>`
      : '';

    const imageHtml = hasCoverImage
      ? `\n    <div class="cover-image-container">\n      <img src="${coverFilename}" alt="Cover"/>\n    </div>` 
      : '';

    const coverXhtml = `<?xml version="1.0" encoding="UTF-8"?>
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
    oebps.file("cover.xhtml", coverXhtml);
    coverPageItem = `<item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>`;
    coverPageRef = `<itemref idref="cover" linear="yes"/>`;
  }

  // CSS - Matching YouTube-Transcript extension style
  oebps.file("styles.css", `
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  line-height: 1.8;
  padding: 5%;
  color: #1a1a1a;
  background-color: #ffffff;
}

h1 {
  font-size: 1.5em;
  margin-top: 1.5em;
  margin-bottom: 0.5em;
}

h2 {
  color: #333;
  margin-top: 1.2em;
}

p {
  margin: 0.5em 0;
  text-align: justify;
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

.merged-paragraph {
  text-indent: 2em;
  margin: 1em 0;
  line-height: 2;
}

img {
  max-width: 100%;
}
  `);

  // Content Files (XHTML) - Matching YouTube-Transcript extension format
  chapters.forEach((chapter, index) => {
    const filename = `chapter_${index + 1}.xhtml`;
    
    // Format time as H:MM:SS or M:SS
    const formatTime = (seconds: number): string => {
      const h = Math.floor(seconds / 3600);
      const m = Math.floor((seconds % 3600) / 60);
      const s = Math.floor(seconds % 60);
      if (h > 0) {
        return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
      }
      return `${m}:${String(s).padStart(2, '0')}`;
    };

    // Chapter content as merged paragraph (matching extension style)
    const mergedText = escapeXml(chapter.content);
    const timeStr = chapter.startTime != null ? ` <span class="chapter-time">[${formatTime(chapter.startTime)}]</span>` : '';

    const content = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8"/>
  <title>${escapeXml(chapter.title)}</title>
  <link rel="stylesheet" type="text/css" href="styles.css"/>
</head>
<body>
  <div class="chapter-header">
    <h1>${escapeXml(chapter.title)}${timeStr}</h1>
  </div>
  <div class="chapter-content">
    <p class="merged-paragraph">${mergedText}</p>
  </div>
</body>
</html>`;
    oebps.file(filename, content);
  });

  // TOC.ncx (Navigation)
  let navPoints = '';
  let playOrder = 1;
  
  if (coverPageRef) {
      navPoints += `
    <navPoint id="navPoint-cover" playOrder="${playOrder++}">
      <navLabel><text>Cover</text></navLabel>
      <content src="cover.xhtml"/>
    </navPoint>`;
  }

  chapters.forEach((chapter, index) => {
    navPoints += `
    <navPoint id="navPoint-${index + 1}" playOrder="${playOrder++}">
      <navLabel><text>${escapeXml(chapter.title)}</text></navLabel>
      <content src="chapter_${index + 1}.xhtml"/>
    </navPoint>`;
  });

  oebps.file("toc.ncx", `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE ncx PUBLIC "-//NISO//DTD ncx 2005-1//EN"
 "http://www.daisy.org/z3986/2005/ncx-2005-1.dtd">
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="urn:uuid:12345" />
    <meta name="dtb:depth" content="1" />
    <meta name="dtb:totalPageCount" content="0" />
    <meta name="dtb:maxPageNumber" content="0" />
  </head>
  <docTitle><text>${escapeXml(title)}</text></docTitle>
  <navMap>${navPoints}</navMap>
</ncx>`);

  // Content.opf (Manifest)
  let manifestItems = `
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml" />
    <item id="css" href="styles.css" media-type="text/css" />
    ${coverImageItem}
    ${coverPageItem}`;

  let spineItems = `${coverPageRef}`;
  
  chapters.forEach((_, index) => {
    manifestItems += `<item id="chapter_${index+1}" href="chapter_${index+1}.xhtml" media-type="application/xhtml+xml" />\n`;
    spineItems += `<itemref idref="chapter_${index+1}" />\n`;
  });

  oebps.file("content.opf", `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookId" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:title>${escapeXml(title)}</dc:title>
    <dc:creator>${escapeXml(author)}</dc:creator>
    <dc:language>en</dc:language>
    <dc:identifier id="BookId" opf:scheme="UUID">urn:uuid:12345</dc:identifier>
    ${coverImageRef ? '<meta name="cover" content="cover-image" />' : ''}
  </metadata>
  <manifest>
    ${manifestItems}
  </manifest>
  <spine toc="ncx">
    ${spineItems}
  </spine>
</package>`);

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