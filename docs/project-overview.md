# Serenity Journal - Project Overview

**A Next.js journaling application with AI-powered reflections and emotional wellness tracking**

Last Updated: January 2026

---

## Table of Contents

1. [Project Description](#project-description)
2. [Technology Stack](#technology-stack)
3. [Core Features](#core-features)
4. [Architecture Overview](#architecture-overview)
5. [AI Integration](#ai-integration)
6. [Database & Data Models](#database--data-models)
7. [Audio System](#audio-system)
8. [Authentication & Security](#authentication--security)
9. [Key Components](#key-components)
10. [API Routes](#api-routes)
11. [Development Workflow](#development-workflow)
12. [Performance Optimizations](#performance-optimizations)

---

## Project Description

Serenity Journal is a modern, AI-enhanced journaling application that provides thoughtful reflections to support mental wellness. Users write journal entries and receive empathetic AI-generated reflections with text-to-speech playback, while the system tracks emotional patterns and important entities (people, places, events) over time.

### Key Differentiators

- **Streaming AI Responses** - Real-time typewriter effect for reflections
- **Multi-Provider Architecture** - Flexible LLM and TTS provider switching
- **3-Layer Audio Caching** - IndexedDB → S3 → Database for optimal performance
- **Context-Aware AI** - Semantic search finds relevant past entries for personalized reflections
- **Entity Tracking** - Automatically extracts and tracks people, places, events, organizations
- **Privacy-First** - Hashed user IDs, no plain email storage
- **Progressive Enhancement** - Works without database using localStorage fallback

---

## Technology Stack

### Core Framework
- **Next.js 16** - App Router with React 19
- **TypeScript** - Full type safety across the codebase
- **Tailwind CSS** - Utility-first styling

### Database & ORM
- **PostgreSQL** - Hosted on Supabase
- **Prisma ORM** - Type-safe database access with migrations
- **PgBouncer** - Connection pooling for serverless environments

### Authentication
- **NextAuth.js v5** (beta) - Session-based authentication
- **Google OAuth** - Primary authentication provider
- **DevLogin** - Development credentials provider

### AI & LLM Integration
- **Google Gemini** (`@google/genai`) - Primary LLM provider
  - Gemini 2.0 Flash Exp for reflections
  - Text Embedding 004 for semantic search
  - Context caching for cost optimization
- **xAI Grok** (`@openrouter/sdk`) - Alternative LLM via OpenRouter

### Text-to-Speech Providers
- **Cartesia AI** - Primary TTS (high quality, fast streaming)
- **ElevenLabs** - Premium voice quality
- **Fish Audio** - Emotional voice control
- **Gemini TTS** - Google's text-to-speech
- **Murf AI** - Professional narration

### Storage & Caching
- **AWS S3** - Cloud audio storage with presigned URLs
- **IndexedDB** - Client-side audio cache
- **localStorage** - Offline fallback storage

### Key Libraries
- `pako` - Gzip compression/decompression
- `react-markdown` - Markdown rendering
- `@prisma/adapter-pg` - Prisma PostgreSQL adapter

---

## Core Features

### 1. Journal Entry Creation
- Write freeform text entries
- Select mood before or after writing
- Auto-save to prevent data loss
- Mobile-optimized text input

### 2. AI-Powered Reflections
- Streaming responses with typewriter effect
- Context-aware using semantic search of past entries
- Mood-specific reflection tone
- Token usage transparency
- Highlight system for key phrases

### 3. Text-to-Speech
- Multi-provider support (5 TTS engines)
- Mood-based voice selection
- Progressive audio streaming (2-3s to first audio)
- 3-layer caching (IndexedDB → S3 → Database)
- Background audio generation
- iOS compatibility handling

### 4. History Management
- View all past entries with pagination
- Search entries by text content
- Filter by mood and date range
- Delete entries with confirmation
- Cross-device sync via database

### 5. Follow-up Chat
- Continue conversation about specific entries
- Context-aware chat with entry text included
- Streaming chat responses
- Audio playback for chat responses

### 6. Entity Tracking
- Automatic extraction of:
  - **People** - Names and relationships
  - **Places** - Locations mentioned
  - **Events** - Occurrences with optional dates/deadlines
  - **Organizations** - Companies, groups, institutions
- Entity history across entries
- Context building from last 3 entries

### 7. Highlighting System
- AI identifies key phrases in reflections
- Three highlight categories:
  - **Main Ideas** - Core concepts (yellow)
  - **Somatic Stressors** - Physical/emotional stress (orange)
  - **Identity Wins** - Personal achievements (green)
- Visual color-coding in reflection display

### 8. Cross-Device Sync
- Database-backed storage (Supabase)
- Automatic sync on login
- localStorage fallback for offline use
- Audio migration to S3 for scalability

### 9. Demo Mode
- Try without authentication
- Cookie-based (`demo-mode=true`)
- All data stored in localStorage
- Separate storage namespace (`_demo` suffix)

---

## Architecture Overview

### Application Structure

```
app/
├── components/           # React components
│   ├── JournalApp.tsx           # Root component (456 lines)
│   ├── JournalInterface.tsx     # Main UI (29KB)
│   ├── AudioManager.tsx         # Audio orchestration (37KB)
│   ├── ChatManager.tsx          # Chat state management
│   ├── HistoryManager.tsx       # DB sync & localStorage
│   ├── HistoryView.tsx          # Entry list with search/filter
│   ├── ReflectionCard.tsx       # Reflection display
│   ├── ChatInterface.tsx        # Chat UI
│   ├── HighlightedText.tsx      # Colored phrase highlights
│   └── EntityTags.tsx           # Entity chips
│
├── lib/                  # Core business logic
│   ├── core/
│   │   ├── journal.ts           # Main AI service entry point
│   │   ├── entity.ts            # Entity processing
│   │   └── history.ts           # Database operations
│   │
│   ├── llm/              # LLM integration layer
│   │   ├── interface.ts         # Provider contract
│   │   ├── index.ts             # Provider selection
│   │   ├── providers/
│   │   │   ├── gemini.ts        # Gemini implementation (1,419 lines)
│   │   │   └── grok.ts          # Grok implementation (687 lines)
│   │   ├── services/
│   │   │   ├── CacheManager.ts           # Gemini context caching
│   │   │   ├── ContextSelectionService.ts # Semantic search
│   │   │   ├── EmbeddingService.ts       # Text embeddings
│   │   │   ├── MoodDetectionService.ts   # Emotion detection
│   │   │   └── TopicDetectionService.ts  # Subject extraction
│   │   └── utils/        # Token counting, context processing
│   │
│   └── tts/              # TTS provider implementations
│       ├── cartesia.ts
│       ├── elevenlabs.ts
│       ├── fish.ts
│       ├── gemini.ts
│       └── murf.ts
│
├── api/                  # API routes
│   ├── auth/[...nextauth]/      # NextAuth handler
│   ├── history/                  # Journal CRUD
│   │   ├── route.ts             # GET/POST/DELETE entries
│   │   ├── audio/route.ts       # Save audio data
│   │   └── audio/s3key/route.ts # S3 key management
│   ├── preferences/route.ts     # User settings
│   ├── tts/                     # Text-to-speech
│   │   ├── route.ts             # Main TTS endpoint
│   │   ├── chunk-cache-check/   # Check chunk cache
│   │   ├── chunk-download/      # Download chunks
│   │   └── chunk-generate/      # Generate chunks
│   └── s3/                      # S3 integration
│       ├── get-key/route.ts     # Presigned URLs
│       └── test/route.ts        # Connectivity test
│
├── utils/                # Utility functions
│   ├── audioCache.ts            # IndexedDB wrapper
│   ├── audioGeneration.ts       # TTS logic
│   ├── audioOptimization.ts     # Compression (77% reduction)
│   ├── audioStreamPlayer.ts     # Progressive playback (21KB)
│   ├── audioSync.ts             # localStorage → DB sync
│   ├── s3Service.ts             # AWS S3 integration
│   ├── encryption.ts            # User ID hashing (SHA-256)
│   ├── entityExtraction.ts      # Named entity recognition
│   ├── prisma.ts                # Singleton Prisma Client
│   ├── logger.ts                # Structured logging
│   ├── toast.tsx                # Toast notifications
│   ├── retry.ts                 # Exponential backoff
│   ├── textHash.ts              # Cache key generation
│   └── uuid.ts                  # UUID generation
│
├── auth.ts               # NextAuth configuration
├── types.ts              # TypeScript definitions (105 lines)
├── middleware.ts         # Route protection
└── providers.tsx         # Session provider wrapper

prisma/
└── schema.prisma         # Database schema
    ├── JournalEntry      # Main entry model
    └── UserPreference    # User settings
```

### Design Patterns

**1. Provider Pattern** - LLM and TTS providers implement common interfaces
```typescript
interface LLMProvider {
  generateReflection(entry: string, options: Options): Promise<Reflection>
  streamReflection(entry: string, callbacks: StreamCallbacks): Promise<void>
  detectMood(entry: string): Promise<Mood>
  // ... other methods
}
```

**2. Render Props Pattern** - Managers share state with UI components
```typescript
<AudioManager>
  {({ audioState, playAudio, stopAudio }) => (
    <ReflectionCard audioState={audioState} onPlay={playAudio} />
  )}
</AudioManager>
```

**3. Service Layer Pattern** - Business logic separated from components
```typescript
// Components call services, not APIs directly
import { getJournalReflection } from '@/lib/core/journal'
const reflection = await getJournalReflection(entryText, mood)
```

**4. Singleton Pattern** - Prisma Client instance reuse
```typescript
// utils/prisma.ts ensures single client instance
export const prisma = new PrismaClient({ adapter })
```

---

## AI Integration

### LLM Provider Architecture

**Primary Provider: Google Gemini**
- Model: `gemini-2.0-flash-exp` (latest experimental)
- Features:
  - Context caching (reduces costs by ~90% for repeated context)
  - Structured JSON output for reliable parsing
  - Streaming support with real-time callbacks
  - Token usage tracking for transparency

**Alternative Provider: xAI Grok**
- Model: `xai/grok-beta` via OpenRouter
- Features:
  - Real-time streaming
  - Alternative AI perspective
  - OpenRouter compatibility

### Context Selection System

**Semantic Search Pipeline:**
1. **Embedding Generation** - Text Embedding 004 model
2. **Similarity Calculation** - Cosine similarity on embeddings
3. **Hybrid Scoring**:
   - 75% semantic similarity (content relevance)
   - 25% mood similarity (emotional relevance)
4. **Re-ranking**:
   - Recency boost (last 7 days prioritized)
   - Topic match bonus
   - Token-aware truncation (~2500 tokens for reflections, ~1500 for chat)
5. **Fallback Strategy** - Use summaries for old entries (>14 days)

**Result:** Personalized reflections that reference relevant past experiences

### Entity Tracking System

**Extraction Process:**
1. AI analyzes entry text with Gemini
2. Structured JSON output with four categories:
   - People (names, relationships)
   - Places (locations)
   - Events (occurrences, dates, deadlines)
   - Organizations (companies, groups)
3. Entities stored in `JournalEntry.entities` JSON field
4. Last 3 entries' entities included in reflection context

**Use Cases:**
- "You mentioned Sarah again - how did that conversation go?"
- "Last time you visited the coffee shop, you felt anxious..."
- Reference past events chronologically

### Highlighting System

**AI Phrase Detection:**
- Gemini identifies key phrases in reflection text (not user entry)
- Returns structured highlights with character positions
- Three categories with semantic meaning:

| Category | Description | Color |
|----------|-------------|-------|
| `main_idea` | Core concepts, central themes | Yellow |
| `somatic_stressor` | Physical/emotional stress indicators | Orange |
| `identity_win` | Personal achievements, growth moments | Green |

**Rendering:**
- `HighlightedText` component overlays highlights
- Supports overlapping highlights
- Maintains text readability

### Mood Detection

**AI-Powered Emotion Recognition:**
- Analyzes entry text for emotional tone
- Returns one of 7 moods:
  - `calm` - Peaceful, balanced
  - `joyful` - Happy, excited
  - `anxious` - Worried, stressed
  - `tired` - Exhausted, low energy
  - `reflective` - Thoughtful, introspective
  - `heavy` - Sad, burdened
  - `none` - Neutral or unclear

**Integration:**
- Used for mood-specific reflection tone
- Influences voice selection for TTS
- Tracked over time for pattern analysis

---

## Database & Data Models

### Schema (Prisma)

**JournalEntry Model:**
```prisma
model JournalEntry {
  id              String   @id @default(uuid())
  userId          String   // Hashed email (SHA-256)
  entryText       String   // User's journal entry
  reflectionText  String?  // AI-generated reflection
  summary         String?  // Brief summary for context
  topic           String?  // 1-3 word subject
  mood            String?  // Detected emotion
  audioData       String?  // Legacy base64 audio (gzip compressed)
  audioS3Key      String?  // S3 storage key (new method)
  entities        Json?    // Extracted people, places, events, orgs
  highlights      Json?    // AI-identified key phrases
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@index([userId])
  @@index([createdAt(sort: Desc)])
  @@index([userId, createdAt(sort: Desc)])
  @@index([audioS3Key])
}
```

**UserPreference Model:**
```prisma
model UserPreference {
  id              String   @id @default(uuid())
  userId          String   @unique
  autoPlayEnabled Boolean  @default(false)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}
```

### Connection Configuration

**Dual Connection Pattern:**
- `DATABASE_URL` - Pooled connection for Prisma Client runtime
  - Format: `postgresql://...@pooler.supabase.com:6543/postgres?pgbouncer=true`
  - Uses PgBouncer adapter
  - Optimized for serverless environments
- `DIRECT_URL` - Direct connection for Prisma CLI
  - Format: `postgresql://...@db.supabase.co:5432/postgres`
  - Used for migrations and introspection
  - Supports full PostgreSQL feature set

**Singleton Client:**
```typescript
// utils/prisma.ts
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const adapter = new PrismaPg(pool)
export const prisma = new PrismaClient({ adapter })
```

### Data Flow

**Write Path:**
1. User creates entry in UI
2. Component calls `/api/history` POST endpoint
3. API route validates session
4. Prisma inserts row with user's hashed ID
5. Response returns created entry
6. UI updates immediately

**Read Path:**
1. Component calls `/api/history` GET endpoint
2. API queries by `userId` with pagination
3. Excludes `audioData` by default (performance)
4. Returns entries sorted by `createdAt DESC`
5. Entries cached in component state

**Audio Path:**
1. Audio generated via TTS API
2. Saved to S3 with presigned URL
3. S3 key stored in `audioS3Key` field
4. Legacy entries use `audioData` (base64, gzip compressed)
5. Client checks IndexedDB → S3 → Database

---

## Audio System

### 3-Layer Caching Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   Audio Request Flow                     │
└─────────────────────────────────────────────────────────┘
                           ▼
              ┌────────────────────────┐
              │  Layer 1: IndexedDB    │
              │  (Client-side cache)   │
              │  ~50-100ms latency     │
              └────────────┬───────────┘
                           │ Cache Miss
                           ▼
              ┌────────────────────────┐
              │  Layer 2: AWS S3       │
              │  (Cloud storage)       │
              │  ~300-500ms latency    │
              └────────────┬───────────┘
                           │ Cache Miss
                           ▼
              ┌────────────────────────┐
              │  Layer 3: Database     │
              │  (Supabase)            │
              │  ~500-1000ms latency   │
              │  (gzip compressed)     │
              └────────────┬───────────┘
                           │ Cache Miss
                           ▼
              ┌────────────────────────┐
              │  TTS API Generation    │
              │  (Cartesia/ElevenLabs) │
              │  ~2-3s latency         │
              └────────────────────────┘
```

### Performance Metrics

| Metric | Before Optimization | After Optimization | Improvement |
|--------|--------------------|--------------------|-------------|
| **Storage Size** | 6.4MB | 1.5MB | **77% smaller** |
| **DB Fetch Time** | 21.9s | 0.3-0.5s | **40-70x faster** |
| **Time to Playback** | 5-6s | 2-3s | **2-3x faster** |
| **Repeated Playback** | 2-3s | ~50-100ms | **20-60x faster** |

### Audio Streaming

**Progressive Playback:**
- Format: WAV with PCM encoding (`pcm_f32le`)
- Sample Rate: 44.1kHz
- Chunk-based streaming for instant playback
- Auto-format detection (WAV/MP3/AAC)

**AudioStreamPlayer** (`utils/audioStreamPlayer.ts`):
- Web Audio API with AudioContext
- Handles iOS "interrupted" state (requires user gesture)
- Wake Lock API prevents screen sleep during playback
- Buffer management for smooth playback

### TTS Provider Selection

**Mood-Based Voice Mapping:**
```typescript
const MOOD_VOICES = {
  calm: { cartesia: "a0e99841-438c-4a64-b679-ae501e7d6091" },
  joyful: { cartesia: "694f9389-aac1-45b6-b726-9d9369183238" },
  anxious: { cartesia: "71a7ad14-091c-4e8e-a314-022ece01c121" },
  // ... other moods
}
```

**Provider Features:**
- **Cartesia** - Fastest, high quality, streaming support
- **ElevenLabs** - Premium voices, best for long-form
- **Fish Audio** - Emotional control, multilingual
- **Gemini** - Free tier, good quality
- **Murf** - Professional narration style

### S3 Integration

**Audio Upload Flow:**
1. TTS API generates audio (base64)
2. Convert to binary buffer
3. Upload to S3 with key: `{userId}/{textHash}.{format}`
4. Store S3 key in database
5. Generate presigned URL for playback (7-day expiry)

**S3 Service** (`utils/s3Service.ts`):
```typescript
export async function uploadAudioToS3(
  audioData: string,
  userId: string,
  textHash: string,
  format: 'wav' | 'mp3'
): Promise<string>

export async function getAudioFromS3(
  s3Key: string
): Promise<string | null>
```

---

## Authentication & Security

### NextAuth.js v5 Configuration

**Security-First Design:**
- **No Plain Emails** - All user IDs are SHA-256 hashes
- **Deterministic Hashing** - Same email always produces same hash
- **Data Persistence** - Users can logout/login without losing data

**User ID Generation:**
```typescript
// utils/encryption.ts
import crypto from 'crypto'

export function hashEmailForUserId(email: string): string {
  const salt = process.env.USER_ID_SALT || 'serenity-journal-salt'
  const hash = crypto.createHash('sha256')
  hash.update(email + salt)
  return hash.digest('hex')
}
```

**Authentication Flow:**
1. User clicks "Sign in with Google"
2. Google OAuth redirects with user email
3. `jwt` callback hashes email: `hashEmailForUserId(profile.email)`
4. Hashed ID stored in JWT token
5. `session` callback exposes hash as `session.user.id`
6. All database queries use hashed ID

**Providers:**

```typescript
// app/auth.ts
export const authConfig = {
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
    // Development only
    Credentials({
      name: "DevLogin",
      // ... credential config
    }),
  ],
  callbacks: {
    async jwt({ token, user, profile }) {
      if (profile?.email) {
        token.userId = hashEmailForUserId(profile.email)
      }
      return token
    },
    async session({ session, token }) {
      if (token.userId) {
        session.user.id = token.userId as string
      }
      return session
    },
  },
}
```

### Demo Mode

**Cookie-Based Authentication Bypass:**
- Cookie name: `demo-mode=true`
- Middleware allows `/` access without session
- All data stored in localStorage with `_demo` suffix
- No database writes
- Separate namespace prevents data leakage

**localStorage Keys:**
```typescript
// Regular user
`serenity_journal_history_{userId}` // Hashed ID

// Demo mode
`serenity_journal_history_demo` // Special key
```

### Middleware Protection

**Route Protection** (`middleware.ts`):
```typescript
export async function middleware(request: NextRequest) {
  const session = await auth()
  const isDemoMode = request.cookies.get('demo-mode')?.value === 'true'

  const isPublicPath = ['/login', '/api/auth'].some(path =>
    request.nextUrl.pathname.startsWith(path)
  )

  if (!isPublicPath && !session && !isDemoMode) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  return NextResponse.next()
}
```

**Protected Routes:**
- `/` - Main app (requires auth or demo mode)
- `/api/history/*` - Journal operations (requires auth)
- `/api/preferences/*` - User settings (requires auth)

**Public Routes:**
- `/login` - Authentication page
- `/api/auth/*` - NextAuth handlers

---

## Key Components

### JournalApp.tsx (Root Component)

**Responsibilities:**
- Application state orchestration
- Session management
- Demo mode detection
- localStorage ↔ database sync
- User ID scoping for storage keys

**State Management:**
```typescript
const [entries, setEntries] = useState<HistoryEntry[]>([])
const [currentEntry, setCurrentEntry] = useState<string>('')
const [currentReflection, setCurrentReflection] = useState<Reflection | null>(null)
const [selectedMood, setSelectedMood] = useState<Mood | null>(null)
const [isGenerating, setIsGenerating] = useState(false)
```

**Key Features:**
- User-scoped localStorage: `serenity_journal_history_{userId}`
- Auto-sync on mount and user change
- Handles demo mode cookie check
- Wake Lock API integration for audio

### Manager Components (Render Props)

**AudioManager.tsx:**
- Audio generation orchestration
- 3-layer cache checking (IndexedDB → S3 → Database)
- TTS provider selection
- Playback state management
- Background generation queue

**ChatManager.tsx:**
- Chat session lifecycle
- Message history management
- Streaming chat responses
- Context inclusion (entry text)

**HistoryManager.tsx:**
- Database CRUD operations
- localStorage fallback
- Pagination state
- Search and filter logic

### UI Components

**HistoryView.tsx:**
- Entry list with infinite scroll
- Search by text content
- Filter by mood and date range
- Delete with confirmation
- Responsive grid layout

**ReflectionCard.tsx:**
- Markdown rendering with `react-markdown`
- Highlighted phrase overlay
- Audio playback controls
- Token usage display
- Copy to clipboard

**ChatInterface.tsx:**
- Message list (user/AI)
- Streaming message display
- Audio controls per message
- Auto-scroll to bottom

**HighlightedText.tsx:**
- Parses highlight positions
- Renders colored spans
- Handles overlapping highlights
- Three color categories

**EntityTags.tsx:**
- Displays extracted entities as chips
- Four categories with icons
- Click to view entity details
- Responsive chip layout

---

## API Routes

### Authentication

**`/api/auth/[...nextauth]/route.ts`**
- NextAuth.js catch-all handler
- Handles all OAuth flows
- Session creation/validation
- JWT token management

### History (Journal Entries)

**`/api/history/route.ts`**

**GET** - Fetch entries
```typescript
Query params:
  - limit: number (default: 50)
  - offset: number (default: 0)
  - includeAudio: boolean (default: false)

Response: { entries: JournalEntry[] }
```

**POST** - Save entry
```typescript
Body: {
  id?: string,
  entryText: string,
  reflectionText?: string,
  summary?: string,
  topic?: string,
  mood?: string,
  entities?: ExtractedEntities,
  highlights?: Highlight[]
}

Response: { entry: JournalEntry }
```

**DELETE** - Delete entry
```typescript
Query params:
  - id: string (entry UUID)

Response: { success: boolean }
```

**`/api/history/audio/route.ts`**

**POST** - Save audio data to entry
```typescript
Body: {
  id: string,
  audioData: string // base64 gzip compressed
}

Response: { success: boolean }
```

**`/api/history/audio/s3key/route.ts`**

**GET** - Get S3 key for entry
```typescript
Query params:
  - id: string (entry UUID)

Response: { s3Key: string | null }
```

**POST** - Update S3 key
```typescript
Body: {
  id: string,
  s3Key: string
}

Response: { success: boolean }
```

### Preferences

**`/api/preferences/route.ts`**

**GET** - Fetch user preferences
```typescript
Response: { preferences: UserPreference }
```

**POST** - Update preferences
```typescript
Body: {
  autoPlayEnabled?: boolean
}

Response: { preferences: UserPreference }
```

### Text-to-Speech

**`/api/tts/route.ts`**

**POST** - Generate audio
```typescript
Body: {
  text: string,
  provider?: 'cartesia' | 'elevenlabs' | 'fish' | 'gemini' | 'murf',
  mood?: Mood,
  voiceId?: string
}

Query params:
  - useCache: boolean (default: true)

Response: {
  audio: string | string[], // base64 or chunked
  format: 'wav' | 'mp3',
  s3Key?: string
}

Rate limit: 30 requests/minute per user
```

**`/api/tts/chunk-cache-check/route.ts`**

**POST** - Check if chunks are cached
```typescript
Body: {
  text: string,
  provider: string
}

Response: {
  cached: boolean,
  chunkCount?: number
}
```

**`/api/tts/chunk-download/route.ts`**

**POST** - Download cached chunks
```typescript
Body: {
  text: string,
  provider: string
}

Response: {
  chunks: string[], // base64 audio chunks
  format: string
}
```

**`/api/tts/chunk-generate/route.ts`**

**POST** - Generate audio in chunks
```typescript
Body: {
  text: string,
  provider: string,
  mood?: Mood
}

Response: {
  chunks: string[],
  format: string
}
```

### S3 Storage

**`/api/s3/get-key/route.ts`**

**GET** - Get presigned URL
```typescript
Query params:
  - key: string (S3 object key)

Response: {
  url: string, // Presigned URL (7-day expiry)
  expiresIn: number
}
```

**`/api/s3/test/route.ts`**

**GET** - Test S3 connectivity
```typescript
Response: {
  success: boolean,
  message: string
}
```

---

## Development Workflow

### Setup

**1. Install Dependencies**
```bash
npm install
```

**2. Environment Configuration**
Create `.env.local`:
```bash
# AI Provider (Gemini primary)
NEXT_PUBLIC_GEMINI_API_KEY=your_key

# Alternative LLM (optional)
OPENROUTER_API_KEY=your_key

# Authentication
AUTH_SECRET=generate_with_openssl_rand_base64_32
GOOGLE_CLIENT_ID=your_id
GOOGLE_CLIENT_SECRET=your_secret

# Database (Supabase)
DATABASE_URL=postgresql://...pooler.supabase.com:6543/postgres?pgbouncer=true
DIRECT_URL=postgresql://...db.supabase.co:5432/postgres

# S3 Storage
AWS_ACCESS_KEY_ID=your_key
AWS_SECRET_ACCESS_KEY=your_secret
AWS_REGION=us-east-1
AWS_S3_BUCKET=your_bucket

# User ID Security
USER_ID_SALT=your_random_salt
```

**3. Database Setup**
```bash
# Run migrations
npx prisma migrate dev --name init

# Generate Prisma Client
npx prisma generate

# Open Prisma Studio (optional)
npx prisma studio
```

**4. Start Development Server**
```bash
npm run dev
# Open http://localhost:3000
```

### Common Commands

**Development:**
```bash
npm run dev          # Start dev server (http://localhost:3000)
npm run build        # Production build
npm start            # Start production server
npm run lint         # Run ESLint
```

**Database:**
```bash
npx prisma migrate dev --name <description>  # Create migration
npx prisma generate                          # Regenerate client
npx prisma studio                            # GUI database browser
npx prisma db push                           # Push schema (dev only)
npx prisma db pull                           # Pull schema from DB
```

**Testing:**
```bash
# Manual testing
# 1. Use demo mode (set cookie: demo-mode=true)
# 2. Use DevLogin provider in development
# 3. Test TTS providers at /test-stream page
```

### Code Organization Best Practices

**1. Component Composition**
- Use render props for cross-cutting concerns (audio, chat, history)
- Keep components focused on single responsibility
- Extract reusable logic to custom hooks

**2. Service Layer**
- All AI calls go through `/lib/core/journal.ts`
- All database calls go through `/lib/core/history.ts`
- Components never call APIs directly

**3. Type Safety**
- Import types from `@/types`
- Use Prisma-generated types for database models
- Define component props with TypeScript interfaces

**4. Error Handling**
- Use try/catch in async functions
- Show user-friendly errors with toast notifications
- Log errors with structured logger (`utils/logger.ts`)

**5. Performance**
- Lazy load heavy components
- Use React.memo for expensive renders
- Debounce search inputs
- Paginate large lists

---

## Performance Optimizations

### Database Query Optimization

**Composite Index:**
```prisma
@@index([userId, createdAt(sort: Desc)])
```
- Single index for user filtering + sorting
- Eliminates need for separate queries

**Selective Field Loading:**
```typescript
// Exclude heavy audio field by default
const entries = await prisma.journalEntry.findMany({
  where: { userId },
  select: {
    id: true,
    entryText: true,
    reflectionText: true,
    // ... other fields
    audioData: false, // Exclude 6MB+ field
    audioS3Key: true, // Include just the key
  },
  orderBy: { createdAt: 'desc' },
  take: limit,
  skip: offset,
})
```

**Result:** 21.9s → 0.3s fetch time (70x faster)

### Audio Compression

**Gzip Compression Pipeline:**
1. Generate audio (base64 WAV)
2. Convert to binary buffer
3. Gzip compress with `pako` library
4. Re-encode to base64
5. Prefix with version: `v2:gz:{data}`

**Compression Ratio:**
- Original: 6.4MB (base64 WAV)
- Compressed: 1.5MB (gzip + base64)
- **77% size reduction**

**Backward Compatibility:**
```typescript
function decompressAudio(audioData: string): string {
  if (audioData.startsWith('v2:gz:')) {
    const compressed = audioData.substring(6)
    const binary = atob(compressed)
    const decompressed = pako.ungzip(binary)
    return btoa(String.fromCharCode(...decompressed))
  }
  return audioData // Legacy uncompressed
}
```

### S3 Migration Strategy

**Why S3?**
- Database is expensive for large binary data
- S3 is optimized for object storage
- Presigned URLs enable direct browser downloads
- Reduces database load and costs

**Migration Flow:**
1. Component checks `audioS3Key` field first
2. If exists, fetch from S3 with presigned URL
3. If not, fall back to `audioData` field (legacy)
4. Background job migrates old entries to S3

**Lazy Migration:**
- No forced migration required
- Entries migrate on-demand when accessed
- Both storage methods work simultaneously

### Context Caching (Gemini)

**Explicit Cache API:**
```typescript
const cache = await cacheManager.upsertContextCache(contextEntries)

const response = await model.generateContent({
  contents: [
    ...cache.cachedContent, // Reference cached context
    { role: 'user', parts: [{ text: currentEntry }] }
  ]
})
```

**Cost Reduction:**
- Cached tokens: ~90% cheaper than regular tokens
- Cache valid for 1 hour
- Automatically refreshes if stale
- Reduces API costs for users with large histories

**Performance Impact:**
- First request: ~3-4s (no cache)
- Subsequent requests: ~1-2s (with cache)
- **50% faster for repeat reflections**

### Streaming UX

**Typewriter Effect:**
- Stream text character-by-character
- Show progress in real-time
- Reduces perceived latency
- Engages user during AI processing

**Implementation:**
```typescript
onTextChunk: (chunk: string) => {
  setReflectionText(prev => prev + chunk)
  setProgress({ stage: 'streaming', percent: undefined })
}
```

**User Perception:**
- Non-streaming: 8s wait → instant result (feels slow)
- Streaming: 0.5s wait → 8s gradual reveal (feels fast)

### IndexedDB Caching

**Cache Strategy:**
- Store audio by text hash
- 100MB quota per origin
- Never expires (manual cleanup if needed)
- Instant retrieval (~50-100ms)

**Cache Hit Rate:**
- Same reflection replayed: 100% hit rate
- Similar wording: ~70% hit rate (hash collision)
- New content: 0% hit rate (generates new)

**Storage Efficiency:**
- Compressed audio stored (1.5MB per entry)
- ~66 entries fit in 100MB quota
- Automatic eviction of oldest entries if quota exceeded

---

## Recent Improvements (Last 5 Commits)

### 1. Audio Playback Fixes (Commit: 1b247d4)
- Fixed audio not playing in history page
- Resolved iOS compatibility issues
- Improved error handling for interrupted AudioContext

### 2. Mobile UI Optimizations (Commit: b136c0e)
- Improved UI density on small screens
- Better audio context handling on mobile
- Responsive layout adjustments

### 3. Gemini Streaming with Typewriter Effect (Commit: 07ec74f)
- Real-time streaming with character-by-character reveal
- Progress indicators during generation
- Smoother UX with perceived performance boost

### 4. Streaming JSON Parsing Fix (Commit: 926edbd)
- Resolved error when no text received in stream
- Better error handling for malformed JSON
- Graceful degradation for empty responses

### 5. Text Duplication Resolution (Commit: c0ddd7b)
- Fixed streaming text appearing twice
- Resolved animation glitches
- Improved chunk buffering logic

---

## Future Roadmap

### Planned Features
- [ ] User-selectable LLM provider (UI preference)
- [ ] Voice customization (pitch, speed, accent)
- [ ] Advanced entity relationship visualization
- [ ] Mood trend analytics dashboard
- [ ] Export journal entries (PDF, Markdown)
- [ ] Scheduled reminders for journaling
- [ ] Dark mode theme
- [ ] Mobile app (React Native)

### Performance Improvements
- [ ] Edge runtime for API routes (reduce cold starts)
- [ ] Image optimization for entity images
- [ ] Lazy loading for history entries
- [ ] Service worker for offline support

### AI Enhancements
- [ ] Multi-language support (i18n)
- [ ] Custom reflection styles (concise, detailed, poetic)
- [ ] Journal prompts and suggestions
- [ ] Weekly/monthly summary generation
- [ ] Sentiment analysis over time

---

## Contributing

### Code Style
- Follow existing patterns (provider pattern, service layer)
- Use TypeScript for all new code
- Add JSDoc comments for complex functions
- Run `npm run lint` before committing

### Testing
- Test with demo mode first
- Verify database operations in Prisma Studio
- Test audio playback on iOS Safari (most restrictive)
- Check performance with Chrome DevTools

### Documentation
- Update `docs/` for significant changes
- Keep `CLAUDE.md` in sync with architecture changes
- Document API changes in route files
- Add JSDoc comments for public functions

---

## Support & Resources

### Documentation
- [Main README](../README.md) - Setup instructions
- [CLAUDE.md](../CLAUDE.md) - AI assistant instructions
- [Audio System Overview](./audio-system-overview.md) - Audio architecture
- [Context Awareness](./CONTEXT-AWARENESS-README.md) - AI context system

### External Resources
- [Next.js Docs](https://nextjs.org/docs)
- [Prisma Docs](https://www.prisma.io/docs)
- [NextAuth.js Docs](https://next-auth.js.org/)
- [Gemini API Docs](https://ai.google.dev/docs)

### Getting Help
- Check existing documentation first
- Review recent commits for similar patterns
- Use `/test-stream` page for AI provider debugging
- Check browser console for error messages

---

**Last Updated:** January 7, 2026
**Version:** 1.0.0
**Maintainers:** Serenity Journal Team
