'use client';

import React, { useRef, useEffect } from 'react';
import { Reflection, AppStatus, ViewMode, HistoryEntry, Mood, ChatMessage, AudioPlaybackState, ReflectionProgress, TokenUsage, CumulativeTokenUsage } from '../types';
import { Session } from 'next-auth';
import { signOut } from 'next-auth/react';
import { showToast, ToastContainer } from '../utils/toast';
import * as AlertDialog from '@radix-ui/react-alert-dialog';
import { HistoryView } from './HistoryView';

interface JournalInterfaceProps {
    // App state
    sessionKey: number;
    viewMode: ViewMode;
    onViewModeChange: (mode: ViewMode) => void;
    isDemoMode: boolean;
    session: Session | null;
    authStatus: 'loading' | 'authenticated' | 'unauthenticated';

    // Journal state
    entry: string;
    onEntryChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
    selectedMood: Mood;
    onSelectedMoodChange: (mood: Mood) => void;
    reflection: Reflection | null;
    streamingReflection?: string; // Add streaming reflection text
    status: AppStatus.IDLE | AppStatus.LOADING | AppStatus.SUCCESS | AppStatus.ERROR;
    error: string | null;
    reflectionProgress: ReflectionProgress | null;
    autoPlayEnabled: boolean;
    wordCount: number;

    // Chat state
    chatMessages: ChatMessage[];
    isChatting: boolean;
    isSendingChat: boolean;
    contextRevalidated: boolean;

    // Audio state
    isPlayingAudio: boolean;
    isGeneratingVoice: boolean;
    isAudioSyncing: boolean;
    audioSyncProgress: any;
    activeAudioId?: string | number | null;
    generatingAudioId?: string | number | null;

    // History state
    history: HistoryEntry[];
    currentHistoryId: string | null;

    // Actions
    onGetReflection: () => void;
    onStartFresh: () => void;
    onToggleAutoPlay: () => void;
    onExitDemo: () => void;

    // Audio actions
    onTogglePlayback: (text: string) => Promise<void>;
    onHistoryAudioPlayback: (text: string, id: string) => Promise<void>;
    onToggleChatPlayback: (text: string, index: number) => Promise<void>;

    // Chat actions
    onSendMessage: (text: string) => Promise<void>;
    onClearChat: () => void;
    onInvalidateChatSession: () => void;
    onStartNewChat?: () => void; // Optional for backwards compatibility

    // History actions
    onDeleteEntry: (id: string) => Promise<void>;
    onClearAllHistory: () => Promise<void>;
}

export const JournalInterface: React.FC<JournalInterfaceProps> = (props) => {
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    // Auto-resize textarea
    useEffect(() => {
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
            textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
        }
    }, [props.entry]);

    const isButtonDisabled = !props.entry.trim() || props.status === AppStatus.LOADING;

    return (
        <div className="min-h-screen px-4 md:px-6 py-6 md:py-20 max-w-2xl mx-auto flex flex-col">
            <ToastContainer />

            {props.isDemoMode && (
                <div className="mb-4 md:mb-6 p-3 md:p-4 bg-amber-50/50 border border-amber-200/50 rounded-lg flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 md:gap-4">
                    <div className="flex items-start gap-2.5 md:gap-3 flex-1 min-w-0">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 md:h-5 md:w-5 text-amber-600 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <div className="flex-1 min-w-0">
                            <p className="text-xs md:text-sm font-medium text-amber-900 mb-0.5">Demo Mode</p>
                            <p className="text-[10px] md:text-xs text-amber-700 font-light leading-relaxed">Your entries won't be saved. <button onClick={() => window.location.href = '/login'} className="underline hover:text-amber-900">Sign in</button></p>
                        </div>
                    </div>
                    <button
                        onClick={props.onExitDemo}
                        className="text-[10px] md:text-xs text-amber-700 hover:text-amber-900 font-medium px-3 py-1.5 md:py-1 rounded-full hover:bg-amber-100 transition-colors flex-shrink-0 touch-manipulation"
                    >
                        Exit Demo
                    </button>
                </div>
            )}

            <header className="mb-6 md:mb-12 text-center md:text-left flex flex-col md:flex-row md:items-end md:justify-between border-b border-stone-100 pb-4 md:pb-8">
                <div>
                    <h1 className="text-xl md:text-4xl font-light text-stone-800 tracking-tight font-serif mb-0.5 md:mb-2">
                        Serenity Journal
                    </h1>
                    <p className="text-stone-500 text-[10px] md:text-base font-light">
                        A quiet space for your thoughts.
                    </p>
                </div>

                <div className="flex flex-col items-center md:items-end mt-4 md:mt-0 gap-2 md:gap-3">
                    <div className="flex flex-wrap justify-center md:justify-end items-center gap-2 md:gap-4">
                        {(props.isPlayingAudio || props.isGeneratingVoice) && (
                            <span className="flex items-center gap-1.5 text-[9px] md:text-[10px] text-emerald-600 bg-emerald-50 px-2 py-0.5 md:py-1 rounded-full uppercase tracking-widest font-bold border border-emerald-100">
                                {props.isGeneratingVoice ? (
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
                                {props.isGeneratingVoice ? 'Wait' : 'Speaking'}
                            </span>
                        )}
                        {props.history.length > 0 && props.viewMode === ViewMode.JOURNAL && (
                            <span className="flex items-center gap-1.5 text-[9px] md:text-[10px] text-emerald-600 bg-emerald-50 px-2 py-0.5 md:py-1 rounded-full uppercase tracking-widest font-bold border border-emerald-100 animate-pulse">
                                <span className="w-1 md:w-1.5 h-1 md:h-1.5 bg-emerald-500 rounded-full"></span>
                                Active
                            </span>
                        )}
                        {props.isAudioSyncing && props.audioSyncProgress && (
                            <span className="flex items-center gap-1.5 text-[9px] md:text-[10px] text-emerald-600 bg-emerald-50 px-2 py-0.5 md:py-1 rounded-full uppercase tracking-widest font-bold border border-emerald-100">
                                <svg className="animate-spin h-2.5 w-2.5 md:h-3 md:w-3 text-emerald-500" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                                Syncing
                            </span>
                        )}
                        <span className={`flex items-center gap-1.5 text-[9px] md:text-[10px] px-2 py-0.5 md:py-1 rounded-full uppercase tracking-widest font-bold border ${props.autoPlayEnabled
                            ? 'text-emerald-600 bg-emerald-50 border-emerald-100'
                            : 'text-stone-400 bg-stone-50 border-stone-200'
                            }`}>
                            Auto-play: {props.autoPlayEnabled ? 'ON' : 'OFF'}
                        </span>
                    </div>

                    <div className="flex items-center gap-2 md:gap-3">
                        <button
                            onClick={() => props.onViewModeChange(props.viewMode === ViewMode.JOURNAL ? ViewMode.HISTORY : ViewMode.JOURNAL)}
                            className="flex items-center gap-1.5 text-stone-500 hover:text-emerald-700 text-xs md:text-sm transition-colors px-3 py-2 md:py-1 rounded-full hover:bg-emerald-50 touch-manipulation min-h-[44px] md:min-h-0"
                        >
                            {props.viewMode === ViewMode.JOURNAL ? (
                                <><svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg> History</>
                            ) : (
                                <><svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg> Journal</>
                            )}
                        </button>

                        {(props.session?.user || props.isDemoMode) && (
                            <div className="flex items-center gap-2">
                                {props.session?.user && (
                                    <span className="text-stone-400 text-xs hidden md:inline">
                                        {props.session.user.email?.split('@')[0]}
                                    </span>
                                )}
                                {props.session?.user ? (
                                    <button
                                        onClick={() => signOut({ callbackUrl: '/login' })}
                                        className="flex items-center gap-1.5 text-stone-400 hover:text-stone-600 text-xs md:text-sm transition-colors px-3 py-2 md:py-1 rounded-full hover:bg-stone-50 touch-manipulation min-h-[44px] md:min-h-0"
                                        title="Sign out"
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                                        </svg>
                                        <span className="hidden md:inline">Sign out</span>
                                    </button>
                                ) : props.isDemoMode && (
                                    <button
                                        onClick={() => window.location.href = '/login'}
                                        className="flex items-center gap-1.5 text-emerald-600 hover:text-emerald-700 text-xs md:text-sm transition-colors px-3 py-2 md:py-1 rounded-full hover:bg-emerald-50 font-medium touch-manipulation min-h-[44px] md:min-h-0"
                                        title="Sign in to save your entries"
                                    >
                                        Sign in
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </header>

            <main className="flex-grow flex flex-col">
                {props.viewMode === ViewMode.JOURNAL ? (
                    <div key={props.sessionKey} className="relative flex-grow flex flex-col animate-in fade-in duration-500">
                        <div className="relative flex flex-col flex-grow">
                            <textarea
                                ref={textareaRef}
                                value={props.entry}
                                onChange={props.onEntryChange}
                                onKeyDown={(e) => {
                                    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                                        e.preventDefault();
                                        if (props.entry.trim() && props.status !== AppStatus.LOADING) {
                                            props.onGetReflection();
                                        }
                                    }
                                }}
                                placeholder="How are you feeling right now?"
                                className="w-full min-h-[200px] md:min-h-[350px] bg-transparent text-base md:text-2xl font-light text-stone-800 placeholder-stone-300 border-none outline-none focus:ring-0 focus:outline-none resize-none p-0 leading-[1.6] mb-3 md:mb-4 transition-all duration-300 overflow-hidden"
                                disabled={props.status === AppStatus.LOADING}
                                autoFocus
                            />

                            {props.entry.length > 0 && (
                                <div className="flex justify-end">
                                    <span className="text-[9px] md:text-[10px] text-stone-400 uppercase tracking-widest font-bold">
                                        {props.wordCount} {props.wordCount === 1 ? 'word' : 'words'}
                                    </span>
                                </div>
                            )}
                        </div>

                        {(props.reflection || (props.status === AppStatus.LOADING && props.streamingReflection)) && (
                            <div className="mb-6">
                                <h2 className="text-lg md:text-2xl font-light text-stone-800 mb-3 md:mb-4">Reflection</h2>
                                <div className="prose prose-stone max-w-none">
                                    <p className="text-base md:text-lg font-light text-stone-700 leading-relaxed mb-4">
                                        {props.status === AppStatus.LOADING && props.streamingReflection
                                            ? props.streamingReflection
                                            : props.reflection?.content || ''}
                                        {props.status === AppStatus.LOADING && (
                                            <span className="inline-block w-2 h-4 bg-emerald-500 ml-1 animate-pulse"></span>
                                        )}
                                    </p>
                                    {props.reflection?.summary && props.status !== AppStatus.LOADING && (
                                        <p className="text-sm md:text-base font-light text-stone-600 italic">
                                            {props.reflection.summary}
                                        </p>
                                    )}
                                </div>
                            </div>
                        )}

                        <div className="sticky bottom-0 md:bottom-8 py-3 md:py-6 pt-4 pb-safe bg-gradient-to-t from-[#FDFCF8] via-[#FDFCF8] to-transparent flex flex-col md:flex-row gap-3 md:gap-4 z-10">
                            <button
                                onClick={props.onGetReflection}
                                disabled={isButtonDisabled}
                                className={`
                                    group relative flex-grow md:flex-initial px-6 md:px-10 py-3.5 md:py-4 rounded-full font-medium transition-all duration-300 active:scale-95 touch-manipulation min-h-[48px] md:min-h-0
                                    ${props.status === AppStatus.LOADING
                                        ? '!bg-emerald-900 md:!bg-emerald-800 !text-white md:!text-emerald-50 border-2 border-emerald-800 md:border-0 shadow-lg md:shadow-md cursor-wait'
                                        : (!props.entry.trim())
                                            ? 'bg-stone-100 text-stone-300 cursor-not-allowed opacity-50'
                                            : '!bg-emerald-900 md:!bg-emerald-800 !text-white md:!text-emerald-50 border-2 border-emerald-800 md:border-0 hover:bg-emerald-950 md:hover:bg-emerald-900 shadow-lg md:shadow-md hover:shadow-xl md:hover:shadow-lg'}
                                `}
                            >
                                <span className={`flex items-center justify-center gap-2 text-sm md:text-base ${props.status === AppStatus.LOADING ? '!text-white' : ''}`}>
                                    {props.status === AppStatus.LOADING ? (
                                        <>
                                            <div className="md:hidden flex items-center gap-2">
                                                {!props.reflectionProgress ? (
                                                    <svg className="animate-spin h-4 w-4 !text-white" viewBox="0 0 24 24">
                                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                                    </svg>
                                                ) : (
                                                    <span className="!text-white font-semibold">{props.reflectionProgress?.message || 'Reflecting...'}</span>
                                                )}
                                            </div>
                                            <div className="hidden md:flex items-center gap-2">
                                                <svg className="animate-spin h-5 w-5 text-stone-300" viewBox="0 0 24 24">
                                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                                </svg>
                                                <span>Reflecting...</span>
                                            </div>
                                        </>
                                    ) : (
                                        <>Get Reflection <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 md:h-5 md:w-5 transition-transform group-hover:translate-x-1" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M12.293 5.293a1 1 0 011.414 0l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-2.293-2.293a1 1 0 010-1.414z" clipRule="evenodd" /></svg></>
                                    )}
                                </span>
                            </button>

                            <button
                                onClick={() => {
                                    // Show confirmation dialog for starting fresh
                                    if (window.confirm('Start a new session? This will clear your current entry and reflection.')) {
                                        props.onStartFresh();
                                    }
                                }}
                                className="px-4 md:px-6 py-3 md:py-4 rounded-full text-stone-400 hover:text-stone-600 hover:bg-stone-100 transition-all text-xs md:text-sm font-medium touch-manipulation min-h-[48px] md:min-h-0"
                            >
                                Start New
                            </button>
                        </div>

                        {props.error && <p className="mt-4 text-rose-500 text-xs md:text-sm text-center md:text-left font-medium">{props.error}</p>}
                    </div>
                ) : (
                    <HistoryView
                        history={props.history}
                        onBack={() => props.onViewModeChange(ViewMode.JOURNAL)}
                        onPlayAudio={props.onHistoryAudioPlayback}
                        activeAudioId={props.activeAudioId}
                        isPlaying={props.isPlayingAudio}
                        isGeneratingVoice={props.isGeneratingVoice}
                        generatingAudioId={props.generatingAudioId}
                        onDeleteEntry={props.onDeleteEntry}
                        onClearAll={props.onClearAllHistory}
                    />
                )}
            </main>

            <footer className="mt-12 md:mt-16 py-6 md:py-8 border-t border-stone-100 flex flex-col md:flex-row justify-between items-center text-stone-400 text-[10px] md:text-xs tracking-widest uppercase gap-4">
                <div className="text-center md:text-left leading-relaxed">
                    Your thoughts are private and safe. <br />
                    <span className="opacity-60 lowercase font-normal italic">A companion, not professional care.</span>
                </div>
                <div className="flex gap-6">
                    <button
                        className={`transition-colors ${props.viewMode === ViewMode.HISTORY ? 'text-emerald-700 font-bold' : 'hover:text-stone-600'}`}
                        onClick={() => props.onViewModeChange(ViewMode.HISTORY)}
                    >
                        History
                    </button>
                    <button
                        className="hover:text-stone-600 transition-colors flex items-center gap-1"
                        onClick={props.onToggleAutoPlay}
                        title={props.autoPlayEnabled ? 'Disable auto-play' : 'Enable auto-play'}
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className={`h-3 w-3 ${props.autoPlayEnabled ? 'text-emerald-600' : 'text-stone-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            {props.autoPlayEnabled ? (
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                            ) : (
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                            )}
                        </svg>
                        <span>Auto-play</span>
                    </button>
                </div>
            </footer>
        </div>
    );
};
