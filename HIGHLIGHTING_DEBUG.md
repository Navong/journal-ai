# Highlighting Debug Guide

## How to Test if Highlighting is Working

### Step 1: Check Browser Console

1. Open browser console (F12 or Right-click → Inspect → Console)
2. Write a journal entry mentioning a person's name, like:
   ```
   I had coffee with Sarah today. She works at the office downtown.
   ```
3. Click "Get Reflection"
4. Look for these console logs:

```
[JournalApp] Received reflection with entities: { people: ['Sarah'], places: ['office'], ... }
[HighlightedText] Entities received: { people: ['Sarah'], places: ['office'], ... }
[HighlightedText] Processing entities for highlighting
[HighlightedText] Added pattern for person: Sarah
[HighlightedText] Added pattern for place: office
[HighlightedText] Total patterns created: 2
[HighlightedText] Found match: "Sarah" at position 45
[HighlightedText] Found match: "office" at position 78
[HighlightedText] Total matches found: 2
```

### Step 2: What to Look For

**If you see:** `[HighlightedText] No entities or content, rendering plain text`
- **Cause**: Entities weren't extracted or passed
- **Solution**: Check entity extraction step

**If you see:** `[HighlightedText] Total patterns created: 0`
- **Cause**: Entities object is empty
- **Solution**: Entity extraction failed

**If you see:** `[HighlightedText] Total matches found: 0`
- **Cause**: Entities were extracted but don't match text
- **Solution**: Check if AI used different names in reflection

### Step 3: Visual Check

If highlighting is working, you should see:
- Names like **Sarah** with emerald underline
- Places like **office** with emerald underline
- Bold text for important words

---

## Common Issues

### Issue 1: No Entities Extracted
**Symptom:** Console shows `entities: undefined` or `entities: { people: [], places: [], events: [], organizations: [] }`

**Cause:** Entity extraction might have failed or text too short

**Solution:**
- Make sure entry is at least 20 characters
- Use clear names (e.g., "Sarah" not "she")
- Mention specific places (e.g., "office" not "there")

### Issue 2: Entities Extracted But No Highlighting
**Symptom:** Console shows entities but no "Found match" logs

**Possible causes:**
- AI rephrased the entities in reflection (e.g., you said "Sarah" but AI said "your friend")
- Special characters in entity names breaking regex
- Word boundary issues (e.g., "Sarah's" vs "Sarah")

**Solution:** Look at the reflection text and see if it actually mentions the entity by name

### Issue 3: Highlighting Not Visible
**Symptom:** Console shows matches but no visual highlighting

**Possible causes:**
- CSS not loaded
- Tailwind classes not applied
- Browser not supporting underline decorations

**Solution:** Check if other styles are working on the page

---

## Manual Test

To force test highlighting, you can temporarily hard-code entities:

1. Edit `ReflectionCard.tsx`
2. Add test entities:
```typescript
<HighlightedText 
  content={reflection?.content || ''} 
  entities={{
    people: ['Sarah', 'John'],
    places: ['office', 'gym'],
    events: [{ name: 'meeting', deadline: false }],
    organizations: ['Apple']
  }}
/>
```

3. See if **any** of those words get highlighted in the reflection

---

## Expected Behavior

### When Working Correctly:

**Entry:**
> "I met with Sarah at the office. We discussed the project deadline."

**AI Reflection with Highlighting:**
> "It sounds like your meeting with <u style="font-weight:600; text-decoration-color:#10b981">**Sarah**</u> at the <u style="font-weight:600; text-decoration-color:#10b981">**office**</u> was productive. The <u style="font-weight:700; text-decoration-color:#047857">**project deadline**</u> seems important to you."

**Visual:**
- Sarah → emerald underline (semibold)
- office → emerald underline (semibold)
- project deadline → darker emerald underline (bold)

---

## Still Not Working?

Share these console logs:
1. All `[HighlightedText]` logs
2. The `[JournalApp] Received reflection with entities:` log
3. The actual reflection text

This will help diagnose the issue!

---

## Quick Fix: Disable Highlighting

If highlighting is causing issues, temporarily disable it by editing `ReflectionCard.tsx`:

```typescript
// Replace HighlightedText with plain ReactMarkdown:
<ReactMarkdown>{reflection?.content || ''}</ReactMarkdown>
```

This will give you plain text while we debug.
