'use client';

import React from 'react';
import { ExtractedEntities } from '../types';

interface EntityTagsProps {
  entities: ExtractedEntities;
  compact?: boolean;
}

export const EntityTags: React.FC<EntityTagsProps> = ({ entities, compact = false }) => {
  const hasEntities = 
    entities.people.length > 0 ||
    entities.places.length > 0 ||
    entities.events.length > 0 ||
    entities.organizations.length > 0;

  if (!hasEntities) return null;

  return (
    <div className={`flex flex-wrap gap-2 ${compact ? 'mt-2' : 'mt-3'}`}>
      {/* People */}
      {entities.people.map((person, idx) => (
        <span
          key={`person-${idx}`}
          className="inline-flex items-center gap-1 px-2 py-1 bg-blue-50 text-blue-700 rounded-full text-xs border border-blue-100"
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
          </svg>
          {person}
        </span>
      ))}

      {/* Places */}
      {entities.places.map((place, idx) => (
        <span
          key={`place-${idx}`}
          className="inline-flex items-center gap-1 px-2 py-1 bg-green-50 text-green-700 rounded-full text-xs border border-green-100"
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          {place}
        </span>
      ))}

      {/* Events */}
      {entities.events.map((event, idx) => (
        <span
          key={`event-${idx}`}
          className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs border ${
            event.deadline
              ? 'bg-red-50 text-red-700 border-red-100'
              : 'bg-purple-50 text-purple-700 border-purple-100'
          }`}
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          {event.name}
          {event.date && (
            <span className="text-[10px] opacity-75">
              {formatEventDate(event.date)}
            </span>
          )}
          {event.deadline && <span className="text-[10px] font-bold">⚠</span>}
        </span>
      ))}

      {/* Organizations */}
      {entities.organizations.map((org, idx) => (
        <span
          key={`org-${idx}`}
          className="inline-flex items-center gap-1 px-2 py-1 bg-amber-50 text-amber-700 rounded-full text-xs border border-amber-100"
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
          </svg>
          {org}
        </span>
      ))}
    </div>
  );
};

/**
 * Format event date in a human-readable way
 */
function formatEventDate(dateStr: string): string {
  try {
    // Try to parse as ISO date first
    const date = new Date(dateStr);
    
    // Check if date is valid
    if (isNaN(date.getTime())) {
      // Not a valid ISO date, might be relative like "next Friday"
      return dateStr;
    }
    
    const now = new Date();
    const diffTime = date.getTime() - now.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) return 'today';
    if (diffDays === 1) return 'tomorrow';
    if (diffDays === -1) return 'yesterday';
    if (diffDays > 0 && diffDays <= 7) return `in ${diffDays}d`;
    
    // Format as readable date
    return date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric'
    });
  } catch (error) {
    return dateStr;
  }
}
