# Per-Zone Duration Implementation Plan

## Overview

Enable per-zone duration customization within the sequence while keeping sequence as the master controller for timing. The sequence builder controls order, days, start time, and default duration. Individual zones can have custom durations that affect subsequent zone start times. The UI clearly shows when zones have non-default durations.

## Current State Analysis

The backend now respects per-zone durations (fix applied in `sprinkler.cpp:266-280`). However, the UI doesn't properly support this:

- Zone settings shows editable time fields that get overwritten by sequence
- Sequence builder doesn't indicate when zones have custom durations
- No way to reset all zones to the template duration
- Confusing UX where user can edit values that don't persist

### Key Files:
- Backend timer calculation: `arduino/sprinkler.cpp:253-306` (already fixed)
- Zone settings UI: `html/js/screens/zone-settings.js`
- Sequence builder UI: `html/js/screens/sequence-builder.js`
- Sequence model: `html/js/models/sequence.js`

## Desired End State

**Sequence Builder:**
- Controls order, days, start time, gap, and default duration
- Shows indicator when any zone has a custom (non-default) duration
- Clicking indicator resets ALL zones to template duration

**Zone Settings (for sequenced zones):**
- Time (hour:minute) is readonly - controlled by sequence
- Duration is editable - allows per-zone customization
- Changing duration affects subsequent zones' start times (handled by backend)

**Data Flow:**
```
Sequence Builder: [06:00] [15min] ⚠️  ← indicator shows custom durations exist
                          ↓ click to reset
Zone 1: 06:00 (readonly) [15] ← uses template
Zone 2: 06:20 (readonly) [30] ← custom duration, shifts Zone 3
Zone 3: 06:55 (readonly) [15] ← starts after Zone 2's 30min + 5min gap
```

### Verification:
1. Create sequence with zones [1,2,3], start 06:00, duration 15min, gap 5min
2. All zones show 15min duration, times are 06:00, 06:20, 06:40
3. Change Zone 2 duration to 30min
4. Zone 2 shows 30min, Zone 3 time shifts to 06:55
5. Sequence builder shows indicator next to duration
6. Click indicator - all zones reset to 15min
7. Zone 3 time returns to 06:40

## What We're NOT Doing

- Not allowing time editing for sequenced zones (sequence controls timing)
- Not adding per-zone gap customization (gap is uniform)
- Not persisting "custom" flags - we detect by comparing to template
- Not changing the pattern connector or week picker components

## Implementation Approach

Three changes:
1. **Zone Settings** - Make time readonly for sequenced zones, keep duration editable
2. **Sequence Builder** - Add indicator and reset functionality for custom durations
3. **Sequence Model** - Add helper methods for duration comparison

---

## Phase 1: Zone Settings - Readonly Time for Sequenced Zones

### Overview
When a zone is part of a sequence, time fields become readonly/disabled. Only duration remains editable.

### Changes Required:

#### 1. Update template for sequenced zones
**File**: `html/js/screens/zone-settings.js`
**Changes**: Modify template to show readonly time display for sequenced zones

Replace the timer time span in template (lines 111-117):

```javascript
const template = (self) => `${style}
<div class="timer">
  <svg class="timer__svg" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <g class="timer__circle">
          <circle class="timer__path-elapsed" cx="50" cy="50" r="45"></circle>
  </svg>
  <div class="timer__ctrl">
    ${App.zones().count() > 1 ? `<input id="timer-name" class="timer__name" type="text" autocapitalize="words" value="${self.zone.name}">` : '&nbsp;'}
    <span id="timer-time" class="timer__time">
      ${self.isSequenced
        ? `<span class="timer__time-readonly">${String.format00(self.timer.h)}:${String.format00(self.timer.m)}</span>`
        : `<select id="timer-time-hours" class="timer__time-hours"></select>
           :
           <select id="timer-time-minutes" class="timer__time-minutes"></select>`
      }
      &nbsp;
      <select id="timer-time-duration" class="timer__time-duration"></select>
    </span>
    <div class="timer__remove">${App.zones().count() > 1 ? '<span id="timer-remove"> - </span>' : '&nbsp;'}</div>
  </div>
</div>
<sketch-week id="week" class="week" ${self.isSequenced ? 'multi-select="true"' : `value="${self.day.name}"`}></sketch-week>`;
```

#### 2. Add readonly time styles
**File**: `html/js/screens/zone-settings.js`
**Changes**: Add CSS for readonly time display

Add to the style constant (around line 77):

```css
.timer__time-readonly {
  font-size: 48px;
  color: var(--info-background-color);
  opacity: 0.6;
}
```

#### 3. Update render() to skip time select population for sequenced zones
**File**: `html/js/screens/zone-settings.js`
**Changes**: Conditionally populate time selects

Update the render method (around lines 199-211):

```javascript
// Only populate time selects if not sequenced
if (!this.isSequenced) {
  for (let minute = 0; minute < 60; minute++) {
    this.DdlMinutes.append(`<option ${(this.timer.m == minute) ? "selected='selected'" : ""}>${String.format00(minute)}</option>`)
  }

  for (let hour = 0; hour < 24; hour++) {
    this.DdlHours.append(`<option ${(this.timer.h == hour) ? "selected='selected'" : ""}>${String.format00(hour)}</option>`)
  }

  this.DdlMinutes.on('change', this.onMinuteChange.bind(this));
  this.DdlHours.on('change', this.onHourChange.bind(this));
}
```

#### 4. Remove outdated comment
**File**: `html/js/screens/zone-settings.js`
**Changes**: Update comment in onDurationChange (line 139)

```javascript
onDurationChange(e) {
  this.timer.d = parseInt(e.srcElement.value);
  // Duration change will affect subsequent zones' start times on save
  this.render();
}
```

### Success Criteria:

#### Automated Verification:
- [x] Web assets build: `deno task build`
- [ ] No JavaScript errors in browser console

#### Manual Verification:
- [x] Sequenced zone shows time as readonly text (e.g., "06:20")
- [x] Non-sequenced zone shows time as editable dropdowns
- [x] Duration dropdown still editable for all zones
- [x] Changing duration on sequenced zone works

---

## Phase 2: Sequence Model - Duration Comparison Helpers

### Overview
Add helper methods to the Sequence class for comparing zone durations with template.

### Changes Required:

#### 1. Add helper methods to Sequence class
**File**: `html/js/models/sequence.js`
**Changes**: Add methods to check for custom durations

```javascript
// Add after existing methods (around line 66)

// Check if any zone in sequence has a duration different from template
hasCustomDurations() {
  for (const zoneId of this.order) {
    const zone = App.zones(zoneId);
    if (!zone || !zone.defined()) continue;

    // Get duration from first available day
    const day = this._days.length > 0 ? zone.days(this._days[0]) : zone.days('all');
    const timer = day.timers(0);
    const zoneDuration = timer.d || 0;

    if (zoneDuration > 0 && zoneDuration !== this.duration) {
      return true;
    }
  }
  return false;
}

// Get list of zones with custom durations
getCustomDurationZones() {
  const customZones = [];
  for (const zoneId of this.order) {
    const zone = App.zones(zoneId);
    if (!zone || !zone.defined()) continue;

    const day = this._days.length > 0 ? zone.days(this._days[0]) : zone.days('all');
    const timer = day.timers(0);
    const zoneDuration = timer.d || 0;

    if (zoneDuration > 0 && zoneDuration !== this.duration) {
      customZones.push({ zoneId, duration: zoneDuration });
    }
  }
  return customZones;
}

// Reset all zones in sequence to template duration
resetAllDurations() {
  for (const zoneId of this.order) {
    const zone = App.zones(zoneId);
    if (!zone || !zone.defined()) continue;

    // Set duration on all sequence days
    for (const dayName of this._days) {
      const day = zone.days(dayName);
      const timer = day.timers(0);
      timer.d = this.duration;
    }
  }
}
```

#### 2. Add App import if not present
**File**: `html/js/models/sequence.js`
**Changes**: Ensure App is imported

```javascript
// At top of file, add import if not present
import { App } from "../system/app";
```

Note: This creates a circular dependency (App imports Sequence, Sequence imports App). If this causes issues, the helper methods can be moved to App instead.

### Success Criteria:

#### Automated Verification:
- [x] Web assets build: `deno task build`
- [ ] No JavaScript errors in browser console

#### Manual Verification:
- [x] `App.sequence().hasCustomDurations()` returns false when all zones match template
- [x] Returns true when any zone has different duration
- [x] `resetAllDurations()` sets all zones to template duration

---

## Phase 3: Sequence Builder - Duration Indicator and Reset

### Overview
Show an indicator next to the duration dropdown when any zone has a custom duration. Clicking it resets all zones to the template duration.

### Changes Required:

#### 1. Update template to include indicator
**File**: `html/js/screens/sequence-builder.js`
**Changes**: Add indicator span next to duration select

Update the timer-time span (lines 71-77):

```javascript
<span id="timer-time" class="timer__time">
  <select id="timer-time-hours"></select>
  <span class="colon">:</span>
  <select id="timer-time-minutes"></select>
  <span class="spacer"></span>
  <select id="timer-time-duration"></select>
  <span id="duration-indicator" class="duration-indicator"></span>
</span>
```

#### 2. Add indicator styles
**File**: `html/js/screens/sequence-builder.js`
**Changes**: Add CSS for the indicator

Add to the style section (around line 40):

```css
.duration-indicator {
  display: none;
  margin-left: 8px;
  cursor: pointer;
  font-size: 24px;
  opacity: 0.8;
}

.duration-indicator:hover {
  opacity: 1;
}

.duration-indicator.visible {
  display: inline;
}
```

#### 3. Add indicator element and handler
**File**: `html/js/screens/sequence-builder.js`
**Changes**: Get indicator element in connectedCallback

Update connectedCallback (around lines 82-97):

```javascript
this.jQuery = jQuery(this).attachShadowTemplate(template, ($) => {
  this.pattern = $('#pattern');
  this.weekPicker = $('#days');
  this.hourSelect = $('#timer-time-hours');
  this.minuteSelect = $('#timer-time-minutes');
  this.durationSelect = $('#timer-time-duration');
  this.durationIndicator = $('#duration-indicator');  // NEW

  this.initSelects();
  this.loadExisting();

  this.pattern.on('change', (e) => this.onPatternChange(e));
  this.weekPicker.on('change', (e) => this.onDaysChange(e));
  this.hourSelect.on('change', (e) => this.onTimeChange());
  this.minuteSelect.on('change', (e) => this.onTimeChange());
  this.durationSelect.on('change', (e) => this.onDurationChange());  // CHANGED
  this.durationIndicator.on('click', (e) => this.onResetDurations());  // NEW
});
```

#### 4. Add duration change and reset handlers
**File**: `html/js/screens/sequence-builder.js`
**Changes**: Add new methods

```javascript
// Replace onTimeChange to separate duration handling
onTimeChange() {
  const seq = App.sequence();
  seq.startHour = parseInt(this.hourSelect.item().value);
  seq.startMinute = parseInt(this.minuteSelect.item().value);
  this.applyToZones();
}

// NEW: Handle duration change - updates template and optionally all zones
onDurationChange() {
  const seq = App.sequence();
  seq.duration = parseInt(this.durationSelect.item().value);
  this.applyToZones();
  this.updateIndicator();
}

// NEW: Reset all zones to template duration
onResetDurations() {
  const seq = App.sequence();
  seq.resetAllDurations();
  this.updateIndicator();
}

// NEW: Update indicator visibility
updateIndicator() {
  const seq = App.sequence();
  const indicator = this.durationIndicator.item();
  if (indicator) {
    if (seq.hasCustomDurations()) {
      indicator.textContent = '⟲';  // Reset symbol
      indicator.title = 'Some zones have custom durations. Click to reset all to template.';
      indicator.classList.add('visible');
    } else {
      indicator.classList.remove('visible');
    }
  }
}
```

#### 5. Update loadExisting to show indicator
**File**: `html/js/screens/sequence-builder.js`
**Changes**: Call updateIndicator after loading

Add at end of waitForReady callback (around line 152):

```javascript
this.waitForReady(() => {
  // ... existing code ...

  // Check for custom durations
  this.updateIndicator();
});
```

#### 6. Update activate to refresh indicator
**File**: `html/js/screens/sequence-builder.js`
**Changes**: Refresh indicator when slide becomes visible

```javascript
activate() {
  App.zones().current = null;
  this.updateIndicator();  // NEW
}
```

### Success Criteria:

#### Automated Verification:
- [x] Web assets build: `deno task build`
- [ ] No JavaScript errors in browser console

#### Manual Verification:
- [x] No indicator shown when all zones have template duration
- [x] Indicator (⟲) appears when any zone has custom duration
- [x] Hovering indicator shows tooltip explaining it
- [x] Clicking indicator resets all zones to template duration
- [x] Indicator disappears after reset

---

## Phase 4: Integration Testing

### Overview
End-to-end verification of the complete per-zone duration flow.

### Test Scenarios:

#### Scenario 1: Basic Per-Zone Duration
1. Create sequence: zones [1,2,3], start 06:00, duration 15min, gap 5min
2. Verify all zones show 15min duration
3. Verify times: Zone 1 at 06:00, Zone 2 at 06:20, Zone 3 at 06:40
4. Go to Zone 2 settings, change duration to 30min
5. Verify Zone 2 time still shows 06:20 (readonly)
6. Save settings
7. Reload page
8. Verify Zone 2 has 30min, Zone 3 now at 06:55 (shifted)

#### Scenario 2: Duration Indicator
1. From Scenario 1, go to sequence builder
2. Verify indicator (⟲) is visible next to duration
3. Hover - verify tooltip shows explanation
4. Change template duration to 30min
5. Verify indicator disappears (Zone 2 now matches template)
6. Change template back to 15min
7. Verify indicator reappears

#### Scenario 3: Reset All Durations
1. Set Zone 1 to 10min, Zone 2 to 30min, Zone 3 to 20min
2. Go to sequence builder
3. Verify indicator is visible
4. Click indicator
5. Verify all zones reset to template duration (15min)
6. Verify indicator disappears
7. Save and reload - verify all zones still at 15min

#### Scenario 4: Non-Sequenced Zone
1. Create a zone that is NOT in the sequence
2. Verify time fields are editable (dropdowns, not readonly)
3. Verify duration is editable
4. Change time - verify it persists after save

### Success Criteria:

#### Manual Verification:
- [x] All four test scenarios pass
- [x] No console errors during any operation
- [x] Times correctly shift based on per-zone durations
- [x] Indicator correctly reflects custom duration state

---

## Testing Strategy

### Integration Tests:
- Zone duration persistence: Set custom duration, save, reload, verify
- Time calculation: Verify subsequent zones shift correctly
- Reset flow: Click reset, verify all zones get template duration

### Manual Testing Steps:
1. Create 3-zone sequence with 15min default
2. Set Zone 2 to 30min
3. Verify Zone 3 shifts to accommodate
4. Check indicator appears in sequence builder
5. Reset all durations
6. Verify indicator disappears
7. Save and restart ESP32
8. Verify all settings persist

## Performance Considerations

- `hasCustomDurations()` iterates through zones - O(n) but n ≤ 6
- Called on activate and duration change - minimal impact
- No additional EEPROM storage needed - durations already in zone timers

## Migration Notes

- No migration needed - existing zone durations are already respected
- Users may notice their custom durations now actually work
- Sequence builder will show indicator if zones already have different durations

## References

- Backend fix: `arduino/sprinkler.cpp:260-309` (extracts zone's custom duration before clearing days)
- Zone settings: `html/js/screens/zone-settings.js`
- Sequence builder: `html/js/screens/sequence-builder.js`
- Sequence model: `html/js/models/sequence.js`
