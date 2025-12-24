# Watering Sequence Scheduler Implementation Plan

## Overview

Add a "connect-the-dots" pattern interface for creating staggered watering sequences across multiple zones. Users draw a path connecting zone icons to define watering order, set a start time and duration, and the system auto-calculates individual zone schedules with 5-minute gaps.

**Git Commit**: 53a1aba683a7cee6a8ad9df6444f51a3feb2106c
**Branch**: master
**Date**: 2025-12-23

## Current State Analysis

### Existing Components
- `html/js/screens/schedule.js` - Slider-based zone schedule editor
- `html/js/screens/zone-settings.js` - Individual zone time/day picker
- `html/js/controls/week.js` - Single-day OR "all" selector
- `html/js/controls/slider.js` - Horizontal swipe carousel
- `html/js/models/zone.js`, `weekday.js`, `timer.js` - Data models

### Key Discoveries
- Week picker only supports single day or "all" toggle (`week.js:86-94`)
- Schedule screen renders one slide per zone (`schedule.js:12-16`)
- Timer model stores `h`, `m`, `d` (hour, minute, duration) per day
- System supports 2 timers per day (`maxTimers: 2` in settings.json)

## Desired End State

### User Flow
1. User opens Schedule screen
2. **First slide**: Sequence Builder (new)
   - Multi-day picker at TOP (same position as individual zones)
   - Zone icons displayed in grid (like landing page)
   - Draw path connecting zones to set order
   - Time picker BELOW: `HH:MM duration` (same style as zone-settings timer__time)
   - Drawing new sequence auto-clears previous (no clear button needed)
3. **Subsequent slides**: Existing zone-settings (unchanged visually)
   - Shows calculated start time if part of sequence
   - Duration editable → triggers cascade recalculation

### Auto-Cascade Behavior
When any zone's duration changes:
```
Sequence: Zone 1 → Zone 3 → Zone 2
Start: 6:00, Gap: 5 min

Before (all 15 min):
  Zone 1: 6:00 - 6:15
  Zone 3: 6:20 - 6:35
  Zone 2: 6:40 - 6:55

After Zone 1 → 25 min:
  Zone 1: 6:00 - 6:25  (changed)
  Zone 3: 6:30 - 6:45  (auto-shifted)
  Zone 2: 6:50 - 7:05  (auto-shifted)
```

## What We're NOT Doing

- Multiple independent sequences (one sequence at a time)
- Variable gaps between zones (fixed 5-minute gap)
- Per-zone gaps (all gaps are equal)
- Sequence branching/parallel paths

## Implementation Approach

### Data Model Changes

**New: Sequence metadata in App settings**
```javascript
// Stored alongside zones in settings
sequence: {
  order: [1, 3, 2, 4],     // Zone IDs in watering order
  startHour: 6,
  startMinute: 0,
  duration: 15,            // Default duration (minutes)
  gap: 5,                  // Gap between zones (minutes)
  days: ["mon", "wed", "fri"]  // Multi-day array
}
```

**Zone timer enhancement**
- Individual zone `d` (duration) can override sequence default
- Start time (`h`, `m`) is calculated, not stored

---

## Phase 1: Multi-Day Week Picker

### Overview
Modify `sketch-week` component to support selecting multiple days.

### Changes Required

#### 1. Update week.js
**File**: `html/js/controls/week.js`

Add `multiSelect` attribute support:

```javascript
// Add to connectedCallback()
this.multiSelect = this.getAttribute("multi-select") === "true";
this.selectedDays = new Set();

// Parse initial value as array if multi-select
if (this.multiSelect && this.value) {
  this.value.split(',').forEach(d => this.selectedDays.add(d));
}
```

Modify `onSelect()` for multi-select mode:

```javascript
onSelect(index) {
  const day = WEEK_DAYS[index + 1];

  if (this.multiSelect) {
    // Toggle day in set
    if (this.selectedDays.has(day)) {
      this.selectedDays.delete(day);
    } else {
      this.selectedDays.add(day);
    }

    // Update visual state
    this.updateSelectedVisuals();

    // Emit array of selected days
    this.dispatchEvent(new CustomEvent('change', {
      detail: { days: Array.from(this.selectedDays) }
    }));
  } else {
    // Existing single-select behavior
    // ... keep current code ...
  }
}

updateSelectedVisuals() {
  const ul = this.Ul.item();
  for (let i = 0; i < ul.children.length; i++) {
    const li = ul.children[i];
    const day = WEEK_DAYS[i + 1];
    if (this.selectedDays.has(day)) {
      this.jQuery(li).addClass("selected");
    } else {
      this.jQuery(li).removeClass("selected");
    }
  }
}
```

### Success Criteria

#### Automated Verification:
- [ ] Web assets build: `deno task build`
- [ ] No JavaScript errors in browser console

#### Manual Verification:
- [ ] Multi-select mode: Can select M, W, F simultaneously
- [ ] Single-select mode: Existing behavior unchanged
- [ ] Visual feedback shows all selected days highlighted

---

## Phase 2: Sequence Model & Storage

### Overview
Add sequence data model and integrate with App settings.

### Changes Required

#### 1. Create sequence.js model
**File**: `html/js/models/sequence.js`

```javascript
export class Sequence {
  constructor(data = {}) {
    this.order = data.order || [];
    this.startHour = data.startHour ?? 6;
    this.startMinute = data.startMinute ?? 0;
    this.duration = data.duration ?? 15;
    this.gap = data.gap ?? 5;
    this.days = data.days || [];
  }

  get isEmpty() {
    return this.order.length === 0;
  }

  // Calculate start time for zone at position in sequence
  getZoneStartTime(zoneId, zoneDurations = {}) {
    const position = this.order.indexOf(zoneId);
    if (position === -1) return null;

    let minutes = this.startHour * 60 + this.startMinute;

    for (let i = 0; i < position; i++) {
      const prevZoneId = this.order[i];
      const prevDuration = zoneDurations[prevZoneId] || this.duration;
      minutes += prevDuration + this.gap;
    }

    return {
      h: Math.floor(minutes / 60) % 24,
      m: minutes % 60
    };
  }

  // Recalculate all zone times and return schedule object
  calculateSchedule(zoneDurations = {}) {
    const schedule = {};

    for (const zoneId of this.order) {
      const startTime = this.getZoneStartTime(zoneId, zoneDurations);
      const duration = zoneDurations[zoneId] || this.duration;

      schedule[zoneId] = {
        ...startTime,
        d: duration,
        sequenced: true
      };
    }

    return schedule;
  }

  toJson() {
    return {
      order: this.order,
      startHour: this.startHour,
      startMinute: this.startMinute,
      duration: this.duration,
      gap: this.gap,
      days: this.days
    };
  }
}
```

#### 2. Update App to include sequence
**File**: `html/js/system/app.js`

Add sequence property and cascade recalculation:

```javascript
// In App class
static sequence() {
  if (!this.$sequence) {
    this.$sequence = new Sequence(this.$settings.sequence || {});
  }
  return this.$sequence;
}

static recalculateSequence() {
  const seq = this.sequence();
  if (seq.isEmpty) return;

  // Gather per-zone duration overrides
  const durations = {};
  for (const zoneId of seq.order) {
    const zone = this.zones(zoneId);
    // Check if zone has custom duration
    for (const day of seq.days) {
      const timer = zone.days(day).timers(0);
      if (timer.d && timer.d !== seq.duration) {
        durations[zoneId] = timer.d;
      }
    }
  }

  // Calculate new schedule
  const schedule = seq.calculateSchedule(durations);

  // Apply to all selected days
  for (const day of seq.days) {
    for (const [zoneId, times] of Object.entries(schedule)) {
      const zone = this.zones(zoneId);
      const timer = zone.days(day).timers(0);
      timer.h = times.h;
      timer.m = times.m;
      timer.d = times.d;
    }
  }
}
```

### Success Criteria

#### Automated Verification:
- [ ] Web assets build: `deno task build`
- [ ] Sequence model correctly calculates staggered times

#### Manual Verification:
- [ ] Sequence data persists in settings
- [ ] Changing duration triggers cascade recalculation

---

## Phase 3: Pattern Connector Component

### Overview
Create the "connect-the-dots" UI for defining zone order.

### Changes Required

#### 1. Create pattern-connector.js
**File**: `html/js/controls/pattern-connector.js`

```javascript
import { jQuery } from "../system/jquery";
import { Icons } from "../assets/icons";
import { App } from "../system/app";

const template = (self) => `
<style>
.pattern-container {
  position: relative;
  width: 280px;
  height: 280px;
  margin: 0 auto;
}

.zone-dot {
  position: absolute;
  width: 60px;
  height: 60px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: transform 0.2s;
}

.zone-dot svg {
  width: 50px;
  height: 50px;
  color: #494949;
}

.zone-dot.selected svg {
  color: var(--info-background-color);
}

.zone-dot.selected::after {
  content: attr(data-order);
  position: absolute;
  top: -8px;
  right: -8px;
  background: var(--info-background-color);
  color: white;
  border-radius: 50%;
  width: 20px;
  height: 20px;
  font-size: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.pattern-lines {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.pattern-lines line {
  stroke: var(--info-background-color);
  stroke-width: 3;
  stroke-linecap: round;
}

.zone-label {
  font-size: 10px;
  color: var(--primary-text-color);
  text-align: center;
  margin-top: 2px;
}
</style>

<div class="pattern-container">
  <svg class="pattern-lines"></svg>
  <!-- Zone dots will be dynamically added -->
</div>
`;

export class PatternConnector extends HTMLElement {
  connectedCallback() {
    this.selectedOrder = [];
    this.zoneDots = {};

    this.jQuery = jQuery(this).attachShadowTemplate(template, ($) => {
      this.container = $('.pattern-container');
      this.linesEl = $('.pattern-lines');
      this.renderZones();
    });
  }

  disconnectedCallback() {
    this.jQuery().detach();
  }

  renderZones() {
    const zones = App.zones();
    const count = zones.count();

    // Grid positions for up to 6 zones (2x3 or 3x2)
    const positions = this.calculatePositions(count);

    let index = 0;
    for (const zone of zones) {
      if (!zone.defined()) continue;

      const pos = positions[index];
      const dot = document.createElement('div');
      dot.className = 'zone-dot';
      dot.setAttribute('data-zone-id', zone.id);
      dot.style.left = pos.x + 'px';
      dot.style.top = pos.y + 'px';
      dot.innerHTML = `
        ${Icons.sprinkler.replace(/width='100' height='100'/, "width='100%' height='100%'")}
        <span class="zone-label">${zone.name || 'Zone ' + zone.id}</span>
      `;

      dot.addEventListener('click', () => this.onZoneClick(zone.id));

      this.container.item().appendChild(dot);
      this.zoneDots[zone.id] = { element: dot, pos };
      index++;
    }
  }

  calculatePositions(count) {
    // Arrange zones in a grid pattern
    const positions = [];
    const cols = count <= 4 ? 2 : 3;
    const rows = Math.ceil(count / cols);
    const cellW = 260 / cols;
    const cellH = 240 / rows;

    for (let i = 0; i < count; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      positions.push({
        x: col * cellW + cellW / 2 - 30,
        y: row * cellH + cellH / 2 - 30
      });
    }
    return positions;
  }

  onZoneClick(zoneId) {
    const index = this.selectedOrder.indexOf(zoneId);

    if (index === -1) {
      // Add to sequence
      this.selectedOrder.push(zoneId);
    } else if (index === this.selectedOrder.length - 1) {
      // Remove last item (allow undo)
      this.selectedOrder.pop();
    } else if (index === 0 && this.selectedOrder.length > 1) {
      // Clicking first zone again - start new sequence from here
      this.selectedOrder = [zoneId];
    }
    // Middle items: no action (user must tap first zone to restart)

    this.updateVisuals();
    this.dispatchEvent(new CustomEvent('change', {
      detail: { order: [...this.selectedOrder] }
    }));
  }

  updateVisuals() {
    // Update dot styles
    for (const [zoneId, data] of Object.entries(this.zoneDots)) {
      const index = this.selectedOrder.indexOf(parseInt(zoneId));
      if (index !== -1) {
        data.element.classList.add('selected');
        data.element.setAttribute('data-order', index + 1);
      } else {
        data.element.classList.remove('selected');
        data.element.removeAttribute('data-order');
      }
    }

    // Draw connecting lines
    this.drawLines();
  }

  drawLines() {
    const svg = this.linesEl.item();
    svg.innerHTML = '';

    for (let i = 1; i < this.selectedOrder.length; i++) {
      const fromId = this.selectedOrder[i - 1];
      const toId = this.selectedOrder[i];
      const from = this.zoneDots[fromId].pos;
      const to = this.zoneDots[toId].pos;

      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', from.x + 30);
      line.setAttribute('y1', from.y + 30);
      line.setAttribute('x2', to.x + 30);
      line.setAttribute('y2', to.y + 30);
      svg.appendChild(line);
    }
  }

  clear() {
    this.selectedOrder = [];
    this.updateVisuals();
  }

  get order() {
    return [...this.selectedOrder];
  }

  set order(value) {
    this.selectedOrder = [...value];
    this.updateVisuals();
  }
}
```

#### 2. Register component
**File**: `html/js/index.js`

```javascript
import { PatternConnector } from "./controls/pattern-connector";
customElements.define('pattern-connector', PatternConnector);
```

### Success Criteria

#### Automated Verification:
- [ ] Web assets build: `deno task build`
- [ ] Component renders without errors

#### Manual Verification:
- [ ] Zones displayed in grid layout
- [ ] Clicking zones adds them to sequence with order numbers
- [ ] Lines drawn between connected zones
- [ ] Clicking last zone removes it (undo)

---

## Phase 4: Sequence Builder Slide

### Overview
Create the first slide in schedule screen with sequence builder UI.

### Changes Required

#### 1. Create sequence-builder.js
**File**: `html/js/screens/sequence-builder.js`

```javascript
import { jQuery } from "../system/jquery";
import { App } from "../system/app";
import { String } from "../system";

const template = (self) => `
<style>
.week {
  position: absolute;
  width: 280px;
  top: 25px;
}

@media screen and (min-height: 666px) {
  .week { top: 10%; }
}

.timer__time {
  color: var(--info-background-color);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 48px;
  margin-top: 20px;
}

select {
  -webkit-appearance: none;
  -moz-appearance: none;
  appearance: none;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--info-background-color);
  font-size: 48px;
}

select option {
  background: var(--primary-background-color);
}
</style>

<sketch-week id="days" class="week" multi-select="true"></sketch-week>

<pattern-connector id="pattern"></pattern-connector>

<span id="timer-time" class="timer__time">
  <select id="timer-time-hours"></select>
  :
  <select id="timer-time-minutes"></select>
  &nbsp;
  <select id="timer-time-duration"></select>
</span>
`;

export class SequenceBuilder extends HTMLElement {
  connectedCallback() {
    this.jQuery = jQuery(this).attachShadowTemplate(template, ($) => {
      this.pattern = $('#pattern');
      this.weekPicker = $('#days');
      this.hourSelect = $('#timer-time-hours');
      this.minuteSelect = $('#timer-time-minutes');
      this.durationSelect = $('#timer-time-duration');

      this.initSelects();
      this.loadExisting();

      this.pattern.on('change', (e) => this.onPatternChange(e));
      this.weekPicker.on('change', (e) => this.onDaysChange(e));
    });
  }

  disconnectedCallback() {
    this.jQuery().detach();
  }

  initSelects() {
    // Hours 0-23
    for (let h = 0; h < 24; h++) {
      this.hourSelect.append(
        `<option value="${h}">${String.format00(h)}</option>`
      );
    }

    // Minutes 0-59
    for (let m = 0; m < 60; m++) {
      this.minuteSelect.append(
        `<option value="${m}">${String.format00(m)}</option>`
      );
    }

    // Duration options matching zone-settings
    [0, 5, 15, 20, 30].forEach(d => {
      this.durationSelect.append(
        `<option value="${d}" ${d === 15 ? 'selected' : ''}>${String.format00(d)}</option>`
      );
    });
  }

  loadExisting() {
    const seq = App.sequence();
    if (!seq.isEmpty) {
      this.pattern.item().order = seq.order;
      this.hourSelect.item().value = seq.startHour;
      this.minuteSelect.item().value = seq.startMinute;
      this.durationSelect.item().value = seq.duration;
    }
  }

  onPatternChange(e) {
    // Drawing new sequence - pattern connector handles auto-clear internally
    // when user starts new path from a different zone
  }

  onDaysChange(e) {
    this.selectedDays = e.detail.days;
  }

  // Called when navigating away - save sequence
  save() {
    const order = this.pattern.item().order;
    if (order.length === 0) return;

    const seq = App.sequence();
    seq.order = order;
    seq.startHour = parseInt(this.hourSelect.item().value);
    seq.startMinute = parseInt(this.minuteSelect.item().value);
    seq.duration = parseInt(this.durationSelect.item().value);
    seq.days = this.selectedDays || [];

    // Apply to zones
    App.recalculateSequence();
  }

  activate() {
    // Called when slide becomes visible
  }
}
```

#### 2. Update schedule.js
**File**: `html/js/screens/schedule.js`

Add sequence builder as first slide:

```javascript
const template = (self) => `
<sketch-slider start="${self.currentIndex}">
  <sprinkler-sequence-builder></sprinkler-sequence-builder>
  ${
    App.zones().count() > 0
      ? ""
      : "<sprinkler-list-empty></sprinkler-list-empty>"
  }
  ${String.join(
    App.zones(),
    (x) =>
      `<sprinkler-settings-zone zone-id="${x.id}"></sprinkler-settings-zone>`
  )}
</sketch-slider>`;
```

#### 3. Register component
**File**: `html/js/index.js`

```javascript
import { SequenceBuilder } from "./screens/sequence-builder";
customElements.define('sprinkler-sequence-builder', SequenceBuilder);
```

### Success Criteria

#### Automated Verification:
- [ ] Web assets build: `deno task build`
- [ ] Firmware compiles: `arduino-cli compile`

#### Manual Verification:
- [ ] Sequence builder appears as first slide in schedule
- [ ] Can draw pattern connecting zones
- [ ] Multi-day selection works
- [ ] Time preview shows calculated schedule
- [ ] Swiping right shows individual zone settings

---

## Phase 5: Cascade Recalculation Integration

### Overview
Connect zone-settings duration changes to trigger cascade recalculation.

### Changes Required

#### 1. Update zone-settings.js
**File**: `html/js/screens/zone-settings.js`

Modify `onDurationChange` to trigger cascade:

```javascript
onDurationChange(e) {
  this.timer.d = parseInt(e.srcElement.value);

  // Check if this zone is part of a sequence
  const seq = App.sequence();
  if (seq.order.includes(parseInt(this.zone.id))) {
    // Trigger cascade recalculation
    App.recalculateSequence();
  }

  this.render();
}
```

#### 2. Visual indicator for sequenced zones
Add indicator showing zone is part of sequence:

```javascript
// In template, add sequence indicator
${seq.order.includes(self.zone.id) ?
  '<div class="sequence-badge">Sequenced</div>' : ''}
```

### Success Criteria

#### Automated Verification:
- [ ] Web assets build: `deno task build`
- [ ] Firmware compiles

#### Manual Verification:
- [ ] Changing Zone 1 duration from 15→25 min shifts Zone 2, 3 start times
- [ ] Preview in sequence builder updates after cascade
- [ ] Sequenced zones show indicator badge

---

## Phase 6: Backend Storage & API

### Overview
Persist sequence configuration to ESP32 EEPROM and expose via API.

### Changes Required

#### 1. Update sprinkler-config.h
**File**: `arduino/sprinkler-config.h`

Add sequence structure:

```cpp
struct SprinklerSequenceConfig {
  uint8_t order[MAX_ZONES];  // Zone IDs in order (0 = unused)
  uint8_t orderCount;
  uint8_t startHour;
  uint8_t startMinute;
  uint8_t duration;
  uint8_t gap;
  uint8_t days;  // Bitmask: bit 0=all, 1=sun, 2=mon, etc.
};
```

#### 2. Update HTTP API
**File**: `arduino/sprinkler-http.h`

Add endpoint for sequence:

```cpp
// GET /api/sequence
// POST /api/sequence
```

### Success Criteria

#### Automated Verification:
- [ ] Firmware compiles with new structures
- [ ] EEPROM size still within 4096 bytes

#### Manual Verification:
- [ ] Sequence persists across reboots
- [ ] API returns sequence configuration

---

## Testing Strategy

### Unit Tests
- Sequence.calculateSchedule() with various durations
- Cascade recalculation after duration change
- Multi-day picker selection/deselection

### Integration Tests
- Full flow: Draw pattern → Set time → Save → Verify zones
- Duration change cascade propagation
- Settings persistence to EEPROM

### Manual Verification
- [ ] Pattern drawing feels intuitive
- [ ] Visual feedback is clear (order numbers, lines)
- [ ] Preview accurately shows calculated times
- [ ] Cascade works when editing individual zones
- [ ] Multi-day selection works as expected

---

## References

- `html/js/screens/schedule.js` - Current schedule screen
- `html/js/screens/zone-settings.js` - Zone time editor
- `html/js/controls/week.js` - Day picker (to modify)
- `html/js/screens/zone-list.js` - Zone grid layout reference
- `html/js/models/zone.js` - Zone data model
