# AI-Powered Semantic Highlighting System

## Overview

The app uses **AI-detected semantic highlighting** to create a sophisticated visual narrative in journal reflections. Instead of randomly highlighting keywords, the AI identifies and categorizes meaningful phrases into 4 distinct types, each with purpose-driven styling.

## The 4 Highlight Categories

### 1. Somatic Markers (Physical Sensations)
**What it captures:** Body-related experiences mentioned in reflections
- Examples: "jaw is locking up", "knees are throbbing", "feeling shaky", "chest is tight"
- **Visual Style:** Subtle red underline with medium weight
- **Purpose:** Creates a "heat map" of physical stress over time. When scrolling through history, multiple red highlights in a period indicate physical burnout.

### 2. Identity Anchors (Personal Strengths)
**What it captures:** Achievements, resilience, personal growth moments
- Examples: "pushed through 18 miles", "found your voice", "stayed committed", "showing courage"
- **Visual Style:** Bold text with subtle gold/amber background
- **Purpose:** Acts as psychological reinforcement. Seeing "pushed through 18 miles" highlighted in gold every time you mention struggle anchors your sense of capability.

### 3. External Stressors (People/Events)
**What it captures:** Specific entities causing stress or requiring attention
- Examples: "Sarah's quick sync", "Miller follow-up", "team meeting", "project deadline"
- **Visual Style:** Grey box with subtle border
- **Purpose:** Quickly identifies what external factors are consuming mental energy. Pattern recognition across entries reveals recurring stressors.

### 4. Emotional Shifts (Emotional Transitions)
**What it captures:** Complex emotions or changes in emotional state
- Examples: "cozy melancholy", "incredible relief", "feeling lighter", "sense of peace"
- **Visual Style:** Italic text with subtle blue tint
- **Purpose:** Tracks emotional journey over time. Blue highlights show the arc from struggle to resolution.

## How It Works

### Backend (AI Detection)
1. **AI Analysis:** When Gemini generates a reflection, it analyzes its own response text
2. **Category Assignment:** It identifies phrases that fit the 4 categories
3. **Structured Response:** Returns JSON with both text and highlights:

```json
{
  "reflection": "I noticed your jaw is locking up again...",
  "highlights": [
    {
      "text": "jaw is locking up",
      "type": "somatic_marker"
    },
    {
      "text": "incredible relief",
      "type": "emotional_shift"
    }
  ]
}
```

### Frontend (Visual Rendering)
1. **Phrase Matching:** Frontend finds exact phrase matches in the reflection text
2. **Smart Styling:** Applies category-specific CSS classes
3. **Tooltips:** Hover over highlights to see category labels
4. **No Overlap:** Prevents choppy highlighting by removing overlapping matches

## UI Benefits

### 1. Visual Narrative
**Problem:** Reading old journals is tedious
**Solution:** Color-coded highlights let you "re-live" months of entries in seconds
- See a lot of **red** (somatic) in October? You were physically burnt out
- See clusters of **gold** (identity) in November? You were achieving growth
- Recurring **grey** (stressors) names? Time to address that relationship

### 2. Scan-ability
**Problem:** People don't re-read journals word-for-word
**Solution:** Highlights act as visual bookmarks
- Quickly scan for physical symptoms (red)
- Find moments of strength (gold)
- Identify problematic patterns (recurring grey names)

### 3. Psychological Reinforcement
**Problem:** We forget our strengths during hard times
**Solution:** Gold-highlighted achievements serve as anchors
- "You pushed through 18 miles" becomes a visual reminder
- Builds confidence through pattern recognition
- Creates a personal mythology of resilience

### 4. High-End Feel
**Problem:** Generic highlighting looks amateurish
**Solution:** Sophisticated, purpose-driven design
- Each color has semantic meaning
- Styling is subtle and elegant
- Creates a "designed" experience

## Technical Implementation

### Files Modified

#### Types (`app/types.ts`)
```typescript
export type HighlightType = 
  | 'somatic_marker' 
  | 'identity_anchor' 
  | 'external_stressor' 
  | 'emotional_shift';

export interface Highlight {
  text: string;
  type: HighlightType;
}

// Added to Reflection and HistoryEntry
highlights?: Highlight[];
```

#### AI Service (`app/services/geminiService.ts`)
- Updated prompt to request 4-category highlights
- Modified response schema to include `highlights` array
- Returns structured highlight data with reflection

#### UI Component (`app/components/HighlightedText.tsx`)
- Completely rewritten to use AI-provided highlights
- No more regex patterns or hardcoded word lists
- Precise phrase matching with category-specific styling
- Smart overlap prevention

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

### Color Palette
- **Somatic:** Red family (`red-400`) - urgent but not alarming
- **Identity:** Gold/Amber (`amber-50`, `amber-900`) - warm, affirming
- **Stressor:** Grey (`stone-100`, `stone-200`) - neutral, factual
- **Emotional:** Blue (`blue-900`) - calm, reflective

### Styling Rules
- **Subtle:** No heavy backgrounds or harsh borders
- **Readable:** All text maintains high contrast
- **Elegant:** Use of space, subtle borders, soft colors
- **Scannable:** Clear visual hierarchy without overwhelming

## Examples

### Before (Generic Highlighting)
```
I see that you're feeling anxious about the upcoming presentation.
[All words randomly highlighted with no meaning]
```

### After (Semantic Highlighting)
```
I see that you're chest is tightening again before Sarah's presentation.
              [red underline]                [grey box]
You've shown courage in past talks, and that same strength is still there.
        [gold background]
```

## User Experience Flow

1. **Entry Creation**
   - User writes journal entry
   - AI generates reflection with semantic analysis
   - Highlights automatically applied to meaningful phrases

2. **History Browsing**
   - Scroll through past entries
   - Visual patterns emerge (red clusters = burnout periods)
   - Quick scan for specific category (gold = achievements)

3. **Pattern Recognition**
   - Notice recurring grey names (problematic relationships)
   - Track blue phrases to see emotional journey
   - Red highlights reveal physical stress accumulation

4. **Psychological Impact**
   - Gold highlights reinforce positive identity
   - Red highlights validate physical experience
   - Grey highlights identify external factors
   - Blue highlights show emotional growth

## Future Enhancements

### Possible Extensions
1. **Heatmap View:** Calendar visualization with color density
2. **Category Filtering:** Show only entries with specific highlight types
3. **Trend Analysis:** Graph highlight frequency over time
4. **Export:** Generate reports focused on specific categories
5. **Customization:** User-configurable color schemes per category

### AI Improvements
1. **Context Awareness:** Better phrase detection based on user's history
2. **Personalization:** Learn which phrases matter most to user
3. **Precision:** Improve category assignment accuracy
4. **Granularity:** Sub-categories within each main type

## Conclusion

This highlighting system transforms the journal from a static text archive into a **living visual narrative**. Each color tells a story, each pattern reveals insight, and each highlight serves a purpose. It's not decoration—it's meaningful design that enhances the core value proposition: helping users understand themselves through their own words.
