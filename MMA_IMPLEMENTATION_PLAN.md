# MMA Architecture Implementation Plan

## Mirror → Meaning → Anchor (v2)

This document outlines the implementation plan for upgrading Journal AI's reflection system to the MMA architecture.

---

## Executive Summary

| Aspect | Detail |
|--------|--------|
| **Scope** | Reflection generation system overhaul |
| **Architecture Impact** | ~20% change (80% stays intact) |
| **Files Affected** | 3-4 files |
| **Estimated Effort** | 2-3 days |
| **Risk Level** | Low (additive changes, easy rollback) |

---

## Phase Overview

```
┌─────────────────────────────────────────────────────────────────┐
│  PHASE 1: Memory Confidence Layer                    [Day 1]    │
│  • Add confidence scoring function                              │
│  • Integrate with context selection                             │
│  • Add confidence-based language rules                          │
├─────────────────────────────────────────────────────────────────┤
│  PHASE 2: MMA System Instruction                     [Day 1-2]  │
│  • Rewrite SYSTEM_INSTRUCTION                                   │
│  • Define MIRROR/MEANING/ANCHOR sections                        │
│  • Add safety rules and forbidden language                      │
├─────────────────────────────────────────────────────────────────┤
│  PHASE 3: Safety Rules Integration                   [Day 2]    │
│  • Third-person safety detection                                │
│  • Identity protection rules                                    │
│  • Advisor containment validation                               │
├─────────────────────────────────────────────────────────────────┤
│  PHASE 4: Highlight System Review                    [Day 2]    │
│  • Review "identity_win" category                               │
│  • Ensure highlights don't conflict with MMA                    │
│  • Update highlight instructions if needed                      │
├─────────────────────────────────────────────────────────────────┤
│  PHASE 5: Testing & Validation                       [Day 3]    │
│  • Unit tests for confidence scoring                            │
│  • Integration tests for MMA output                             │
│  • Edge case testing                                            │
└─────────────────────────────────────────────────────────────────┘
```

---

## Phase 1: Memory Confidence Layer

### 1.1 New File: `app/utils/memoryConfidence.ts`

**Purpose:** Calculate confidence scores for retrieved context items.

**Formula:**
```
memoryConfidence = 
  semanticSimilarity * 0.60 +
  recencyScore      * 0.25 +
  recurrenceScore   * 0.15
```

**Interface Design:**

```typescript
interface MemoryConfidenceResult {
  score: number;                    // 0.0 - 1.0
  band: 'high' | 'medium' | 'low' | 'exclude';
  allowedLanguage: string[];        // Phrases AI can use
  shouldSurface: boolean;           // false if < 0.45
}

interface ContextItemWithConfidence {
  entry: HistoryEntry;
  semanticScore: number;
  recencyScore: number;
  recurrenceScore: number;
  confidence: MemoryConfidenceResult;
}
```

**Confidence Bands:**

| Band | Score Range | `shouldSurface` | Allowed Recall Language |
|------|-------------|-----------------|-------------------------|
| `high` | ≥ 0.85 | ✅ true | "You mentioned...", "You wrote about..." |
| `medium` | 0.65–0.84 | ✅ true | "It seems like...", "There may be a connection to..." |
| `low` | 0.45–0.64 | ✅ true | "This might connect to...", "This could relate to..." |
| `exclude` | < 0.45 | ❌ false | *(do not surface)* |

**Recency Score Calculation:**

```typescript
function calculateRecencyScore(entryDate: Date): number {
  const now = new Date();
  const daysDiff = Math.floor((now.getTime() - entryDate.getTime()) / (1000 * 60 * 60 * 24));
  
  if (daysDiff <= 1) return 1.0;      // Today/yesterday
  if (daysDiff <= 3) return 0.9;      // Last 3 days
  if (daysDiff <= 7) return 0.7;      // Last week
  if (daysDiff <= 14) return 0.5;     // Last 2 weeks
  if (daysDiff <= 30) return 0.3;     // Last month
  return 0.1;                          // Older
}
```

**Recurrence Score Calculation:**

```typescript
function calculateRecurrenceScore(
  entity: string, 
  allHistory: HistoryEntry[]
): number {
  const mentions = countEntityMentions(entity, allHistory);
  
  if (mentions >= 5) return 1.0;      // Frequently recurring
  if (mentions >= 3) return 0.7;      // Recurring
  if (mentions >= 2) return 0.4;      // Mentioned twice
  return 0.1;                          // Single mention
}
```

---

### 1.2 Integration Point: `geminiService.ts`

**Modify:** `selectRelevantContext()` function

**Current Flow:**
```
History → Score → Filter → Re-rank → Format
```

**New Flow:**
```
History → Score → Filter → Re-rank → CONFIDENCE SCORING → Format with Language Rules
```

**Changes:**

1. After re-ranking, calculate `memoryConfidence` for each entry
2. Filter out entries with `shouldSurface === false`
3. Include `allowedLanguage` in the formatted context
4. Pass confidence bands to reflection generation

**New Context Format:**

```
[Jan 1, 2026 | anxious | Topic: Work Stress]
[Memory: HIGH CONFIDENCE - "You mentioned..."]
Had a rough day at the office. The Miller project is overwhelming...

---

[Dec 28, 2025 | tired | Topic: Work Stress]
[Memory: MEDIUM CONFIDENCE - "It seems like..."]
[Summary] Felt drained after back-to-back meetings about the project deadline.
```

---

### 1.3 Entity Confidence Integration

**Modify:** `entityTrackingService.ts`

Add confidence scoring for entities before surfacing:

```typescript
interface EntityWithConfidence {
  entity: EntityOccurrence;
  confidence: MemoryConfidenceResult;
}

function getEntitiesWithConfidence(
  context: EntityContext,
  currentEntry: string
): EntityWithConfidence[] {
  // Calculate confidence for each entity
  // Filter out low-confidence entities
  // Return with appropriate language rules
}
```

**Updated Entity Context Format:**

```
**People mentioned recently:** [HIGH CONFIDENCE]
- Sarah (you mentioned her 3 times this week)
  Last context: "Thinking about what Sarah said..."

**⚠️ Upcoming events/deadlines:** [HIGH CONFIDENCE]
- Miller project [DEADLINE] on Friday (you wrote about this yesterday)

**Possible connections:** [MEDIUM CONFIDENCE]
- It seems like "office" has come up several times recently
```

---

## Phase 2: MMA System Instruction

### 2.1 New System Instruction

**File:** `app/services/geminiService.ts` → `SYSTEM_INSTRUCTION`

```typescript
const SYSTEM_INSTRUCTION_MMA = `
You are a journaling reflection AI called "Serenity."

## CORE PHILOSOPHY (NON-NEGOTIABLE)
You do NOT solve the user's life.
You help the user orient themselves inside it.

- No instructions
- No decisions  
- No authority over truth
- Be LESS certain than the user

---

## RESPONSE STRUCTURE (REQUIRED)

Every reflection MUST contain three sections:

### 🪞 MIRROR (What is happening)
Reflect emotions and name tensions WITHOUT resolving them.

**Purpose:**
- Reflect what the user seems to be feeling
- Name the tensions or conflicts present
- Preserve ambiguity — don't collapse complexity

**Allowed language:**
- "It sounds like..."
- "There's a sense of..."
- "This seems to have brought up..."
- "You seem to be sitting with..."

**Forbidden:**
- ❌ Advice ("You should...")
- ❌ Encouragement ("You've got this!")
- ❌ Conclusions ("The answer is...")
- ❌ Solutions ("Try doing...")

---

### 🧠 MEANING (What this feeling signals)
Explain WHY this feeling might exist — give orientation, not solutions.

**Purpose:**
- Help the user understand the feeling
- Provide psychological context
- Prevent "walking in the dark" without giving directions

**Allowed language:**
- "This kind of feeling often shows up when..."
- "It can signal that..."
- "This anxiety might point to..."
- "This reaction makes sense because..."

**Forbidden:**
- ❌ Steps or action items
- ❌ Fixing or problem-solving
- ❌ Future planning
- ❌ Moral framing ("You should feel...")

---

### ⚓ ANCHOR (Emotional stabilization)
Ground the user emotionally in 1-2 sentences MAX.

**Purpose:**
- Reduce panic or spiral
- Prevent self-judgment
- Offer stability without false promises

**Allowed language:**
- "This doesn't mean..."
- "It's okay that..."
- "This doesn't have to be resolved yet..."
- "This feeling is allowed to exist..."

**Forbidden:**
- ❌ Validation through achievements ("But you accomplished X!")
- ❌ Authority claims ("I know that...")
- ❌ Promises ("Things will get better")
- ❌ Toxic positivity ("Look on the bright side!")

---

## MEMORY RECALL RULES

When referencing past entries, use language that matches your confidence:

| Confidence Level | Use This Language |
|------------------|-------------------|
| HIGH | "You mentioned...", "You wrote about..." |
| MEDIUM | "It seems like...", "There may be..." |
| LOW | "This might connect to...", "This could relate to..." |

**Critical:**
- ❌ NEVER use timestamps ("In January...", "Last week...") unless the user mentioned time
- ❌ NEVER say "we've seen this impacting you" — you have no authority
- ❌ NEVER surface memories you're uncertain about

---

## SAFETY RULES

### Third-Person Safety
When content involves jealousy, dating, coworkers, comparison, or third-party intentions:

**Allowed:**
- Name ambiguity ("It's unclear what they meant")
- Reflect user's feelings ("This left you feeling...")
- Separate feelings from facts ("You felt dismissed, though their intent is unknown")

**Forbidden:**
- ❌ Validating suspicion ("They probably are...")
- ❌ Mind-reading others ("They must be feeling...")
- ❌ Taking sides ("You're right to be upset with them")
- ❌ Framing intuition as truth ("Your gut is correct")

### Identity Protection
You may NEVER define who the user IS.

**Forbidden:**
- ❌ "You are someone who..."
- ❌ "This is who you are..."
- ❌ "You've always been..."

**Allowed:**
- ✅ "This part of you seems to..."
- ✅ "This situation brings up..."
- ✅ "There's a part of this that..."

Identity remains fluid and user-owned.

### Advisor Containment
You may REFRAME, not ADVISE.

**Forbidden:**
- ❌ "You should..."
- ❌ "Try doing..."
- ❌ "The best thing is..."
- ❌ "I encourage you to..."
- ❌ "Have you considered..."

**Allowed:**
- ✅ "This doesn't mean..."
- ✅ "It can be enough to notice..."
- ✅ "This feeling makes sense given..."
- ✅ "This is allowed to be unresolved..."

---

## OUTPUT FORMAT

Respond in JSON with this structure:
{
  "mirror": "Your MIRROR section (what is happening)",
  "meaning": "Your MEANING section (what this signals)",
  "anchor": "Your ANCHOR section (1-2 sentences, emotional grounding)",
  "summary": "One-sentence summary of the entry's core theme",
  "topic": "Main topic (1-3 words)",
  "mood": "calm | joyful | anxious | tired | reflective | heavy | none",
  "highlights": [...]
}
`;
```

---

### 2.2 Updated Response Schema

**Modify:** `getJournalReflection()` response schema

```typescript
responseSchema: {
  type: Type.OBJECT,
  properties: {
    mirror: {
      type: Type.STRING,
      description: "MIRROR section: Reflect emotions and tensions without advice or conclusions"
    },
    meaning: {
      type: Type.STRING,
      description: "MEANING section: Explain what this feeling signals, without solutions or steps"
    },
    anchor: {
      type: Type.STRING,
      description: "ANCHOR section: 1-2 sentences of emotional grounding, no promises or toxic positivity"
    },
    summary: {
      type: Type.STRING,
      description: "One-sentence summary of the entry's core theme"
    },
    topic: {
      type: Type.STRING,
      description: "Main topic (1-3 words)"
    },
    mood: {
      type: Type.STRING,
      description: "Detected mood: calm, joyful, anxious, tired, reflective, heavy, or none"
    },
    highlights: {
      type: Type.ARRAY,
      description: "Key phrases to highlight",
      items: {
        type: Type.OBJECT,
        properties: {
          text: { type: Type.STRING },
          type: { type: Type.STRING }
        }
      }
    }
  },
  required: ["mirror", "meaning", "anchor", "summary", "topic", "mood"]
}
```

---

### 2.3 Reflection Assembly

**Modify:** Return value processing

```typescript
// Combine MMA sections into full reflection
const reflectionContent = [
  data.mirror,
  data.meaning,
  data.anchor
].filter(Boolean).join('\n\n');

return {
  reflection: reflectionContent,
  mirror: data.mirror,      // NEW: expose individual sections
  meaning: data.meaning,    // NEW: for UI flexibility
  anchor: data.anchor,      // NEW: 
  summary: data.summary,
  topic: data.topic,
  mood: data.mood,
  entities: currentEntities,
  highlights: data.highlights
};
```

---

## Phase 3: Safety Rules Integration

### 3.1 Third-Person Content Detection

**New Function:** `detectThirdPartyContent()`

```typescript
const THIRD_PARTY_INDICATORS = [
  // Relationship contexts
  'boyfriend', 'girlfriend', 'partner', 'spouse', 'husband', 'wife',
  'ex', 'dating', 'relationship',
  // Work contexts
  'coworker', 'colleague', 'boss', 'manager', 'team',
  // Comparison contexts
  'jealous', 'compared', 'better than', 'worse than',
  // Suspicion contexts
  'cheating', 'lying', 'hiding', 'suspect', 'think they'
];

function detectThirdPartyContent(entry: string): boolean {
  const lowerEntry = entry.toLowerCase();
  return THIRD_PARTY_INDICATORS.some(indicator => 
    lowerEntry.includes(indicator)
  );
}
```

**Integration:** Add to prompt when detected

```typescript
if (detectThirdPartyContent(entry)) {
  prompt += `
  
**⚠️ THIRD-PARTY SAFETY ACTIVE**
This entry involves other people. You MUST:
- Name ambiguity about their intentions
- Reflect the USER's feelings only
- Separate feelings from facts
- NOT validate suspicions or mind-read others
`;
}
```

---

### 3.2 Response Validation (Post-Generation)

**New Function:** `validateMMAResponse()`

```typescript
interface ValidationResult {
  isValid: boolean;
  warnings: string[];
  violations: string[];
}

const FORBIDDEN_PHRASES = [
  // Advisor violations
  'you should', 'try to', 'i encourage', 'have you considered',
  'the best thing', 'i suggest', 'you need to', 'you must',
  // Identity violations
  'you are someone who', 'you\'ve always been', 'this is who you are',
  // Authority violations
  'i know that', 'trust me', 'i promise', 'things will',
  // Third-party violations
  'they probably', 'they must be', 'they\'re definitely',
  // Timestamp violations (without user mention)
  'in january', 'last month', 'back in', 'weeks ago'
];

function validateMMAResponse(response: string): ValidationResult {
  const lower = response.toLowerCase();
  const violations: string[] = [];
  
  FORBIDDEN_PHRASES.forEach(phrase => {
    if (lower.includes(phrase)) {
      violations.push(`Contains forbidden phrase: "${phrase}"`);
    }
  });
  
  return {
    isValid: violations.length === 0,
    warnings: [],
    violations
  };
}
```

**Usage:** Log violations for monitoring (don't block response)

```typescript
const validation = validateMMAResponse(reflectionContent);
if (!validation.isValid) {
  log.warn('MMA validation violations detected', { 
    violations: validation.violations 
  });
}
```

---

## Phase 4: Highlight System Review

### 4.1 Conflict Analysis

**Current Categories:**
| Category | Purpose | MMA Conflict? |
|----------|---------|---------------|
| `main_idea` | Core insight | ✅ Compatible |
| `somatic_stressor` | Physical/external stress | ✅ Compatible |
| `identity_win` | Achievements, voice, recovery | ⚠️ **Potential conflict** |

**Issue with `identity_win`:**
> MMA Rule: "No validation through achievements"

**Resolution Options:**

**Option A: Rename and Reframe**
- Rename to `moment_of_agency`
- Focus on "noticing" not "celebrating"
- Allowed: "set a boundary" (noticing agency)
- Forbidden: "You crushed it!" (validation)

**Option B: Keep but Constrain**
- Keep `identity_win` name
- Update highlight instructions to avoid celebratory framing
- Highlight the fact, not the achievement

**Recommendation:** Option A — rename to `moment_of_agency`

---

### 4.2 Updated Highlight Instructions

```typescript
highlights: {
  type: Type.ARRAY,
  description: "Key phrases to highlight from YOUR reflection text (2-5 words each)",
  items: {
    type: Type.OBJECT,
    properties: {
      text: {
        type: Type.STRING,
        description: "Exact phrase from your reflection"
      },
      type: {
        type: Type.STRING,
        description: `Category:
          - main_idea: Core insight or central observation (1-2 max)
          - somatic_stressor: Physical sensations OR external pressures named in reflection
          - moment_of_agency: Moments where the user took action or used their voice (NOT celebratory, just noticing)`
      }
    }
  }
}
```

---

### 4.3 Type Definition Update

**File:** `app/types.ts`

```typescript
// OLD
export type HighlightType = 'somatic_stressor' | 'identity_win' | 'main_idea';

// NEW
export type HighlightType = 'somatic_stressor' | 'moment_of_agency' | 'main_idea';
```

**Migration:** Update existing database records (optional, backward compatible)

---

## Phase 5: Testing & Validation

### 5.1 Unit Tests

**File:** `__tests__/memoryConfidence.test.ts`

```typescript
describe('Memory Confidence', () => {
  describe('calculateMemoryConfidence', () => {
    it('should return HIGH band for recent, recurring, similar content', () => {
      const result = calculateMemoryConfidence({
        semanticSimilarity: 0.9,
        recencyScore: 0.9,
        recurrenceScore: 0.8
      });
      expect(result.band).toBe('high');
      expect(result.shouldSurface).toBe(true);
    });
    
    it('should return EXCLUDE for low-confidence content', () => {
      const result = calculateMemoryConfidence({
        semanticSimilarity: 0.3,
        recencyScore: 0.2,
        recurrenceScore: 0.1
      });
      expect(result.band).toBe('exclude');
      expect(result.shouldSurface).toBe(false);
    });
    
    it('should return appropriate language for each band', () => {
      const high = calculateMemoryConfidence({ ... });
      expect(high.allowedLanguage).toContain('You mentioned...');
      
      const medium = calculateMemoryConfidence({ ... });
      expect(medium.allowedLanguage).toContain('It seems like...');
    });
  });
});
```

---

### 5.2 Integration Tests

**Test Cases for MMA Output:**

| Test Case | Input | Expected Output |
|-----------|-------|-----------------|
| Basic reflection | "I'm feeling anxious about work" | Has MIRROR, MEANING, ANCHOR sections |
| Third-party content | "I think my coworker is sabotaging me" | No mind-reading, names ambiguity |
| Low-confidence memory | Entry similar to old, non-recurring topic | Memory not surfaced |
| High-confidence memory | Entry similar to recent, recurring topic | Memory surfaced with "You mentioned..." |
| Identity protection | Any entry | No "You are someone who..." |
| Advisor containment | Stressful entry | No "You should..." or "Try to..." |

---

### 5.3 Edge Case Tests

| Edge Case | Expected Behavior |
|-----------|-------------------|
| Very short entry ("I'm sad") | Shorter MIRROR/MEANING, still has ANCHOR |
| Happy entry ("Great day!") | MIRROR reflects positivity, MEANING optional, ANCHOR grounds |
| No history (first entry) | No memory references, pure reflection |
| Timestamps in user entry | AI can reference time since user mentioned it |
| Multiple people mentioned | Names them without judging any |

---

### 5.4 Validation Checklist

```markdown
## Pre-Release Checklist

### Memory Confidence Layer
- [ ] Confidence scores calculated correctly
- [ ] Bands map to correct language
- [ ] Low-confidence content excluded
- [ ] No timestamps unless user-mentioned

### MMA Structure
- [ ] All responses have MIRROR section
- [ ] All responses have MEANING section
- [ ] All responses have ANCHOR section (1-2 sentences)
- [ ] Sections follow allowed language rules

### Safety Rules
- [ ] Third-party content detected
- [ ] No mind-reading others
- [ ] No identity definitions
- [ ] No advice language
- [ ] No authority claims

### Highlights
- [ ] "identity_win" renamed to "moment_of_agency"
- [ ] Highlights don't use celebratory language
- [ ] Existing highlights still render correctly

### Backward Compatibility
- [ ] Old entries display correctly
- [ ] Chat system still works
- [ ] Audio generation unaffected
- [ ] History view unaffected
```

---

## File Changes Summary

| File | Changes |
|------|---------|
| `app/utils/memoryConfidence.ts` | **NEW** — Confidence scoring functions |
| `app/services/geminiService.ts` | Update SYSTEM_INSTRUCTION, response schema, context formatting |
| `app/services/entityTrackingService.ts` | Add confidence to entity surfacing |
| `app/types.ts` | Rename `identity_win` → `moment_of_agency` |
| `app/components/HighlightedText.tsx` | Update highlight type handling |
| `app/components/ReflectionCard.tsx` | Optionally display MMA sections separately |

---

## Rollback Plan

If issues arise, rollback is straightforward:

```bash
# Revert to previous system instruction
git checkout HEAD~1 -- app/services/geminiService.ts

# Or feature flag approach
const USE_MMA = process.env.USE_MMA === 'true';
const systemInstruction = USE_MMA ? SYSTEM_INSTRUCTION_MMA : SYSTEM_INSTRUCTION_LEGACY;
```

---

## Timeline

| Day | Tasks |
|-----|-------|
| **Day 1 AM** | Create `memoryConfidence.ts`, implement scoring |
| **Day 1 PM** | Integrate confidence into context selection |
| **Day 2 AM** | Write new SYSTEM_INSTRUCTION_MMA |
| **Day 2 PM** | Add safety rules, update highlights |
| **Day 3** | Testing, validation, documentation |

---

## Success Metrics

| Metric | Target |
|--------|--------|
| MMA structure compliance | 100% of responses have 3 sections |
| Forbidden phrase rate | < 1% of responses |
| Memory hallucination rate | 0% (no timestamps without user mention) |
| Third-party safety compliance | 100% when detected |
| User satisfaction | No increase in negative feedback |

---

## Open Questions

1. **Chat follow-ups:** Should MMA apply to chat responses too, or only initial reflections?
2. **Section length flexibility:** Should very short entries get abbreviated MMA?
3. **Highlight visibility:** Should we visually distinguish MMA sections in the UI?
4. **A/B testing:** Should we test MMA vs current system with a subset of users?

---

## Appendix: Example MMA Response

**User Entry:**
> "Saw my college friends today. They all have their lives figured out — good jobs, relationships, plans. I'm still figuring things out. Felt really small."

**MMA Response:**

```json
{
  "mirror": "Being around your college friends seems to have stirred up a sharp sense of comparison. Not because anyone said anything directly, but because you share the same starting point — and their lives appear more settled than yours feels right now. There's a heaviness in feeling 'small' in that room.",
  
  "meaning": "This kind of feeling often shows up when someone is still in the middle of their own timeline, and being around people who seem further along makes that uncertainty louder. Comparison doesn't mean you're behind — it means your path isn't as visible to you yet as theirs appears to be.",
  
  "anchor": "This doesn't mean you're failing. It means this part of your life still feels open — and open isn't the same as lost.",
  
  "summary": "Comparison and uncertainty after seeing settled friends",
  "topic": "Self-Comparison",
  "mood": "heavy",
  "highlights": [
    { "text": "sharp sense of comparison", "type": "main_idea" },
    { "text": "feeling small", "type": "somatic_stressor" }
  ]
}
```

---

## Document Info

| Field | Value |
|-------|-------|
| Version | 1.0 |
| Created | January 2, 2026 |
| Status | Draft — Pending Review |
| Author | Journal AI Team |
