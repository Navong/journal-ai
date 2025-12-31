
import React, { useState } from 'react';
import { HistoryEntry } from '../types';
import ReactMarkdown from 'react-markdown';

interface HistoryViewProps {
  history: HistoryEntry[];
  onBack: () => void;
  onClear: () => void;
}

export const HistoryView: React.FC<HistoryViewProps> = ({ history, onBack, onClear }) => {
  const [expandedEntries, setExpandedEntries] = useState<Set<string>>(new Set());

  const toggleExpand = (id: string) => {
    const newExpanded = new Set(expandedEntries);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedEntries(newExpanded);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString(undefined, {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <div className="flex flex-col animate-in fade-in duration-500">
      <div className="flex items-center justify-between mb-8 md:mb-12">
        <button 
          onClick={onBack}
          className="flex items-center gap-1.5 text-stone-500 hover:text-stone-800 transition-colors group text-sm md:text-base"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 md:h-5 md:w-5 transition-transform group-hover:-translate-x-1" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M7.707 14.707a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l2.293 2.293a1 1 0 010 1.414z" clipRule="evenodd" />
          </svg>
          Back
        </button>
        
        {history.length > 0 && (
          <button 
            onClick={() => {
              if (confirm('Clear your history?')) {
                onClear();
              }
            }}
            className="text-stone-400 hover:text-rose-400 text-[10px] md:text-xs tracking-widest uppercase transition-colors px-2 py-1"
          >
            Clear All
          </button>
        )}
      </div>

      <h2 className="text-xl md:text-2xl font-serif text-stone-800 mb-6 md:mb-8 px-1">Past Reflections</h2>

      {history.length === 0 ? (
        <div className="py-20 text-center text-stone-400 italic text-sm">
          No past reflections yet.
        </div>
      ) : (
        <div className="space-y-12 md:space-y-16">
          {history.map((item) => {
            const isExpanded = expandedEntries.has(item.id);
            const isLongEntry = item.text.length > 250 || (item.text.match(/\n/g) || []).length > 2;

            return (
              <article key={item.id} className="border-l-2 border-stone-100 pl-5 md:pl-8 relative">
                <div className="absolute -left-[5px] top-1 w-2 h-2 rounded-full bg-stone-200"></div>
                
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <time className="text-[10px] text-stone-400 font-medium tracking-wide uppercase block">
                    {formatDate(item.timestamp)}
                  </time>
                  {item.mood !== 'none' && (
                    <span className="text-[9px] px-2 py-0.5 rounded-full bg-stone-50 text-stone-500 border border-stone-100 font-medium uppercase tracking-tighter">
                      {item.mood}
                    </span>
                  )}
                </div>

                {/* Essence Summary */}
                {item.summary && (
                  <div className="mb-3 md:mb-4">
                    <p className="text-emerald-700/80 font-medium text-[13px] md:text-sm leading-relaxed border-b border-emerald-50/50 pb-2">
                      {item.summary}
                    </p>
                  </div>
                )}
                
                {/* Journal Entry with Truncation */}
                <div className="mb-5 md:mb-6 relative">
                  <div className={`
                    text-stone-700 font-serif leading-relaxed whitespace-pre-wrap text-sm md:text-base transition-all duration-300
                    ${!isExpanded && isLongEntry ? 'line-clamp-3 overflow-hidden mask-fade-bottom' : ''}
                  `}>
                    {item.text}
                  </div>
                  
                  {isLongEntry && (
                    <button 
                      onClick={() => toggleExpand(item.id)}
                      className="mt-2 text-[10px] md:text-xs font-bold text-emerald-700 uppercase tracking-widest hover:text-emerald-800 transition-colors flex items-center gap-1 group py-1"
                    >
                      {isExpanded ? (
                        <>Show less <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" /></svg></>
                      ) : (
                        <>Read more <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 group-hover:translate-y-0.5 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg></>
                      )}
                    </button>
                  )}
                </div>

                {/* Reflection Card */}
                <div className="bg-[#F2F6F3]/50 p-4 md:p-6 rounded-xl md:rounded-2xl border border-stone-50 text-stone-600 italic font-serif text-xs md:text-sm leading-relaxed mb-4">
                  <ReactMarkdown>{item.reflection}</ReactMarkdown>
                </div>

                {/* Chat Thread */}
                {item.chatHistory && item.chatHistory.length > 0 && (
                  <div className="mt-6 space-y-3 md:space-y-4 border-t border-stone-50 pt-4">
                     <h4 className="text-[9px] md:text-[10px] text-stone-400 font-bold uppercase tracking-widest mb-1 px-1">Follow-up</h4>
                     <div className="space-y-2 md:space-y-3">
                       {item.chatHistory.map((chat, idx) => (
                         <div key={idx} className={`flex flex-col ${chat.role === 'model' ? 'items-start' : 'items-end'}`}>
                           <div className={`px-3 md:px-4 py-2 rounded-xl md:rounded-2xl text-[13px] md:text-sm ${chat.role === 'model' ? 'bg-emerald-50 text-emerald-900 font-serif italic border border-emerald-100/30' : 'bg-stone-50 text-stone-600 border border-stone-100 shadow-sm'}`}>
                             {chat.role === 'model' ? <ReactMarkdown>{chat.text}</ReactMarkdown> : chat.text}
                           </div>
                         </div>
                       ))}
                     </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
};
