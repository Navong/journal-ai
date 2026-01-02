import { HistoryEntry, ExtractedEntities, Event } from '../types';
import logger from '../utils/logger';

const log = logger.module('EntityTracking');

export interface EntityOccurrence {
  entity: string;
  type: 'person' | 'place' | 'event' | 'organization';
  occurrences: {
    entryId: string;
    timestamp: string;
    context: string; // Sentence where it appeared
  }[];
  firstMention: string;    // ISO timestamp
  lastMention: string;     // ISO timestamp
  totalCount: number;
}

export interface EntityContext {
  recentPeople: EntityOccurrence[];      // Last N entries
  recentPlaces: EntityOccurrence[];      // Last N entries
  upcomingEvents: Event[];               // Events with future dates
  recentEvents: Event[];                 // Events from last N entries
  recurringEntities: EntityOccurrence[]; // Entities mentioned 3+ times
}

/**
 * Build entity context from history
 * Focus on last N entries for recency
 */
export function buildEntityContext(
  history: HistoryEntry[],
  lookbackCount: number = 3
): EntityContext {
  log.debug('Building entity context', { historyCount: history.length, lookbackCount });

  // Sort history by date (most recent first)
  const sortedHistory = [...history].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );
  
  // Get last N entries
  const recentEntries = sortedHistory.slice(0, lookbackCount);
  
  // Track all entities across all history for pattern detection
  const allEntityMap = new Map<string, EntityOccurrence>();
  
  // Extract from all entries for pattern detection
  history.forEach(entry => {
    if (!entry.entities) return;
    
    // Track people
    entry.entities.people?.forEach(person => {
      trackEntity(allEntityMap, person, 'person', entry);
    });
    
    // Track places
    entry.entities.places?.forEach(place => {
      trackEntity(allEntityMap, place, 'place', entry);
    });
    
    // Track organizations
    entry.entities.organizations?.forEach(org => {
      trackEntity(allEntityMap, org, 'organization', entry);
    });
  });
  
  // Extract recent entities (last N entries)
  const recentPeople: EntityOccurrence[] = [];
  const recentPlaces: EntityOccurrence[] = [];
  const recentEvents: Event[] = [];
  const upcomingEvents: Event[] = [];
  
  recentEntries.forEach(entry => {
    if (!entry.entities) return;
    
    // Collect recent people (deduplicate)
    entry.entities.people?.forEach(person => {
      const occurrence = allEntityMap.get(person.toLowerCase());
      if (occurrence && !recentPeople.find(p => p.entity.toLowerCase() === occurrence.entity.toLowerCase())) {
        recentPeople.push(occurrence);
      }
    });
    
    // Collect recent places (deduplicate)
    entry.entities.places?.forEach(place => {
      const occurrence = allEntityMap.get(place.toLowerCase());
      if (occurrence && !recentPlaces.find(p => p.entity.toLowerCase() === occurrence.entity.toLowerCase())) {
        recentPlaces.push(occurrence);
      }
    });
    
    // Collect events
    entry.entities.events?.forEach(event => {
      recentEvents.push(event);
      
      // Check if event has future date
      if (event.date) {
        try {
          const eventDate = new Date(event.date);
          const now = new Date();
          if (eventDate > now) {
            upcomingEvents.push(event);
          }
        } catch (error) {
          // Invalid date format, skip
          log.warn('Invalid event date format', { date: event.date, event: event.name });
        }
      }
    });
  });
  
  // Find recurring entities (mentioned 3+ times)
  const recurringEntities = Array.from(allEntityMap.values())
    .filter(entity => entity.totalCount >= 3)
    .sort((a, b) => b.totalCount - a.totalCount)
    .slice(0, 5); // Top 5 recurring entities
  
  const context = {
    recentPeople,
    recentPlaces,
    upcomingEvents: upcomingEvents.sort((a, b) => {
      if (!a.date || !b.date) return 0;
      return new Date(a.date).getTime() - new Date(b.date).getTime();
    }),
    recentEvents,
    recurringEntities,
  };

  log.debug('Entity context built', {
    recentPeople: context.recentPeople.length,
    recentPlaces: context.recentPlaces.length,
    upcomingEvents: context.upcomingEvents.length,
    recentEvents: context.recentEvents.length,
    recurringEntities: context.recurringEntities.length,
  });

  return context;
}

/**
 * Helper to track entity occurrences
 */
function trackEntity(
  map: Map<string, EntityOccurrence>,
  entityName: string,
  type: EntityOccurrence['type'],
  entry: HistoryEntry
) {
  const key = entityName.toLowerCase();
  
  if (!map.has(key)) {
    map.set(key, {
      entity: entityName,
      type,
      occurrences: [],
      firstMention: entry.timestamp,
      lastMention: entry.timestamp,
      totalCount: 0,
    });
  }
  
  const occurrence = map.get(key)!;
  occurrence.occurrences.push({
    entryId: entry.id,
    timestamp: entry.timestamp,
    context: extractContext(entry.text, entityName),
  });
  occurrence.lastMention = entry.timestamp;
  occurrence.totalCount++;
}

/**
 * Extract sentence/context where entity appears
 */
function extractContext(text: string, entity: string): string {
  const sentences = text.split(/[.!?]+/);
  const match = sentences.find(s => 
    s.toLowerCase().includes(entity.toLowerCase())
  );
  return match?.trim().substring(0, 150) || ''; // Limit to 150 chars
}

/**
 * Format entity context for AI prompt
 */
export function formatEntityContextForPrompt(context: EntityContext): string {
  const parts: string[] = [];
  
  // Recent people
  if (context.recentPeople.length > 0) {
    parts.push('**People mentioned recently:**');
    context.recentPeople.forEach(person => {
      const timesText = person.totalCount > 1 
        ? ` (mentioned ${person.totalCount} times across entries)`
        : '';
      parts.push(`- ${person.entity}${timesText}`);
      
      // Show recent context
      const recentOccurrence = person.occurrences[person.occurrences.length - 1];
      if (recentOccurrence.context) {
        parts.push(`  Last context: "${recentOccurrence.context}"`);
      }
    });
    parts.push('');
  }
  
  // Recent places
  if (context.recentPlaces.length > 0) {
    parts.push('**Places mentioned recently:**');
    context.recentPlaces.forEach(place => {
      const timesText = place.totalCount > 1 
        ? ` (mentioned ${place.totalCount} times)`
        : '';
      parts.push(`- ${place.entity}${timesText}`);
    });
    parts.push('');
  }
  
  // Upcoming events/deadlines (most important for detail-oriented response)
  if (context.upcomingEvents.length > 0) {
    parts.push('**⚠️ Upcoming events/deadlines:**');
    context.upcomingEvents.forEach(event => {
      const dateStr = event.date ? formatDate(event.date) : '';
      const urgentTag = event.deadline ? ' [DEADLINE]' : '';
      parts.push(`- ${event.name}${urgentTag}${dateStr ? ` on ${dateStr}` : ''}`);
      if (event.description) {
        parts.push(`  Context: "${event.description}"`);
      }
    });
    parts.push('');
  }
  
  // Recent events (non-future) - only show if no upcoming events
  if (context.recentEvents.length > 0 && context.upcomingEvents.length === 0) {
    parts.push('**Recent events mentioned:**');
    context.recentEvents.slice(0, 3).forEach(event => {
      parts.push(`- ${event.name}`);
      if (event.description) {
        parts.push(`  "${event.description}"`);
      }
    });
    parts.push('');
  }
  
  // Recurring entities (shows patterns)
  if (context.recurringEntities.length > 0) {
    parts.push('**Recurring themes (frequently mentioned):**');
    context.recurringEntities.forEach(entity => {
      parts.push(`- ${entity.entity} (${entity.type}, ${entity.totalCount} mentions)`);
    });
    parts.push('');
  }
  
  if (parts.length === 0) {
    return 'No specific entities tracked yet from recent entries.';
  }
  
  return parts.join('\n');
}

/**
 * Format date in a human-readable way
 */
function formatDate(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    const now = new Date();
    
    // Check if date is valid
    if (isNaN(date.getTime())) {
      return dateStr; // Return original string if invalid
    }
    
    // Calculate days difference
    const diffTime = date.getTime() - now.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) return 'today';
    if (diffDays === 1) return 'tomorrow';
    if (diffDays === -1) return 'yesterday';
    if (diffDays > 0 && diffDays <= 7) return `in ${diffDays} days`;
    
    // Format as readable date
    return date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric',
      year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
    });
  } catch (error) {
    return dateStr;
  }
}
