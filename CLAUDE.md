# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an ESP32-based sprinkler controller firmware that manages up to 6 zones with scheduling capabilities, Alexa integration, and a web-based UI. The system operates entirely on the local network without cloud dependencies.

**Key Features:**
- Multi-zone irrigation control (up to 6 zones)
- Web-based control interface with scheduling
- Alexa voice control integration via FauxmoESP
- OTA (Over-The-Air) firmware updates
- NTP time synchronization
- WiFi configuration with AP fallback mode
- WebSocket-based real-time updates

## Build Commands

### Web UI Build
The web interface must be built before compiling the Arduino firmware:

```bash
deno task build
```

This processes HTML/CSS/JS files from `html/` directory using Deno:
1. Copies files to `arduino/html/`
2. Generates `config.js` from `.sprinkler/settings.json`
3. Bundles and minifies JavaScript (index.js, setup.js) with esbuild
4. Inlines JS into HTML and minifies
5. Gzips all assets
6. Converts to C header files (.h) with PROGMEM byte arrays
7. Generates version header (`settings.json.h`)
8. Increments build number in settings.json

### Arduino Firmware Build
The project uses `arduino-cli` for compilation (not the Arduino IDE extension):

```bash
tools/arduino-cli compile --config-file arduino/arduino-cli.yaml --fqbn esp32:esp32:esp32wrover --output-dir .bin arduino/arduino.ino
```

- **FQBN**: `esp32:esp32:esp32wrover` (ESP32 WROVER module)
- **ESP32 Core**: 2.0.17 (required for library compatibility)
- **Config file**: `arduino/arduino-cli.yaml` (sets library path)
- **Sketch**: `arduino/arduino.ino`
- **Output**: `.bin/arduino.ino.bin`

### Firmware Publishing
To deploy firmware to OTA server:

```bash
publish.cmd
```

This copies `arduino.ino.bin` to the network OTA location specified in `.sprinkler/settings.json`.

## Architecture

### Core Module Structure

The firmware is organized into modular header files with clear separation of concerns:

- **sprinkler.h** - Main controller class (`SprinklerControl`) exposing public API
- **sprinkler-device.h** - Hardware abstraction (relay control, EEPROM, GPIO)
- **sprinkler-settings.h** - Zone configuration and timer settings
- **sprinkler-schedule.h** - Timer scheduling with TimeAlarms library
- **sprinkler-state.h** - Runtime state (active watering, zone timers)
- **sprinkler-http.h** - AsyncWebServer endpoints and WebSocket handlers
- **sprinkler-wifi.h** - WiFi connection and AP mode fallback
- **sprinkler-ota.h** - OTA update handling
- **sprinkler-alexa.h** - Alexa integration via FauxmoESP
- **sprinkler-time.h** - NTP time synchronization
- **sprinkler-setup.h** - Device initialization
- **sprinkler-pinout.h** - GPIO pin definitions
- **sprinkler-config.h** - EEPROM configuration structures

### Data Model

**Configuration Hierarchy:**
```
SprinklerConfig (EEPROM-persisted)
├── Device metadata (name, hostname, log level)
├── Water source pin mapping
└── SprinklerZoneConfig[6]
    ├── Zone name
    └── SprinklerTimerConfig[8]  (7 weekdays + 1 "everyday")
        ├── Hour, minute
        └── Duration in minutes
```

**Runtime State:**
```
SprinklerControl (global: Sprinkler)
├── SprinklerSettings (zones with schedules)
│   └── SprinklerZone[N]
│       └── SprinklerSchedule (ScheduleDay per weekday)
│           └── SprinklerTimer[N] (AlarmID-tracked timers)
└── SprinklerState (active watering)
    └── SprinklerZoneTimer[N] (Ticker-based countdown)
```

### Initialization Flow

The `setup()` function in `arduino.ino` calls:
1. `setupUnit()` - Initialize device, load EEPROM config
2. `setupWifi()` - Connect to WiFi or start AP mode
3. `setupDhcp()` - Configure network
4. `setupTime()` - Sync with NTP server
5. `setupHttp()` - Start web server on port 80
6. `setupOTA()` - Enable OTA updates
7. `setupAlexa()` - Register Alexa devices

### Key Design Patterns

**Event System:**
The `SprinklerControl` class implements an event emitter pattern:
```cpp
Sprinkler.on("state", [](const char *event) { /* callback */ });
```
Events are fired for state changes and broadcast via WebSocket to connected clients.

**Timer Abstraction:**
Two timer types coexist:
- **SprinklerTimer**: Scheduled events using TimeAlarms library (integrated with time-of-day)
- **SprinklerZoneTimer**: Runtime countdown using Ticker library (duration-based)

**Settings vs State:**
- `SprinklerSettings`: Persistent configuration (schedules, zone names)
- `SprinklerState`: Transient runtime state (active watering sessions)

### Web UI Integration

HTML files are converted to gzipped C header files:
- `index.html` → `index.html.gz.h` with `SKETCH_INDEX_HTML_GZ` byte array
- Served with Last-Modified headers for caching
- WebSocket at `/ws` for real-time state updates

### HTTP API Endpoints

**Zone Control:**
- `GET /api/zone/{id}/start?d={duration}` - Start watering
- `GET /api/zone/{id}/stop` - Stop watering
- `GET /api/zone/{id}/pause` - Pause timer
- `GET /api/zone/{id}/resume` - Resume timer
- `GET /api/zone/{id}/state` - Get zone state

**System:**
- `GET /api/state` - All zones state
- `POST /api/settings` - Update configuration
- `GET /esp/update` - OTA update endpoint

### Configuration File

`.sprinkler/settings.json` defines build-time constants:
```json
{
  "version": "3.0.2.9",
  "maxZones": 6,
  "maxTimers": 2,
  "timeLimit": 15,
  "firmwareUrl": "http://ota.voights.net/sprinkler_v3.bin"
}
```

These values are injected into:
- `html/settings.json.h` (C header with `SKETCH_MAX_ZONES` defines)
- `html/js/config.js` (JavaScript constants)

## Important Constraints

- **Maximum zones**: 6 (hardware limitation)
- **Maximum timers per day per zone**: 2 (configurable in settings.json)
- **Time limit per session**: 30 minutes max
- **EEPROM size**: 4096 bytes
- **Web server port**: 80 (hardcoded)
- **WebSocket path**: /ws

## Dependencies

**Arduino Libraries (in `arduino/libraries/`):**
- ESPAsyncWebServer - Async HTTP server
- AsyncTCP - Async TCP library for ESP32
- ArduinoJson - JSON parsing/serialization
- FauxmoESP - Alexa emulation
- TimeAlarms - Scheduled timer events
- Time - Time handling
- WsConsole - WebSocket-based console logging

**Deno Build Tools:**
- Deno runtime (v2.0+) - Build script execution
- npm:esbuild - JavaScript bundling (via Deno's npm compatibility)
- npm:html-minifier-terser - HTML minification
- Built-in CompressionStream - Gzip compression

## IDE Keyboard Shortcuts (Cursor/VS Code)

These shortcuts are defined in the user-level `keybindings.json` and map to tasks in `.vscode/tasks.json`:

| Shortcut | Task | Description |
|---|---|---|
| `Ctrl+Shift+T` | Prebuild HTML (Dev) | Build web UI in dev mode |
| `Ctrl+Shift+C` | Compile ESP32 | Build HTML + compile firmware |
| `Ctrl+Shift+U` | Upload OTA | Upload firmware to device (prompts for IP) |
| `Ctrl+Shift+I` | Publish OTA | Full deploy: build + compile + upload |

Default device IP: `192.168.0.120`

## Development Notes

- The firmware entry point is `arduino/arduino.ino`, NOT a file named `sprinkler.ino`
- All sprinkler-specific logic is in header files (`.h`), not separate `.cpp` files
- HTML source files are in `html/`, compiled versions in `arduino/html/`
- Never edit files in `arduino/html/` directly - they are generated by `deno task build`
- The build process must run `deno task build` before `arduino-cli compile` to generate headers
- GPIO pin assignments are in `sprinkler-pinout.h` (device-specific)
- Water source control pin is separate from zone pins (index 0 in pins array)
