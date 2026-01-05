'use client';

import React from 'react';
import { ViewMode } from '../types';

interface BottomNavigationProps {
  currentView: ViewMode;
  onViewChange: (view: ViewMode) => void;
  onNewEntry: () => void;
}

export function BottomNavigation({ currentView, onViewChange, onNewEntry }: BottomNavigationProps) {
  const navItems = [
    {
      id: ViewMode.TODAY,
      label: 'TODAY',
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          <line x1="16" y1="2" x2="16" y2="6" strokeWidth="2" strokeLinecap="round"/>
          <line x1="8" y1="2" x2="8" y2="6" strokeWidth="2" strokeLinecap="round"/>
          <line x1="3" y1="10" x2="21" y2="10" strokeWidth="2" strokeLinecap="round"/>
        </svg>
      ),
    },
    {
      id: ViewMode.STORY,
      label: 'STORY',
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      ),
    },
    {
      id: ViewMode.MAP,
      label: 'MAP',
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path d="M12 2v20M12 2c-3 3-7 5-10 6v11c3-1 7-3 10-6M12 2c3 3 7 5 10 6v11c-3-1-7-3-10-6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      ),
    },
    {
      id: ViewMode.PRO,
      label: 'PRO',
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      ),
    },
  ];

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-stone-200 pb-safe">
      <div className="flex items-center justify-around h-16 px-2 max-w-2xl mx-auto">
        {navItems.slice(0, 2).map((item) => (
          <button
            key={item.id}
            onClick={() => onViewChange(item.id)}
            className={`flex flex-col items-center justify-center flex-1 space-y-1 transition-colors touch-manipulation ${
              currentView === item.id
                ? 'text-indigo-600'
                : 'text-stone-400 hover:text-stone-600'
            }`}
          >
            {item.icon}
            <span className="text-xs font-medium">{item.label}</span>
          </button>
        ))}

        {/* Central + button */}
        <button
          onClick={onNewEntry}
          className="flex items-center justify-center w-14 h-14 bg-indigo-600 rounded-full shadow-lg hover:bg-indigo-700 transition-all transform hover:scale-105 touch-manipulation -mt-6"
          aria-label="New entry"
        >
          <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <line x1="12" y1="5" x2="12" y2="19" strokeWidth="3" strokeLinecap="round"/>
            <line x1="5" y1="12" x2="19" y2="12" strokeWidth="3" strokeLinecap="round"/>
          </svg>
        </button>

        {navItems.slice(2).map((item) => (
          <button
            key={item.id}
            onClick={() => onViewChange(item.id)}
            className={`flex flex-col items-center justify-center flex-1 space-y-1 transition-colors touch-manipulation ${
              currentView === item.id
                ? 'text-indigo-600'
                : 'text-stone-400 hover:text-stone-600'
            }`}
          >
            {item.icon}
            <span className="text-xs font-medium">{item.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
