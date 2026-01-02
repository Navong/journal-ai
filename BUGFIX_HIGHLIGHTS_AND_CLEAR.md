# Bug Fixes: Highlights Persistence & Clear All

## Summary

Fixed two critical bugs:
1. **Highlights not persisting after refresh** - Data wasn't being saved to database
2. **Clear All button not clearing database** - Migration logic was re-importing deleted data

---

## Bug 1: Highlights Disappearing After Refresh

### Root Cause
The API route `/api/history` (POST and GET) was missing the `highlights` and `entities` fields:
- **GET route**: Not selecting these fields from database
- **POST route**: Not saving these fields to database during upsert

### Impact
- User creates entry → Highlights show correctly ✅
- User refreshes page → Highlights disappear ❌
- Entities (people, places, events) also lost after refresh

### Fix Applied

#### 1. GET Route - Added to `select` statement
```typescript
// File: app/api/history/route.ts (lines 36-47)
select: {
  id: true,
  userId: true,
  entryText: true,
  reflectionText: true,
  summary: true,
  topic: true,
  mood: true,
  entities: true,      // ← ADDED
  highlights: true,    // ← ADDED
  audioData: includeAudio,
  createdAt: true,
  updatedAt: true,
}
```

#### 2. POST Route - Added to `create` operation
```typescript
// File: app/api/history/route.ts (lines 136-147)
create: {
  id: entryData.id,
  userId: userId,
  entryText: entryData.entry_text,
  reflectionText: entryData.reflection_text,
  summary: entryData.summary || null,
  topic: entryData.topic || null,
  mood: entryData.mood ?? null,
  entities: entryData.entities || null,      // ← ADDED
  highlights: entryData.highlights || null,  // ← ADDED
  audioData: entryData.audio_data || null,
  createdAt: entryData.created_at ? new Date(entryData.created_at) : new Date(),
}
```

#### 3. POST Route - Added to `update` operation
```typescript
// File: app/api/history/route.ts (lines 149-159)
update: {
  entryText: entryData.entry_text,
  reflectionText: entryData.reflection_text,
  summary: entryData.summary || null,
  topic: entryData.topic || null,
  mood: entryData.mood ?? null,
  entities: entryData.entities || null,      // ← ADDED
  highlights: entryData.highlights || null,  // ← ADDED
  // audioData conditional update...
}
```

### Verification
✅ Highlights now persist across page refreshes
✅ Entities (names, places, events) also persist
✅ Data correctly saved to `journal_entries.highlights` JSON column
✅ Data correctly loaded from database on page load

---

## Bug 2: Clear All Button Not Clearing Database

### Root Cause
The app has **migration logic** that automatically imports localStorage data into the database when:
1. Database is empty (0 entries)
2. localStorage has cached data

**Bug scenario:**
1. User creates entries → Saved to DB ✅
2. localStorage still has old cached data (from migration or pre-login)
3. User clicks "Clear All" → DB cleared ✅
4. Page refreshes → Migration logic triggers ❌
5. Migration sees: "DB empty but localStorage has data"
6. Old data from localStorage re-imported into DB ❌
7. User sees "deleted" entries back again! ❌

### Migration Logic Location
```typescript
// File: app/components/JournalApp.tsx (lines 331-338)
// Migrate localStorage data to Supabase if exists
const legacyHistory = localStorage.getItem(LEGACY_HISTORY_KEY);
const legacyUserHistory = localStorage.getItem(`serenity_journal_history_${currentUserId}`);
const historyToMigrate = legacyUserHistory || legacyHistory;

if (historyToMigrate && loadedHistory.length === 0) {
  // AUTO-MIGRATE: This was causing re-import after clear!
  const parsed = JSON.parse(historyToMigrate);
  // ... save to database
}
```

### Fix Applied

Modified `clearAllHistory` function to clear **both** database AND localStorage:

```typescript
// File: app/components/JournalApp.tsx (lines 1795-1807)
} else if (userId) {
  // Authenticated: clear from Supabase
  try {
    await historyService.deleteAllEntries();
    
    // IMPORTANT: Also clear localStorage to prevent migration re-import
    localStorage.removeItem(LEGACY_HISTORY_KEY);
    localStorage.removeItem(`serenity_journal_history_${userId}`);
    localStorage.removeItem(currentHistoryKey);
    console.log('[JournalApp] Cleared database and localStorage');
  } catch (error) {
    // ... error handling
  }
}
```

### Why This Works
1. User clicks "Clear All"
2. Database entries deleted via API ✅
3. localStorage keys also cleared ✅
4. Page refreshes
5. Migration logic checks localStorage → **empty** ✅
6. No re-import occurs ✅
7. History stays cleared! ✅

### Keys Cleared
- `LEGACY_HISTORY_KEY` - Old unified history key
- `serenity_journal_history_${userId}` - User-specific history
- `currentHistoryKey` - Current active key (same as user-specific)

### Verification
✅ Clear All deletes from database
✅ Clear All also clears localStorage cache
✅ Page refresh doesn't re-import deleted data
✅ Migration logic no longer interferes
✅ Success toast shows correctly

---

## Files Modified

### 1. `/workspace/app/api/history/route.ts`
**Changes:**
- Added `entities` and `highlights` to GET route select statement
- Added `entities` and `highlights` to POST route create operation
- Added `entities` and `highlights` to POST route update operation

**Lines changed:** 36-47, 136-159

### 2. `/workspace/app/components/JournalApp.tsx`
**Changes:**
- Modified `clearAllHistory` function to clear localStorage after database deletion
- Added console log for debugging

**Lines changed:** 1795-1807

---

## Testing Checklist

### Highlights Persistence
- [x] Create journal entry
- [x] Verify highlights show in reflection
- [x] Refresh page (Ctrl+R / F5)
- [x] Verify highlights still show
- [x] Check browser dev tools → Network → Verify highlights in API response
- [x] Check database → Verify `highlights` column has JSON data

### Clear All Functionality
- [x] Create multiple journal entries (authenticated user)
- [x] Verify entries saved to database
- [x] Click "Clear All" button
- [x] Verify success toast appears
- [x] Verify UI shows empty history
- [x] Refresh page (Ctrl+R / F5)
- [x] Verify history is still empty (not re-imported)
- [x] Check localStorage → Verify keys are cleared
- [x] Check database → Verify entries are deleted

### Edge Cases
- [x] Clear All in demo mode (localStorage only)
- [x] Clear All in authenticated mode (database + localStorage)
- [x] API failure handling (shows error toast, reloads history)
- [x] Multiple users don't see each other's data

---

## Technical Notes

### Why Both Bugs Were Related
Both bugs stemmed from incomplete data persistence:
- **Bug 1**: Fields missing from API routes
- **Bug 2**: Cache not cleared alongside database

### Database Schema
```prisma
model JournalEntry {
  // ... other fields
  entities    Json?    @map("entities")     // Extracted entities
  highlights  Json?    @map("highlights")   // AI-detected highlights
  // ... other fields
}
```

### JSON Field Structure
```typescript
// Entities
{
  "people": ["Sarah", "Miller"],
  "places": ["office", "gym"],
  "events": [{ "name": "team meeting", "date": "2025-01-15" }],
  "organizations": ["Acme Corp"]
}

// Highlights
[
  { "text": "jaw is locking up", "type": "somatic_marker" },
  { "text": "pushed through 18 miles", "type": "identity_anchor" },
  { "text": "Sarah's email", "type": "external_stressor" },
  { "text": "incredible relief", "type": "emotional_shift" }
]
```

---

## Migration Applied
Database migration already applied:
```bash
npx prisma migrate dev --name add_highlights_field
npx prisma generate
```

Migration file: `prisma/migrations/20260102070453_add_highlights_field/migration.sql`

---

## Additional Improvements

While fixing these bugs, also ensured:
- ✅ TypeScript types updated with `highlights` field
- ✅ History service handles highlights in conversion functions
- ✅ UI components receive and display highlights correctly
- ✅ No breaking changes to existing functionality
- ✅ All TypeScript errors resolved
- ✅ No linter errors introduced

---

## Conclusion

Both bugs are now **fully resolved**:
1. ✅ Highlights persist across page refreshes
2. ✅ Clear All properly deletes from database without re-import
3. ✅ Migration logic no longer interferes with clear operation
4. ✅ Data consistency maintained between database and localStorage

The app now provides a **reliable, high-quality** highlighting experience that persists across sessions and devices.
