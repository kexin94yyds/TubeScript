import React, { useEffect, useRef } from 'react';
import { Terminal } from 'lucide-react';

interface TerminalLogProps {
  logs: string[];
}

const TerminalLog: React.FC<TerminalLogProps> = ({ logs }) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <div className="bg-notebook-900 rounded-lg overflow-hidden shadow-lg border border-notebook-700 flex flex-col h-64 font-mono text-xs sm:text-sm">
      <div className="bg-notebook-800 px-4 py-2 flex items-center gap-2 border-b border-notebook-700">
        <Terminal className="w-4 h-4 text-notebook-400" />
        <span className="text-notebook-300 font-semibold">切书神技.zsh - Output</span>
      </div>
      <div 
        ref={scrollRef}
        className="flex-1 p-4 overflow-y-auto text-green-400 space-y-1"
      >
        {logs.length === 0 ? (
          <span className="text-notebook-600 animate-pulse">Waiting for process to start...</span>
        ) : (
          logs.map((log, index) => (
            <div key={index} className="break-all whitespace-pre-wrap">
              {log}
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default TerminalLog;
