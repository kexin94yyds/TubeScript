import React, { useState } from 'react';
import { Folder, FileText, FileCode, ChevronRight, ChevronDown, File } from 'lucide-react';
import { ProcessedOutput, VirtualFile } from '../types';

interface FileTreeProps {
  data: ProcessedOutput | null;
  onSelectFile: (file: VirtualFile) => void;
  selectedPath?: string;
}

const FileIcon = ({ name }: { name: string }) => {
  if (name.endsWith('.md')) return <FileCode className="w-4 h-4 text-blue-500" />;
  if (name.endsWith('.html')) return <FileCode className="w-4 h-4 text-orange-500" />;
  if (name.endsWith('.txt')) return <FileText className="w-4 h-4 text-gray-500" />;
  return <File className="w-4 h-4 text-gray-400" />;
};

const FolderItem: React.FC<{ 
  name: string; 
  children?: React.ReactNode; 
  defaultOpen?: boolean 
}> = ({ name, children, defaultOpen = false }) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="ml-2">
      <div 
        className="flex items-center gap-1 py-1 cursor-pointer hover:bg-notebook-100 rounded px-1 select-none"
        onClick={() => setIsOpen(!isOpen)}
      >
        {isOpen ? <ChevronDown className="w-4 h-4 text-notebook-500" /> : <ChevronRight className="w-4 h-4 text-notebook-500" />}
        <Folder className={`w-4 h-4 ${isOpen ? 'text-notebook-700' : 'text-notebook-500'}`} />
        <span className="text-sm font-medium text-notebook-800">{name}</span>
      </div>
      {isOpen && <div className="ml-4 border-l border-notebook-300 pl-1">{children}</div>}
    </div>
  );
};

const FileItem: React.FC<{ 
  file: VirtualFile; 
  onSelect: (f: VirtualFile) => void;
  isSelected: boolean;
}> = ({ file, onSelect, isSelected }) => (
  <div 
    className={`flex items-center gap-2 py-1 ml-6 cursor-pointer rounded px-2 text-sm ${
      isSelected ? 'bg-primary-100 text-primary-600 font-medium' : 'hover:bg-notebook-100 text-notebook-700'
    }`}
    onClick={() => onSelect(file)}
  >
    <FileIcon name={file.name} />
    <span className="truncate">{file.name}</span>
  </div>
);

const FileTree: React.FC<FileTreeProps> = ({ data, onSelectFile, selectedPath }) => {
  if (!data) return <div className="p-4 text-notebook-400 text-sm text-center">No output generated yet.</div>;

  return (
    <div className="h-full overflow-y-auto p-2">
      <FolderItem name={data.baseDir} defaultOpen={true}>
        
        {/* Full Files at Root */}
        <FileItem 
          file={data.fullMarkdown} 
          onSelect={onSelectFile} 
          isSelected={selectedPath === data.fullMarkdown.path} 
        />
        <FileItem 
          file={data.fullTxt} 
          onSelect={onSelectFile} 
          isSelected={selectedPath === data.fullTxt.path} 
        />

        {/* HTML Directory */}
        <FolderItem name="html">
          {data.htmlDir.map(f => (
            <FileItem 
              key={f.path} 
              file={f} 
              onSelect={onSelectFile}
              isSelected={selectedPath === f.path}
            />
          ))}
        </FolderItem>

        {/* Markdown Directory */}
        <FolderItem name="markdown" defaultOpen={true}>
          <FileItem 
            file={data.indexMd} 
            onSelect={onSelectFile}
            isSelected={selectedPath === data.indexMd.path}
          />
           <div className="my-1 border-t border-notebook-200"></div>
          {data.markdownDir.map(f => (
            <FileItem 
              key={f.path} 
              file={f} 
              onSelect={onSelectFile}
              isSelected={selectedPath === f.path}
            />
          ))}
        </FolderItem>

        {/* TXT Directory */}
        <FolderItem name="txt">
          <FileItem 
            file={data.indexTxt} 
            onSelect={onSelectFile}
            isSelected={selectedPath === data.indexTxt.path}
          />
          <div className="my-1 border-t border-notebook-200"></div>
          {data.txtDir.map(f => (
            <FileItem 
              key={f.path} 
              file={f} 
              onSelect={onSelectFile}
              isSelected={selectedPath === f.path}
            />
          ))}
        </FolderItem>

      </FolderItem>
    </div>
  );
};

export default FileTree;
