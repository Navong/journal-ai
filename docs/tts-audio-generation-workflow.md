# Text-to-Speech Audio Generation: Detailed Workflow

## Complete TTS Audio Pipeline Architecture

```mermaid
graph TB
    %% User Interface Triggers
    subgraph "User Interface Triggers"
        PlayBtn[Play Button<br/>Journal/History/Chat]
        AutoPlay[Auto-play Toggle<br/>Reflection Complete]
        HistoryPlay[History Audio<br/>Cached Playback]
        ChatPlay[Chat Message<br/>Instant Generation]
    end

    %% AudioManager Orchestration
    subgraph "AudioManager Orchestration"
        AM[AudioManager<br/>handleTogglePlayback]
        StateCheck{Check State}
        S3Check[AWS S3 Cache<br/>Check]
        SupabaseCheck[Supabase Cache<br/>Check]
        FormatDetect[Format Detection<br/>Content-Type Analysis]
        PlayerInit[AudioStreamPlayer<br/>Initialization]
    end

    %% API Layer Processing
    subgraph "API Layer (/api/tts)"
        RateLimit[Rate Limiting<br/>30 req/min per user]
        AuthCheck[Authentication<br/>Session Validation]
        TextProcess[Text Preprocessing<br/>Clean & Format]
        MoodExtract[Mood Detection<br/>From Entry Metadata]
        CacheKeyGen[Cache Key Generation<br/>User-scoped Hashing]
        ProviderSelect[TTS Provider Selection<br/>Environment/Config]
    end

    %% TTS Service Layer
    subgraph "TTS Service Layer"
        TTSFactory[TTS Provider Factory<br/>getTTSProvider]
        CartesiaSvc[CartesiaTTSProvider<br/>sonic-2 model]
        GeminiSvc[GeminiTTSProvider<br/>30+ voices]
        ElevenLabsSvc[ElevenLabsTTSProvider<br/>Ultra-low latency]
        FishSvc[FishAudioTTSProvider<br/>Emotion control]
        MurfSvc[MurfTTSProvider<br/>Studio quality]
    end

    %% Provider-Specific Processing
    subgraph "Provider-Specific Processing"
        CartesiaClean[Text Cleaning<br/>Markdown removal]
        GeminiStyle[Style Prefix Injection<br/>Say naturally:]
        FishEmotion[Emotion Mapping<br/>Mood → Emotion Tags]
        VoiceConfig[Voice Configuration<br/>Model + Voice ID]
        APICall[API Call<br/>Stream Generation]
    end

    %% Streaming & Caching
    subgraph "Streaming & Dual Processing"
        TransformStream[TransformStream<br/>Tee: Client + Buffer]
        ClientStream[Client Streaming<br/>Immediate Playback]
        BufferAccum[Buffer Accumulation<br/>S3 Upload Prep]
        Chunking[Chunk Processing<br/>8KB Progressive]
        BackgroundUpload[S3 Background Upload<br/>Non-blocking]
    end

    %% Audio Playback System
    subgraph "Audio Playback System"
        AudioStreamPlayer[AudioStreamPlayer<br/>Core Player]
        BufferManager[Buffer Manager<br/>512KB Initial Buffer]
        FormatDecoder[Format Decoder<br/>WAV/MP3/PCM Detection]
        WebAudioAPI[Web Audio API<br/>Context + Sources]
        ProgressivePlay[Progressive Playback<br/>Stream Continuation]
    end

    %% Caching Layers
    subgraph "Caching Layers"
        SupabaseCache[(Supabase<br/>Database Cache)]
        S3Cache[(AWS S3<br/>Cloud Storage)]
        MemoryCache[(Memory Cache<br/>Session Cache)]
    end

    %% Error Handling
    subgraph "Error Handling & Fallbacks"
        RetryLogic[Retry Logic<br/>Exponential Backoff]
        ProviderFallback[Provider Fallback<br/>Next Available]
        FormatFallback[Format Fallback<br/>MP3 → WAV → PCM]
        CacheFallback[Cache Fallback<br/>S3 → Generate → Error]
    end

    %% Data Flow
    PlayBtn --> AM
    AutoPlay --> AM
    HistoryPlay --> AM
    ChatPlay --> AM

    AM --> StateCheck
    StateCheck --> S3Check
    S3Check --> SupabaseCheck
    SupabaseCheck --> AM
    AM --> PlayerInit
    PlayerInit --> AudioStreamPlayer

    AM --> RateLimit
    RateLimit --> AuthCheck
    AuthCheck --> TextProcess
    TextProcess --> MoodExtract
    MoodExtract --> CacheKeyGen
    CacheKeyGen --> ProviderSelect
    ProviderSelect --> TTSFactory

    TTSFactory --> CartesiaSvc
    TTSFactory --> GeminiSvc
    TTSFactory --> ElevenLabsSvc
    TTSFactory --> FishSvc
    TTSFactory --> MurfSvc

    CartesiaSvc --> CartesiaClean
    GeminiSvc --> GeminiStyle
    FishSvc --> FishEmotion
    ElevenLabsSvc --> VoiceConfig
    MurfSvc --> VoiceConfig

    CartesiaClean --> APICall
    GeminiStyle --> APICall
    FishEmotion --> APICall
    VoiceConfig --> APICall

    APICall --> TransformStream
    TransformStream --> ClientStream
    TransformStream --> BufferAccum

    ClientStream --> Chunking
    Chunking --> AudioStreamPlayer

    BufferAccum --> BackgroundUpload
    BackgroundUpload --> S3Cache

    AudioStreamPlayer --> BufferManager
    BufferManager --> FormatDecoder
    FormatDecoder --> WebAudioAPI
    WebAudioAPI --> ProgressivePlay

    S3Check --> S3Cache
    SupabaseCheck --> SupabaseCache
    PlayerInit --> MemoryCache

    APICall --> RetryLogic
    RetryLogic --> ProviderFallback
    ProviderFallback --> TTSFactory

    FormatDecoder --> FormatFallback
    BackgroundUpload --> CacheFallback

    %% Styling
    classDef uiClass fill:#e1f5fe,stroke:#01579b,stroke-width:2px
    classDef apiClass fill:#f3e5f5,stroke:#4a148c,stroke-width:2px
    classDef serviceClass fill:#fce4ec,stroke:#880e4f,stroke-width:2px
    classDef processingClass fill:#fff3e0,stroke:#e65100,stroke-width:2px
    classDef streamingClass fill:#e8f5e8,stroke:#1b5e20,stroke-width:2px
    classDef playbackClass fill:#fce4ec,stroke:#c2185b,stroke-width:2px
    classDef cacheClass fill:#f3e5f5,stroke:#7b1fa2,stroke-width:2px
    classDef errorClass fill:#ffebee,stroke:#c62828,stroke-width:2px

    class PlayBtn,AutoPlay,HistoryPlay,ChatPlay,AM,StateCheck uiClass
    class RateLimit,AuthCheck,TextProcess,MoodExtract,CacheKeyGen,ProviderSelect apiClass
    class TTSFactory,CartesiaSvc,GeminiSvc,ElevenLabsSvc,FishSvc,MurfSvc serviceClass
    class CartesiaClean,GeminiStyle,FishEmotion,VoiceConfig,APICall processingClass
    class TransformStream,ClientStream,BufferAccum,Chunking,BackgroundUpload streamingClass
    class AudioStreamPlayer,BufferManager,FormatDecoder,WebAudioAPI,ProgressivePlay playbackClass
    class SupabaseCache,S3Cache,MemoryCache cacheClass
    class RetryLogic,ProviderFallback,FormatFallback,CacheFallback errorClass
```

## Detailed Step-by-Step TTS Generation Sequence

### Phase 1: User Interaction & Initial Checks
```mermaid
sequenceDiagram
    participant U as User
    participant UI as UI Component
    participant AM as AudioManager
    participant S3 as AWS S3
    participant SB as Supabase

    U->>UI: Click Play Audio
    UI->>AM: handleTogglePlayback(text, id)

    AM->>AM: Check playback state
    alt Audio already playing for this ID
        AM->>AM: Stop current playback
        AM->>U: Update UI state
    else New audio request
        AM->>S3: Check S3 cache (via API)
        alt S3 hit
            S3->>AM: Stream from S3
            AM->>AM: Progressive playback
            AM->>U: Audio playing
        else S3 miss
            AM->>SB: Check Supabase cache
            alt Supabase hit
                SB->>AM: Return cached audio
                AM->>AM: Play from cache
                AM->>U: Audio playing
            else Supabase miss
                AM->>AM: Generate new audio
            end
        end
    end
```

### Phase 2: API Processing & Provider Selection
```mermaid
sequenceDiagram
    participant AM as AudioManager
    participant API as /api/tts
    participant RL as Rate Limiter
    participant AUTH as Auth Check
    participant PROC as Text Processor
    participant MOOD as Mood Extractor
    participant CACHE as Cache Key Gen
    participant PROV as Provider Selector
    participant FACT as TTS Factory

    AM->>API: POST /api/tts {text, entryId}
    API->>RL: Check rate limit (30/min)
    RL->>API: Rate OK

    API->>AUTH: Validate session
    AUTH->>API: User authenticated

    API->>PROC: Clean text (remove markdown, normalize)
    PROC->>API: Cleaned text

    API->>MOOD: Extract mood from entry (if entryId)
    MOOD->>API: Mood detected

    API->>CACHE: Generate cache key (user-scoped hash)
    CACHE->>API: Cache key generated

    API->>PROV: Select provider (env/config)
    PROV->>API: Provider selected

    API->>FACT: getTTSProvider(providerType)
    FACT->>API: Provider instance
```

### Phase 3: Provider-Specific Processing
```mermaid
sequenceDiagram
    participant API as /api/tts
    participant CART as CartesiaProvider
    participant GEM as GeminiProvider
    participant FISH as FishProvider
    participant PROC as Text Processor
    participant STYLE as Style Injector
    participant EMO as Emotion Mapper
    participant VOICE as Voice Config
    participant EXT as External API

    alt Cartesia Provider
        API->>CART: generateSpeechStream()
        CART->>PROC: Clean text for TTS
        PROC->>CART: Cleaned text
        CART->>VOICE: Configure voice (sonic-2 model)
        VOICE->>CART: Voice configured
        CART->>EXT: Call Cartesia API
        EXT->>CART: Raw PCM stream (44.1kHz)

    else Gemini Provider
        API->>GEM: generateSpeechStream()
        GEM->>STYLE: Add style prefix ("Say naturally:")
        STYLE->>GEM: Styled text
        GEM->>VOICE: Configure voice (Kore + 29 others)
        VOICE->>GEM: Voice configured
        GEM->>EXT: Call Gemini TTS API
        EXT->>GEM: Base64 PCM response
        GEM->>GEM: Convert to WAV (big-endian → little-endian)

    else Fish Audio Provider
        API->>FISH: generateSpeechStream()
        FISH->>EMO: Map mood to emotion (joyful→Happy)
        EMO->>FISH: Emotion tags injected
        FISH->>VOICE: Configure voice (S1 model)
        VOICE->>FISH: Voice configured
        FISH->>EXT: Call Fish Audio API
        EXT->>FISH: Audio stream with emotion
    end
```

### Phase 4: Streaming & Dual Processing
```mermaid
sequenceDiagram
    participant PROV as TTS Provider
    participant API as /api/tts
    participant TS as TransformStream
    participant CLIENT as Client Stream
    participant BUFFER as Buffer Accumulator
    participant CHUNK as Chunk Processor
    participant S3 as AWS S3
    participant AM as AudioManager

    PROV->>API: Audio stream generated

    API->>TS: Create TransformStream (tee)
    TS->>CLIENT: Pass-through to client
    TS->>BUFFER: Accumulate for S3 upload

    CLIENT->>CHUNK: Process in 8KB chunks
    CHUNK->>AM: Progressive streaming to player

    BUFFER->>BUFFER: Accumulate complete audio
    BUFFER->>S3: Background upload (non-blocking)
    S3->>API: Upload confirmation (async)

    Note over API,S3: Background upload doesn't block<br/>client audio playback
```

### Phase 5: Client-Side Audio Playback
```mermaid
sequenceDiagram
    participant AM as AudioManager
    participant ASP as AudioStreamPlayer
    participant BM as Buffer Manager
    participant FD as Format Decoder
    participant WA as Web Audio API
    participant PP as Progressive Player
    participant UI as User Interface

    AM->>ASP: playFromResponse(stream)

    ASP->>BM: Initialize 512KB buffer
    BM->>ASP: Buffer ready

    ASP->>FD: Detect audio format
    alt WAV/MP3/PCM detection
        FD->>FD: Try WAV decode
        FD->>FD: Try MP3 decode
        FD->>FD: Try raw PCM decode
        FD->>ASP: Format detected
    end

    ASP->>WA: Create AudioContext
    WA->>WA: Initialize Web Audio nodes
    WA->>ASP: Audio context ready

    ASP->>PP: Start progressive playback
    PP->>PP: Play buffered portion
    PP->>PP: Continue streaming remainder

    ASP->>UI: Playback started (1-2s latency)
    PP->>UI: Seamless audio continuation
```

## Provider-Specific Implementation Details

### Cartesia TTS Flow
```mermaid
graph TD
    A[Input Text] --> B[Clean Text<br/>Remove markdown, links, bullets]
    B --> C[Configure Voice<br/>sonic-2 model<br/>Voice ID: 694f9389-aac1-45b6-b726-9d9369183238]
    C --> D[API Call<br/>Raw PCM output<br/>44.1kHz, 16-bit]
    D --> E[Progressive Streaming<br/>8KB chunks<br/>No conversion needed]
    E --> F[Web Audio Playback<br/>Direct PCM decode]
```

### Gemini TTS Flow
```mermaid
graph TD
    A[Input Text] --> B[Add Style Prefix<br/>Say naturally: text]
    B --> C[Select Voice<br/>Kore<br/>gemini-2.5-flash-preview-tts]
    C --> D[API Call<br/>Base64 PCM response<br/>24kHz, 16-bit, big-endian]
    D --> E[Byte Order Conversion<br/>Big-endian → Little-endian]
    E --> F[WAV Header Generation<br/>RIFF + fmt + data chunks]
    F --> G[Progressive Streaming<br/>8KB chunks<br/>Complete WAV file]
    G --> H[Web Audio Playback<br/>WAV decode]
```

### Fish Audio Emotion Mapping
```mermaid
graph TD
    A[Journal Entry Mood] --> B{Mood Detection}
    B -->|joyful| C[Emotion: Happy<br/>Tag: <emotion>Happy</emotion>]
    B -->|anxious| D[Emotion: Sad<br/>Tag: <emotion>Sad</emotion>]
    B -->|reflective| E[Emotion: Calm<br/>Tag: <emotion>Calm</emotion>]
    B -->|tired| F[Emotion: Sleepy<br/>Tag: <emotion>Sleepy</emotion>]

    C --> G[Text Injection<br/>Emotion tags wrapped around text]
    D --> G
    E --> G
    F --> G

    G --> H[API Call<br/>S1 model with emotion control]
```

## Performance Characteristics

### Latency Breakdown (Target: 1-2 seconds)
```mermaid
gantt
    title TTS Generation Latency (Target: 1-2s total)
    dateFormat x
    axisFormat %S

    section Network/API
    DNS Resolution     :done, 0, 100ms
    API Call          :done, 100ms, 800ms
    Initial Response  :done, 900ms, 200ms

    section Processing
    Text Cleaning     :done, 0, 50ms
    Format Conversion :done, 50ms, 150ms
    Buffer Setup      :done, 200ms, 100ms

    section Streaming
    First Chunk       :done, 300ms, 100ms
    Buffer Fill (512KB):done, 400ms, 600ms
    Playback Start    :done, 1000ms, 100ms

    section Total
    End-to-End        :done, 0, 1200ms
```

### Cache Hit Rates (Expected Performance)
```mermaid
pie title Cache Effectiveness (Estimated)
    "S3 Hits" : 60
    "Supabase Hits" : 20
    "New Generation" : 20
```

## Error Recovery Patterns

### Provider Fallback Chain
```mermaid
graph TD
    A[Primary Provider<br/>Fails] --> B{Retry with<br/>Backoff}
    B -->|Success| C[Continue Processing]
    B -->|Fail| D{Next Provider<br/>Available?}

    D -->|Yes| E[Switch Provider<br/>Cartesia → Gemini → ElevenLabs → Fish]
    D -->|No| F[Format Fallback<br/>MP3 → WAV → PCM]

    E --> C
    F --> G{Cache Fallback<br/>S3 → Generate → Error}
    G --> H[Show User Error<br/>Graceful Degradation]
```

### Mobile-Specific Optimizations
```mermaid
graph TD
    A[Mobile Device Detected] --> B[Force MP3 Format<br/>Better compatibility]
    B --> C[Reduced Buffer Size<br/>Conserve memory]
    C --> D[Audio Context Unlock<br/>iOS Safari requirement]
    D --> E[Touch Interaction Required<br/>Before playback]
```

---

## Key TTS Architecture Principles

### **Progressive Enhancement**
- Audio starts playing within 1-2 seconds
- Seamless transition from buffered to streaming audio
- Graceful fallback for unsupported formats

### **Multi-Layer Caching**
- **Supabase**: Database-backed persistence (server-side)
- **S3**: Cross-device cloud storage (CDN delivery)
- **Memory**: Session optimization (temporary)

### **Provider Redundancy**
- 5 different TTS providers available
- Automatic failover on errors
- Cost optimization through provider selection

### **Streaming Optimization**
- Dual processing: client + S3 simultaneously
- Background uploads don't block playback
- Chunked streaming for smooth delivery

### **Error Resilience**
- Exponential backoff retry logic
- Format detection and fallback
- User-friendly error messages

This detailed TTS workflow ensures reliable, high-performance audio generation with multiple fallback mechanisms and optimization strategies for the best user experience.This detailed TTS workflow ensures reliable, high-performance audio generation with multiple fallback mechanisms and optimization strategies for the best user experience.
