import { join, basename, dirname } from "@std/path";
import { ensureDir, emptyDir } from "@std/fs";
import * as esbuild from "npm:esbuild@0.24";
import { minify as minifyHtml } from "npm:html-minifier-terser@7";

const HTML_SRC = "./html";
const HTML_DEST = "./arduino/html";
const SETTINGS_PATH = "./.sprinkler/settings.json";

// Check for --mock flag
const USE_MOCK_HTTP = Deno.args.includes("--mock");

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
  const parts = version.split(".").map(Number);
  return [parts[0], parts[1], parts[2], parts[3] || 0];
}

async function clean(): Promise<void> {
  console.log("Cleaning arduino/html/...");
  await emptyDir(HTML_DEST);
}

async function copyFiles(): Promise<void> {
  console.log("Copying html/ to arduino/html/...");
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

async function generateHttpModule(): Promise<void> {
  const httpModule = USE_MOCK_HTTP ? "http.mock" : "http.prod";
  console.log(`Generating http.js (using ${httpModule})...`);

  const content = `export * from "./${httpModule}";\n`;

  await ensureDir(join(HTML_DEST, "js", "system"));
  await Deno.writeTextFile(join(HTML_DEST, "js", "system", "http.js"), content);
}

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
    allowOverwrite: true,
  });

  // Bundle setup.js
  await esbuild.build({
    ...commonOptions,
    entryPoints: [join(HTML_DEST, "js", "setup.js")],
    outfile: join(HTML_DEST, "js", "setup.js"),
    globalName: "sprinkler",
    allowOverwrite: true,
  });
}

async function processHtml(): Promise<void> {
  console.log("Processing HTML files...");

  // Only process index.html - it has JS that needs to be inlined
  // setup.html references setup.js which is served separately
  const htmlPath = join(HTML_DEST, "index.html");

  let html = await Deno.readTextFile(htmlPath);

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
}

async function inlineJs(html: string, basePath: string): Promise<string> {
  // Find <script src="..."></script> but NOT type="module" or external URLs
  const scriptRegex = /<script([^>]*)src=["']([^"']+)["']([^>]*)><\/script>/gi;

  const matches = [...html.matchAll(scriptRegex)];

  for (const match of matches) {
    const [fullMatch, attrsBefore, src, attrsAfter] = match;

    // Skip external scripts and module scripts
    if (src.startsWith("http") || attrsBefore.includes('type="module"') || attrsAfter.includes('type="module"')) {
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

async function gzipFiles(): Promise<void> {
  console.log("Gzipping files...");

  // Only gzip the files we actually need for the firmware (per files.h)
  const filesToGzip = [
    "index.html",
    "favicon.png",
    "apple-touch-icon.png",
    "manifest.json",
    "js/setup.js", // Note: index.js is inlined into index.html
  ];

  for (const file of filesToGzip) {
    const inputPath = join(HTML_DEST, file);
    const outputPath = inputPath + ".gz";

    try {
      const input = await Deno.readFile(inputPath);
      const compressed = await gzipData(input);
      await Deno.writeFile(outputPath, compressed);

      const ratio = ((1 - compressed.length / input.length) * 100).toFixed(1);
      console.log(`  ${file}: ${input.length} -> ${compressed.length} (${ratio}% reduction)`);
    } catch (e) {
      if (e instanceof Deno.errors.NotFound) {
        console.warn(`  Warning: ${file} not found, skipping gzip`);
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

  const compressedStream = stream.pipeThrough(new CompressionStream("gzip"));
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

async function generateHeaders(): Promise<void> {
  console.log("Generating C headers...");

  // Generate headers for gzipped files (per files.h)
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
      console.log(`  ${file}.h (${data.length} bytes)`);
    } catch (e) {
      if (e instanceof Deno.errors.NotFound) {
        console.warn(`  Warning: ${file} not found, skipping header`);
        continue;
      }
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

async function generateVersionHeader(settings: Settings): Promise<void> {
  console.log("Generating version header...");

  const [major, minor, release, build] = parseVersion(settings.version);

  // Match the exact format from tools/arduino-gulp/index.js:61-83
  const header = `
#define SKETCH_VERSION_MAJOR ${major}\r\n
#define SKETCH_VERSION_MINOR ${minor}\r\n
#define SKETCH_VERSION_RELEASE ${release}\r\n
#define SKETCH_VERSION_BUILD ${build}\r\n
#define SKETCH_VERSION "${settings.version}"\r\n
#define SKETCH_MAX_ZONES ${settings.maxZones}\r\n
#define SKETCH_MAX_TIMERS ${settings.maxTimers}\r\n
#define SKETCH_TIMER_DEFAULT_LIMIT ${settings.timeLimit}
`;

  await Deno.writeTextFile(join(HTML_DEST, "settings.json.h"), header);
}

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

// Main build function - phases added incrementally
async function build(): Promise<void> {
  const startTime = performance.now();

  let settings = await readSettings();
  await clean();
  await copyFiles();
  await generateConfigJs(settings);
  await generateHttpModule();
  await bundleJs();
  await processHtml();
  await gzipFiles();
  await generateHeaders();
  await generateVersionHeader(settings);
  settings = await incrementBuildNumber(settings);

  const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);
  console.log(`\nBuild completed in ${elapsed}s`);
  console.log(`Version: ${settings.version}`);
}

build().catch((err) => {
  console.error("Build failed:", err);
  Deno.exit(1);
});
