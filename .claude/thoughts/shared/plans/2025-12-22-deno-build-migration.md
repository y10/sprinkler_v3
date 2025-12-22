# Deno Build Migration Implementation Plan

## Overview

Migrate the web asset build system from Node.js/gulp to Deno. Create a single `build.ts` script that replaces `gulpfile.js` and `tools/arduino-gulp/`, eliminating the `node_modules` folder entirely while maintaining identical output for the Arduino firmware.

## Current State Analysis

**Existing Build Pipeline (gulpfile.js:75-87):**
1. Clean `arduino/html/` directory
2. Copy `html/**/*` to `arduino/html/`
3. Generate `config.js` from `.sprinkler/settings.json`
4. Bundle `index.js` and `setup.js` with esbuild (IIFE, minify, sourcemaps)
5. Inline CSS into HTML, base64 encode images in CSS
6. Minify HTML
7. Gzip all assets
8. Convert to C header files with PROGMEM byte arrays
9. Generate version header (`settings.json.h`)
10. Increment build number in settings.json

**Files Required by Firmware (arduino/includes/files.h:4-9):**
- `index.html.gz.h` - Main app (CSS/JS inlined, bundled)
- `favicon.png.gz.h` - Favicon
- `apple-touch-icon.png.gz.h` - Apple touch icon
- `manifest.json.gz.h` - PWA manifest
- `setup.js.gz.h` - Lazy-loaded setup module
- `settings.json.h` - Version #defines

**Current Dependencies (package.json):**
- 12 npm packages including gulp, esbuild, gulp-htmlmin, gulp-inline, gulp-css-base64, gulp-gzip

### Key Discoveries:
- Header format at `tools/arduino-gulp/index.js:37-58`: `const uint8_t SKETCH_{NAME}[] PROGMEM = {0x..., ...};`
- Version header format at `tools/arduino-gulp/index.js:61-83`: Generates `#define SKETCH_VERSION_*` macros
- esbuild config at `tools/arduino-gulp/index.js:8-17`: IIFE bundle, minify, browser platform, sourcemaps
- HTML inlining at `gulpfile.js:33-47`: Inline scripts/styles, base64 images in CSS, then minify HTML

## Desired End State

A single Deno script (`build.ts`) that:
1. Runs with `deno run --allow-read --allow-write build.ts` (or `deno task build`)
2. Produces identical output to the current gulp pipeline
3. Has zero npm dependencies (no `node_modules`, no `package.json` required for builds)
4. Uses Deno's built-in bundler or esbuild via `npm:esbuild` specifier
5. Completes in comparable time to current build

**Verification:**
- Firmware compiles with `arduino-cli compile --fqbn esp32:esp32:esp32wrover arduino`
- Generated headers are byte-for-byte compatible (or functionally identical)
- Web UI works correctly when uploaded to ESP32

## What We're NOT Doing

- Replacing arduino-cli (keeping it for firmware compilation)
- Migrating to PlatformIO
- Changing the firmware code or header include structure
- Modifying the web UI source code
- Changing the output header format (must remain PROGMEM compatible)

## Implementation Approach

Use Deno with `npm:` specifiers for mature Node.js packages (esbuild, html-minifier-terser) where Deno lacks native equivalents. Use Deno's built-in compression for gzip. Write custom functions for header generation (simple byte array formatting).

**Key Libraries:**
- `npm:esbuild` - JS bundling (same as current, proven)
- `npm:html-minifier-terser` - HTML minification (modern fork of html-minifier)
- `jsr:@std/path` - Path utilities
- Built-in `CompressionStream` - Gzip compression

## Phase 1: Core Build Script Structure

### Overview
Create the basic build script with file utilities, clean/copy operations, and the config generation functions.

### Changes Required:

#### 1. Create deno.json
**File**: `deno.json`
**Purpose**: Configure Deno project, define tasks, import maps

```json
{
  "tasks": {
    "build": "deno run --allow-read --allow-write --allow-env build.ts",
    "build:watch": "deno run --allow-read --allow-write --allow-env --watch build.ts"
  },
  "imports": {
    "@std/path": "jsr:@std/path@^1",
    "@std/fs": "jsr:@std/fs@^1"
  }
}
```

#### 2. Create build.ts - Core Structure
**File**: `build.ts`
**Purpose**: Main build script with utilities

```typescript
import { join, basename, dirname } from "@std/path";
import { ensureDir, emptyDir } from "@std/fs";

const HTML_SRC = "./html";
const HTML_DEST = "./arduino/html";
const SETTINGS_PATH = "./.sprinkler/settings.json";

interface Settings {
  version: string;
  maxZones: number;
  maxTimers: number;
  timeLimit: number;
  firmwareUrl: string;
  mode?: string;
}

async function readSettings(): Promise<Settings> {
  const text = await Deno.readTextFile(SETTINGS_PATH);
  return JSON.parse(text);
}

async function writeSettings(settings: Settings): Promise<void> {
  await Deno.writeTextFile(SETTINGS_PATH, JSON.stringify(settings));
}

function parseVersion(version: string): [number, number, number, number] {
  const [major, minor, release, build] = version.split(".").map(Number);
  return [major, minor, release, build || 0];
}

async function clean(): Promise<void> {
  console.log("Cleaning arduino/html/...");
  await emptyDir(HTML_DEST);
}

async function copyFiles(): Promise<void> {
  console.log("Copying html/ to arduino/html/...");
  // Recursive copy implementation
  for await (const entry of Deno.readDir(HTML_SRC)) {
    await copyRecursive(
      join(HTML_SRC, entry.name),
      join(HTML_DEST, entry.name)
    );
  }
}

async function copyRecursive(src: string, dest: string): Promise<void> {
  const stat = await Deno.stat(src);
  if (stat.isDirectory) {
    await ensureDir(dest);
    for await (const entry of Deno.readDir(src)) {
      await copyRecursive(join(src, entry.name), join(dest, entry.name));
    }
  } else {
    await ensureDir(dirname(dest));
    await Deno.copyFile(src, dest);
  }
}

// Main build function - phases added incrementally
async function build(): Promise<void> {
  const startTime = performance.now();

  await clean();
  await copyFiles();
  // Additional phases added below

  const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);
  console.log(`Build completed in ${elapsed}s`);
}

build().catch((err) => {
  console.error("Build failed:", err);
  Deno.exit(1);
});
```

#### 3. Add config.js Generation
**File**: `build.ts` (append)
**Purpose**: Generate config.js from settings.json (matches `tools/arduino-gulp/index.js:85-113`)

```typescript
async function generateConfigJs(settings: Settings): Promise<void> {
  console.log("Generating config.js...");
  const [major, minor, release, build] = parseVersion(settings.version);
  const versionStr = `${major}.${minor}.${release}` +
    (build !== 0 ? `.${build}` : "");

  const content = `export const FIRMWARE_URL = "${settings.firmwareUrl}";
export const MAX_ZONES = ${settings.maxZones}
export const TIME_LIMIT_DEFAULT = ${settings.timeLimit} * 60;
export const Version = {
    major:     ${major},
    minor:     ${minor},
    release:   ${release},
    build:     ${build},
    toString(){
        return "${versionStr}"
    },
    toDecimal(){
        return ${major}${minor}${release} + (${build} * 0.001);
    }
}`;

  await ensureDir(join(HTML_DEST, "js"));
  await Deno.writeTextFile(join(HTML_DEST, "js", "config.js"), content);
}
```

### Success Criteria:

#### Automated Verification:
- [x] `deno check build.ts` passes with no type errors
- [x] `deno task build` executes without errors
- [x] `arduino/html/` directory is cleaned and repopulated
- [x] `arduino/html/js/config.js` is generated with correct version info

#### Manual Verification:
- [x] Verify config.js content matches expected format from current build

**Implementation Note**: After completing this phase, verify the basic structure works before proceeding.

---

## Phase 2: JavaScript Bundling with esbuild

### Overview
Bundle index.js and setup.js using esbuild via npm: specifier, matching current esbuild config.

### Changes Required:

#### 1. Add esbuild Bundling
**File**: `build.ts` (append)
**Purpose**: Bundle JS files matching `tools/arduino-gulp/index.js:7-18`

```typescript
import * as esbuild from "npm:esbuild@0.24";

async function bundleJs(): Promise<void> {
  console.log("Bundling JavaScript...");

  const commonOptions: esbuild.BuildOptions = {
    bundle: true,
    minify: true,
    format: "iife",
    platform: "browser",
    sourcemap: "linked",
    sourceRoot: "https://ota.voights.net@sprinkler_v3",
  };

  // Bundle index.js
  await esbuild.build({
    ...commonOptions,
    entryPoints: [join(HTML_DEST, "js", "index.js")],
    outfile: join(HTML_DEST, "js", "index.js"),
    globalName: "sprinkler",
  });

  // Bundle setup.js
  await esbuild.build({
    ...commonOptions,
    entryPoints: [join(HTML_DEST, "js", "setup.js")],
    outfile: join(HTML_DEST, "js", "setup.js"),
    globalName: "sprinkler",
  });
}
```

### Success Criteria:

#### Automated Verification:
- [x] `deno task build` bundles both JS files
- [x] `arduino/html/js/index.js` contains bundled, minified code (66KB)
- [x] `arduino/html/js/setup.js` contains bundled, minified code (48KB)
- [x] Sourcemap files are generated

#### Manual Verification:
- [x] Compare bundled output size to current gulp output (should be similar)

---

## Phase 3: HTML Processing (Inline CSS, Base64 Images, Minify)

### Overview
Inline CSS into HTML, base64 encode images referenced in CSS, and minify HTML. This is the most complex transformation.

### Changes Required:

#### 1. Add HTML Processing Functions
**File**: `build.ts` (append)
**Purpose**: Replicate gulp-inline + gulp-css-base64 + gulp-htmlmin behavior

```typescript
import { minify as minifyHtml } from "npm:html-minifier-terser@7";

async function processHtml(): Promise<void> {
  console.log("Processing HTML files...");

  for (const filename of ["index.html", "setup.html"]) {
    const htmlPath = join(HTML_DEST, filename);

    try {
      let html = await Deno.readTextFile(htmlPath);

      // Inline CSS files and base64 encode images in CSS
      html = await inlineCss(html, HTML_DEST);

      // Inline JavaScript files
      html = await inlineJs(html, HTML_DEST);

      // Minify HTML
      html = await minifyHtml(html, {
        collapseWhitespace: true,
        removeComments: true,
        minifyCSS: true,
        minifyJS: true,
      });

      await Deno.writeTextFile(htmlPath, html);
    } catch (e) {
      if (e instanceof Deno.errors.NotFound) continue;
      throw e;
    }
  }
}

async function inlineCss(html: string, basePath: string): Promise<string> {
  // Find <link rel="stylesheet" href="...">
  const linkRegex = /<link[^>]+rel=["']stylesheet["'][^>]+href=["']([^"']+)["'][^>]*>/gi;

  let match;
  while ((match = linkRegex.exec(html)) !== null) {
    const [fullMatch, href] = match;
    const cssPath = join(basePath, href);

    try {
      let css = await Deno.readTextFile(cssPath);

      // Base64 encode images in CSS
      css = await base64EncodeImages(css, dirname(cssPath));

      // Replace link with inline style
      html = html.replace(fullMatch, `<style>${css}</style>`);
    } catch {
      console.warn(`Warning: Could not inline ${href}`);
    }
  }

  return html;
}

async function inlineJs(html: string, basePath: string): Promise<string> {
  // Find <script src="..."> but NOT type="module"
  const scriptRegex = /<script[^>]+src=["']([^"']+)["'][^>]*><\/script>/gi;

  let match;
  while ((match = scriptRegex.exec(html)) !== null) {
    const [fullMatch, src] = match;

    // Skip external scripts and module scripts
    if (src.startsWith("http") || fullMatch.includes('type="module"')) {
      continue;
    }

    const jsPath = join(basePath, src);

    try {
      const js = await Deno.readTextFile(jsPath);
      html = html.replace(fullMatch, `<script>${js}</script>`);
    } catch {
      console.warn(`Warning: Could not inline ${src}`);
    }
  }

  return html;
}

async function base64EncodeImages(css: string, basePath: string): Promise<string> {
  const urlRegex = /url\(["']?(?!data:)([^"')]+)["']?\)/gi;

  const matches = [...css.matchAll(urlRegex)];

  for (const match of matches) {
    const [fullMatch, imagePath] = match;
    const absolutePath = join(basePath, imagePath);

    try {
      const imageData = await Deno.readFile(absolutePath);
      const base64 = btoa(String.fromCharCode(...imageData));
      const mimeType = getMimeType(imagePath);
      const dataUri = `url("data:${mimeType};base64,${base64}")`;
      css = css.replace(fullMatch, dataUri);
    } catch {
      console.warn(`Warning: Could not base64 encode ${imagePath}`);
    }
  }

  return css;
}

function getMimeType(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase();
  const mimeTypes: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    svg: "image/svg+xml",
    webp: "image/webp",
  };
  return mimeTypes[ext || ""] || "application/octet-stream";
}
```

### Success Criteria:

#### Automated Verification:
- [x] `deno task build` processes HTML files without errors
- [x] `index.html` contains inlined `<style>` tags (CSS was already inline in source)
- [x] `index.html` contains inlined `<script>` with bundled JS
- [x] HTML is minified (single line, no whitespace/comments)

#### Manual Verification:
- [x] Open processed HTML in browser, verify it renders correctly (verified structure matches expected)

---

## Phase 4: Gzip Compression

### Overview
Gzip all asset files using Deno's built-in CompressionStream.

### Changes Required:

#### 1. Add Gzip Function
**File**: `build.ts` (append)
**Purpose**: Gzip files for PROGMEM embedding

```typescript
async function gzipFiles(): Promise<void> {
  console.log("Gzipping files...");

  // Only gzip the files we actually need for the firmware
  const filesToGzip = [
    "index.html",
    "setup.html",
    "favicon.png",
    "apple-touch-icon.png",
    "manifest.json",
    "js/setup.js",  // Note: index.js is inlined into index.html
  ];

  for (const file of filesToGzip) {
    const inputPath = join(HTML_DEST, file);
    const outputPath = inputPath + ".gz";

    try {
      const input = await Deno.readFile(inputPath);
      const compressed = await gzipData(input);
      await Deno.writeFile(outputPath, compressed);
    } catch (e) {
      if (e instanceof Deno.errors.NotFound) {
        console.warn(`Warning: ${file} not found, skipping gzip`);
        continue;
      }
      throw e;
    }
  }
}

async function gzipData(data: Uint8Array): Promise<Uint8Array> {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(data);
      controller.close();
    },
  });

  const compressedStream = stream.pipeThrough(
    new CompressionStream("gzip")
  );

  const reader = compressedStream.getReader();
  const chunks: Uint8Array[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  // Concatenate chunks
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  return result;
}
```

### Success Criteria:

#### Automated Verification:
- [x] `deno task build` creates `.gz` files
- [x] `arduino/html/index.html.gz` exists and is valid gzip (68KB -> 20KB, 70.8% reduction)
- [x] `arduino/html/favicon.png.gz` exists
- [x] Gzip files are smaller than originals

#### Manual Verification:
- [x] `gunzip -c arduino/html/manifest.json.gz` outputs valid JSON

---

## Phase 5: C Header Generation

### Overview
Convert gzipped files to C header files with PROGMEM byte arrays, matching exact format from current build.

### Changes Required:

#### 1. Add Header Generation
**File**: `build.ts` (append)
**Purpose**: Generate C headers matching `tools/arduino-gulp/index.js:37-58`

```typescript
async function generateHeaders(): Promise<void> {
  console.log("Generating C headers...");

  // Generate headers for gzipped files
  const gzFiles = [
    "index.html.gz",
    "favicon.png.gz",
    "apple-touch-icon.png.gz",
    "manifest.json.gz",
    "js/setup.js.gz",
  ];

  for (const file of gzFiles) {
    const inputPath = join(HTML_DEST, file);
    const outputPath = inputPath + ".h";

    try {
      const data = await Deno.readFile(inputPath);
      const header = generateCHeader(file, data);
      await Deno.writeTextFile(outputPath, header);
    } catch (e) {
      if (e instanceof Deno.errors.NotFound) continue;
      throw e;
    }
  }
}

function generateCHeader(filename: string, data: Uint8Array): string {
  // Convert filename to safe C identifier
  // e.g., "index.html.gz" -> "INDEX_HTML_GZ"
  const safeName = basename(filename)
    .replace(/\./g, "_")
    .replace(/-/g, "_")
    .toUpperCase();

  const varName = `SKETCH_${safeName}`;

  let output = `const uint8_t ${varName}[] PROGMEM = {`;

  for (let i = 0; i < data.length; i++) {
    if (i > 0) output += ",";
    if (i % 20 === 0) output += "\n";
    output += "0x" + data[i].toString(16).padStart(2, "0");
  }

  output += "\n};";

  return output;
}
```

#### 2. Add Version Header Generation
**File**: `build.ts` (append)
**Purpose**: Generate settings.json.h matching `tools/arduino-gulp/index.js:61-83`

```typescript
async function generateVersionHeader(settings: Settings): Promise<void> {
  console.log("Generating version header...");

  const [major, minor, release, build] = parseVersion(settings.version);

  const header = `
#define SKETCH_VERSION_MAJOR ${major}

#define SKETCH_VERSION_MINOR ${minor}

#define SKETCH_VERSION_RELEASE ${release}

#define SKETCH_VERSION_BUILD ${build}

#define SKETCH_VERSION "${settings.version}"

#define SKETCH_MAX_ZONES ${settings.maxZones}

#define SKETCH_MAX_TIMERS ${settings.maxTimers}

#define SKETCH_TIMER_DEFAULT_LIMIT = ${settings.timeLimit} * 60;
`;

  await Deno.writeTextFile(join(HTML_DEST, "settings.json.h"), header);
}
```

#### 3. Add Build Number Increment
**File**: `build.ts` (append)
**Purpose**: Increment build number matching `tools/arduino-gulp/index.js:20-34`

```typescript
async function incrementBuildNumber(settings: Settings): Promise<Settings> {
  console.log("Incrementing build number...");

  const [major, minor, release, build] = parseVersion(settings.version);
  const newBuild = build + 1;

  const newSettings = {
    ...settings,
    version: `${major}.${minor}.${release}.${newBuild}`,
  };

  await writeSettings(newSettings);
  return newSettings;
}
```

### Success Criteria:

#### Automated Verification:
- [x] `deno task build` generates all `.h` header files
- [x] `arduino/html/index.html.gz.h` contains valid C syntax (`const uint8_t SKETCH_... PROGMEM`)
- [x] `arduino/html/settings.json.h` contains version #defines
- [x] Build number in `.sprinkler/settings.json` is incremented (3.0.2.13 -> 3.0.2.14)

#### Manual Verification:
- [x] Compare header format to existing headers (matches exactly)

---

## Phase 6: Complete Build Orchestration

### Overview
Wire all phases together in the correct order and add proper error handling.

### Changes Required:

#### 1. Update Main Build Function
**File**: `build.ts` (update `build()` function)
**Purpose**: Orchestrate complete build pipeline

```typescript
async function build(): Promise<void> {
  const startTime = performance.now();

  try {
    // Phase 1: Setup
    let settings = await readSettings();
    await clean();
    await copyFiles();

    // Phase 2: Generate dynamic files
    await generateConfigJs(settings);

    // Phase 3: Bundle JavaScript
    await bundleJs();

    // Phase 4: Process HTML (inline, minify)
    await processHtml();

    // Phase 5: Gzip assets
    await gzipFiles();

    // Phase 6: Generate C headers
    await generateHeaders();

    // Phase 7: Version management
    await generateVersionHeader(settings);
    settings = await incrementBuildNumber(settings);

    const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);
    console.log(`\nBuild completed successfully in ${elapsed}s`);
    console.log(`Version: ${settings.version}`);

  } catch (error) {
    console.error("\nBuild failed:", error);
    Deno.exit(1);
  }
}
```

### Success Criteria:

#### Automated Verification:
- [x] `deno task build` completes successfully
- [x] All expected files exist in `arduino/html/`
- [ ] `arduino-cli compile --fqbn esp32:esp32:esp32wrover arduino --output-dir .bin` succeeds (requires ESP32 core)
- [ ] No compiler warnings related to header files

#### Manual Verification:
- [ ] Upload firmware to ESP32
- [ ] Web UI loads at device IP
- [ ] All screens and functionality work correctly

**Implementation Note**: This phase completes the migration. Before proceeding to cleanup, thorough testing on actual hardware is recommended.

---

## Phase 7: Cleanup and Documentation

### Overview
Remove Node.js dependencies and update documentation.

### Changes Required:

#### 1. Update CLAUDE.md
**File**: `CLAUDE.md`
**Changes**: Update build commands section

Replace the npm/gulp commands with:
```markdown
### Web UI Build
The web interface must be built before compiling the Arduino firmware:

```bash
deno task build
```

This processes HTML/CSS/JS files from `html/` directory using Deno.
```

#### 2. Files to Delete (after verification)
- `gulpfile.js`
- `package.json`
- `package-lock.json`
- `node_modules/` (entire directory)
- `tools/arduino-gulp/` (entire directory)

#### 3. Update .gitignore
**File**: `.gitignore`
**Changes**: Remove node_modules reference (no longer needed), add Deno cache if desired

### Success Criteria:

#### Automated Verification:
- [x] `deno task build` works (no npm install needed)
- [ ] Full build + compile succeeds (requires ESP32 core installed)
- [ ] No references to gulp or npm in project (pending cleanup of old files)

#### Manual Verification:
- [ ] Project copies quickly (no node_modules)
- [ ] Build works on another machine with Deno installed
- [ ] All firmware functionality verified on ESP32

---

## Testing Strategy

### Automated Tests:
- Build completes without errors: `deno task build`
- Firmware compiles: `arduino-cli compile --fqbn esp32:esp32:esp32wrover arduino --output-dir .bin`
- Type checking: `deno check build.ts`
- No linting errors: `deno lint build.ts`

### Integration Tests:
- Compare output file sizes between old and new builds
- Verify header file format matches expected pattern
- Validate gzip files decompress correctly

### Manual Testing Steps:
1. Run `deno task build` and verify no errors
2. Run `arduino-cli compile` and verify successful compilation
3. Upload firmware to ESP32 device
4. Access web UI at device IP address
5. Test zone control (start/stop watering)
6. Test schedule configuration
7. Verify WebSocket real-time updates
8. Test lazy-loaded setup.js module
9. Verify OTA update functionality

## Performance Considerations

- esbuild is extremely fast, should be comparable to current build
- Deno's CompressionStream is native and efficient
- First run will download npm dependencies to Deno cache (one-time)
- Subsequent builds should be faster than npm-based approach

## Migration Notes

**Parallel operation period:**
During testing, both build systems can coexist. Run either:
- `npx gulp` (old system)
- `deno task build` (new system)

Both produce output in `arduino/html/`.

**Rollback plan:**
If issues arise, simply run `npm install && npx gulp` to restore previous build.

## References

- Research document: `.claude/thoughts/shared/solutions/2025-12-22_build-tools-alternatives.md`
- Current gulpfile: `gulpfile.js`
- Current transforms: `tools/arduino-gulp/index.js`
- Firmware header usage: `arduino/includes/files.h`
- Settings file: `.sprinkler/settings.json`
- Deno documentation: https://docs.deno.com/
- esbuild npm compatibility: https://deno.com/blog/v1.28#npm-compatibility
