# TTS Advanced Features - Detailed Implementation Guide

## 1. Chunk Caching — Cache Individual Chunks for Reuse

### Current Problem

**Current behavior:**
```typescript
// Text: "This is a long reflection. It has multiple sentences. Each sentence is important."
// Chunks: ["This is a long reflection.", "It has multiple sentences.", "Each sentence is important."]

// User 1 requests full text → Generates 3 chunks → Caches full text
// User 2 requests text with same chunk → Regenerates ALL chunks (waste!)
```

**Issue:** If two different texts share common chunks (e.g., "Thank you for sharing." appears in many reflections), each text regenerates those chunks, wasting API calls.

### Solution: Individual Chunk Caching

**Concept:** Cache each chunk separately, then reconstruct full audio from cached chunks.

**How it works:**

```typescript
// Step 1: When chunking text, check cache for EACH chunk
async function generateSpeechWithChunkCache(text: string) {
  const chunks = chunkTextForTTS(text);
  const chunkResults: string[] = [];
  
  for (const chunk of chunks) {
    // Check if THIS specific chunk is cached
    const cachedChunk = await audioCache.get(chunk);
    
    if (cachedChunk) {
      // ✅ Cache hit - reuse this chunk (NO API call!)
      chunkResults.push(cachedChunk);
      log.debug('Chunk cache HIT', { chunk: chunk.substring(0, 50) });
    } else {
      // ❌ Cache miss - generate only this chunk
      const generated = await generateSpeechChunk(chunk);
      if (generated) {
        // Save THIS chunk to cache for future reuse
        await audioCache.set(chunk, generated);
        chunkResults.push(generated);
      }
    }
  }
  
  return chunkResults;
}
```

**Example Scenario:**

```
Text A: "I feel anxious today. Work is stressful. I need a break."
Text B: "I feel anxious today. Family is supportive. I'm grateful."

Chunks:
- Chunk 1: "I feel anxious today." (appears in BOTH texts)
- Chunk 2A: "Work is stressful. I need a break."
- Chunk 2B: "Family is supportive. I'm grateful."

Flow:
1. User requests Text A
   - Chunk 1: Cache miss → Generate → Cache it
   - Chunk 2A: Cache miss → Generate → Cache it
   - API calls: 2

2. User requests Text B
   - Chunk 1: Cache HIT → Reuse (no API call!) ✅
   - Chunk 2B: Cache miss → Generate → Cache it
   - API calls: 1 (saved 1 call!)

Total: 3 API calls instead of 4 (25% reduction)
```

**Implementation Details:**

```typescript
// Enhanced generateSpeech function
export const generateSpeech = async (
  text: string,
  options?: { useCache?: boolean; chunked?: boolean }
): Promise<string | string[] | undefined> => {
  const { useCache = true, chunked = false } = options || {};

  // Check full text cache first (existing behavior)
  if (useCache) {
    const fullCached = await audioCache.get(text);
    if (fullCached) return fullCached;
  }

  // If chunked mode, use chunk-level caching
  if (chunked) {
    const chunks = chunkTextForTTS(text);
    
    // Check each chunk individually
    const chunkResults: string[] = [];
    const chunksToGenerate: { index: number; text: string }[] = [];
    
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const cached = await audioCache.get(chunk);
      
      if (cached) {
        chunkResults[i] = cached; // Cache hit
      } else {
        chunksToGenerate.push({ index: i, text: chunk });
      }
    }
    
    // Generate only missing chunks
    for (const { index, text: chunkText } of chunksToGenerate) {
      const generated = await generateSpeechChunk(chunkText);
      if (generated) {
        chunkResults[index] = generated;
        // Cache this chunk for future reuse
        await audioCache.set(chunkText, generated);
      }
    }
    
    // Also cache the full result for quick lookup
    if (chunkResults.length > 0 && useCache) {
      await audioCache.set(text, chunkResults[0]); // Store first chunk as full text marker
    }
    
    return chunkResults;
  }
  
  // ... rest of existing code
};
```

**Benefits:**
- ✅ Reuse common phrases across different texts
- ✅ Reduce API calls by 20-40% (depending on text similarity)
- ✅ Faster generation when chunks are cached
- ✅ Works automatically - no code changes needed in UI

**Trade-offs:**
- ⚠️ More cache entries (one per chunk + one per full text)
- ⚠️ Slightly more complex cache lookup logic
- ⚠️ Need to handle partial cache hits (some chunks cached, some not)

---

## 2. Batch Requests — Share Identical Requests Across Users

### Current Problem

**Current behavior:**
```typescript
// User A requests: "Thank you for sharing your thoughts."
// User B requests: "Thank you for sharing your thoughts." (same text, 5 seconds later)

// Result: TWO separate API calls (waste!)
```

**Issue:** `pendingTTSRequests` only works within a single browser session. Multiple users (or even the same user in different tabs) make duplicate API calls for identical text.

### Solution: Server-Side Request Batching

**Concept:** When multiple users request the same text within a short time window, share the API call and return the same result to all.

**How it works:**

```typescript
// Server-side (app/api/tts/route.ts)

// In-memory cache of pending requests (shared across all users)
const pendingServerRequests = new Map<string, Promise<string>>();

export async function POST(request: NextRequest) {
  const { text } = await request.json();
  const normalizedText = normalizeTextForCache(text);
  
  // Check if there's already a pending request for this exact text
  const existingRequest = pendingServerRequests.get(normalizedText);
  
  if (existingRequest) {
    // ✅ Another user is already generating this - wait for their result
    log.info('Batch request: sharing existing generation', { text: text.substring(0, 50) });
    try {
      const result = await existingRequest;
      return NextResponse.json({ audioData: result });
    } catch (error) {
      // If the shared request failed, remove it and continue to generate
      pendingServerRequests.delete(normalizedText);
    }
  }
  
  // Check cache first (database or Redis)
  const cached = await checkServerCache(normalizedText);
  if (cached) {
    return NextResponse.json({ audioData: cached });
  }
  
  // Create new request and share it
  const generationPromise = generateTTSFromAPI(normalizedText)
    .then(result => {
      // Save to cache
      await saveToServerCache(normalizedText, result);
      // Remove from pending (but keep in cache)
      pendingServerRequests.delete(normalizedText);
      return result;
    })
    .catch(error => {
      // Remove from pending on error
      pendingServerRequests.delete(normalizedText);
      throw error;
    });
  
  // Store promise so other requests can share it
  pendingServerRequests.set(normalizedText, generationPromise);
  
  try {
    const result = await generationPromise;
    return NextResponse.json({ audioData: result });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
```

**Example Scenario:**

```
Time 0s:  User A requests "I feel grateful today."
          → Starts API call, stores promise in pendingServerRequests

Time 2s:  User B requests "I feel grateful today." (same text)
          → Finds existing promise, waits for User A's result
          → NO API call made! ✅

Time 3s:  User A's API call completes
          → Returns result to User A
          → Returns same result to User B (who was waiting)
          → Saves to cache
          → Removes from pendingServerRequests

Result: 1 API call served 2 users (50% reduction)
```

**Implementation with Database Cache:**

```typescript
// app/api/tts/route.ts

// Server-side cache (shared across all users)
const pendingServerRequests = new Map<string, Promise<string>>();

async function checkServerCache(text: string): Promise<string | null> {
  // Option 1: Database (Supabase)
  const { data } = await supabase
    .from('tts_cache')
    .select('audio_data')
    .eq('text_hash', hashText(text))
    .single();
  
  return data?.audio_data || null;
  
  // Option 2: Redis (if available)
  // return await redis.get(`tts:${hashText(text)}`);
}

async function saveToServerCache(text: string, audioData: string): Promise<void> {
  // Save to database
  await supabase
    .from('tts_cache')
    .upsert({
      text_hash: hashText(text),
      audio_data: audioData,
      created_at: new Date().toISOString(),
    });
}

export async function POST(request: NextRequest) {
  const { text } = await request.json();
  const normalizedText = normalizeTextForCache(text);
  const textHash = hashText(normalizedText);
  
  // 1. Check server-side cache (database/Redis)
  const cached = await checkServerCache(normalizedText);
  if (cached) {
    return NextResponse.json({ audioData: cached });
  }
  
  // 2. Check if another request is already generating this
  const pending = pendingServerRequests.get(textHash);
  if (pending) {
    log.info('Batch: sharing request', { text: normalizedText.substring(0, 50) });
    try {
      const result = await pending;
      return NextResponse.json({ audioData: result });
    } catch (error) {
      pendingServerRequests.delete(textHash);
      // Continue to generate below
    }
  }
  
  // 3. Check daily limit BEFORE generating
  const limitCheck = await checkDailyLimit();
  if (!limitCheck.allowed) {
    return NextResponse.json({
      error: 'Daily limit reached',
      message: limitCheck.message,
    }, { status: 429 });
  }
  
  // 4. Generate and share with other pending requests
  const generationPromise = (async () => {
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview-tts',
      contents: [{ parts: [{ text: `Speak warmly and gently: ${normalizedText}` }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: 'Kore' },
          },
        },
      },
    });
    
    const audioData = extractBase64Audio(response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data);
    
    // Save to cache
    await saveToServerCache(normalizedText, audioData);
    
    // Increment daily counter
    await incrementDailyUsage();
    
    return audioData;
  })();
  
  // Store promise for other requests to share
  pendingServerRequests.set(textHash, generationPromise);
  
  try {
    const result = await generationPromise;
    pendingServerRequests.delete(textHash); // Clean up
    return NextResponse.json({ audioData: result });
  } catch (error) {
    pendingServerRequests.delete(textHash); // Clean up on error
    throw error;
  }
}
```

**Benefits:**
- ✅ Multiple users share same API call (huge savings with multiple users)
- ✅ Works across browser sessions/tabs
- ✅ Reduces server load
- ✅ Faster response for users who "join" an in-progress generation

**Trade-offs:**
- ⚠️ Requires server-side cache (database or Redis)
- ⚠️ Memory usage for pending requests (should expire after timeout)
- ⚠️ Need to handle cleanup of stale pending requests

**Cleanup Strategy:**
```typescript
// Clean up pending requests after 30 seconds (in case of errors)
setTimeout(() => {
  pendingServerRequests.delete(textHash);
}, 30000);
```

---

## 3. Fallback Options — Browser TTS or Alternative Services

### Current Problem

**Current behavior:**
```typescript
// API call fails (rate limit, network error, etc.)
// → User sees error message
// → No audio available
```

**Issue:** When Gemini TTS quota is exhausted or API fails, users have no audio option.

### Solution: Multi-Tier Fallback System

**Concept:** Try primary service first, then fall back to alternatives in order of preference.

**Fallback Priority:**
1. **Gemini TTS** (primary - best quality)
2. **Browser TTS** (Web Speech API - free, always available)
3. **Alternative TTS Service** (e.g., Google Cloud TTS, AWS Polly - if configured)

### Option A: Browser TTS Fallback (Web Speech API)

**How it works:**

```typescript
// app/services/ttsFallback.ts

/**
 * Browser TTS using Web Speech API
 * Note: This generates audio in real-time, quality may vary by browser
 */
export async function generateSpeechBrowserTTS(text: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      reject(new Error('Browser TTS not available'));
      return;
    }
    
    // Clean text for TTS
    const cleaned = cleanTextForTTS(text);
    
    // Create speech utterance
    const utterance = new SpeechSynthesisUtterance(cleaned);
    
    // Configure voice (try to find a good one)
    const voices = speechSynthesis.getVoices();
    const preferredVoice = voices.find(v => 
      v.lang.startsWith('en') && 
      (v.name.includes('Google') || v.name.includes('Natural') || v.name.includes('Enhanced'))
    ) || voices.find(v => v.lang.startsWith('en')) || voices[0];
    
    if (preferredVoice) {
      utterance.voice = preferredVoice;
      utterance.rate = 0.9; // Slightly slower for clarity
      utterance.pitch = 1.0;
      utterance.volume = 1.0;
    }
    
    // Convert to audio blob (requires MediaRecorder API)
    // Note: This is complex - browser TTS doesn't directly give us audio data
    // We'd need to use MediaRecorder to capture the audio stream
    
    // Simple approach: Just play it (no audio data returned)
    utterance.onend = () => resolve('browser-tts-played');
    utterance.onerror = (error) => reject(error);
    
    speechSynthesis.speak(utterance);
  });
}

/**
 * Advanced: Capture browser TTS as audio blob
 * This is more complex and requires MediaRecorder
 */
export async function generateSpeechBrowserTTSAsBlob(text: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined') {
      reject(new Error('Browser API not available'));
      return;
    }
    
    // This requires:
    // 1. Create AudioContext
    // 2. Use MediaRecorder to capture speechSynthesis output
    // 3. Convert to base64
    
    // Implementation is complex - see below for alternative approach
    reject(new Error('Browser TTS blob capture not yet implemented'));
  });
}
```

**Limitation:** Web Speech API doesn't directly return audio data - it only plays audio. To get audio data, you'd need to:
1. Use `MediaRecorder` to capture audio stream (complex)
2. Or just play it directly (simpler, but no audio data to store)

**Simpler Approach - Direct Playback:**

```typescript
// In JournalApp.tsx
async function playAudioWithFallback(text: string) {
  try {
    // Try Gemini TTS first
    const audio = await generateSpeech(text);
    if (audio) {
      playAudio(audio, 'main');
      return;
    }
  } catch (error) {
    if (error.message.includes('rate limit') || error.message.includes('quota')) {
      // Fallback to browser TTS
      log.info('Gemini TTS unavailable, using browser TTS fallback');
      playBrowserTTS(text);
      return;
    }
    throw error;
  }
}

function playBrowserTTS(text: string) {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    showToast('TTS not available in this browser', 'error');
    return;
  }
  
  const utterance = new SpeechSynthesisUtterance(cleanTextForTTS(text));
  const voices = speechSynthesis.getVoices();
  const voice = voices.find(v => v.lang.startsWith('en')) || voices[0];
  if (voice) utterance.voice = voice;
  
  speechSynthesis.speak(utterance);
}
```

### Option B: Alternative TTS Service Fallback

**How it works:**

```typescript
// app/services/ttsService.ts

interface TTSService {
  name: string;
  generate(text: string): Promise<string>;
  isAvailable(): Promise<boolean>;
}

class GeminiTTSService implements TTSService {
  name = 'Gemini TTS';
  
  async isAvailable(): Promise<boolean> {
    const usage = await checkDailyUsage();
    return usage.count < 70; // Check if under limit
  }
  
  async generate(text: string): Promise<string> {
    // Existing Gemini TTS implementation
    const response = await fetch('/api/tts', {
      method: 'POST',
      body: JSON.stringify({ text }),
    });
    const data = await response.json();
    return data.audioData;
  }
}

class GoogleCloudTTSService implements TTSService {
  name = 'Google Cloud TTS';
  
  async isAvailable(): Promise<boolean> {
    // Check if API key is configured
    return !!process.env.GOOGLE_CLOUD_TTS_API_KEY;
  }
  
  async generate(text: string): Promise<string> {
    // Use Google Cloud TTS API
    const response = await fetch('https://texttospeech.googleapis.com/v1/text:synthesize', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GOOGLE_CLOUD_TTS_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        input: { text },
        voice: { languageCode: 'en-US', name: 'en-US-Wavenet-D' },
        audioConfig: { audioEncoding: 'MP3' },
      }),
    });
    const data = await response.json();
    return data.audioContent; // Base64 encoded
  }
}

class BrowserTTSService implements TTSService {
  name = 'Browser TTS';
  
  async isAvailable(): Promise<boolean> {
    return typeof window !== 'undefined' && 'speechSynthesis' in window;
  }
  
  async generate(text: string): Promise<string> {
    // Browser TTS - just plays, doesn't return audio data
    return new Promise((resolve) => {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.onend = () => resolve('played');
      speechSynthesis.speak(utterance);
    });
  }
}

// Fallback chain
const TTS_SERVICES: TTSService[] = [
  new GeminiTTSService(),
  new GoogleCloudTTSService(), // If configured
  new BrowserTTSService(), // Always available
];

export async function generateSpeechWithFallback(text: string): Promise<string> {
  for (const service of TTS_SERVICES) {
    const available = await service.isAvailable();
    if (!available) {
      log.debug(`TTS service ${service.name} not available, trying next...`);
      continue;
    }
    
    try {
      log.info(`Using TTS service: ${service.name}`);
      const result = await service.generate(text);
      return result;
    } catch (error) {
      log.warn(`TTS service ${service.name} failed:`, error);
      // Try next service
      continue;
    }
  }
  
  throw new Error('All TTS services unavailable');
}
```

**Benefits:**
- ✅ Always have audio option (even when quota exhausted)
- ✅ Better user experience (no "TTS unavailable" errors)
- ✅ Flexible - can add more services easily

**Trade-offs:**
- ⚠️ Browser TTS quality varies by browser/OS
- ⚠️ Alternative services may cost money
- ⚠️ Browser TTS doesn't return audio data (only plays)

---

## Implementation Priority

### Recommended Order:

1. **Chunk Caching** (Easiest, High Impact)
   - ✅ No external dependencies
   - ✅ Works with existing IndexedDB cache
   - ✅ Immediate 20-40% reduction in API calls
   - ⏱️ Implementation: 2-3 hours

2. **Batch Requests** (Medium Complexity, High Impact with Multiple Users)
   - ✅ Requires server-side cache (database)
   - ✅ Huge savings if multiple users
   - ⏱️ Implementation: 4-6 hours

3. **Fallback Options** (Lower Priority, Better UX)
   - ✅ Browser TTS is free but limited
   - ✅ Alternative services cost money
   - ⏱️ Implementation: 3-4 hours

---

## Combined Example

```typescript
// Ultimate TTS function with all optimizations

export async function generateSpeechOptimized(text: string): Promise<string | string[]> {
  // 1. Check full text cache
  const fullCached = await audioCache.get(text);
  if (fullCached) return fullCached;
  
  // 2. If chunked, check chunk cache
  const chunks = chunkTextForTTS(text);
  if (chunks.length > 1) {
    const chunkResults: string[] = [];
    const missingChunks: string[] = [];
    
    for (const chunk of chunks) {
      const cached = await audioCache.get(chunk);
      if (cached) {
        chunkResults.push(cached);
      } else {
        missingChunks.push(chunk);
      }
    }
    
    // Generate only missing chunks (with server-side batching)
    for (const chunk of missingChunks) {
      try {
        const audio = await generateSpeechChunk(chunk); // Server handles batching
        chunkResults.push(audio);
        await audioCache.set(chunk, audio);
      } catch (error) {
        // Fallback to browser TTS for this chunk
        log.warn('API failed, using browser TTS fallback for chunk');
        await playBrowserTTS(chunk);
      }
    }
    
    return chunkResults;
  }
  
  // 3. Single chunk - try API with fallback
  try {
    const audio = await generateSpeechChunk(text);
    await audioCache.set(text, audio);
    return audio;
  } catch (error) {
    if (error.message.includes('rate limit') || error.message.includes('quota')) {
      // Fallback to browser TTS
      await playBrowserTTS(text);
      return 'browser-tts-played';
    }
    throw error;
  }
}
```

This combines all three optimizations for maximum efficiency! 🚀

