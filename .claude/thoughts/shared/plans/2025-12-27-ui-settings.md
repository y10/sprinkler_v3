# UI Settings Additions

## Overview

Add missing configuration options to the web UI settings: Log Level control, Alexa Enable/Disable, and a Console log viewer.

## UI Structure

### Main Menu
```
┌──────────────────┐
│      setup       │  regular → opens Setup slider (renamed from "general")
├──────────────────┤
│      zones       │  regular
├──────────────────┤
│   city water     │  blue (toggles)
│   well water     │  green (toggles)
├──────────────────┤
│     schedule     │  regular
├──────────────────┤
│     enabled      │  regular (toggles scheduler on/off)
├──────────────────┤
│  firmware update │  yellow (warn)
├──────────────────┤
│  factory reset   │  red (alert)
├──────────────────┤
│     console      │  regular ← NEW
├──────────────────┤
│     restart      │  yellow (warn) ← ADD COLOR
└──────────────────┘
```

### Setup Slider (via "setup" button)
```
[General] → [WiFi] → [MQTT] → [Alexa] → [Time]
    │          │        │         │        │
    │          │        │         │        └── NTP/timezone
    │          │        │         │
    │          │        │         └── Device buttons (see Alexa Panel below)
    │          │        │
    │          │        └── Broker host/port
    │          │            Username/password
    │          │            Enable button
    │          │
    │          └── WiFi SSID/password
    │
    └── Device name, hostname
```

### Console View (via "console" menu button)
```
┌─────────────────────────────────┐
│  none  error  warn  info    ☰╲  │
├─────────────────────────────────┤
│ [http] Started.                 │
│ [alxa] Registered: Sprinklers   │
│ [http] [1] Connected from ...   │
│ [warn] Schedule skipped...      │
└─────────────────────────────────┘
```
- Log level toggles: color-coded (none=muted, error=red, warn=yellow, info=white)
- Clear button: list icon with slash (☰╲)
- Logs: real-time via WebSocket, color-coded by level

### Alexa Panel
```
┌─────────────────────────────────┐
│            Alexa                │
│                                 │
│  ┌─────────────────────────┐    │
│  │      Sprinklers         │    │  ← toggle (green=on, gray=off)
│  └─────────────────────────┘    │
│  ┌─────────────────────────┐    │
│  │      Front Yard         │    │  ← read-only
│  └─────────────────────────┘    │
│  ┌─────────────────────────┐    │
│  │      Back Yard          │    │  ← read-only
│  └─────────────────────────┘    │
│                                 │
│               ● ○ ○ ○ ○         │
└─────────────────────────────────┘
```
- Sprinklers button: toggle enabled/disabled (color-coded, requires reboot)
- Zone buttons: read-only, show zone names only (no "Sprinkler at" prefix)

**Future enhancement:** Add usage counter per zone (stored in RAM)

## Current State

- Log Level exists in EEPROM (`loglevel`) and is returned in `toJSON()` but cannot be changed via UI
- Alexa enable/disable doesn't exist - Alexa is always enabled if WiFi is in STA mode
- No console/log viewer in UI

## Changes Required

### Phase 1: Backend - Add Alexa Enable to Config

#### 1. Update Config Structure
**File**: `arduino/sprinkler-config.h`

Add `alexa_enabled` field to `SprinklerConfig`:
```cpp
struct SprinklerConfig
{
  uint8_t version;
  uint8_t loglevel;
  char full_name[50];
  char host_name[50];
  char disp_name[50];
  char source;
  bool alexa_enabled;  // ADD THIS
  SprinklerZoneConfig zones[SKETCH_MAX_ZONES];
  SprinklerConfig(): version(0), full_name({0}), host_name({0}), disp_name({0}),
    source('P'), alexa_enabled(true) {}  // Default enabled
};
```

#### 2. Add Device Accessors
**File**: `arduino/sprinkler-device.h`

Add accessor methods:
```cpp
bool alexaEnabled() { return config.alexa_enabled; }
void alexaEnabled(bool enabled) { config.alexa_enabled = enabled; }
```

#### 3. Update JSON Serialization
**File**: `arduino/sprinkler.h`

Update `toJSON()` to include `alexaEnabled`:
```cpp
String toJSON() {
  return (String) "{ \"logLevel\": " + (String)Device.logLevel() +
    ", \"alexaEnabled\": " + (Device.alexaEnabled() ? "true" : "false") +
    ", \"name\": \"" + Device.dispname() +
    "\", \"ssid\": \"" + wifissid() +
    "\", \"host\": \"" + Device.hostname() +
    "\", \"zones\": " + Settings.toJSON() +
    ", \"source\": \"" + Device.source() +
    "\", \"enabled\": " + isEnabled() + " }";
}
```

Note: Changed `logLevel` from string to number for easier UI handling.

#### 4. Update JSON Parsing
**File**: `arduino/sprinkler.cpp`

Add handlers in `fromJSON()`:
```cpp
if (json.containsKey("logLevel")) {
  Device.logLevel(json["logLevel"].as<uint8_t>());
  Console.logLevel((logLevel_t)json["logLevel"].as<uint8_t>());
  dirty = true;
}

if (json.containsKey("alexaEnabled")) {
  Device.alexaEnabled(json["alexaEnabled"].as<bool>());
  dirty = true;
}
```

#### 5. Update Alexa Setup
**File**: `arduino/sprinkler-alexa.h`

Check `alexaEnabled` before setup:
```cpp
void setupAlexa() {
  if (!(WiFi.getMode() & WIFI_STA)) {
    alexa_console.println("Skipped (not in STA mode)");
    return;
  }

  if (!Sprinkler.Device.alexaEnabled()) {
    alexa_console.println("Disabled");
    return;
  }

  // ... rest of setup
}

void handleAlexa() {
  if (fauxmo && Sprinkler.Device.alexaEnabled() && (WiFi.getMode() & WIFI_STA)) {
    fauxmo->handle();
  }
}
```

### Phase 2: Web UI - Add Alexa Settings Panel

#### 1. Create Alexa Settings Component
**File**: `html/js/screens/setup-alexa.js` (new file)

Shows the Alexa enable toggle and read-only zone device list.

#### 2. Add App Getters
**File**: `html/js/system/app.js`

Add getters:
```javascript
logLevel() {
  const { logLevel } = this.$settings;
  return logLevel ?? 3;  // Default to Info
}

alexaEnabled() {
  const { alexaEnabled } = this.$settings;
  return alexaEnabled ?? true;  // Default enabled
}
```

#### 3. Register Component
**File**: `html/js/setup.js`

Add import:
```javascript
import { AlexaSettings } from "./screens/setup-alexa";
```

Add to registration:
```javascript
'sprinkler-setup-alexa': AlexaSettings,
```

#### 4. Add to Settings Slider
**File**: `html/js/screens/setup.js`

Update HTML:
```javascript
const html = `
<sketch-slider>
  <sprinkler-setup-general></sprinkler-setup-general>
  <sprinkler-setup-wifi></sprinkler-setup-wifi>
  <sprinkler-setup-alexa></sprinkler-setup-alexa>
  <sprinkler-time></sprinkler-time>
</sketch-slider>
`
```

### Success Criteria

#### Automated Verification:
- [x] Web UI builds: `deno task build`
- [x] Firmware compiles: `deno task compile`

#### Manual Verification:
- [ ] Alexa settings panel appears in Setup slider
- [ ] Alexa toggle button shows current state (green=enabled)
- [ ] Zone names appear as read-only buttons
- [ ] Disabling Alexa stops discovery/control (after reboot)
- [ ] Re-enabling Alexa restores functionality (after reboot)

## Testing

1. Build and upload firmware
2. Open Settings → Advanced
3. Change log level to "Error", save
4. Reboot, verify log level persisted
5. Uncheck "Enable Alexa", save, reboot
6. Verify Alexa no longer discovers device
7. Re-enable Alexa, reboot, verify discovery works

### Phase 3: Console View (with Log Level Controls)

#### 1. Create Console Component
**File**: `html/js/screens/console.js` (new file)

Console view includes:
- Log level toggle buttons at top (none, error, warn, info) - color-coded
- Clear button
- Scrollable log display with real-time updates

```javascript
import { jQuery } from "../system/jquery";
import { Log } from "../system/log";
import { App } from "../system/app";

const html = `
<div class="container">
  <div class="header">
    <div class="levels">
      <button class="level-btn" data-level="0">none</button>
      <button class="level-btn" data-level="1">error</button>
      <button class="level-btn" data-level="2">warn</button>
      <button class="level-btn" data-level="3">info</button>
    </div>
    <button id="clear">Clear</button>
  </div>
  <div id="logs"></div>
</div>
`;

const style = `
<style>
.container {
  width: 90vw;
  max-width: 500px;
  height: 70vh;
  display: flex;
  flex-direction: column;
}
.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}
h1 {
  margin: 0;
  font-size: 1.5rem;
}
#clear {
  padding: 4px 12px;
  border: 0;
  border-radius: 4px;
  background: var(--secondary-background-color);
  color: var(--secondary-text-color);
}
#logs {
  flex: 1;
  overflow-y: auto;
  background: #1a1a1a;
  border-radius: 4px;
  padding: 8px;
  font-family: monospace;
  font-size: 0.85rem;
}
.log-entry {
  margin: 2px 0;
  word-break: break-all;
}
.log-error { color: #ff6b6b; }
.log-warn { color: #ffd93d; }
.log-info { color: #e0e0e0; }
.log-scope {
  color: #6bcfff;
  margin-right: 4px;
}
</style>
`;

export class Console extends HTMLElement {
  connectedCallback() {
    this.jQuery = jQuery(this).attachShadowTemplate(style + html, ($) => {
      this.$logs = $("#logs");
      $("#clear").on("click", () => this.clear());

      // Subscribe to WebSocket log events
      this.unsubscribe = App.on("event", (log) => this.addLog(log));

      // Load existing logs
      this.loadLogs();
    });
  }

  disconnectedCallback() {
    if (this.unsubscribe) this.unsubscribe();
    this.jQuery().detach();
  }

  async loadLogs() {
    try {
      const logs = await Http.json("GET", "esp/log");
      logs.forEach(log => this.addLog(log));
    } catch (e) {
      console.error("Failed to load logs", e);
    }
  }

  addLog(log) {
    const level = log.error ? "error" : log.warn ? "warn" : "info";
    const message = log.error || log.warn || log.info || "";
    const entry = document.createElement("div");
    entry.className = `log-entry log-${level}`;
    entry.innerHTML = `<span class="log-scope">[${log.scope}]</span>${this.escapeHtml(message)}`;
    this.$logs.item().appendChild(entry);
    this.$logs.item().scrollTop = this.$logs.item().scrollHeight;
  }

  escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  clear() {
    this.$logs.item().innerHTML = "";
  }
}
```

#### 2. Add Console Button to Menu
**File**: `html/js/screens/menu.js`

Add button in template after schedule:
```javascript
<button id="console">console</button>
```

Add click handler:
```javascript
$('#console').on('click', this.gotoConsole.bind(this));
```

Add method:
```javascript
gotoConsole() {
  Router.navigate('console');
}
```

#### 3. Register Route and Component
**File**: `html/js/index.js`

Add import:
```javascript
import { Console } from "./screens/console";
```

Add to customElements:
```javascript
'sprinkler-console': Console,
```

Add route:
```javascript
{ path: 'console', component: 'sprinkler-console' },
```

### Success Criteria

#### Automated Verification:
- [x] Web UI builds: `deno task build`
- [x] Firmware compiles: `deno task compile`

#### Manual Verification:
- [ ] Alexa settings panel appears in Setup slider (General -> WiFi -> Alexa -> Time)
- [ ] Alexa toggle button shows current state (green=enabled)
- [ ] Zone names appear as read-only buttons
- [ ] Disabling Alexa stops discovery/control (after reboot)
- [ ] Re-enabling Alexa restores functionality (after reboot)
- [ ] Console button appears in menu
- [ ] Console view shows log level toggle buttons at top
- [ ] Log level toggles are color-coded and persist selection
- [ ] Console view shows existing logs
- [ ] New logs appear in real-time via WebSocket
- [ ] Clear button clears the log view

## Notes

- Alexa enable/disable requires reboot to take effect
- Log level takes effect immediately for new messages
- Both settings persist in EEPROM
- Console view receives real-time logs via existing WebSocket events
