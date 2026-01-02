# Audio Generation Behavior

## Current Implementation (After Fix)

### Auto-Play ENABLED ✅
When you click "Get Reflection":
1. ✅ AI generates reflection text with entities
2. ✅ Audio is **automatically generated** from the reflection
3. ✅ Audio **automatically plays** immediately
4. You'll see "Wait" indicator while audio generates

### Auto-Play DISABLED ❌
When you click "Get Reflection":
1. ✅ AI generates reflection text with entities
2. ❌ **No audio generation happens**
3. ❌ **No audio plays**
4. You'll see a **play button** (▶️) on the reflection card

**When you click the play button:**
- Audio generates **on-demand** (first time)
- Audio plays from cache (subsequent times)
- You'll see "Wait" indicator while generating

---

## How to Test

### Test 1: Auto-Play Disabled
1. Look at **header**: Should show "Auto-play: OFF" badge
2. Look at **footer**: Toggle should show gray pause icon ⏸
3. Click "Get Reflection"
4. **Expected**: Reflection appears, NO "Wait" indicator, play button shows
5. **Console should show**: `[JournalApp] Skipping audio generation - auto-play is disabled`

### Test 2: Auto-Play Enabled
1. Click auto-play toggle in footer
2. You'll see toast: "Auto-play enabled"
3. **Header** should show: "Auto-play: ON" (green)
4. **Footer** should show: green play icon ▶️
5. Click "Get Reflection"
6. **Expected**: Reflection appears, "Wait" indicator shows, then audio plays
7. **Console should show**: `[JournalApp] Auto-generating audio because auto-play is enabled`

---

## Visual Indicators

### Header Status Badges:
- **"Wait"** (spinning) = Audio is generating
- **"Speaking"** (animated bars) = Audio is playing
- **"Auto-play: ON"** (green) = Auto-play enabled
- **"Auto-play: OFF"** (gray) = Auto-play disabled

### Footer Toggle:
- ▶️ **Green play icon** = Auto-play ENABLED
- ⏸ **Gray pause icon** = Auto-play DISABLED

---

## Confusion Points

### "But I see 'Wait' even with auto-play disabled!"

This can happen if:
1. **You clicked the play button manually** → This is correct! Manual play generates audio on-demand
2. **Auto-play was enabled when you clicked "Get Reflection"** → The audio started generating before you disabled auto-play
3. **Playing history entry audio** → History entries always generate audio on-demand when you click play

### "I want NO audio generation at all"

Current behavior:
- **Auto-play OFF** = No automatic generation, but generates when you click play
- **Auto-play ON** = Generates automatically after each reflection

If you want ZERO audio generation:
- Keep auto-play OFF
- Don't click any play buttons ▶️

---

## Behind the Scenes

### Where Audio Can Generate:

1. **After "Get Reflection"** (only if auto-play ON)
   - Triggers: Clicking "Get Reflection" button
   - Condition: `if (autoPlayEnabled) { generateAudio() }`

2. **After chat message** (only if auto-play ON)
   - Triggers: Sending a follow-up question
   - Condition: `if (autoPlayEnabled) { generateAudio() }`

3. **When clicking play button** (always, on-demand)
   - Triggers: Clicking ▶️ on reflection card
   - Triggers: Clicking ▶️ on history entry
   - Triggers: Clicking ▶️ on chat message
   - No condition - this is manual action

---

## Debug Console Logs

When you click "Get Reflection", you should see:

### Auto-play OFF:
```
[JournalApp] Auto-play enabled: false, Preferences loaded: true
[JournalApp] Skipping audio generation - auto-play is disabled
```

### Auto-play ON:
```
[JournalApp] Auto-play enabled: true, Preferences loaded: true
[JournalApp] Auto-generating audio because auto-play is enabled
```

### When toggling:
```
[JournalApp] Toggling auto-play from false to true
```
or
```
[JournalApp] Toggling auto-play from true to false
```

---

## Known Issue (Fixed)

**Before fix**: Audio always generated after "Get Reflection", regardless of auto-play setting. The toggle only controlled whether it played.

**After fix**: Audio only generates when auto-play is enabled OR when user manually clicks play button.

---

## Date Updated
January 2, 2026
