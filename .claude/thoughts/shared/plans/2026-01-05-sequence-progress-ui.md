# Sequence Progress UI Implementation Plan

## Overview

Add visual feedback to the main screen when a scheduled sequence is actively running. Keep the existing two-layer icon system but change the fill direction to bottom-up so completed zones stay green. Add order badges and enable sequence-wide control through existing icon interactions. Overall sequence progress is shown implicitly by which zones are complete (green).

## Current State Analysis

### Backend
- Sequences are configured in EEPROM (`SprinklerSequenceConfig` in `sprinkler-config.h:24-45`)
- At save time, sequences are converted to individual zone timers (`sprinkler.cpp:237-316`)
- No runtime tracking of "sequence session" - each zone timer is autonomous
- `SprinklerState` tracks active zone timers independently (`sprinkler-state.h:74-98`)

### Frontend
- Two-layer icon system: gray base + colored progress overlay (`checkbox.js:54-70`)
- Progress uses `clip-path: inset(N% 0 0 0)` for fill effect (`checkbox.js:166-172`)
- Tap/long-press handlers exist (`checkbox.js:181-193`)
- WebSocket broadcasts per-zone state (`sprinkler-http.h:54-56`)

### Key Discoveries:
- `SprinklerZoneTimer` uses Ticker for countdown (`sprinkler-state.h:10-72`)
- Zone state JSON format: `{ "state": "started", "zone": N, "millis": X, "duration": Y }`
- TimeAlarms library schedules time-of-day triggers (`sprinkler-schedule.cpp:14-35`)
- Checkbox component already distinguishes single tap vs double-tap/long-press

## Desired End State

When a scheduled sequence runs:
1. **Completed zones** stay fully **green** (progress fills from bottom, stays when done)
2. **Current zone** shows **green layer** filling from bottom as it waters
3. **Waiting zones** show **gray base** with order badge (no color until their turn)
4. **Order badges** (①②③) appear top-right of each sequenced zone icon
5. **Tap** any sequenced zone icon to pause/resume the entire sequence
6. **Long-press/double-tap** any sequenced zone icon to stop the sequence completely
7. Pause shows **yellow** on current zone; resume continues from where it left off

### Verification:
- Sequence starts at scheduled time, badges appear on all sequenced zones
- Current zone fills green from bottom
- When zone completes, it stays green and next zone starts filling
- Tap pauses current zone (turns yellow), progress frozen
- Resume continues from where it left off
- Long-press stops sequence completely, icons return to gray

## What We're NOT Doing

- Manual sequence triggering from UI (only scheduled sequences)
- Skip/reorder zones mid-sequence
- Changes to schedule view or sequence builder
- New buttons, panels, or overlays
- Backward compatibility with old EEPROM format (clean redesign)
- Third "blue" layer for overall progress (simplified: completed zones = progress)

## Implementation Approach

Create a `SequenceSession` struct in the backend to track active sequence state. Detect sequence start when a scheduled timer fires for a zone that's in the sequence order AND current time falls within the sequence window. Extend WebSocket messages to include sequence state. Frontend changes the existing progress fill direction to bottom-up, adds order badges, and repurposes tap/long-press interactions for sequence control.

---

## Phase 1: Backend Sequence Session Tracking

### Overview
Add data structures and detection logic to track when a sequence is actively running.

### Changes Required:

#### 1. New SequenceSession Struct
**File**: `arduino/sprinkler-state.h`
**Changes**: Add struct to track active sequence session

```cpp
// Add after SprinklerZoneTimer class (around line 72)

struct SequenceSession {
  bool active;                      // Is sequence currently running?
  bool paused;                      // Is sequence paused?
  uint8_t currentZoneIndex;         // Current position in order[] (0-based)
  uint8_t totalZones;               // Total zones in sequence

  SequenceSession() : active(false), paused(false),
    currentZoneIndex(0), totalZones(0) {}

  void reset() {
    active = false;
    paused = false;
    currentZoneIndex = 0;
    totalZones = 0;
  }

  const String toJSON() const {
    if (!active) return "null";
    return "{ \"active\": true"
           ", \"paused\": " + String(paused ? "true" : "false") +
           ", \"currentIndex\": " + String(currentZoneIndex) +
           ", \"totalZones\": " + String(totalZones) +
           " }";
  }
};
```

#### 2. Add Session to SprinklerState
**File**: `arduino/sprinkler-state.h`
**Changes**: Add SequenceSession member to SprinklerState class

```cpp
// In SprinklerState class (around line 76), add member:
SequenceSession Sequence;
```

#### 3. Sequence Detection Helper
**File**: `arduino/sprinkler.h`
**Changes**: Add helper methods to detect and manage sequence

```cpp
// In SprinklerControl class, add private members:
private:
  bool isInSequenceWindow();           // Check if current time is within sequence window
  bool isZoneInSequence(uint8_t zone); // Check if zone is in sequence order
  uint8_t getZoneSequenceIndex(uint8_t zone); // Get zone's position in sequence (0-based)
  void startSequenceSession(uint8_t zoneIndex);
```

#### 4. Sequence Detection Implementation
**File**: `arduino/sprinkler.cpp`
**Changes**: Implement sequence detection when scheduled timer fires

```cpp
// Add helper implementations

bool SprinklerControl::isZoneInSequence(uint8_t zone) {
  auto& seq = Device.sequence();
  for (uint8_t i = 0; i < seq.orderCount(); i++) {
    if (seq.order[i] == zone) return true;
  }
  return false;
}

uint8_t SprinklerControl::getZoneSequenceIndex(uint8_t zone) {
  auto& seq = Device.sequence();
  for (uint8_t i = 0; i < seq.orderCount(); i++) {
    if (seq.order[i] == zone) return i;
  }
  return 255; // Not found
}

bool SprinklerControl::isInSequenceWindow() {
  auto& seq = Device.sequence();
  if (!seq.enabled || seq.orderCount() == 0) return false;

  // Get current time
  time_t now = time(nullptr);
  struct tm* timeinfo = localtime(&now);
  int currentDayBit = 1 << timeinfo->tm_wday; // 0=Sun, 1=Mon, etc.

  // Check if today is a sequence day
  if (!(seq.days & currentDayBit)) return false;

  // Check if current time is close to sequence start (within reasonable window)
  int currentMinutes = timeinfo->tm_hour * 60 + timeinfo->tm_min;
  int seqStartMinutes = seq.hour * 60 + seq.minute;

  // Allow 60 minute window after start time for sequence detection
  return currentMinutes >= seqStartMinutes && currentMinutes <= seqStartMinutes + 60;
}

void SprinklerControl::startSequenceSession(uint8_t zoneIndex) {
  auto& session = Timers.Sequence;
  auto& seq = Device.sequence();

  session.active = true;
  session.paused = false;
  session.currentZoneIndex = zoneIndex;
  session.totalZones = seq.orderCount();

  console.println("Sequence session started, zone index: " + String(zoneIndex));
}
```

#### 5. Integrate with scheduled() method
**File**: `arduino/sprinkler.cpp`
**Changes**: Modify `scheduled()` to detect sequence start

```cpp
// Modify scheduled() method (around line 42-52)
void SprinklerControl::scheduled(unsigned int zone, unsigned int duration) {
  if (Timers.isEnabled()) {
    console.println("Scheduled timer " + (String)zone);

    // Check if this is part of a sequence
    if (isZoneInSequence(zone) && isInSequenceWindow()) {
      uint8_t zoneIndex = getZoneSequenceIndex(zone);

      if (!Timers.Sequence.active) {
        // First zone of sequence - start session
        startSequenceSession(zoneIndex);
      } else {
        // Subsequent zone - advance session
        Timers.Sequence.currentZoneIndex = zoneIndex;
      }
    }

    start(zone, duration);
  }
}
```

#### 6. Handle zone completion
**File**: `arduino/sprinkler.cpp`
**Changes**: Modify `stop()` to advance sequence when zone completes naturally

```cpp
// In stop() method, after stopping the timer, add:
void SprinklerControl::stop(unsigned int zone) {
  console.println("Stopping timer " + (String)zone);
  if (Timers.isWatering(zone)) {
    if (Timers.count() == 1) {
      Device.turnOff();
      Device.blink(0);
    }
    Device.turnOff(zone);
    Timers.stop(zone);

    // Check if this was a sequence zone completing naturally
    if (Timers.Sequence.active && isZoneInSequence(zone)) {
      uint8_t zoneIndex = getZoneSequenceIndex(zone);
      if (zoneIndex == Timers.Sequence.currentZoneIndex) {
        // This zone completed - check if sequence is done
        if (zoneIndex >= Timers.Sequence.totalZones - 1) {
          console.println("Sequence completed");
          Timers.Sequence.reset();
        }
        // Note: advanceSequenceSession() called when next zone starts
      }
    }

    fireEvent("state", Timers.toJSON(zone));
  }
}
```

### Success Criteria:

#### Automated Verification:
- [x] Firmware compiles: `tools/arduino-cli compile --config-file arduino/arduino-cli.yaml --fqbn esp32:esp32:esp32wrover --output-dir .bin arduino/arduino.ino`
- [x] No compiler warnings related to new code

#### Manual Verification:
- [ ] Schedule a sequence, verify `Sequence.active` becomes true when first zone starts
- [ ] Verify `currentZoneIndex` advances as zones complete
- [ ] Verify `Sequence.reset()` called when last zone finishes
- [ ] Check serial console for sequence log messages

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Backend Sequence Control API

### Overview
Add pause/resume/stop methods for sequence-wide control and expose via HTTP endpoints.

### Changes Required:

#### 1. Sequence Control Methods
**File**: `arduino/sprinkler.h`
**Changes**: Add public methods for sequence control

```cpp
// In SprinklerControl class public section:
public:
  void pauseSequence();
  void resumeSequence();
  void stopSequence();
  bool isSequenceActive() { return Timers.Sequence.active; }
  bool isSequencePaused() { return Timers.Sequence.paused; }
```

#### 2. Sequence Control Implementation
**File**: `arduino/sprinkler.cpp`
**Changes**: Implement sequence pause/resume/stop

```cpp
void SprinklerControl::pauseSequence() {
  auto& session = Timers.Sequence;
  if (!session.active || session.paused) return;

  console.println("Pausing sequence");
  session.paused = true;

  // Pause current zone
  auto& seq = Device.sequence();
  uint8_t currentZone = seq.order[session.currentZoneIndex];
  if (Timers.isWatering(currentZone)) {
    pause(currentZone);
  }

  // Disable scheduled alarms for remaining zones
  for (uint8_t i = session.currentZoneIndex + 1; i < session.totalZones; i++) {
    uint8_t zoneId = seq.order[i];
    Settings.zones(zoneId).disable(); // Disable TimeAlarms for this zone
  }

  fireEvent("sequence", session.toJSON().c_str());
}

void SprinklerControl::resumeSequence() {
  auto& session = Timers.Sequence;
  if (!session.active || !session.paused) return;

  console.println("Resuming sequence");
  session.paused = false;

  // Resume current zone
  auto& seq = Device.sequence();
  uint8_t currentZone = seq.order[session.currentZoneIndex];
  if (Timers.isPaused(currentZone)) {
    resume(currentZone);
  }

  // Re-enable scheduled alarms for remaining zones
  for (uint8_t i = session.currentZoneIndex + 1; i < session.totalZones; i++) {
    uint8_t zoneId = seq.order[i];
    Settings.zones(zoneId).enable(); // Re-enable TimeAlarms
  }

  fireEvent("sequence", session.toJSON().c_str());
}

void SprinklerControl::stopSequence() {
  auto& session = Timers.Sequence;
  if (!session.active) return;

  console.println("Stopping sequence");
  auto& seq = Device.sequence();

  // Stop current zone if running
  uint8_t currentZone = seq.order[session.currentZoneIndex];
  if (Timers.isWatering(currentZone) || Timers.isPaused(currentZone)) {
    stop(currentZone);
  }

  // Disable scheduled alarms for remaining zones
  for (uint8_t i = session.currentZoneIndex + 1; i < session.totalZones; i++) {
    uint8_t zoneId = seq.order[i];
    Settings.zones(zoneId).disable();
  }

  session.reset();
  fireEvent("sequence", "null");
}
```

#### 3. HTTP Endpoints
**File**: `arduino/sprinkler-http.h`
**Changes**: Add sequence control endpoints

```cpp
// Add after zone control endpoints (around line 119)

// GET /api/sequence/state - Get current sequence status
http.on("/api/sequence/state", ASYNC_HTTP_GET, [&](AsyncWebServerRequest *request) {
  console.println("GET: /api/sequence/state");
  json(request, "{ \"sequence\": " + Sprinkler.Timers.Sequence.toJSON() + " }");
});

// POST /api/sequence/pause - Pause sequence
http.on("/api/sequence/pause", ASYNC_HTTP_POST, [&](AsyncWebServerRequest *request) {
  console.println("POST: /api/sequence/pause");
  Sprinkler.pauseSequence();
  json(request, "{ \"sequence\": " + Sprinkler.Timers.Sequence.toJSON() + " }");
});

// POST /api/sequence/resume - Resume sequence
http.on("/api/sequence/resume", ASYNC_HTTP_POST, [&](AsyncWebServerRequest *request) {
  console.println("POST: /api/sequence/resume");
  Sprinkler.resumeSequence();
  json(request, "{ \"sequence\": " + Sprinkler.Timers.Sequence.toJSON() + " }");
});

// POST /api/sequence/stop - Stop sequence
http.on("/api/sequence/stop", ASYNC_HTTP_POST, [&](AsyncWebServerRequest *request) {
  console.println("POST: /api/sequence/stop");
  Sprinkler.stopSequence();
  json(request, "{ \"sequence\": " + Sprinkler.Timers.Sequence.toJSON() + " }");
});
```

#### 4. WebSocket Sequence Event
**File**: `arduino/sprinkler-http.h`
**Changes**: Add WebSocket broadcaster for sequence events

```cpp
// Add after existing "state" event registration (around line 56)
Sprinkler.on("sequence", [](const char *event) {
  ws.textAll((String) "{ \"sequence\": " + (String)(strlen(event) ? event : "null") + "}");
});
```

#### 5. Include Sequence in State Broadcasts
**File**: `arduino/sprinkler-state.h`
**Changes**: Modify toJSON to include sequence info

```cpp
// Modify SprinklerState::toJSON(zone) to include sequence when active
const String toJSON(unsigned int zone) {
  String zoneJson;
  if (Timers.find(zone) != Timers.end()) {
    zoneJson = Timers[zone]->toJSON();
  } else {
    zoneJson = "{ \"state\": \"stopped\", \"zone\":" + (String)zone + "}";
  }

  // Add sequence info if active and zone is in sequence
  if (Sequence.active) {
    // We'll add sequence order info in the state message
    return zoneJson; // Sequence sent separately
  }
  return zoneJson;
}
```

### Success Criteria:

#### Automated Verification:
- [ ] Firmware compiles: `tools/arduino-cli compile --config-file arduino/arduino-cli.yaml --fqbn esp32:esp32:esp32wrover --output-dir .bin arduino/arduino.ino`
- [ ] No compiler warnings

#### Manual Verification:
- [ ] `GET /api/sequence/state` returns sequence status
- [ ] `POST /api/sequence/pause` pauses running sequence
- [ ] `POST /api/sequence/resume` resumes paused sequence
- [ ] `POST /api/sequence/stop` stops sequence completely
- [ ] WebSocket receives `{ "sequence": {...} }` messages

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Frontend Progress Direction Change

### Overview
Change the existing progress fill direction from top-down to bottom-up, so completed zones naturally stay green.

### Changes Required:

#### 1. Update Checkbox CSS for Bottom-Up Fill
**File**: `html/js/controls/checkbox.js`
**Changes**: Modify clip-path to fill from bottom

```css
/* Modify .checkbox-icon-progress styles (around line 70) */
.checkbox-icon-progress {
  position: absolute;
  top: 0;
  left: 0;
  color: var(--info-background-color); /* Green */
  clip-path: inset(100% 0 0 0);  /* Start hidden from bottom */
  transition: clip-path 0.3s ease;
}
```

#### 2. Update Progress Setter for Bottom-Up Fill
**File**: `html/js/controls/checkbox.js`
**Changes**: Invert clip-path calculation

```javascript
// Modify progress setter (around line 166-172)
set progress(value) {
  this._progress = Math.max(0, Math.min(1, value));
  if (this.iconProgress) {
    // Fill from bottom: 100% hidden at 0, 0% hidden at 1
    const clipBottom = (1 - this._progress) * 100;
    this.iconProgress.item().style.clipPath = `inset(0 0 ${clipBottom}% 0)`;
  }
}
```

**Note**: The existing `clip-path: inset(N% 0 0 0)` hides from TOP.
Changing to `clip-path: inset(0 0 N% 0)` hides from BOTTOM, so as N decreases, the fill rises from bottom.

### Success Criteria:

#### Automated Verification:
- [ ] Web assets build: `deno task build`
- [ ] Generated headers updated in `arduino/html/`

#### Manual Verification:
- [ ] Start a zone manually, verify green fills from bottom up
- [ ] When zone completes, verify it stays fully green
- [ ] Progress animation is smooth (CSS transition)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: Frontend Order Badges

### Overview
Add order badges (①②③) to zone icons when sequence is active.

### Changes Required:

#### 1. Add Badge CSS
**File**: `html/js/controls/checkbox.js`
**Changes**: Add badge styling (matching schedule view pattern from `pattern-connector.js:70-88`)

```css
/* Add to CSS template - matches .order-badge from schedule view */
.checkbox-badge {
  display: none;
  position: absolute;
  top: 0;
  right: -5px;
  background: #494949;
  color: white;
  border-radius: 50%;
  width: 22px;
  height: 22px;
  font-size: 12px;
  align-items: center;
  justify-content: center;
  z-index: 10;
}

.checkbox-badge.visible {
  display: flex;
}
```

#### 2. Add Badge Element to HTML
**File**: `html/js/controls/checkbox.js`
**Changes**: Add badge element to template

```javascript
// Add badge element to checkbox-tile (around line 88)
<div class="checkbox-tile">
  <span class="checkbox-badge"></span>
  <span class="checkbox-icon-base">${self._icon || ''}</span>
  <span class="checkbox-icon-progress">${self._icon || ''}</span>
</div>
```

#### 3. Add Badge Property
**File**: `html/js/controls/checkbox.js`
**Changes**: Add getter/setter for badge

```javascript
// Add badge getter
get badge() {
  return this.jQuery('.checkbox-badge');
}

// Add badge order setter (1-based index, shows ①②③ etc.)
set badgeOrder(value) {
  this._badgeOrder = value;
  if (this.badge) {
    if (value > 0 && value <= 10) {
      // Unicode circled numbers: ① = U+2460, ② = U+2461, etc.
      const circledNumbers = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'];
      this.badge.item().textContent = circledNumbers[value - 1];
      this.badge.item().classList.add('visible');
    } else {
      this.badge.item().classList.remove('visible');
    }
  }
}

get badgeOrder() {
  return this._badgeOrder || 0;
}

// Clear badge
clearBadge() {
  this._badgeOrder = 0;
  if (this.badge) {
    this.badge.item().classList.remove('visible');
  }
}
```

### Success Criteria:

#### Automated Verification:
- [ ] Web assets build: `deno task build`
- [ ] Generated headers updated in `arduino/html/`

#### Manual Verification:
- [ ] Setting `badgeOrder = 1` shows ① in top-right corner
- [ ] Setting `badgeOrder = 0` or `clearBadge()` hides badge
- [ ] Badge appears above all icon layers
- [ ] Badge styling matches schedule view (dark gray #494949 circle, white number, 22px)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 5: Frontend Zone List Sequence Integration

### Overview
Update zone-list screen to display sequence state on zone icons and handle sequence-specific interactions.

### Changes Required:

#### 1. Add Sequence State Tracking
**File**: `html/js/screens/zone-list.js`
**Changes**: Add sequence state management

```javascript
// Add to class properties (around line 48)
this.sequenceState = null;

// Add WebSocket listener for sequence events (in connectedCallback, around line 74)
Wsc.on("sequence", this.onSequenceUpdate, this);

// Add cleanup in disconnectedCallback
Wsc.off("sequence", this.onSequenceUpdate, this);
```

#### 2. Sequence Update Handler
**File**: `html/js/screens/zone-list.js`
**Changes**: Handle sequence WebSocket updates

```javascript
// Add method to handle sequence updates
onSequenceUpdate(data) {
  this.sequenceState = data;
  this.updateSequenceDisplay();
}

updateSequenceDisplay() {
  const seq = this.sequenceState;
  const sequenceOrder = seq?.order || App.sequence().order;

  // Update all zone checkboxes
  this.jQuery('.container sketch-checkbox').forEach((checkbox, index) => {
    const zoneId = parseInt(checkbox.getAttribute('zone-id'));
    const seqIndex = sequenceOrder.indexOf(zoneId);

    if (seq && seq.active && seqIndex !== -1) {
      // Zone is in active sequence - show badge
      checkbox.badgeOrder = seqIndex + 1;

      if (seqIndex < seq.currentIndex) {
        // Completed zone - stays fully green (progress = 1)
        checkbox.progressColor = 'var(--info-background-color)';
        checkbox.progress = 1;
      } else if (seqIndex === seq.currentIndex) {
        // Current zone - green (or yellow if paused)
        // Progress is updated by tickProgress() based on timer
        checkbox.progressColor = seq.paused
          ? 'var(--warn-background-color)'
          : 'var(--info-background-color)';
      } else {
        // Waiting zone - just gray with badge (progress = 0)
        checkbox.progress = 0;
      }
    } else {
      // Zone not in sequence or no active sequence
      checkbox.clearBadge();
    }
  });
}
```

#### 3. Modify Zone Interaction for Sequence Control
**File**: `html/js/screens/zone-list.js`
**Changes**: Override tap/long-press when sequence active

```javascript
// Modify onZoneChecking (around line 126-130)
onZoneChecking(e) {
  e.preventDefault();

  const checkbox = e.srcElement;
  const zoneId = parseInt(checkbox.getAttribute('zone-id'));

  // Check if this zone is in active sequence
  if (this.sequenceState?.active && App.sequence().order.includes(zoneId)) {
    // Sequence control: tap = pause/resume
    if (this.sequenceState.paused) {
      Http.post('api/sequence/resume');
    } else {
      Http.post('api/sequence/pause');
    }
    return;
  }

  // Normal zone toggle
  this.onZoneCheck(checkbox);
}

// Modify onZoneClick (around line 120-124)
onZoneClick(e) {
  const checkbox = e.srcElement;
  const zoneId = parseInt(checkbox.getAttribute('zone-id'));

  // Check if this zone is in active sequence
  if (this.sequenceState?.active && App.sequence().order.includes(zoneId)) {
    // Sequence control: long-press/double-tap = stop
    Http.post('api/sequence/stop');
    return;
  }

  // Normal behavior: navigate to zone detail
  Router.navigate('zone', { popup: true, params:{'zone-id': zoneId} });
}
```

#### 4. Existing Progress Tick Works As-Is
**File**: `html/js/screens/zone-list.js`
**Note**: The existing `tickProgress()` method already updates individual zone progress correctly. No changes needed - it will fill the current zone's progress from bottom up, and completed zones will stay at progress=1 (fully green).

#### 5. Fetch Initial Sequence State
**File**: `html/js/screens/zone-list.js`
**Changes**: Load sequence state on screen mount

```javascript
// In connectedCallback, after existing setup
async connectedCallback() {
  // ... existing code ...

  // Fetch initial sequence state
  try {
    const response = await Http.get('api/sequence/state');
    if (response.sequence) {
      this.sequenceState = response.sequence;
      this.updateSequenceDisplay();
    }
  } catch (err) {
    console.log('No active sequence');
  }
}
```

### Success Criteria:

#### Automated Verification:
- [ ] Web assets build: `deno task build`
- [ ] Generated headers updated in `arduino/html/`

#### Manual Verification:
- [ ] When sequence active, order badges (①②③) appear on sequenced zones
- [ ] Current zone shows green progress filling from bottom
- [ ] Completed zones stay fully green
- [ ] Waiting zones show gray (no fill) with badge
- [ ] Tap on sequenced zone pauses/resumes sequence (current zone turns yellow when paused)
- [ ] Long-press on sequenced zone stops sequence
- [ ] Non-sequenced zones behave normally

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 6: WebSocket Integration & Polish

### Overview
Ensure WebSocket messages properly propagate sequence state and handle edge cases.

### Changes Required:

#### 1. Include Sequence Order in WebSocket Messages
**File**: `arduino/sprinkler-state.h`
**Changes**: Add order array to sequence JSON

```cpp
// Modify SequenceSession::toJSON() to include order
const String toJSON() const {
  if (!active) return "null";

  // Build order array
  String orderJson = "[";
  auto& seq = Device.sequence();
  for (uint8_t i = 0; i < totalZones; i++) {
    if (i > 0) orderJson += ",";
    orderJson += String(seq.order[i]);
  }
  orderJson += "]";

  return "{ \"active\": true"
         ", \"paused\": " + String(paused ? "true" : "false") +
         ", \"currentIndex\": " + String(currentZoneIndex) +
         ", \"totalZones\": " + String(totalZones) +
         ", \"order\": " + orderJson +
         " }";
}
```

#### 2. Fire Sequence Event on State Changes
**File**: `arduino/sprinkler.cpp`
**Changes**: Broadcast sequence state when zone state changes

```cpp
// In start() method, after fireEvent("state", ...)
if (Timers.Sequence.active) {
  fireEvent("sequence", Timers.Sequence.toJSON().c_str());
}

// In stop() method, after fireEvent("state", ...)
fireEvent("sequence", Timers.Sequence.toJSON().c_str());

// In pause() method, after fireEvent("state", ...)
if (Timers.Sequence.active) {
  fireEvent("sequence", Timers.Sequence.toJSON().c_str());
}

// In resume() method, after fireEvent("state", ...)
if (Timers.Sequence.active) {
  fireEvent("sequence", Timers.Sequence.toJSON().c_str());
}
```

#### 3. Handle Manual Zone Start During Sequence
**File**: `arduino/sprinkler.cpp`
**Changes**: Stop sequence if user manually starts a zone

```cpp
// In start() method, at the beginning
void SprinklerControl::start(unsigned int zone, unsigned int duration) {
  // If manually starting a zone while sequence is active, stop the sequence
  // (This prevents conflicting controls)
  if (Timers.Sequence.active && !isInSequenceWindow()) {
    console.println("Manual start during sequence - stopping sequence");
    stopSequence();
  }

  // ... rest of start() method
}
```

#### 4. Update Frontend to Handle Order Array
**File**: `html/js/screens/zone-list.js`
**Changes**: Use order from WebSocket instead of App.sequence()

```javascript
// Modify updateSequenceDisplay to use order from WebSocket
updateSequenceDisplay() {
  const seq = this.sequenceState;

  // Use order from WebSocket if available, otherwise fall back to App.sequence()
  const sequenceOrder = seq?.order || App.sequence().order;

  // ... rest of method
}
```

### Success Criteria:

#### Automated Verification:
- [ ] Web assets build: `deno task build`
- [ ] Firmware compiles: `tools/arduino-cli compile --config-file arduino/arduino-cli.yaml --fqbn esp32:esp32:esp32wrover --output-dir .bin arduino/arduino.ino`
- [ ] No compiler warnings

#### Manual Verification:
- [ ] WebSocket messages include `order` array when sequence active
- [ ] UI updates immediately when sequence state changes
- [ ] Manual zone start during sequence stops the sequence
- [ ] Progress fills smoothly from bottom up
- [ ] Completed zones remain green after their timer finishes
- [ ] No memory leaks or crashes during extended operation

**Implementation Note**: This is the final phase. After completing verification, the feature is ready for production use.

---

## Testing Strategy

### Unit Tests:
- isInSequenceWindow() with different days/times
- getZoneSequenceIndex() returns correct values
- SequenceSession state transitions

### Integration Tests:
- Complete sequence flow: start → progress → complete
- Pause/resume preserves state correctly
- Stop cancels remaining zones

### Manual Testing Steps:
1. Configure sequence with 3 zones, 2-minute durations, 1-minute gaps
2. Wait for scheduled start time
3. Verify badges ①②③ appear on sequenced zones
4. Verify current zone fills green from bottom
5. When first zone completes, verify it stays green and second zone starts filling
6. Tap current zone - verify it pauses (turns yellow)
7. Tap again - verify resume (turns green, continues filling)
8. Long-press - verify sequence stops completely
9. Verify WebSocket updates in browser dev tools

## Performance Considerations

- WebSocket broadcasts are small JSON payloads (~100 bytes)
- Two-layer icons use CSS clip-path - GPU accelerated
- No additional polling needed - progress calculated from zone timer
- Completed zones stay green with no ongoing computation

## Migration Notes

No EEPROM migration needed - `SprinklerSequenceConfig` structure unchanged. `SequenceSession` is runtime-only state that resets on boot.

## References

- Research document: `.claude/thoughts/shared/research/2026-01-05-sequence-progress-ui-requirements.md`
- Current icon implementation: `html/js/controls/checkbox.js:54-70`
- Zone state handling: `html/js/screens/zone-list.js:189-225`
- Sequence config: `arduino/sprinkler-config.h:24-45`
- Timer state: `arduino/sprinkler-state.h:10-72`
