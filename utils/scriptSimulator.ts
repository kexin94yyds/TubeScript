import { Chapter, ProcessedOutput, VirtualFile } from "../types";

// Simulating the 'clean_filename' function from the ZSH script
const cleanFilename = (title: string): string => {
  let clean = title.replace(/<[^>]*>/g, ''); // Remove tags
  clean = clean.trim();
  clean = clean.replace(/[\/\*\?:<>"|]/g, '_'); // Replace special chars
  clean = clean.replace(/[[:space:]]+/g, '_'); // Collapse spaces
  clean = clean.replace(/\s+/g, '_'); // JS specific space cleanup
  if (clean.length > 100) clean = clean.substring(0, 100);
  if (!clean || /^[\p{P}_]+$/u.test(clean)) clean = "untitled";
  return clean;
};

// Simulating the logic to generate the file tree based on the provided script
export const generateVirtualFileSystem = (
  bookName: string,
  chapters: Chapter[]
): ProcessedOutput => {
  
  const safeBookName = cleanFilename(bookName);
  const date = new Date().toISOString().split('T')[0];

  const markdownFiles: VirtualFile[] = [];
  const txtFiles: VirtualFile[] = [];
  const htmlFiles: VirtualFile[] = []; // Mock HTML

  let fullMdContent = `---
title: "${bookName}"
date: ${date}
---

`;

  let fullTxtContent = `${bookName}
================================

`;

  let indexMdContent = `# ${bookName}\n## 目录\n\n`;
  let indexTxtContent = `目录\n======\n\n`;

  chapters.forEach((chapter) => {
    // 1. Format Filenames
    const chapterTitle = cleanFilename(chapter.title);
    const chapterIndex = String(chapter.index).padStart(3, '0');
    const chapterBasename = `${chapterIndex}_${chapterTitle}`;
    
    // 2. Content Generation
    // Markdown
    markdownFiles.push({
      name: `${chapterBasename}.md`,
      type: 'file',
      path: `/${safeBookName}/markdown/${chapterBasename}.md`,
      content: chapter.content
    });

    // TXT
    const txtContent = chapter.content.replace(/#/g, '').replace(/\*\*/g, ''); // Simple strip
    txtFiles.push({
      name: `${chapterBasename}.txt`,
      type: 'file',
      path: `/${safeBookName}/txt/${chapterBasename}.txt`,
      content: txtContent
    });

    // Mock HTML (just wrapping MD in div for simulation)
    htmlFiles.push({
      name: `${chapterIndex}.html`,
      type: 'file',
      path: `/${safeBookName}/html/${chapterIndex}.html`,
      content: `<html><body><h1>${chapter.title}</h1>${chapter.content}</body></html>`
    });

    // 3. Aggregate for Full Files
    fullMdContent += `${chapter.content}\n\n---\n\n`;
    
    fullTxtContent += `## ${chapter.title}\n--------------------------------\n${txtContent}\n\n`;

    // 4. Index Files
    indexMdContent += `- [${chapter.title}](markdown/${chapterBasename}.md)\n`;
    indexTxtContent += `* ${chapterIndex} ${chapter.title}\n`;
  });

  return {
    baseDir: safeBookName,
    htmlDir: htmlFiles,
    markdownDir: markdownFiles,
    txtDir: txtFiles,
    fullMarkdown: {
      name: `${safeBookName}.md`,
      type: 'file',
      path: `/${safeBookName}/${safeBookName}.md`,
      content: fullMdContent
    },
    fullTxt: {
      name: `${safeBookName}.txt`,
      type: 'file',
      path: `/${safeBookName}/${safeBookName}.txt`,
      content: fullTxtContent
    },
    indexMd: {
      name: 'index.md',
      type: 'file',
      path: `/${safeBookName}/markdown/index.md`,
      content: indexMdContent
    },
    indexTxt: {
      name: 'index.txt',
      type: 'file',
      path: `/${safeBookName}/txt/index.txt`,
      content: indexTxtContent
    }
  };
};
