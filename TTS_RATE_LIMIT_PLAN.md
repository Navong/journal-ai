# TTS Rate Limit Management Plan
## Handling 70 requests/day for gemini-3-flash-preview-tts

### Current Situation
- **Rate Limit**: 70 requests per day (very restrictive)
- **Current Model**: `gemini-2.5-flash-preview-tts` (should update to `gemini-3-flash-preview-tts`)
- **Existing Protections**: 
  - IndexedDB caching (client-side)
  - Supabase audio storage (persistent)
  - Request deduplication
  - Basic per-minute rate limiting (30/min)

### Problem Analysis
With 70 requests/day:
- **Average**: ~2.9 requests/hour
- **Heavy user**: Could exhaust quota in 1-2 hours
- **Multiple users**: Shared quota across all users
- **No daily tracking**: Current system only tracks per-minute limits

---

## Implementation Plan

### Phase 1: Daily Usage Tracking & Enforcement (Priority: HIGH)

#### 1.1 Server-Side Daily Counter
**File**: `app/api/tts/route.ts`

**Implementation**:
- Track daily usage per API key (shared across all users)
- Use persistent storage (database or Redis) to track:
  - Date (YYYY-MM-DD)
  - Count of requests
  - Reset at midnight UTC
- Check before each request
- Return 429 with clear message when limit reached

**Code Structure**:
```typescript
interface DailyUsage {
  date: string; // YYYY-MM-DD
  count: number;
  lastReset: number; // timestamp
}

// Check daily limit before processing
const dailyUsage = await getDailyUsage();
if (dailyUsage.count >= 70) {
  const hoursUntilReset = calculateHoursUntilMidnight();
  return NextResponse.json({
    error: 'Daily TTS limit reached',
    message: `TTS quota exhausted. Resets in ${hoursUntilReset} hours.`,
    resetAt: getMidnightTimestamp(),
  }, { status: 429 });
}
```

#### 1.2 Database Schema (if using Supabase)
```sql
CREATE TABLE tts_daily_usage (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  date DATE NOT NULL UNIQUE,
  count INTEGER DEFAULT 0,
  last_request_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_tts_usage_date ON tts_daily_usage(date);
```

#### 1.3 Alternative: In-Memory with Persistence
If no database available:
- Use file-based storage (`tts-usage.json`)
- Or environment variable with daily reset script
- Or Redis with TTL

---

### Phase 2: Smart Caching & Request Optimization (Priority: HIGH)

#### 2.1 Enhanced Cache Strategy
**Current**: IndexedDB + Supabase
**Enhancement**: 
- **Pre-check all caches** before API call
- **Cache warming**: Pre-generate TTS for new reflections (background)
- **Cache persistence**: Ensure audio survives browser refresh

**Implementation**:
```typescript
// In generateSpeech function
async function generateSpeech(text: string) {
  // 1. Check IndexedDB (instant)
  const indexedDBCache = await audioCache.get(text);
  if (indexedDBCache) return indexedDBCache;
  
  // 2. Check Supabase (for history entries)
  const supabaseCache = await checkSupabaseCache(text);
  if (supabaseCache) {
    // Also save to IndexedDB for faster future access
    await audioCache.set(text, supabaseCache);
    return supabaseCache;
  }
  
  // 3. Check if we're at daily limit BEFORE making API call
  const limitCheck = await checkDailyLimit();
  if (!limitCheck.allowed) {
    throw new Error(`Daily TTS limit reached. ${limitCheck.message}`);
  }
  
  // 4. Generate (only if cache miss AND under limit)
  return await generateFromAPI(text);
}
```

#### 2.2 Text Normalization for Better Cache Hits
**Current**: Basic cleaning
**Enhancement**: 
- Normalize whitespace
- Remove punctuation variations
- Case-insensitive matching
- Handle markdown variations

```typescript
function normalizeTextForCache(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.,!?;:]/g, '')
    .trim();
}
```

#### 2.3 Chunking Optimization
**Current**: Chunks at 1500 chars
**Enhancement**:
- **Smart chunking**: Split at sentence boundaries
- **Cache chunks individually**: Reuse chunks across different texts
- **Merge cached chunks**: Combine cached chunks instead of regenerating

---

### Phase 3: User Experience & Feedback (Priority: MEDIUM)

#### 3.1 Usage Indicator
**UI Component**: Show TTS quota status

```typescript
// In JournalApp.tsx
const [ttsUsage, setTtsUsage] = useState({ used: 0, limit: 70, resetAt: null });

// Fetch usage on mount
useEffect(() => {
  fetch('/api/tts/usage').then(r => r.json()).then(setTtsUsage);
}, []);

// Display in UI
{ttsUsage.used > 50 && (
  <div className="tts-warning">
    TTS quota: {ttsUsage.used}/70 ({Math.round((ttsUsage.used/70)*100)}% used)
  </div>
)}
```

#### 3.2 Graceful Degradation
**When limit reached**:
- Show clear message: "TTS quota exhausted for today"
- Offer alternatives:
  - "Use cached audio from previous sessions"
  - "Try again tomorrow"
  - "Upgrade plan" (if applicable)
- Disable TTS button or show disabled state

#### 3.3 Request Prioritization
**Priority levels**:
1. **High**: User explicitly clicks "Play Audio" button
2. **Medium**: Auto-generate after reflection (background)
3. **Low**: Pre-generate for history entries

**Implementation**:
```typescript
interface TTSRequest {
  text: string;
  priority: 'high' | 'medium' | 'low';
  userId: string;
}

// Queue system with priority
class TTSQueue {
  async enqueue(request: TTSRequest) {
    if (request.priority === 'high') {
      // Check limit, generate immediately
    } else {
      // Queue for later, check limit periodically
    }
  }
}
```

---

### Phase 4: Request Reduction Strategies (Priority: MEDIUM)

#### 4.1 Batch Similar Requests
**Strategy**: Group similar texts and generate once

```typescript
// If multiple users request same text within short window
const pendingRequests = new Map<string, Promise<string>>();

async function generateSpeech(text: string) {
  const normalized = normalizeTextForCache(text);
  const existing = pendingRequests.get(normalized);
  if (existing) {
    return existing; // Share the same request
  }
  
  const promise = generateFromAPI(text);
  pendingRequests.set(normalized, promise);
  return promise;
}
```

#### 4.2 Lazy Generation
**Strategy**: Only generate TTS when user explicitly requests it

**Changes**:
- Remove auto-generation after reflection
- Add "Generate Audio" button
- Generate on-demand only

#### 4.3 Text Length Limits
**Strategy**: Limit TTS generation to reasonable lengths

```typescript
const MAX_TTS_LENGTH = 5000; // characters

if (text.length > MAX_TTS_LENGTH) {
  // Option 1: Truncate with ellipsis
  text = text.substring(0, MAX_TTS_LENGTH) + '...';
  
  // Option 2: Only generate first N sentences
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [];
  text = sentences.slice(0, 10).join(' '); // First 10 sentences
}
```

---

### Phase 5: Fallback & Alternative Solutions (Priority: LOW)

#### 5.1 Browser TTS Fallback
**When quota exhausted**: Use Web Speech API

```typescript
function generateSpeechFallback(text: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.voice = /* select best available voice */;
    
    // Convert to audio blob (if possible)
    // Note: Browser TTS quality may be lower
    resolve(/* audio data */);
  });
}
```

#### 5.2 Alternative TTS Service
**Options**:
- Google Cloud Text-to-Speech (paid, higher limits)
- AWS Polly (paid, higher limits)
- ElevenLabs (paid, high quality)
- OpenAI TTS (paid, good quality)

**Implementation**: Service abstraction layer

```typescript
interface TTSService {
  generate(text: string): Promise<string>;
  getQuota(): Promise<{ used: number; limit: number }>;
}

class GeminiTTSService implements TTSService { /* ... */ }
class GoogleCloudTTSService implements TTSService { /* ... */ }
class FallbackTTSService implements TTSService { /* ... */ }
```

#### 5.3 Multi-API Key Rotation
**If multiple API keys available**:
- Rotate keys when one hits limit
- Track usage per key
- Load balance across keys

---

## Implementation Priority

### Week 1 (Critical)
1. ✅ Daily usage tracking (database/file-based)
2. ✅ Daily limit enforcement (429 response)
3. ✅ Usage indicator in UI
4. ✅ Enhanced cache checking (all layers before API call)

### Week 2 (Important)
5. ✅ Text normalization for better cache hits
6. ✅ Request prioritization (high/medium/low)
7. ✅ Graceful degradation UI
8. ✅ Remove auto-generation, make it on-demand

### Week 3 (Optimization)
9. ✅ Batch similar requests
10. ✅ Text length limits
11. ✅ Chunking optimization with chunk caching

### Week 4+ (Future)
12. ⏳ Browser TTS fallback
13. ⏳ Alternative TTS service integration
14. ⏳ Multi-API key rotation

---

## Monitoring & Alerts

### Metrics to Track
1. **Daily usage**: Count per day
2. **Cache hit rate**: % of requests served from cache
3. **Average requests per user**: Identify heavy users
4. **Peak usage times**: When quota is consumed fastest
5. **Failed requests**: Due to rate limits

### Alerts
- **Warning**: 50/70 requests used (71% quota)
- **Critical**: 65/70 requests used (93% quota)
- **Exhausted**: 70/70 requests used (100% quota)

### Logging
```typescript
console.log('[TTS] Daily usage:', {
  date: '2024-01-15',
  count: 45,
  remaining: 25,
  cacheHitRate: '78%',
  avgRequestsPerUser: 2.3
});
```

---

## Testing Strategy

### Unit Tests
- Daily limit enforcement logic
- Cache hit/miss scenarios
- Text normalization
- Chunking logic

### Integration Tests
- API endpoint with daily limit
- Cache layer interactions
- Error handling when limit reached

### Load Tests
- Simulate 70+ requests in one day
- Verify limit enforcement
- Test cache effectiveness

---

## Rollout Plan

### Phase 1: Backend (No UI changes)
1. Deploy daily tracking
2. Deploy limit enforcement
3. Monitor for 2-3 days
4. Verify cache hit rates

### Phase 2: UI Updates
1. Add usage indicator
2. Add graceful degradation
3. Remove auto-generation
4. User testing

### Phase 3: Optimization
1. Text normalization
2. Request prioritization
3. Chunking optimization
4. Performance monitoring

---

## Success Metrics

### Target Goals
- **Cache hit rate**: >80% (reduces API calls by 80%)
- **Daily API calls**: <30 (well under 70 limit)
- **User satisfaction**: No complaints about TTS availability
- **Error rate**: <1% due to rate limits

### Monitoring Dashboard
Track:
- Daily usage graph
- Cache hit rate over time
- Requests per user distribution
- Peak usage hours

---

## Code Changes Summary

### Files to Modify
1. `app/api/tts/route.ts` - Add daily tracking & limit enforcement
2. `app/services/geminiService.ts` - Enhanced cache checking
3. `app/components/JournalApp.tsx` - Usage indicator, remove auto-gen
4. `app/utils/audioCache.ts` - Text normalization

### New Files
1. `app/utils/ttsUsageTracker.ts` - Daily usage tracking logic
2. `app/components/TTSUsageIndicator.tsx` - UI component
3. `app/api/tts/usage/route.ts` - Usage endpoint

### Database Changes
- Add `tts_daily_usage` table (if using Supabase)
- Or use file-based storage for simple deployment

---

## Risk Mitigation

### Risks
1. **Quota exhausted early in day**: Implement request prioritization
2. **Cache misses**: Improve normalization and caching strategy
3. **User frustration**: Clear messaging and graceful degradation
4. **Multiple users**: Shared quota requires careful management

### Mitigation
1. Monitor usage patterns and adjust limits/strategies
2. Implement aggressive caching
3. Provide clear feedback and alternatives
4. Consider per-user quotas if multiple users

---

## Next Steps

1. **Immediate**: Implement daily tracking (Phase 1.1)
2. **This week**: Deploy limit enforcement + UI updates
3. **Next week**: Optimize caching and request handling
4. **Ongoing**: Monitor usage and adjust strategies

---

## Questions to Consider

1. **Single user or multi-user?** 
   - If single user: 70/day might be sufficient with good caching
   - If multi-user: Need per-user quotas or shared pool management

2. **Budget for alternative services?**
   - If yes: Can add fallback TTS services
   - If no: Must optimize current usage

3. **Priority of TTS feature?**
   - High: Invest in optimization and fallbacks
   - Low: Make it optional/on-demand only

4. **Database available?**
   - Yes: Use database for daily tracking
   - No: Use file-based or in-memory with persistence

