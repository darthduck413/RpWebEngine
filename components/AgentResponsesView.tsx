import React, { useEffect, useState } from 'react';
import { AgentResponse } from '../types';
import { ClipboardDocumentCheckIcon } from './icons/ClipboardDocumentCheckIcon';
import { SparklesIcon } from './icons/SparklesIcon';
import { splitThinkingContent } from '../services/common/thinking';

interface AgentResponsesViewProps {
  responses: AgentResponse[];
  themeColor: string;
  onCopyToNotes: (agentName: string, text: string) => void;
  onSummarizeToNotes: (agentName: string, text: string) => Promise<void>;
}

const AgentResponsesView: React.FC<AgentResponsesViewProps> = ({ responses, themeColor, onCopyToNotes, onSummarizeToNotes }) => {
  const [activeTabIndex, setActiveTabIndex] = useState(0);

  useEffect(() => {
    if (activeTabIndex >= responses.length) {
      setActiveTabIndex(0);
    }
  }, [activeTabIndex, responses.length]);

  if (!responses || responses.length === 0) {
    return null;
  }

  const activeResponse = responses[activeTabIndex];
  
  const formatText = (text: string) => (text ?? '')
      .replace(/\*\*(.*?)\*\*/g, '<strong class="font-bold text-white/90">$1</strong>')
      .replace(/\*(.*?)\*/g, `<em class="italic text-primary-200/70">$1</em>`)
      .replace(/\n/g, '<br />');

  const renderResponseContent = (text: string) => {
    const { thoughts, content } = splitThinkingContent(text);
    const formattedContent = formatText(content);

    return (
      <>
        {thoughts !== null && (
          <details className="mb-3 rounded-md border border-gray-700/70 bg-gray-900/40 p-3">
            <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wider text-gray-400 hover:text-primary-300">
              Thinking Process
            </summary>
            <div className="mt-2 whitespace-pre-wrap font-mono text-xs leading-relaxed text-gray-400">
              {thoughts || <span className="animate-pulse">thinking...</span>}
            </div>
          </details>
        )}
        {content ? (
          <div dangerouslySetInnerHTML={{ __html: formattedContent }} />
        ) : thoughts !== null ? null : (
          <div className="italic text-gray-500">No response text.</div>
        )}
      </>
    );
  }

  return (
    <div className={`border border-primary-900/50 bg-gray-800/40 rounded-lg overflow-hidden`}>
      <div className={`flex bg-gray-900/50 border-b border-primary-900/50`} role="tablist">
        {responses.map((response, index) => (
          <button
            key={index}
            role="tab"
            aria-selected={index === activeTabIndex}
            className={`px-4 py-2 text-sm font-medium transition-colors duration-200 focus:outline-none ${
              index === activeTabIndex
                ? `bg-primary-900/50 text-white border-b-2 border-primary-500`
                : 'text-gray-400 hover:bg-gray-700/50'
            }`}
            onClick={() => setActiveTabIndex(index)}
          >
            {response.agentName}
          </button>
        ))}
      </div>
      {activeResponse && (
        <div className="p-4 text-gray-300 text-sm leading-relaxed" role="tabpanel">
            {renderResponseContent(activeResponse.text)}
            <div className="mt-4 pt-3 border-t border-gray-700/50 flex items-center gap-2">
                <button 
                    onClick={() => onCopyToNotes(activeResponse.agentName, activeResponse.text)} 
                    className={`flex items-center gap-2 px-3 py-1.5 text-xs bg-gray-700/60 text-primary-300 rounded-md border border-gray-600 hover:bg-gray-600/80 hover:text-white transition-all duration-200`}
                    aria-label={`Copy response from ${activeResponse.agentName} to notes`}
                >
                    <ClipboardDocumentCheckIcon className="w-4 h-4" />
                    <span>Copy to Notes</span>
                </button>
                <button 
                    onClick={() => onSummarizeToNotes(activeResponse.agentName, activeResponse.text)} 
                    className={`flex items-center gap-2 px-3 py-1.5 text-xs bg-gray-700/60 text-primary-300 rounded-md border border-gray-600 hover:bg-gray-600/80 hover:text-white transition-all duration-200`}
                    aria-label={`Summarize response from ${activeResponse.agentName} and add to notes`}
                >
                    <SparklesIcon className="w-4 h-4" />
                    <span>Summarize to Notes</span>
                </button>
            </div>
        </div>
      )}
    </div>
  );
};

export default AgentResponsesView;
