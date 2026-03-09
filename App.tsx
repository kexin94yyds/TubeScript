import React, { useState, useEffect } from 'react';
import { Play, RotateCcw, Youtube, Download, FileText, ChevronRight, Loader2, Sparkles, AlertCircle, BookOpen, FileArchive } from 'lucide-react';
import { fetchTranscript } from './services/transcriptService';
import { generateVirtualFileSystem } from './utils/scriptSimulator';
import { generateEpubBlob, generateSplitZipBlob } from './services/fileGenerators';
import TerminalLog from './components/TerminalLog';
import FileTree from './components/FileTree';
import { ProcessingState, ProcessedOutput, VirtualFile, VideoMetadata } from './types';

const App = () => {
  const [url, setUrl] = useState('');
  const [state, setState] = useState<ProcessingState>({
    status: 'idle',
    logs: [],
    progress: 0
  });
  const [output, setOutput] = useState<ProcessedOutput | null>(null);
  const [selectedFile, setSelectedFile] = useState<VirtualFile | null>(null);
  const [videoMeta, setVideoMeta] = useState<VideoMetadata | null>(null);
  
  // Download URLs
  const [epubUrl, setEpubUrl] = useState<string | null>(null);
  const [zipUrl, setZipUrl] = useState<string | null>(null);

  // Helper to add logs with a delay for effect
  const addLog = async (message: string, delay = 100) => {
    setState(prev => ({ ...prev, logs: [...prev.logs, message] }));
    await new Promise(r => setTimeout(r, delay));
  };

  const fetchVideoMetadata = async (videoUrl: string): Promise<VideoMetadata> => {
    try {
      // Use noembed as a proxy to avoid CORS issues for simple metadata
      const response = await fetch(`https://noembed.com/embed?url=${encodeURIComponent(videoUrl)}`);
      const data = await response.json();
      
      let title = data.title;
      const author = data.author_name || 'Unknown Author';
      let thumbnailUrl = data.thumbnail_url;

      // Extract ID
      let videoId = 'unknown';
      if (videoUrl.includes('youtu.be/')) {
        videoId = videoUrl.split('youtu.be/')[1].split('?')[0];
      } else if (videoUrl.includes('v=')) {
        videoId = videoUrl.split('v=')[1].split('&')[0];
      }

      if (!title || data.error) {
         // Fallback if noembed fails to find it (sometimes happens with new videos)
         title = `YouTube Video ${videoId}`;
      }
      
      if (!thumbnailUrl) {
         thumbnailUrl = `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;
      }

      return {
        id: videoId,
        title: title,
        author: author,
        thumbnailUrl: thumbnailUrl
      };
    } catch (e) {
      console.warn("Metadata fetch failed, falling back to basic parsing", e);
      // Fallback
      let videoId = 'unknown';
      if (videoUrl.includes('youtu.be/')) videoId = videoUrl.split('youtu.be/')[1].split('?')[0];
      else if (videoUrl.includes('v=')) videoId = videoUrl.split('v=')[1].split('&')[0];
      
      return {
        id: videoId,
        title: `YouTube Video ${videoId}`,
        author: 'YouTube Creator',
        thumbnailUrl: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`
      };
    }
  };

  const handleProcess = async () => {
    if (!url.includes('youtube.com') && !url.includes('youtu.be')) {
      setState(prev => ({ ...prev, error: "Please enter a valid YouTube URL" }));
      return;
    }

    // Reset
    setState({ status: 'fetching_info', logs: [], progress: 0 });
    setOutput(null);
    setSelectedFile(null);
    setVideoMeta(null);
    if (epubUrl) URL.revokeObjectURL(epubUrl);
    if (zipUrl) URL.revokeObjectURL(zipUrl);
    setEpubUrl(null);
    setZipUrl(null);

    try {
      // Step 1: Fetch Video Info
      await addLog("$ analyzing_url " + url);
      await addLog("Fetching video metadata...");
      
      const meta = await fetchVideoMetadata(url);
      setVideoMeta(meta);
      await addLog(`✓ Found video: ${meta.title}`);
      await addLog(`  Channel: ${meta.author}`);

      // Step 2: Fetch real transcript from YouTube
      setState(prev => ({ ...prev, status: 'transcribing', progress: 20 }));
      await addLog("Fetching real transcript from YouTube...");
      
      const transcriptResult = await fetchTranscript(url);
      const chapters = transcriptResult.chapters;
      
      if (transcriptResult.fallbackLang) {
        await addLog(`⚠ Original language unavailable, using ${transcriptResult.fallbackLang}`);
      }
      await addLog(`✓ Got ${transcriptResult.segmentCount} subtitle segments`);
      
      await addLog(`✓ Transcript generated. Found ${chapters.length} chapters.`);
      setState(prev => ({ ...prev, status: 'generating_epub', progress: 40 }));

      // Step 3: EPUB Generation
      await addLog("Building EPUB container...");
      await addLog("Generating OEBPS structure and NCX...");
      
      // Pass thumbnail for cover if available
      const epubBlob = await generateEpubBlob(meta.title, meta.author, chapters, meta.thumbnailUrl, url);
      const generatedEpubUrl = URL.createObjectURL(epubBlob);
      setEpubUrl(generatedEpubUrl);
      await addLog(`✓ Generated ${meta.title}.epub (${(epubBlob.size / 1024).toFixed(1)} KB)`);
      
      // Step 4: Running the "Cut Book" Script (Virtual)
      setState(prev => ({ ...prev, status: 'running_script', progress: 60 }));
      await addLog("\n--- Executing 切书神技.zsh ---\n");
      await addLog(`$ ./cut_book.zsh "${meta.title}.epub"`);
      
      await addLog("Unzipping EPUB to temporary directory...");
      await addLog("Locating OEBPS/OPS folder...");
      
      // Generate the File System Object
      const fsResult = generateVirtualFileSystem(meta.title, chapters);
      
      // Simulate the per-file logging of the script
      await addLog("Converting chapters to Markdown...");
      for (const file of fsResult.markdownDir) {
        if (file.name === 'index.md') continue;
        const shortName = file.name.replace('.md', '').split('_')[1]; // Simple parse for log
        await addLog(`✓ Converted to Markdown: ${shortName}`, 20);
      }
      
      await addLog("Creating complete files...");
      await addLog(`Generating ${fsResult.fullMarkdown.name}...`);
      await addLog(`Generating ${fsResult.fullTxt.name}...`);
      await addLog("Creating index files...");
      
      // Generate ZIP for split files
      await addLog("Compressing split output to ZIP...");
      const zipBlob = await generateSplitZipBlob(fsResult);
      const generatedZipUrl = URL.createObjectURL(zipBlob);
      setZipUrl(generatedZipUrl);

      await addLog(`✓ Conversion completed! Output ready.`);

      setOutput(fsResult);
      setSelectedFile(fsResult.fullMarkdown);
      setState(prev => ({ ...prev, status: 'completed', progress: 100 }));

    } catch (err: any) {
      console.error(err);
      setState(prev => ({ 
        ...prev, 
        status: 'error', 
        error: err.message || "An unexpected error occurred." 
      }));
    }
  };

  return (
    <div className="flex h-screen w-full bg-notebook-50 overflow-hidden">
      
      {/* Sidebar - History & File Tree */}
      <aside className="w-80 bg-white border-r border-notebook-200 flex flex-col hidden md:flex shrink-0">
        <div className="p-4 border-b border-notebook-200 flex items-center gap-2">
          <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center text-white font-bold">
            T
          </div>
          <span className="font-bold text-notebook-800 text-lg">TubeScript</span>
        </div>
        
        <div className="flex-1 overflow-y-auto">
          {output ? (
            <div className="flex flex-col h-full">
              <div className="px-4 py-3 bg-notebook-50 border-b border-notebook-200">
                <h3 className="text-xs font-semibold text-notebook-500 uppercase tracking-wider mb-1">Generated Files</h3>
                <p className="text-xs text-notebook-400 truncate">{output.baseDir}</p>
              </div>
              <FileTree 
                data={output} 
                onSelectFile={setSelectedFile} 
                selectedPath={selectedFile?.path}
              />
            </div>
          ) : (
            <div className="p-8 text-center text-notebook-400">
              <FileText className="w-12 h-12 mx-auto mb-3 opacity-20" />
              <p className="text-sm">Process a video to see generated files here.</p>
            </div>
          )}
        </div>
        
        {process.env.API_KEY ? null : (
             <div className="p-4 bg-yellow-50 border-t border-yellow-100 text-xs text-yellow-800">
               Note: No API_KEY found. Using mock data.
             </div>
        )}
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0">
        
        {/* Header / Input Area */}
        <header className="bg-white border-b border-notebook-200 p-4 shadow-sm z-10">
          <div className="max-w-4xl mx-auto w-full">
            <div className="flex gap-2">
              <div className="relative flex-1 group">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Youtube className="h-5 w-5 text-gray-400 group-focus-within:text-red-500 transition-colors" />
                </div>
                <input
                  type="text"
                  placeholder="Paste YouTube Link (e.g. https://www.youtube.com/watch?v=...)"
                  className="block w-full pl-10 pr-3 py-2.5 border border-notebook-300 rounded-lg leading-5 bg-notebook-50 placeholder-notebook-400 focus:outline-none focus:bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 sm:text-sm transition-all shadow-inner"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleProcess()}
                />
              </div>
              <button
                onClick={handleProcess}
                disabled={state.status !== 'idle' && state.status !== 'completed' && state.status !== 'error'}
                className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-lg shadow-sm text-white bg-notebook-900 hover:bg-black focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-900 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                {state.status !== 'idle' && state.status !== 'completed' && state.status !== 'error' ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Sparkles className="w-4 h-4 mr-2" />
                )}
                Start Processing
              </button>
            </div>
            {state.error && (
               <div className="mt-2 text-red-600 text-sm flex items-center gap-1">
                 <AlertCircle className="w-4 h-4" /> {state.error}
               </div>
            )}
          </div>
        </header>

        {/* Workspace */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-8">
          <div className="max-w-4xl mx-auto w-full space-y-6">

            {/* Status Section */}
            {(state.status !== 'idle') && (
              <section className="space-y-4 animate-fadeIn">
                 {/* Video Card */}
                 {videoMeta && (
                  <div className="bg-white p-4 rounded-xl border border-notebook-200 shadow-sm flex gap-4 items-start">
                    <img 
                      src={videoMeta.thumbnailUrl} 
                      alt="Thumbnail" 
                      className="w-32 h-20 object-cover rounded-lg bg-notebook-100"
                    />
                    <div className="flex-1">
                      <h2 className="font-bold text-notebook-900 text-lg leading-tight">{videoMeta.title}</h2>
                      <p className="text-notebook-500 text-sm mt-1">{videoMeta.author}</p>
                      
                      <div className="flex flex-wrap items-center gap-3 mt-3">
                         <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                           state.status === 'completed' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'
                         }`}>
                           {state.status === 'completed' ? 'Processing Complete' : 'Processing...'}
                         </span>

                         {state.status === 'completed' && (
                           <>
                             {epubUrl && (
                               <a 
                                 href={epubUrl} 
                                 download={`${videoMeta.title.replace(/[\/\*\?:<>"|]/g, '_').trim()}.epub`}
                                 className="inline-flex items-center gap-1 text-xs font-medium text-orange-700 bg-orange-100 hover:bg-orange-200 px-3 py-1 rounded-full transition-colors"
                               >
                                 <BookOpen className="w-3 h-3" /> Download Full EPUB
                               </a>
                             )}
                             {zipUrl && (
                               <a 
                                 href={zipUrl} 
                                 download={`${videoMeta.title.replace(/[\/\*\?:<>"|]/g, '_').trim()}_split.zip`}
                                 className="inline-flex items-center gap-1 text-xs font-medium text-purple-700 bg-purple-100 hover:bg-purple-200 px-3 py-1 rounded-full transition-colors"
                               >
                                 <FileArchive className="w-3 h-3" /> Download Split ZIP
                               </a>
                             )}
                           </>
                         )}
                      </div>
                    </div>
                  </div>
                 )}

                 {/* Logs */}
                 <TerminalLog logs={state.logs} />
              </section>
            )}

            {/* Result Preview Section */}
            {state.status === 'completed' && selectedFile && (
              <section className="bg-white rounded-xl border border-notebook-200 shadow-sm overflow-hidden flex flex-col h-[600px] animate-slideUp">
                <div className="bg-notebook-50 px-4 py-3 border-b border-notebook-200 flex justify-between items-center">
                   <div className="flex items-center gap-2">
                     <FileText className="w-4 h-4 text-notebook-500" />
                     <span className="font-mono text-sm font-medium text-notebook-700">{selectedFile.name}</span>
                   </div>
                   <div className="flex gap-2">
                     <button className="p-1.5 hover:bg-white rounded border border-transparent hover:border-notebook-300 text-notebook-500 transition-all" title="Download File">
                       <Download className="w-4 h-4" />
                     </button>
                   </div>
                </div>
                <div className="flex-1 overflow-y-auto p-6 bg-white">
                  <article className="prose prose-slate prose-sm sm:prose max-w-none">
                     <pre className="whitespace-pre-wrap font-sans text-notebook-800">
                       {selectedFile.content}
                     </pre>
                  </article>
                </div>
              </section>
            )}

          </div>
        </div>
      </main>
    </div>
  );
};

export default App;