# AI-Powered Semantic Highlighting System

## Overview

The app uses **AI-detected semantic highlighting** to create a clean, focused visual narrative in journal reflections. Instead of randomly highlighting keywords, the AI identifies and categorizes meaningful phrases into **2 powerful categories**, each with purpose-driven styling.

## The 2 Highlight Categories

### 1. The Somatic Stressor (Physical + External Stress)
**What it captures:** 
- **Physical symptoms:** Body-related stress signals (e.g., "jaw is locking up", "chest is tight", "shoulders tense", "feeling shaky")
- **External triggers:** People, events, or situations causing stress (e.g., "Sarah's email", "Miller project", "tight deadline", "team meeting")

**Visual Style:** Soft red glow with underline
- Red underline for visibility
- Subtle red background tint
- Medium font weight

**Purpose:** Creates a unified "stress map" showing both how stress manifests physically AND what's causing it. When scrolling through history, clusters of red indicate high-stress periods and reveal patterns of recurring stressors.

### 2. The Identity Win (Achievements + Voice + Recovery)
**What it captures:**
- **Personal achievements:** Concrete accomplishments (e.g., "pushed through 18 miles", "completed the marathon", "finished the project")
- **Moments of voice/agency:** Standing up for yourself (e.g., "stood your ground", "set a boundary", "spoke up", "said no")
- **Emotional recovery:** Progress toward wellbeing (e.g., "finding peace", "feeling lighter", "regaining balance", "sense of relief")

**Visual Style:** Bold text with gold/yellow highlight
- Bold font for emphasis
- Warm amber/gold background
- Subtle shadow for depth

**Purpose:** Acts as psychological reinforcement and builds your personal narrative of strength. These golden highlights become visual anchors of your capability, resilience, and growth. Over time, they form a "trail of wins" showing your journey.

## How It Works

### Backend (AI Detection)
1. **AI Analysis:** When Gemini generates a reflection, it analyzes its own response text
2. **Category Assignment:** It identifies phrases that fit the 2 categories
3. **Structured Response:** Returns JSON with both text and highlights:

```json
{
  "reflection": "I see your jaw is locking up again from the Miller project stress. But you pushed through 18 miles—that resilience is still there.",
  "highlights": [
    {
      "text": "jaw is locking up",
      "type": "somatic_stressor"
    },
    {
      "text": "Miller project stress",
      "type": "somatic_stressor"
    },
    {
      "text": "pushed through 18 miles",
      "type": "identity_win"
    }
  ]
}
```

### Frontend (Visual Rendering)
1. **Markdown Processing:** Uses ReactMarkdown to render formatting (**bold**, *italic*, etc.)
2. **Phrase Matching:** Recursively finds exact phrase matches in text nodes
3. **Smart Styling:** Applies category-specific CSS classes while preserving markdown
4. **Tooltips:** Hover over highlights to see category labels
5. **No Overlap:** Prevents choppy highlighting by removing overlapping matches

## UI Benefits

### 1. Visual Narrative (Simplified)
**Problem:** Reading old journals is tedious
**Solution:** Two-color system lets you "re-live" months of entries in seconds
- **Red clusters** in October? High-stress period with specific triggers visible
- **Gold clusters** in November? Growth, achievement, recovery period
- Pattern at a glance: Stress (red) → Win (gold) → Stress → Win shows your rhythm

### 2. Scan-ability
**Problem:** People don't re-read journals word-for-word
**Solution:** Just 2 colors = instant clarity
- **Red = What's hurting you** (physical + external)
- **Gold = What's healing you** (wins + voice + recovery)
- No cognitive overload, immediate pattern recognition

### 3. Psychological Reinforcement
**Problem:** We forget our strengths during hard times
**Solution:** Gold wins are always visible
- "You pushed through 18 miles" becomes a visual anchor
- Every gold highlight reinforces your capability
- Red stressors validated, not dismissed
- Builds a balanced narrative: struggle AND strength

### 4. High-End Feel
**Problem:** Too many colors looks cluttered
**Solution:** Refined, purposeful design
- Only 2 colors = sophisticated restraint
- Red and gold = classic, timeless palette
- Subtle styling = elegant, not overwhelming
- Creates a premium, thoughtful experience

## Technical Implementation

### Files Modified

#### Types (`app/types.ts`)
```typescript
export type HighlightType = 'somatic_stressor' | 'identity_win';

export interface Highlight {
  text: string;
  type: HighlightType;
}

// Added to Reflection and HistoryEntry
highlights?: Highlight[];
```

#### AI Service (`app/services/geminiService.ts`)
- Updated prompt to request **2-category highlights** (simplified from 4)
- Modified response schema to include `highlights` array
- Returns structured highlight data with reflection
- AI instructions emphasize combining physical + external in "somatic_stressor"
- AI instructions emphasize combining achievements + voice + recovery in "identity_win"

#### UI Component (`app/components/HighlightedText.tsx`)
- Simplified to use only 2 highlight styles
- Red glow (somatic_stressor) and gold highlight (identity_win)
- Precise phrase matching with category-specific styling
- Smart overlap prevention
- Processes markdown alongside highlights

#### Database (`prisma/schema.prisma`)
- Added `highlights Json?` field to `JournalEntry` model
- Stores AI-detected highlights for persistence
- Enables cross-device sync of highlighting

#### History Service (`app/services/historyService.ts`)
- Updated conversion functions to handle highlights
- Saves/loads highlights from database

### Migration
```bash
npx prisma migrate dev --name add_highlights_field
npx prisma generate
```

## Visual Design Guidelines

### Color Palette (Simplified)
- **Somatic Stressor:** Red family (`red-400` underline, `red-50` background, `red-900` text) - urgent yet soft, validates stress
- **Identity Win:** Gold/Amber (`amber-50` background, `amber-900` text) - warm, affirming, celebratory

### Styling Rules
- **Just 2 Colors:** Red for stress, gold for wins—nothing else needed
- **Readable:** High contrast text on subtle backgrounds
- **Elegant:** Soft backgrounds, clean underlines, no harsh borders
- **Scannable:** Instant pattern recognition with dual-color system

## Examples

### Before (Generic Highlighting)
```
I see that you're feeling anxious about the upcoming presentation.
[All words randomly highlighted with no meaning]
```

### After (2-Category System)
```
I see your chest is tightening again before Sarah's presentation deadline.
           [red - somatic stressor]      [red - somatic stressor]

You pushed through 18 miles when things were hard. That resilience is still there.
    [gold - identity win]
```

**Why This Works:**
- Red highlights connect physical symptom ("chest tightening") to external cause ("Sarah's presentation")
- Gold highlights remind you of past wins as evidence of capability
- Clean, scannable, meaningful

## User Experience Flow

1. **Entry Creation**
   - User writes journal entry
   - AI generates reflection with semantic analysis
   - Highlights automatically applied: red for stress, gold for wins

2. **History Browsing**
   - Scroll through past entries
   - Visual patterns emerge instantly:
     - **Red clusters** = high-stress periods (physical + external)
     - **Gold clusters** = growth, achievement, recovery periods
   - See your rhythm: Struggle → Win → Struggle → Win

3. **Pattern Recognition**
   - **Red patterns reveal:**
     - Recurring physical symptoms (jaw tension every Monday?)
     - Recurring external triggers (Sarah's emails? Miller project?)
     - Stress accumulation over time
   
   - **Gold patterns reveal:**
     - Your "greatest hits" of resilience
     - Moments when you found your voice
     - Evidence of progress and recovery

4. **Psychological Impact**
   - **Red validates:** "My stress is real and has identifiable causes"
   - **Gold reinforces:** "I have a track record of getting through hard things"
   - **Balance:** Not toxic positivity (red) or learned helplessness (gold alone)
   - **Narrative:** "I struggle AND I win" = realistic, empowering story

## Future Enhancements

### Possible Extensions
1. **Heatmap View:** Calendar showing stress (red) vs. wins (gold) density over time
2. **Category Filtering:** Toggle to show only red or only gold highlights
3. **Trend Analysis:** Line graph showing red/gold ratio over months
4. **Export:** Generate "Stress Report" (red patterns) or "Wins Report" (gold patterns)
5. **Smart Insights:** "You mention 'Sarah' in 70% of red highlights—pattern?"

### AI Improvements
1. **Context Awareness:** Better phrase detection based on user's recurring patterns
2. **Personalization:** Learn user's specific stressor vocabulary
3. **Precision:** Improve category assignment (stress vs. win)
4. **Connections:** Suggest links between stressors and wins ("You ran 5 miles after every Miller meeting")

## Conclusion

This **simplified 2-category system** transforms the journal into a clean, scannable **visual narrative**:
- **Red = Stress** (physical + external)
- **Gold = Wins** (achievements + voice + recovery)

No cognitive overload. No color confusion. Just two meaningful categories that together tell your complete story: **struggle AND strength**. It's not toxic positivity (all gold) or learned helplessness (all red)—it's a balanced, realistic narrative that validates pain while celebrating progress.

The result? A high-end, thoughtful experience that helps users understand themselves through a simple but powerful visual language.
