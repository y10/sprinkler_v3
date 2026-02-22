# Sequence Progress UI - Requirements Document

## Summary

Add visual feedback to the main screen when a scheduled sequence is actively running. Extend the existing two-layer sprinkler icon with a third layer for overall sequence progress. Keep the minimal design - no new controls or UI elements except order badges.

## Design Principle

**Minimal changes to existing UI:**
- Use current two-layer sprinkler icon as blueprint
- Add ONE new layer (blue) for overall sequence progress
- Add order badges (①②③) positioned like schedule view (top-right corner)
- NO new buttons, controls, or UI elements
- Interaction through existing icons (tap, long-press, double-tap)

## Problem Statement

Currently, when a scheduled sequence runs:
- Each zone fires independently at its calculated time
- No visual indication that zones are part of an active sequence
- No way to pause/resume/stop the entire sequence
- No visibility into overall sequence progress

## Requirements

### Visual: Extend Existing Icon with Third Layer

**Current two-layer icon (keep as-is for non-sequence):**
- Layer 1: Background/empty state
- Layer 2: Progress fill (green when running)

**Extended three-layer icon (when sequence running):**
- Layer 1: Background/empty state (existing)
- Layer 2: Overall sequence progress - BLUE (NEW - same % on all icons)
- Layer 3: Individual zone progress - GREEN on current, YELLOW on waiting (existing colors)

**Example with 3 zones, Zone 1 at 60%:**
```
Zone 1:          Zone 2:          Zone 3:
[①]              [②]              [③]         ← badges top-right
Green 60%        Yellow           Yellow       ← individual state
Blue 33%         Blue 33%         Blue 33%     ← overall progress (same)
```

### Visual: Order Badges

- Position: Top-right corner of zone icon (same as schedule view)
- Show: ①②③ based on sequence order
- Visibility: Only when sequence is actively running

### Color Scheme

| Color | Hex | Layer | Meaning |
|-------|-----|-------|---------|
| Green | `#4CAF50` | Individual | Zone actively watering |
| Blue | `#2196F3` | Overall | Sequence progress (same on all icons) |
| Yellow | `#FFC107` | Waiting | Zones queued in sequence |

**Why these colors:**
- Green = universal "active/go" - most important, shows current zone
- Blue = water theme, familiar progress indicator
- Yellow = "pending" intuition, matches existing paused state
- Colorblind-friendly: Green/Blue/Yellow distinguishable for most types

### Interaction (Using Existing Icons)

| User Action | Result |
|-------------|--------|
| Single tap any sequenced zone | Pause/Resume entire sequence |
| Long-press any sequenced zone | Stop sequence completely |
| Double-tap any sequenced zone | Stop sequence completely |

### States

| State | Blue Layer | Individual Layer | Badges |
|-------|------------|------------------|--------|
| No sequence | Hidden | Normal behavior | Hidden |
| Sequence running | Shows overall % (all icons) | Green on current, Yellow on waiting | Visible |
| Sequence paused | Frozen (all icons) | Yellow on all | Visible |

### Backend Requirements

1. **Track sequence session** - Distinguish scheduled sequence vs manual zone start
2. **Calculate overall progress** - (completed zones + current zone %) / total zones
3. **Sequence control** - Pause/Resume/Stop affects all zones in sequence
4. **WebSocket updates** - Include sequence state in real-time updates

### API (proposed)

```
GET  /api/sequence/state    - Current sequence status
POST /api/sequence/pause    - Pause sequence
POST /api/sequence/resume   - Resume sequence
POST /api/sequence/stop     - Stop sequence
```

## Out of Scope

- New buttons or controls (use existing icon interactions)
- New UI panels or overlays
- Manual sequence triggering
- Skip/reorder zones mid-sequence
- Changes to schedule view or sequence builder

## Files to Research

**Frontend (icon extension):**
- `html/js/controls/sprinkler-icon.js` - Add third layer, badge support
- `html/js/screens/main.js` - Pass sequence state to icons
- `html/js/screens/zone.js` - Handle tap/long-press/double-tap for sequence control

**Backend (sequence tracking):**
- `arduino/sprinkler-state.h` - Add sequence session tracking
- `arduino/sprinkler.cpp` - Sequence pause/resume/stop logic
- `arduino/sprinkler-http.h` - New API endpoints

## Success Criteria

1. Existing icon design preserved for non-sequence zones
2. Blue layer added showing overall progress (same on all sequenced zones)
3. Green layer shows individual zone progress (current zone only)
4. Yellow layer shows waiting state (queued zones)
5. Badges appear top-right (like schedule view) when sequence running
6. Tap any icon pauses/resumes sequence
7. Long-press or double-tap stops sequence
8. No new UI elements besides badge and blue layer
