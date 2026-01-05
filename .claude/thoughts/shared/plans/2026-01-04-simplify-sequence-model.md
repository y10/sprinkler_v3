# Persist Sequence to EEPROM Implementation Plan (v2)

## Overview

Add sequence as a first-class persisted object in EEPROM. The sequence stores zone order, scheduled days, start time, duration, and gap - eliminating the lossy derivation that currently occurs on page reload.

## Current State Analysis

The sequence model exists only in the UI and is "derived" from zone timers on load. This causes:
- Combined paths after restart
- Lost duration changes
- Unreliable reconstruction of user intent

### Current Data Flow (Broken)
```
User → Sequence → Zone Timers → POST /api/settings → EEPROM (zones only)
                                                          ↓
User ← Derived Sequence (lossy!) ← GET /api/settings ← EEPROM
```

### Key Discoveries:
- EEPROM has 4096 bytes, currently using ~1400 bytes (`sprinkler-device.h:10`)
- `SprinklerConfig` stored at address 0 via `EEPROM.put()` (`sprinkler-device.cpp:178`)
- Backend `toJSON()` doesn't include sequence (`sprinkler.h:62-75`)
- Frontend `save()` doesn't send sequence (`html/js/system/app.js:281`)
- Derivation logic in `deriveSequenceFromZones()` (`html/js/system/app.js:200-272`)

## Desired End State

Sequence survives restart exactly as configured:
```
User → Sequence → Zone Timers → POST /api/settings → EEPROM (zones + sequence)
                                                          ↓
User ← Sequence (exact!) ← GET /api/settings ← EEPROM
```

### Verification:
1. Create sequence with zones [1,3,2], days Mon+Wed, 06:00, 15min duration, 5min gap
2. Save settings
3. Reload page
4. Verify sequence loaded exactly as saved (not derived)
5. Restart ESP32
6. Reload page
7. Verify sequence still matches original configuration

## What We're NOT Doing

- Not changing how zone timers are stored (they remain per-zone per-day)
- Not adding "override" functionality for individual zone times (future work)
- Not modifying the PatternConnector or WeekPicker UI components
- Not changing the sequence-builder screen logic

## API Contract

### GET /api/settings Response
```json
{
  "sequence": {
    "order": [1, 3, 2],
    "days": ["mon", "wed", "fri"],
    "startHour": 6,
    "startMinute": 0,
    "duration": 15,
    "gap": 5
  },
  "zones": {
    "1": { "name": "Zone 1", "days": { "mon": [{ "h": 6, "m": 0, "d": 15 }] } }
  }
}
```

When no sequence is configured, `sequence` will be `null`.

### POST /api/settings Request
Same structure - sequence object included at top level alongside zones.

## Implementation Approach

The change flows through four layers:
1. **EEPROM** - Add `SprinklerSequenceConfig` struct (~12 bytes)
2. **Backend** - Serialize/deserialize sequence in JSON API
3. **Frontend Storage** - Include sequence in save payload
4. **Frontend Load** - Use stored sequence instead of deriving

---

## Phase 1: EEPROM Data Structure

### Overview
Add `SprinklerSequenceConfig` struct to store sequence configuration alongside existing zone data.

### Changes Required:

#### 1. Add sequence config struct
**File**: `arduino/sprinkler-config.h`
**Changes**: Add new struct and field to SprinklerConfig

```cpp
// Add after SprinklerZoneConfig struct (line 22)

struct SprinklerSequenceConfig
{
  bool enabled;               // Whether sequence is active
  uint8_t order[6];           // Zone indices in order (0 = not used)
  uint8_t order_count;        // Number of zones in sequence
  uint8_t days;               // Bitmask: bit 0=Sun, 1=Mon, 2=Tue, ... 6=Sat
  uint8_t hour;               // Start hour (0-23)
  uint8_t minute;             // Start minute (0-59)
  uint8_t duration;           // Duration per zone in minutes
  uint8_t gap;                // Gap between zones in minutes

  SprinklerSequenceConfig()
    : enabled(false), order{0}, order_count(0), days(0),
      hour(6), minute(0), duration(15), gap(5) {}
};
```

```cpp
// Add to SprinklerConfig struct (after mqtt_enabled, before zones[])

  SprinklerSequenceConfig sequence;
```

### Success Criteria:

#### Automated Verification:
- [x] Firmware compiles: `tools/arduino-cli compile --config-file arduino/arduino-cli.yaml --fqbn esp32:esp32:esp32wrover --output-dir .bin arduino/arduino.ino`
- [x] No compiler warnings about struct size or alignment

#### Manual Verification:
- [x] Firmware uploads to ESP32 without error

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Backend Sequence Serialization

### Overview
Add methods to serialize sequence to JSON and deserialize from JSON, integrating with existing `toJSON()` and `fromJSON()` flow.

### Changes Required:

#### 1. Add sequence JSON methods to SprinklerControl
**File**: `arduino/sprinkler.h`
**Changes**: Update `toJSON()` to include sequence

The `toJSON()` method at line 62-75 needs to include sequence data:

```cpp
// Replace toJSON() method (line 62-75)
String toJSON() {
  return (String) "{ \"logLevel\": " + (String)logLevelNumber() +
    ", \"alexaEnabled\": " + (Device.alexaEnabled() ? "true" : "false") +
    ", \"mqttHost\": \"" + Device.mqttHost() +
    "\", \"mqttPort\": " + Device.mqttPort() +
    ", \"mqttUser\": \"" + Device.mqttUser() +
    "\", \"mqttEnabled\": " + (Device.mqttEnabled() ? "true" : "false") +
    ", \"name\": \"" + Device.dispname() +
    "\", \"ssid\": \"" + wifissid() +
    "\", \"host\": \"" + Device.hostname() +
    "\", \"zones\": " + Settings.toJSON() +
    ", \"sequence\": " + sequenceToJSON() +
    ", \"source\": \"" + Device.source() +
    "\", \"enabled\": " + isEnabled() + " }";
}

// Add new method declaration
String sequenceToJSON();
```

#### 2. Implement sequenceToJSON in sprinkler.cpp
**File**: `arduino/sprinkler.cpp`
**Changes**: Add implementation after line 191 (after fromJSON)

```cpp
String SprinklerControl::sequenceToJSON() {
  SprinklerSequenceConfig& seq = Device.sequence();

  if (!seq.enabled || seq.order_count == 0) {
    return "null";
  }

  String json = "{\"order\":[";
  for (uint8_t i = 0; i < seq.order_count; i++) {
    if (i > 0) json += ",";
    json += String(seq.order[i]);
  }
  json += "],\"days\":[";

  // Convert bitmask to day names
  const char* dayNames[] = {"sun", "mon", "tue", "wed", "thu", "fri", "sat"};
  bool first = true;
  for (int i = 0; i < 7; i++) {
    if (seq.days & (1 << i)) {
      if (!first) json += ",";
      json += "\"";
      json += dayNames[i];
      json += "\"";
      first = false;
    }
  }
  json += "],\"startHour\":" + String(seq.hour);
  json += ",\"startMinute\":" + String(seq.minute);
  json += ",\"duration\":" + String(seq.duration);
  json += ",\"gap\":" + String(seq.gap);
  json += "}";

  return json;
}
```

#### 3. Add sequence parsing to fromJSON
**File**: `arduino/sprinkler.cpp`
**Changes**: Add sequence handling in `fromJSON()` (around line 179, before zones handling)

```cpp
// Add before the zones handling block (line 179)
if (json.containsKey("sequence")) {
  JsonObject seqJson = json["sequence"].as<JsonObject>();
  if (!seqJson.isNull()) {
    SprinklerSequenceConfig& seq = Device.sequence();

    // Parse order array
    JsonArray orderArr = seqJson["order"].as<JsonArray>();
    seq.order_count = 0;
    memset(seq.order, 0, sizeof(seq.order));
    for (JsonVariant v : orderArr) {
      if (seq.order_count < 6) {
        seq.order[seq.order_count++] = v.as<uint8_t>();
      }
    }

    // Parse days array to bitmask
    seq.days = 0;
    JsonArray daysArr = seqJson["days"].as<JsonArray>();
    for (JsonVariant v : daysArr) {
      const char* day = v.as<const char*>();
      if (strcmp(day, "sun") == 0) seq.days |= (1 << 0);
      else if (strcmp(day, "mon") == 0) seq.days |= (1 << 1);
      else if (strcmp(day, "tue") == 0) seq.days |= (1 << 2);
      else if (strcmp(day, "wed") == 0) seq.days |= (1 << 3);
      else if (strcmp(day, "thu") == 0) seq.days |= (1 << 4);
      else if (strcmp(day, "fri") == 0) seq.days |= (1 << 5);
      else if (strcmp(day, "sat") == 0) seq.days |= (1 << 6);
    }

    seq.hour = seqJson["startHour"] | 6;
    seq.minute = seqJson["startMinute"] | 0;
    seq.duration = seqJson["duration"] | 15;
    seq.gap = seqJson["gap"] | 5;
    seq.enabled = (seq.order_count > 0 && seq.days > 0);

    dirty = true;
  }
}
```

#### 4. Add sequence accessor to SprinklerDevice
**File**: `arduino/sprinkler-device.h`
**Changes**: Add sequence member and accessor

```cpp
// Add private member after mqtt_enabled (around line 29)
SprinklerSequenceConfig seq_config;

// Add public accessor method (around line 95)
SprinklerSequenceConfig& sequence() { return seq_config; }
```

#### 5. Update device load/save for sequence
**File**: `arduino/sprinkler-device.cpp`
**Changes**: Load and save sequence in EEPROM operations

In `load()` method (around line 143, before `unitLog.print("rev:")`)`:
```cpp
    // Load sequence config
    seq_config = cfg.sequence;
    unitLog.print("sequence enabled: ");
    unitLog.println(seq_config.enabled ? "yes" : "no");
```

In `save()` method (around line 175, before `cfg.version = version + 1`):
```cpp
  cfg.sequence = seq_config;
```

### Success Criteria:

#### Automated Verification:
- [x] Firmware compiles: `tools/arduino-cli compile --config-file arduino/arduino-cli.yaml --fqbn esp32:esp32:esp32wrover --output-dir .bin arduino/arduino.ino`
- [x] No compiler warnings

#### Manual Verification:
- [x] GET /api/settings returns `sequence` field (null if empty)
- [x] POST /api/settings with sequence data persists correctly
- [x] After ESP32 restart, GET /api/settings returns previously saved sequence

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Frontend - Send Sequence in Save

### Overview
Modify the frontend save flow to include sequence data in the POST request.

### Changes Required:

#### 1. Include sequence in save payload
**File**: `html/js/system/app.js`
**Changes**: Update `save()` method to include sequence

```javascript
// Replace save() method (lines 274-297)
async save() {
  const spinner = Status.wait();
  const logLevel = this.logLevel();
  const chip = this.hostname();
  const name = this.friendlyName();
  const zones = this.$zones.toJson();
  const sequence = this.$sequence ? this.$sequence.toJson() : null;
  const state = { logLevel, name, chip, zones, sequence };
  try {
    const json = await Store.put(state);
    if (json && json !== state) {
      this.$settings = { ...json };
      if ("zones" in json && Object.keys(json.zones).length > 0) {
        this.$zones = new ZoneSet(json.zones);
      }
      if ("sequence" in json && json.sequence) {
        this.$sequence = new Sequence(json.sequence);
      }
      return true;
    }
  } catch (error) {
    Status.error(error);
  }

  spinner.close();
  return false;
}
```

### Success Criteria:

#### Automated Verification:
- [x] Web assets build: `deno task build`
- [x] No JavaScript errors in browser console

#### Manual Verification:
- [x] Open Network tab, save settings, verify POST body includes `sequence` object
- [x] Sequence data matches what was configured in UI

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: Frontend - Load Sequence from Backend

### Overview
Use the sequence returned from backend instead of deriving it from zones.

### Changes Required:

#### 1. Simplify load() to use backend sequence
**File**: `html/js/system/app.js`
**Changes**: Update `load()` method (lines 179-198)

```javascript
// Replace load() method (lines 179-198)
async load(modules) {
  try {
    const { zones, sequence } = await this.settings();
    if (zones && Object.keys(zones).length > 0) {
      this.$zones = new ZoneSet(zones);
    }
    if (sequence) {
      // Use sequence from backend directly - no derivation needed
      this.$sequence = new Sequence(sequence);
      console.log('[Sequence] Loaded from backend:', sequence);
    } else {
      // No sequence configured yet - start with empty
      this.$sequence = new Sequence();
      console.log('[Sequence] No sequence in backend, starting fresh');
    }
    Module.register(modules);
  } catch(error) {
    console.log(error);
    Module.register(modules);
    Status.error("Failed to load zones from the server. <a href='./index.html' taget='self'>Reload</a>");
  }
}
```

#### 2. Remove deriveSequenceFromZones method
**File**: `html/js/system/app.js`
**Changes**: Delete or comment out `deriveSequenceFromZones()` method (lines 200-272)

This method is no longer needed since sequence comes from backend.

```javascript
// DELETE or comment out the entire deriveSequenceFromZones method (lines 200-272)
// The method was used for backward compatibility but is now obsolete
```

### Success Criteria:

#### Automated Verification:
- [x] Web assets build: `deno task build`
- [x] No JavaScript errors in browser console

#### Manual Verification:
- [x] Create sequence with zones [1,3,2], days Mon+Wed, 06:00
- [x] Save settings
- [x] Reload page - sequence appears exactly as saved
- [x] Restart ESP32 from UI (Settings > Restart)
- [x] Reload page - sequence still appears exactly as saved
- [x] Check console logs show "Loaded from backend" not "Derived from zones"

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:
- N/A - ESP32 Arduino project doesn't have unit test framework

### Integration Tests:
- Backend JSON round-trip: POST sequence, GET sequence, verify match
- EEPROM persistence: Save, restart, load, verify match

### Manual Testing Steps:
1. Create new sequence with 3 zones in specific order
2. Select Mon, Wed, Fri days
3. Set start time to 06:00
4. Set duration to 20 minutes (non-default)
5. Set gap to 3 minutes (non-default)
6. Save settings
7. Reload page - verify all settings preserved
8. Power cycle ESP32
9. Reload page - verify all settings still preserved
10. Modify sequence order
11. Save and reload - verify new order preserved

## Performance Considerations

- Sequence struct adds ~12 bytes to EEPROM usage (well within 4096 byte limit)
- JSON serialization adds ~100-200 bytes to GET/POST payload (negligible)
- No impact on timer scheduling performance

## Migration Notes

- Existing installations with zones but no sequence will get empty sequence on first load
- Users will need to re-create their sequence once after update
- Zone timer data is NOT affected - schedules continue to work

## References

- Research: `.claude/thoughts/shared/research/2026-01-04-sequence-scheduling-architecture.md`
- Current config struct: `arduino/sprinkler-config.h:6-44`
- Current toJSON: `arduino/sprinkler.h:62-75`
- Current fromJSON: `arduino/sprinkler.cpp:111-191`
- Frontend save: `html/js/system/app.js:274-297`
- Frontend load: `html/js/system/app.js:179-198`

## Future Work: Zone Timer Override

After this plan is implemented, consider adding per-zone timer override tracking. This would allow:

1. **Sequence as template** - Sequence generates zone timers automatically
2. **Individual overrides** - Users can modify a zone's timer without breaking the sequence
3. **Override indicator in UI** - Show "sequence default" vs "override" state

### Proposed Data Model (for future implementation)

```javascript
// Frontend tracking
zones["1"].days["mon"] = [{ h: 6, m: 0, d: 15, override: true }]
```

### UI Changes (future)

- Zone settings screen shows indicator when timer differs from sequence
- "Reset to sequence" button to clear override
- Visual distinction between sequence-generated and manually-set times

This builds on the persisted sequence foundation established by this plan.
