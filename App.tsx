
import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Reflection, AppStatus, ViewMode, HistoryEntry, Mood, ChatMessage } from './types';
import { getJournalReflection, startJournalChat, generateSpeech } from './services/geminiService';
import { ReflectionCard } from './components/ReflectionCard';
import { HistoryView } from './components/HistoryView';
import { ChatInterface } from './components/ChatInterface';
import { Chat } from '@google/genai';

const DRAFT_KEY = 'serenity_journal_draft';
const HISTORY_KEY = 'serenity_journal_history';

const MOODS: { label: string; value: Mood }[] = [
  { label: 'Calm', value: 'calm' },
  { label: 'Joyful', value: 'joyful' },
  { label: 'Reflective', value: 'reflective' },
  { label: 'Heavy', value: 'heavy' },
  { label: 'Anxious', value: 'anxious' },
  { label: 'Tired', value: 'tired' },
];

function decodeBase64(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number = 24000,
  numChannels: number = 1,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

const App: React.FC = () => {
  const [viewMode, setViewMode] = useState<ViewMode>(ViewMode.JOURNAL);
  const [sessionKey, setSessionKey] = useState(0);
  const [entry, setEntry] = useState<string>(() => {
    return localStorage.getItem(DRAFT_KEY) || '';
  });
  const [selectedMood, setSelectedMood] = useState<Mood>('none');
  const [reflection, setReflection] = useState<Reflection | null>(null);
  const [status, setStatus] = useState<AppStatus>(AppStatus.IDLE);
  const [error, setError] = useState<string | null>(null);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [currentHistoryId, setCurrentHistoryId] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>(() => {
    const saved = localStorage.getItem(HISTORY_KEY);
    return saved ? JSON.parse(saved) : [];
  });

  const [isFocused, setIsFocused] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const audioContextRef = useRef<AudioContext | null>(null);
  const currentAudioSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [currentAudioBase64, setCurrentAudioBase64] = useState<string | null>(null);
  const [isGeneratingVoice, setIsGeneratingVoice] = useState(false);
  
  const [activeAudioId, setActiveAudioId] = useState<string | number | null>(null);
  const [generatingAudioId, setGeneratingAudioId] = useState<string | number | null>(null);

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [isChatting, setIsChatting] = useState(false);
  const chatSessionRef = useRef<Chat | null>(null);
  const [isSendingChat, setIsSendingChat] = useState(false);

  const entryRef = useRef(entry);
  useEffect(() => {
    entryRef.current = entry;
    // Auto-resize textarea
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [entry]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (entryRef.current.trim() && viewMode === ViewMode.JOURNAL) {
        localStorage.setItem(DRAFT_KEY, entryRef.current);
        setLastSaved(new Date());
      }
    }, 30000);
    return () => clearInterval(interval);
  }, [viewMode]);

  useEffect(() => {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  }, [history]);

  const stopCurrentAudio = () => {
    if (currentAudioSourceRef.current) {
      try {
        currentAudioSourceRef.current.stop();
      } catch (e) {}
      currentAudioSourceRef.current = null;
    }
    setIsPlayingAudio(false);
    setActiveAudioId(null);
  };

  const playAudio = async (base64Audio: string, id: string | number = 'main') => {
    stopCurrentAudio();
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    }
    const ctx = audioContextRef.current;
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }

    const audioBytes = decodeBase64(base64Audio);
    const buffer = await decodeAudioData(audioBytes, ctx);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.onended = () => {
      setIsPlayingAudio(false);
      setActiveAudioId(null);
    };
    
    currentAudioSourceRef.current = source;
    setIsPlayingAudio(true);
    setActiveAudioId(id);
    source.start(0);
  };

  const updateHistoryWithChat = (messages: ChatMessage[]) => {
    if (!currentHistoryId) return;
    setHistory(prev => prev.map(h => 
      h.id === currentHistoryId ? { ...h, chatHistory: messages } : h
    ));
  };

  const handleTogglePlayback = async () => {
    if (isPlayingAudio && activeAudioId === 'main') {
      stopCurrentAudio();
    } else {
      if (currentAudioBase64 && (activeAudioId !== 'main' || !isPlayingAudio)) {
        playAudio(currentAudioBase64, 'main');
      } else if (reflection) {
        setIsGeneratingVoice(true);
        setGeneratingAudioId('main');
        try {
          const base64Audio = await generateSpeech(reflection.content);
          if (base64Audio) {
            setCurrentAudioBase64(base64Audio);
            playAudio(base64Audio, 'main');
          }
        } finally {
          setIsGeneratingVoice(false);
          setGeneratingAudioId(null);
        }
      }
    }
  };

  const handleToggleChatPlayback = async (text: string, index: number) => {
    const id = `chat-${index}`;
    const msg = chatMessages[index];
    
    if (isPlayingAudio && activeAudioId === id) {
      stopCurrentAudio();
    } else {
      if (msg?.audioBase64) {
        playAudio(msg.audioBase64, id);
        return;
      }
      
      setGeneratingAudioId(id);
      setIsGeneratingVoice(true);
      try {
        const base64Audio = await generateSpeech(text);
        if (base64Audio) {
          const updatedMessages = chatMessages.map((m, i) => i === index ? { ...m, audioBase64: base64Audio } : m);
          setChatMessages(updatedMessages);
          updateHistoryWithChat(updatedMessages);
          playAudio(base64Audio, id);
        }
      } finally {
        setIsGeneratingVoice(false);
        setGeneratingAudioId(null);
      }
    }
  };

  const handleEntryChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setEntry(e.target.value);
  };

  const handleGetReflection = useCallback(async () => {
    if (!entry.trim()) return;

    setStatus(AppStatus.LOADING);
    setError(null);
    setIsChatting(false);
    setChatMessages([]);
    chatSessionRef.current = null;
    setCurrentAudioBase64(null);
    stopCurrentAudio();
    
    try {
      const { reflection: content, summary } = await getJournalReflection(entry, selectedMood, history);
      const newReflection = {
        content,
        summary,
        timestamp: new Date()
      };
      
      const newId = crypto.randomUUID();
      setCurrentHistoryId(newId);
      setReflection(newReflection);
      setStatus(AppStatus.SUCCESS);
      
      const newHistoryEntry: HistoryEntry = {
        id: newId,
        text: entry,
        summary: summary,
        reflection: content,
        mood: selectedMood,
        timestamp: new Date().toISOString(),
        chatHistory: []
      };
      
      setHistory(prev => [newHistoryEntry, ...prev]);

      setIsGeneratingVoice(true);
      setGeneratingAudioId('main');
      try {
        const base64Audio = await generateSpeech(content);
        if (base64Audio) {
          setCurrentAudioBase64(base64Audio);
          playAudio(base64Audio, 'main');
        }
      } finally {
        setIsGeneratingVoice(false);
        setGeneratingAudioId(null);
      }

      setTimeout(() => {
        window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
      }, 100);
    } catch (err) {
      console.error(err);
      setError("I'm sorry, I couldn't reflect on that right now. Please try again when you're ready.");
      setStatus(AppStatus.ERROR);
    }
  }, [entry, selectedMood, history]);

  const handleSendMessage = async (text: string) => {
    if (!chatSessionRef.current) {
      if (!reflection) return;
      chatSessionRef.current = startJournalChat(entry, reflection.content, selectedMood, history);
    }

    const newUserMsg: ChatMessage = { role: 'user', text };
    const updatedMessagesWithUser = [...chatMessages, newUserMsg];
    setChatMessages(updatedMessagesWithUser);
    updateHistoryWithChat(updatedMessagesWithUser);
    setIsSendingChat(true);

    try {
      const response = await chatSessionRef.current.sendMessage({ message: text });
      const modelText = response.text || "I'm here listening, but I couldn't find the right words just now.";
      const newModelMsg: ChatMessage = { role: 'model', text: modelText };
      
      const updatedMessagesWithModel = [...updatedMessagesWithUser, newModelMsg];
      setChatMessages(updatedMessagesWithModel);
      updateHistoryWithChat(updatedMessagesWithModel);
      
      setIsGeneratingVoice(true);
      try {
        const base64Audio = await generateSpeech(modelText);
        if (base64Audio) {
          setChatMessages(prev => {
            const next = [...prev];
            const lastIdx = next.length - 1;
            if (next[lastIdx] && next[lastIdx].role === 'model') {
              next[lastIdx] = { ...next[lastIdx], audioBase64: base64Audio };
              updateHistoryWithChat(next);
            }
            return next;
          });
          
          const id = `chat-${updatedMessagesWithUser.length}`; 
          playAudio(base64Audio, id);
        }
      } finally {
        setIsGeneratingVoice(false);
      }
    } catch (err) {
      console.error(err);
      setChatMessages(prev => [...prev, { role: 'model', text: "I'm sorry, I lost my train of thought. Could you say that again?" }]);
    } finally {
      setIsSendingChat(false);
    }
  };

  const handleStartFresh = () => {
    if (entry.trim() || reflection) {
      if (!confirm('Start a new session? Your current writing and reflection will be cleared.')) {
        return;
      }
    }
    
    stopCurrentAudio();
    setCurrentAudioBase64(null);
    setSessionKey(prev => prev + 1);
    setEntry('');
    setReflection(null);
    setSelectedMood('none');
    setChatMessages([]);
    setIsChatting(false);
    setStatus(AppStatus.IDLE);
    setError(null);
    setLastSaved(null);
    setCurrentHistoryId(null);
    chatSessionRef.current = null;
    localStorage.removeItem(DRAFT_KEY);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const clearHistory = () => {
    setHistory([]);
    localStorage.removeItem(HISTORY_KEY);
  };

  const isButtonDisabled = !entry.trim() || status === AppStatus.LOADING;
  const wordCount = entry.trim() ? entry.trim().split(/\s+/).length : 0;

  return (
    <div className="min-h-screen px-4 md:px-6 py-6 md:py-20 max-w-2xl mx-auto flex flex-col">
      <header className={`mb-8 md:mb-12 text-center md:text-left flex flex-col md:flex-row md:items-end md:justify-between border-b border-stone-100 pb-6 md:pb-8 transition-opacity duration-700 ${isFocused ? 'opacity-30' : 'opacity-100'}`}>
        <div>
          <h1 className="text-2xl md:text-4xl font-light text-stone-800 tracking-tight font-serif mb-1 md:mb-2">
            Serenity Journal
          </h1>
          <p className="text-stone-500 text-xs md:text-base font-light">
            A quiet space for your thoughts.
          </p>
        </div>
        
        <div className="flex flex-col items-center md:items-end mt-4 md:mt-0 gap-2 md:gap-3">
          <div className="flex flex-wrap justify-center md:justify-end items-center gap-2 md:gap-4">
            {(isPlayingAudio || isGeneratingVoice) && (
               <span className="flex items-center gap-1.5 text-[9px] md:text-[10px] text-emerald-600 bg-emerald-50 px-2 py-0.5 md:py-1 rounded-full uppercase tracking-widest font-bold border border-emerald-100">
                {isGeneratingVoice ? (
                  <svg className="animate-spin h-2.5 w-2.5 md:h-3 md:w-3 text-emerald-500" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                ) : (
                  <span className="flex gap-0.5">
                    <span className="w-0.5 h-1.5 md:h-2 bg-emerald-500 animate-[bounce_0.6s_infinite]"></span>
                    <span className="w-0.5 h-2 md:h-3 bg-emerald-500 animate-[bounce_0.8s_infinite]"></span>
                  </span>
                )}
                {isGeneratingVoice ? 'Wait' : 'Speaking'}
              </span>
            )}
            {history.length > 0 && viewMode === ViewMode.JOURNAL && (
              <span className="flex items-center gap-1.5 text-[9px] md:text-[10px] text-emerald-600 bg-emerald-50 px-2 py-0.5 md:py-1 rounded-full uppercase tracking-widest font-bold border border-emerald-100 animate-pulse">
                <span className="w-1 md:w-1.5 h-1 md:h-1.5 bg-emerald-500 rounded-full"></span>
                Active
              </span>
            )}
          </div>
          
          <button 
            onClick={() => setViewMode(viewMode === ViewMode.JOURNAL ? ViewMode.HISTORY : ViewMode.JOURNAL)}
            className="flex items-center gap-1.5 text-stone-500 hover:text-emerald-700 text-xs md:text-sm transition-colors px-3 py-1 rounded-full hover:bg-emerald-50"
          >
            {viewMode === ViewMode.JOURNAL ? (
              <><svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg> History</>
            ) : (
              <><svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg> Journal</>
            )}
          </button>
        </div>
      </header>

      <main className="flex-grow flex flex-col">
        {viewMode === ViewMode.JOURNAL ? (
          <div key={sessionKey} className="relative flex-grow flex flex-col animate-in fade-in duration-500">
            <div className={`mb-6 md:mb-8 flex flex-wrap justify-center md:justify-start gap-1.5 md:gap-2 transition-opacity duration-700 ${isFocused ? 'opacity-40' : 'opacity-100'}`}>
              {MOODS.map((m) => (
                <button
                  key={m.value}
                  onClick={() => setSelectedMood(m.value)}
                  className={`px-3 md:px-4 py-1.5 rounded-full text-[10px] md:text-xs transition-all border ${
                    selectedMood === m.value 
                      ? 'bg-stone-800 text-stone-50 border-stone-800 shadow-sm' 
                      : 'bg-white text-stone-400 border-stone-200 hover:border-stone-400'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>

            <div className={`relative flex flex-col flex-grow transition-all duration-500 ${isFocused ? 'scale-[1.01]' : 'scale-100'}`}>
              <textarea
                ref={textareaRef}
                value={entry}
                onChange={handleEntryChange}
                onFocus={() => setIsFocused(true)}
                onBlur={() => setIsFocused(false)}
                placeholder="How are you feeling right now?"
                className="w-full min-h-[250px] md:min-h-[350px] bg-transparent text-lg md:text-2xl font-light text-stone-800 placeholder-stone-300 border-none focus:ring-0 resize-none p-0 leading-[1.6] mb-4 transition-all duration-300 overflow-hidden"
                disabled={status === AppStatus.LOADING}
                autoFocus
              />
              
              {entry.length > 0 && (
                <div className={`flex justify-end transition-opacity duration-500 ${isFocused ? 'opacity-100' : 'opacity-40'}`}>
                  <span className="text-[9px] md:text-[10px] text-stone-400 uppercase tracking-widest font-bold">
                    {wordCount} {wordCount === 1 ? 'word' : 'words'}
                  </span>
                </div>
              )}
            </div>
            
            <div className={`sticky bottom-0 md:bottom-8 py-4 md:py-6 bg-gradient-to-t from-[#FDFCF8] via-[#FDFCF8] to-transparent flex flex-col md:flex-row gap-3 md:gap-4 transition-opacity duration-500 z-10 ${isFocused && entry.length > 50 ? 'opacity-20 hover:opacity-100' : 'opacity-100'} sticky-bottom-safe`}>
              <button
                onClick={handleGetReflection}
                disabled={isButtonDisabled}
                className={`
                  group relative flex-grow md:flex-initial px-8 md:px-10 py-3.5 md:py-4 rounded-full font-medium transition-all duration-300 active:scale-95
                  ${isButtonDisabled 
                    ? 'bg-stone-100 text-stone-300 cursor-not-allowed opacity-50' 
                    : 'bg-emerald-800 text-emerald-50 hover:bg-emerald-900 shadow-md hover:shadow-lg'}
                `}
              >
                <span className="flex items-center justify-center gap-2 text-sm md:text-base">
                  {status === AppStatus.LOADING ? (
                    <><svg className="animate-spin h-4 w-4 md:h-5 md:w-5 text-stone-300" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> Reflecting...</>
                  ) : (
                    <>Get Reflection <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 md:h-5 md:w-5 transition-transform group-hover:translate-x-1" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M12.293 5.293a1 1 0 011.414 0l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-2.293-2.293a1 1 0 010-1.414z" clipRule="evenodd" /></svg></>
                  )}
                </span>
              </button>

              <button
                onClick={handleStartFresh}
                className="px-6 py-2 md:py-4 rounded-full text-stone-400 hover:text-stone-600 hover:bg-stone-100 transition-all text-xs md:text-sm font-medium"
              >
                Start New
              </button>
            </div>
            
            {error && <p className="mt-4 text-rose-500 text-xs md:text-sm text-center md:text-left font-medium">{error}</p>}
            
            <ReflectionCard 
              reflection={reflection} 
              isLoading={status === AppStatus.LOADING} 
              onTogglePlayback={handleTogglePlayback} 
              isPlaying={isPlayingAudio && activeAudioId === 'main'} 
              isGeneratingVoice={isGeneratingVoice && generatingAudioId === 'main'}
            />
            
            {status === AppStatus.SUCCESS && reflection && (
              <div className="mt-6 md:mt-8 flex justify-center md:justify-start">
                <button 
                  onClick={() => setIsChatting(true)}
                  className="text-emerald-700 hover:text-emerald-800 text-xs md:text-sm font-medium flex items-center gap-2 px-6 py-3 rounded-full bg-emerald-50/50 hover:bg-emerald-50 transition-all border border-emerald-100/50 group"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 transition-transform group-hover:scale-110" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                  Ask a follow-up
                </button>
              </div>
            )}
            
            {isChatting && (
              <ChatInterface 
                messages={chatMessages} 
                onSendMessage={handleSendMessage} 
                isSending={isSendingChat}
                onClose={() => setIsChatting(false)}
                onTogglePlayback={handleToggleChatPlayback}
                activeAudioId={activeAudioId}
                generatingAudioId={generatingAudioId}
              />
            )}
          </div>
        ) : (
          <HistoryView history={history} onBack={() => setViewMode(ViewMode.JOURNAL)} onClear={clearHistory} />
        )}
      </main>

      <footer className="mt-12 md:mt-16 py-6 md:py-8 border-t border-stone-100 flex flex-col md:flex-row justify-between items-center text-stone-400 text-[10px] md:text-xs tracking-widest uppercase gap-4">
        <div className="text-center md:text-left leading-relaxed">
          Your thoughts are private and safe. <br/>
          <span className="opacity-60 lowercase font-normal italic">A companion, not professional care.</span>
        </div>
        <div className="flex gap-6">
          <button className={`transition-colors ${viewMode === ViewMode.HISTORY ? 'text-emerald-700 font-bold' : 'hover:text-stone-600'}`} onClick={() => setViewMode(ViewMode.HISTORY)}>History</button>
          <button className="hover:text-stone-600 transition-colors">Settings</button>
        </div>
      </footer>
    </div>
  );
};

export default App;
