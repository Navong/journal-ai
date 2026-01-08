# End-to-End Workflow: Serenity Journal AI

## Complete System Architecture & Data Flow

```mermaid
graph TB
    %% User Interface Layer
    subgraph "User Interface Layer"
        UI[Journal Interface<br/>React Components]
        Auth[Authentication<br/>NextAuth.js + Google OAuth]
        State[State Management<br/>Compound Components]
    end

    %% Client-Side Processing
    subgraph "Client Processing"
        Input[User Input<br/>Journal Entry]
        ContextSel[Context Selection<br/>Semantic Scoring]
        Streaming[Streaming Display<br/>Real-time UI Updates]
        AudioPlay[Audio Playback<br/>AudioStreamPlayer]
    end

    %% API Layer
    subgraph "API Layer"
        TTS_API[TTS API<br/>/api/tts]
        History_API[History API<br/>/api/history]
        Auth_API[Auth API<br/>NextAuth Handlers]
    end

    %% Service Layer
    subgraph "Service Layer"
        JournalSvc[JournalAIService<br/>Orchestrator]
        TTSSvc[TTS Provider<br/>Factory Pattern]
        HistorySvc[History Service<br/>CRUD Operations]
        CacheSvc[Cache Service<br/>LRU + Analytics]
    end

    %% AI Providers
    subgraph "AI Providers"
        Gemini[Google Gemini<br/>gemini-1.5-flash/pro]
        Grok[Grok via OpenRouter<br/>x-ai/grok-4.1-fast]
        CartesiaTTS[Cartesia TTS<br/>sonic-2 model]
        GeminiTTS[Gemini TTS<br/>30+ voices]
        ElevenLabsTTS[ElevenLabs TTS<br/>Ultra-low latency]
        FishTTS[Fish Audio TTS<br/>Emotion control]
    end

    %% Data Layer
    subgraph "Data Layer"
        Supabase[(Supabase PostgreSQL<br/>User Data + Metadata)]
        S3[(AWS S3<br/>Audio Files)]
        IndexedDB[(IndexedDB<br/>Client Cache)]
        LocalStorage[(localStorage<br/>Demo Mode)]
    end

    %% External Systems
    subgraph "External Systems"
        Google[Google OAuth<br/>User Authentication]
        OpenRouter[OpenRouter API<br/>Multi-Model Access]
        GoogleAI[Google AI API<br/>Gemini Models]
        Cartesia[Cartesia API<br/>High-Quality TTS]
        ElevenLabs[ElevenLabs API<br/>Fast TTS]
        FishAudio[Fish Audio API<br/>Emotional TTS]
    end

    %% Data Flow Connections
    UI --> Auth
    Auth --> Google

    UI --> Input
    Input --> ContextSel
    ContextSel --> JournalSvc

    JournalSvc --> Gemini
    JournalSvc --> Grok
    Gemini --> GoogleAI
    Grok --> OpenRouter

    JournalSvc --> Streaming
    Streaming --> UI

    JournalSvc --> TTSSvc
    TTSSvc --> CartesiaTTS
    TTSSvc --> GeminiTTS
    TTSSvc --> ElevenLabsTTS
    TTSSvc --> FishTTS

    CartesiaTTS --> Cartesia
    GeminiTTS --> GoogleAI
    ElevenLabsTTS --> ElevenLabs
    FishTTS --> FishAudio

    TTSSvc --> AudioPlay
    AudioPlay --> UI

    %% API Connections
    UI --> TTS_API
    UI --> History_API
    UI --> Auth_API

    TTS_API --> TTSSvc
    History_API --> HistorySvc
    Auth_API --> Auth

    %% Service to Data Connections
    JournalSvc --> CacheSvc
    HistorySvc --> Supabase
    TTSSvc --> S3
    TTSSvc --> IndexedDB
    HistorySvc --> LocalStorage

    %% Styling
    classDef uiClass fill:#e1f5fe,stroke:#01579b,stroke-width:2px
    classDef serviceClass fill:#f3e5f5,stroke:#4a148c,stroke-width:2px
    classDef dataClass fill:#e8f5e8,stroke:#1b5e20,stroke-width:2px
    classDef externalClass fill:#fff3e0,stroke:#e65100,stroke-width:2px
    classDef aiClass fill:#fce4ec,stroke:#880e4f,stroke-width:2px

    class UI,Auth,State,Input,ContextSel,Streaming,AudioPlay uiClass
    class JournalSvc,TTSSvc,HistorySvc,CacheSvc,TTS_API,History_API,Auth_API serviceClass
    class Supabase,S3,IndexedDB,LocalStorage dataClass
    class Google,OpenRouter,GoogleAI,Cartesia,ElevenLabs,FishAudio externalClass
    class Gemini,Grok,CartesiaTTS,GeminiTTS,ElevenLabsTTS,FishTTS aiClass
```

## Detailed Workflow Sequences

### 1. User Authentication Flow
```mermaid
sequenceDiagram
    participant U as User
    participant UI as Journal Interface
    participant Auth as NextAuth.js
    participant G as Google OAuth
    participant DB as Supabase

    U->>UI: Click "Sign In"
    UI->>Auth: Initiate OAuth Flow
    Auth->>G: Redirect to Google
    G->>U: Google Login
    U->>Auth: OAuth Callback
    Auth->>DB: Create/Update User
    DB->>Auth: User Profile
    Auth->>UI: Authenticated Session
    UI->>U: Access Granted
```

### 2. Journal Entry Creation & AI Reflection
```mermaid
sequenceDiagram
    participant U as User
    participant UI as Journal Interface
    participant JS as JournalAIService
    participant CS as Context Selection
    participant AI as AI Provider (Gemini/Grok)
    participant DB as Supabase
    participant Cache as Cache Service

    U->>UI: Write Journal Entry
    UI->>UI: Auto-save to localStorage
    U->>UI: Click "Get Reflection"

    UI->>JS: generateReflection(entry, context)
    JS->>CS: selectRelevantContext(entry, history)
    CS->>Cache: Check Embedding Cache
    Cache->>CS: Cached Embeddings or New Calculation
    CS->>CS: Calculate Similarity Scores
    CS->>JS: Relevant Context (Top-K entries)

    JS->>AI: Generate Reflection with Context
    AI->>JS: Streaming Response Chunks
    JS->>UI: Stream Chunks to UI
    UI->>U: Real-time Reflection Display

    JS->>DB: Save Entry + Reflection + Metadata
    DB->>JS: Confirmation
    JS->>Cache: Update Analytics Cache
```

### 3. Text-to-Speech Audio Generation
```mermaid
sequenceDiagram
    participant U as User
    participant UI as Journal Interface
    participant AM as AudioManager
    participant TTS_API as /api/tts
    participant TS as TTS Service
    participant TP as TTS Provider
    participant S3 as AWS S3
    participant Cache as IndexedDB Cache

    U->>UI: Click Play Audio
    UI->>AM: handleTogglePlayback(text, id)

    AM->>TTS_API: POST /api/tts with text & entryId
    TTS_API->>TTS_API: Check Rate Limits
    TTS_API->>S3: Check Cache (cacheKey)
    alt Cache Hit
        S3->>TTS_API: Return Cached Audio
        TTS_API->>AM: Stream Audio to Client
    else Cache Miss
        TTS_API->>TS: getTTSProvider()
        TS->>TP: generateSpeechStream(text)
        TP->>TS: Audio Stream
        TS->>TTS_API: Stream to Client + Buffer

        TTS_API->>AM: Progressive Audio Stream
        TTS_API->>S3: Background Upload (non-blocking)
        S3->>TTS_API: Upload Complete
    end

    AM->>AM: AudioStreamPlayer.playFromResponse()
    AM->>UI: Audio Playback Controls
    UI->>U: Audio Playing (1-2s latency)

    AM->>Cache: Cache Audio Locally
```

### 4. History & Caching Flow
```mermaid
sequenceDiagram
    participant U as User
    participant UI as History View
    participant HS as History Service
    participant DB as Supabase
    participant S3 as AWS S3
    participant LS as localStorage

    U->>UI: Open History Page
    UI->>HS: loadHistory(userId)

    alt Authenticated User
        HS->>DB: Query Journal Entries
        DB->>HS: Entry List + Metadata
        HS->>UI: Render History
    else Demo Mode
        HS->>LS: Load from localStorage
        LS->>HS: Cached Entries
        HS->>UI: Render History
    end

    U->>UI: Click Play on History Entry
    UI->>UI: Check IndexedDB Cache
    alt Audio Cached
        UI->>UI: Play from Cache
    else No Cache
        UI->>S3: Fetch Audio (streaming=true)
        S3->>UI: Stream Audio or 404
        alt S3 Hit
            UI->>UI: Progressive Playback
        else S3 Miss
            UI->>UI: Generate New Audio
        end
    end
```

## Component Architecture Flow

### Compound Component Pattern
```mermaid
graph TD
    A[JournalApp] --> B[HistoryManager]
    A --> C[AudioManager]
    A --> D[ChatManager]
    A --> E[JournalInterface]

    B --> F[Entry List]
    B --> G[Pagination]
    B --> H[Search/Filter]

    C --> I[AudioStreamPlayer]
    C --> J[Audio Context]
    C --> K[Format Detection]

    D --> L[Message History]
    D --> M[Streaming Display]
    D --> N[Auto-play Logic]

    E --> O[Writing Interface]
    E --> P[Reflection Display]
    E --> Q[Audio Controls]

    F --> B
    I --> C
    L --> D
    O --> E
```

## Data Persistence Strategy

### Multi-Layer Storage
```mermaid
graph TD
    A[User Writes Entry] --> B{Authentication?}

    B -->|Yes| C[Supabase PostgreSQL]
    B -->|No| D[localStorage Demo]

    C --> E[Structured Data]
    C --> F[Metadata + Analytics]
    C --> G[Entity Relationships]

    D --> H[Simple JSON Array]
    D --> I[No Audio Persistence]

    E --> J[Cross-device Sync]
    F --> K[Usage Analytics]
    G --> L[Context Awareness]

    H --> M[Single Device Only]
```

## Performance Optimization Layers

### Caching Hierarchy
```mermaid
graph TD
    A[User Request] --> B{IndexedDB Cache}
    B -->|Hit| C[Instant Playback]
    B -->|Miss| D{AWS S3 Cache}

    D -->|Hit| E[CDN Delivery]
    D -->|Miss| F{TTS API Call}

    F --> G[Generate Audio]
    G --> H[Stream to Client]
    G --> I[Background S3 Upload]

    H --> J[Progressive Playback]
    I --> K[Future Request Cache]
```

## Error Handling & Resilience

### Fallback Chain
```mermaid
graph TD
    A[Audio Request] --> B{IndexedDB Cache}
    B -->|Hit| C[Play Cached Audio]

    B -->|Miss| D{S3 Cache}
    D -->|Hit| E[Stream from S3]

    D -->|Miss| F{TTS Provider}
    F -->|Available| G[Generate New Audio]

    F -->|Error| H{Retry Logic}
    H -->|Success| G
    H -->|Fail| I{Fallback Provider}
    I -->|Available| J[Try Different Provider]
    I -->|None| K[Show Error Message]
```

## Cost Optimization Flow

### Token & Cache Management
```mermaid
graph TD
    A[AI Request] --> B{Cache Check}
    B -->|Hit| C[Return Cached Response<br/>$0 Cost]

    B -->|Miss| D[Select Provider]
    D --> E{Gemini Context Cache}
    E -->|Available| F[Apply Cache<br/>20-30% Savings]

    E -->|None| G[Full Generation]
    G --> H[Track Token Usage]
    H --> I[Update Analytics]
    I --> J[Optimize Future Requests]
```

---

## Key System Characteristics

### **Scalability**
- Serverless architecture with Supabase
- CDN delivery via S3
- Horizontal scaling through API design

### **Reliability**
- Multi-provider redundancy
- Progressive enhancement
- Graceful degradation

### **Performance**
- Progressive audio streaming
- Intelligent caching layers
- Optimized context selection

### **Privacy**
- User-scoped data isolation
- End-to-end encryption
- Transparent data control

### **Cost Efficiency**
- Multi-layer caching (30-50% savings)
- Provider optimization
- Background processing

This end-to-end workflow ensures a seamless, intelligent journaling experience that evolves with user patterns while maintaining high performance and reliability.