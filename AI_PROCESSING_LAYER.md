# AI Processing Layer — Technical Documentation

## Overview

The AI Processing Layer is the brain of Journal AI. It transforms raw journal entries into meaningful, context-aware reflections using Google's Gemini AI. This document explains how each component works and how they interact.

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         AI PROCESSING LAYER                                  │
│                                                                             │
│  ┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐      │
│  │  MOOD DETECTION  │    │ TOPIC DETECTION  │    │ ENTITY EXTRACTION│      │
│  │                  │    │                  │    │                  │      │
│  │  calm, joyful,   │    │  "Work Stress"   │    │  People, Places, │      │
│  │  anxious, tired  │    │  "Family Time"   │    │  Events, Orgs    │      │
│  └────────┬─────────┘    └────────┬─────────┘    └────────┬─────────┘      │
│           │                       │                       │                 │
│           └───────────────────────┼───────────────────────┘                 │
│                                   ▼                                         │
│  ┌────────────────────────────────────────────────────────────────────┐    │
│  │                    CONTEXT SELECTION ENGINE                         │    │
│  │                                                                     │    │
│  │  ┌─────────────┐   ┌─────────────┐   ┌─────────────┐              │    │
│  │  │  Semantic   │   │    Mood     │   │  Recency    │              │    │
│  │  │ Embeddings  │   │  Matching   │   │   Boost     │              │    │
│  │  │   (75%)     │   │   (25%)     │   │  (+0.15)    │              │    │
│  │  └─────────────┘   └─────────────┘   └─────────────┘              │    │
│  └────────────────────────────────────────────────────────────────────┘    │
│                                   │                                         │
│                                   ▼                                         │
│  ┌────────────────────────────────────────────────────────────────────┐    │
│  │                    REFLECTION GENERATION                            │    │
│  │                                                                     │    │
│  │  Entity Context + Relevant History + Current Entry                 │    │
│  │                          ↓                                          │    │
│  │              AI generates personalized reflection                   │    │
│  │                          ↓                                          │    │
│  │              Semantic Highlights applied                            │    │
│  └────────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Components

### 1. Mood Detection

**File:** `app/services/geminiService.ts` → `detectMood()`

**Purpose:** Automatically identify the emotional tone of a journal entry.

**How It Works:**
1. User writes an entry (minimum 15 characters)
2. AI analyzes the text for emotional signals
3. Returns one of 7 moods with a confidence level (high/medium/low)

**The 7 Moods:**

| Mood | Description | Related Moods |
|------|-------------|---------------|
| **Calm** | Peaceful, relaxed, serene | reflective, none |
| **Joyful** | Happy, excited, positive, grateful | reflective |
| **Anxious** | Worried, nervous, stressed, overwhelmed | tired, heavy |
| **Tired** | Exhausted, drained, fatigued | anxious, heavy, none |
| **Reflective** | Thoughtful, contemplative, introspective | calm, joyful, none |
| **Heavy** | Sad, burdened, melancholic, down | anxious, tired |
| **None** | Neutral, unclear, or mixed emotions | calm, reflective, tired |

**Mood Similarity Scoring:**
- Same mood = 100% match
- Related moods = 60% match
- Neutral = 40% match
- Opposite moods = 20% match

**Opposite Mood Pairs:**
- joyful ↔ heavy
- joyful ↔ anxious
- calm ↔ anxious
- calm ↔ heavy

---

### 2. Topic Detection

**File:** `app/services/geminiService.ts` → `detectTopic()`

**Purpose:** Identify *what* the user is writing about (subject matter, not emotional state).

**How It Works:**
1. AI analyzes the subject matter of the entry
2. Returns 1-3 words describing the main topic
3. Filters out vague labels ("feelings", "thoughts", "life", "day")
4. Returns `undefined` if topic is too generic or entry is too short

**Example Topics:**
- Work: `Work Stress`, `Work Deadlines`, `Work Relationships`
- Family: `Family Conflict`, `Family Time`, `Family Planning`
- Health: `Health Anxiety`, `Fitness Goals`, `Medical Concerns`
- Relationships: `Relationship Struggles`, `Dating`, `Friendship`
- Career: `Career Planning`, `Job Search`, `Career Growth`
- Personal: `Self-Reflection`, `Personal Growth`, `Creative Projects`

**Why Topics Matter:**
- Help select relevant past entries for context
- Entries with matching topics get a +0.10 relevance boost
- Create continuity across journal sessions

---

### 3. Entity Extraction

**File:** `app/utils/entityExtraction.ts` → `extractEntities()`

**Purpose:** Pull out specific details (names, places, events, organizations) from journal entries.

**The 4 Entity Types:**

| Entity Type | Examples | Extraction Rules |
|-------------|----------|------------------|
| **People** | Sarah, Mom, Dr. Smith, John | Names only, no pronouns (he/she/they) |
| **Places** | Office, Central Park, Tokyo, gym | Specific locations, neighborhoods, venues |
| **Events** | Presentation, deadline, appointment | Meetings, deadlines, important dates |
| **Organizations** | Google, Columbia, yoga studio | Companies, schools, teams, groups |

**Event Enrichment:**
Events have additional attributes:

```typescript
interface Event {
  name: string;        // "Miller project"
  date?: string;       // "next Friday" or "2026-01-10"
  deadline?: boolean;  // true if urgent
  description?: string; // "quarterly review presentation"
}
```

**Deadline Detection:**
Events are marked as deadlines when context includes words like:
- "deadline", "due", "urgent", "must finish", "have to complete"

**Date Extraction:**
AI extracts dates in various formats:
- Absolute: "December 15", "Jan 10"
- Relative: "tomorrow", "next Friday", "next week", "in 3 days"

**Example:**
```
Entry: "Had coffee with Sarah. She's stressed about the Miller project deadline on Friday."

Extracted Entities:
{
  people: ["Sarah"],
  places: [],
  events: [{ 
    name: "Miller project", 
    date: "Friday", 
    deadline: true,
    description: "She's stressed about the deadline"
  }],
  organizations: []
}
```

---

### 4. Entity Tracking Service

**File:** `app/services/entityTrackingService.ts`

**Purpose:** Track entities across multiple entries to recognize patterns and build context.

**What It Tracks:**

| Context Type | Description | Use Case |
|--------------|-------------|----------|
| **Recent People** | People from last N entries | "You mentioned Sarah again" |
| **Recent Places** | Places from last N entries | "You've been at the office a lot" |
| **Upcoming Events** | Events with future dates | "With the presentation on Friday..." |
| **Recent Events** | Events from last N entries | Reference past meetings |
| **Recurring Entities** | Mentioned 3+ times total | "Sarah is a recurring presence" |

**Entity Occurrence Tracking:**

```typescript
interface EntityOccurrence {
  entity: string;           // "Sarah"
  type: 'person' | 'place' | 'event' | 'organization';
  occurrences: {
    entryId: string;
    timestamp: string;
    context: string;        // Sentence where it appeared
  }[];
  firstMention: string;     // First time mentioned
  lastMention: string;      // Most recent mention
  totalCount: number;       // Total occurrences
}
```

**Context Formatting for AI Prompt:**

```
**People mentioned recently:**
- Sarah (mentioned 3 times across entries)
  Last context: "Thinking about what Sarah said about boundaries"

**Places mentioned recently:**
- Office (mentioned 5 times)

**⚠️ Upcoming events/deadlines:**
- Miller project [DEADLINE] on Friday (in 3 days)
  Context: "She's stressed about the deadline..."

**Recurring themes (frequently mentioned):**
- Sarah (person, 3 mentions)
- Office (place, 5 mentions)
```

---

### 5. Context Selection Engine

**File:** `app/services/geminiService.ts` → `selectRelevantContext()`

**Purpose:** Select the most relevant past entries to include in the AI prompt within token budget.

**The Challenge:**
- Users may have hundreds of past entries
- AI has limited context window (~2500 tokens for reflection, ~1500 for chat)
- Need to pick the *most relevant* entries, not just recent ones

**The Hybrid Scoring Algorithm:**

#### Step 1: Semantic Similarity (75% weight)

Uses Gemini's `text-embedding-004` model to generate vector embeddings:

```
Current Entry → [0.123, -0.456, 0.789, ...] (768 dimensions)
History Entry → [0.111, -0.444, 0.777, ...]

Cosine Similarity = dot_product / (norm_a × norm_b)
```

- Score range: 0.0 (unrelated) to 1.0 (identical meaning)
- Embeddings are cached in memory (max 100 entries)

#### Step 2: Mood Matching (25% weight)

```
Current Mood: anxious
Entry Mood: tired

Similarity Score: 0.6 (related moods)
```

#### Step 3: Combined Score

```
Final Score = (Semantic × 0.75) + (Mood × 0.25)
```

#### Step 4: Lightweight Re-Ranking

After initial scoring, apply boosts:

| Condition | Boost |
|-----------|-------|
| Entry from last 7 days | +0.05 to +0.15 (decreases with age) |
| Exact topic match | +0.10 |
| Partial topic match | +0.05 |

#### Step 5: Filtering

- Minimum relevance threshold: 0.30
- If no entries meet threshold, use highest-scoring entry
- Take top 20 entries for re-ranking

#### Step 6: Token Budgeting

| Entry Age | Content Included |
|-----------|------------------|
| ≤3 days | Full text + reflection |
| ≤14 days | Summary only |
| >14 days | Summary only (or truncated to 200 chars) |

**Output Format:**
```
[Jan 1, 2026 | anxious | Topic: Work Stress] [Relevant: similar content, same mood]
Had a rough day at the office. The Miller project is overwhelming...

---

[Dec 28, 2025 | tired | Topic: Work Stress] [Relevance: 72%]
[Summary] Felt drained after back-to-back meetings about the project deadline.
```

---

### 6. Reflection Generation

**File:** `app/services/geminiService.ts` → `getJournalReflection()`

**Purpose:** Generate a thoughtful, personalized AI response using all gathered context.

**AI Persona — "Serenity":**

The system instruction defines the AI as a compassionate journaling companion with:
- **Empathetic reflection** — Validates feelings without being clinical
- **Detail awareness** — Uses specific names, places, events
- **Pattern recognition** — Notices recurring themes across entries
- **Long-term memory** — References past entries when relevant

**The Context Checklist:**

Before every response, the AI must complete this checklist:
- ☐ Any specific person mentioned in last 3 entries? → Acknowledge by name
- ☐ Any specific place mentioned? → Reference it specifically
- ☐ Any upcoming event/deadline? → Acknowledge with empathy
- ☐ Any recurring entities? → Notice patterns

**Prompt Structure:**

```
### ENTITY CONTEXT (SPECIFIC DETAILS FROM RECENT ENTRIES)
[Formatted entity context from tracking service]

### USER CONTEXT (RELEVANT PAST ENTRIES)
[Selected history entries with relevance labels]

### CURRENT ENTRY
Content: "[user's entry]"

**⚠️ BEFORE RESPONDING - COMPLETE THE CONTEXT CHECKLIST:**
[Checklist instructions]

**IMPORTANT:**
- Focus primarily on the CURRENT ENTRY
- Use entity context for detail-oriented observations
- Reference people, places, events BY NAME
- Be a great personal assistant who remembers details
```

**AI Output Schema:**

```typescript
{
  reflection: string;      // Deep, empathetic response
  summary: string;         // One-sentence summary
  topic: string;           // Main topic (1-3 words)
  mood: Mood;              // Detected mood
  highlights: Highlight[]; // Phrases to highlight
}
```

---

### 7. Semantic Highlighting

**Purpose:** Identify meaningful phrases in the AI's reflection for visual emphasis.

**The 3 Highlight Categories:**

| Category | What It Captures | Visual Style |
|----------|-----------------|--------------|
| **Main Idea** | Core insight, central theme (1-2 phrases max) | Emphasized |
| **Somatic Stressor** | Physical symptoms + external triggers | Red glow |
| **Identity Win** | Achievements + voice/agency + recovery | Gold highlight |

**Somatic Stressor Examples:**
- Physical: "jaw is locking up", "chest is tight", "shoulders tense"
- External: "Sarah's email", "Miller project", "tight deadline"

**Identity Win Examples:**
- Achievements: "pushed through 18 miles", "completed the marathon"
- Voice/Agency: "stood your ground", "set a boundary", "spoke up"
- Recovery: "finding peace", "feeling lighter", "regaining balance"

**How It Works:**
1. AI generates reflection text
2. AI identifies 2-5 word phrases from its *own* response
3. Each phrase is categorized into one of 3 types
4. Frontend applies category-specific visual styling

**Output Format:**
```json
{
  "highlights": [
    { "text": "jaw is tight", "type": "somatic_stressor" },
    { "text": "Miller project deadline", "type": "somatic_stressor" },
    { "text": "pushed through", "type": "identity_win" },
    { "text": "resilience is still there", "type": "main_idea" }
  ]
}
```

---

## Complete Processing Flow

```
User writes: "Stressed about the Miller project. My jaw is tight."
                               │
                               ▼
         ┌─────────────────────────────────────────────┐
         │           PARALLEL PROCESSING               │
         │                                             │
         │  Mood Detection ──────────► anxious         │
         │  Topic Detection ─────────► Work Stress     │
         │  Entity Extraction ───────► Miller project  │
         └─────────────────────────────────────────────┘
                               │
                               ▼
         ┌─────────────────────────────────────────────┐
         │         CONTEXT GATHERING                   │
         │                                             │
         │  1. Build entity context from last 3 entries│
         │  2. Generate embeddings for current entry   │
         │  3. Calculate relevance scores for history  │
         │  4. Select entries within token budget      │
         │  5. Format everything for AI prompt         │
         └─────────────────────────────────────────────┘
                               │
                               ▼
         ┌─────────────────────────────────────────────┐
         │         REFLECTION GENERATION               │
         │                                             │
         │  AI receives:                               │
         │  - Entity context (people, places, events)  │
         │  - Relevant history (with labels)           │
         │  - Current entry                            │
         │  - System instruction & checklist           │
         │                                             │
         │  AI outputs:                                │
         │  - Reflection text                          │
         │  - Summary                                  │
         │  - Topic                                    │
         │  - Mood                                     │
         │  - Highlights                               │
         └─────────────────────────────────────────────┘
                               │
                               ▼
         ┌─────────────────────────────────────────────┐
         │         RESULT                              │
         │                                             │
         │  "I notice your jaw is tight again—the     │
         │  Miller project has been a recurring       │
         │  source of stress. Remember last week      │
         │  when you pushed through the quarterly     │
         │  report? That same resilience is here."    │
         │                                             │
         │  Highlights:                               │
         │  🔴 "jaw is tight" (somatic_stressor)      │
         │  🔴 "Miller project" (somatic_stressor)    │
         │  🟡 "pushed through" (identity_win)        │
         │  ⭐ "resilience is here" (main_idea)       │
         └─────────────────────────────────────────────┘
```

---

## Configuration Constants

| Constant | Value | Description |
|----------|-------|-------------|
| `MAX_CONTEXT_TOKENS_REFLECTION` | 2500 | Token budget for reflection generation |
| `MAX_CONTEXT_TOKENS_CHAT` | 1500 | Token budget for chat context |
| `DAYS_RECENT` | 3 | Days to use full entry text |
| `DAYS_MEDIUM` | 14 | Days to use summary |
| `SEMANTIC_WEIGHT` | 0.75 | Weight for semantic similarity |
| `MOOD_WEIGHT` | 0.25 | Weight for mood matching |
| `MIN_RELEVANCE_SCORE` | 0.30 | Minimum score to include entry |
| `RE_RANK_TOP_K` | 20 | Top entries to re-rank |

---

## Key Design Principles

1. **Parallel Processing** — Mood, topic, and entity extraction run simultaneously for speed

2. **Hybrid Relevance** — Semantic similarity (75%) + mood matching (25%) = better context selection

3. **Token Efficiency** — Summaries for old entries, full text for recent ones

4. **Detail-Oriented** — AI uses names, acknowledges deadlines, connects dots across entries

5. **Graceful Degradation** — If any step fails, the flow continues without breaking

6. **Pattern Recognition** — Recurring entities and moods are surfaced to the AI

7. **Visual Feedback** — Highlights create a scannable narrative over time

8. **Caching** — Embeddings cached in memory to avoid redundant API calls

---

## Files Reference

| File | Purpose |
|------|---------|
| `app/services/geminiService.ts` | Main AI service (mood, topic, reflection, chat, TTS) |
| `app/utils/entityExtraction.ts` | Entity extraction using structured output |
| `app/services/entityTrackingService.ts` | Entity tracking and context formatting |
| `app/types.ts` | TypeScript interfaces (Mood, Highlight, ExtractedEntities) |

---

## API Models Used

| Model | Purpose | Temperature |
|-------|---------|-------------|
| `gemini-3-flash-preview` | Mood detection | 0.5 |
| `gemini-3-flash-preview` | Topic detection | 0.5 |
| `gemini-3-flash-preview` | Entity extraction | 0.3 |
| `gemini-3-flash-preview` | Reflection generation | 0.7 |
| `text-embedding-004` | Semantic embeddings | N/A |

---

## Date Created
January 2, 2026
