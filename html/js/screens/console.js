import { jQuery } from "../system/jquery";
import { Log } from "../system/log";
import { App } from "../system/app";
import { Status } from "../system/status";

const html = `
<div class="container">
  <h1>Console</h1>
  <div class="header">
    <div class="levels">
      <button class="level-btn none" data-level="0">none</button>
      <button class="level-btn error" data-level="1">error</button>
      <button class="level-btn warn" data-level="2">warn</button>
      <button class="level-btn info" data-level="3">info</button>
    </div>
    <div class="actions">
      <button id="copy" title="Copy logs"></button>
      <button id="download" title="Download logs"></button>
      <button id="clear" title="Clear logs"></button>
    </div>
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
h1 {
  position: absolute;
  top: 0;
}
@media screen and (min-height: 730px) {
  h1 { top: 6%; }
}
.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
  gap: 8px;
}
.levels {
  display: flex;
  gap: 4px;
}
.level-btn {
  padding: 3px 8px;
  border: 0;
  border-radius: 4px;
  font-size: 0.8rem;
  cursor: pointer;
  opacity: 0.4;
  transition: opacity 0.15s;
  min-width: 3rem;
  text-align: center;
}
.level-btn.active {
  opacity: 1;
}
.level-btn.none {
  background: #666;
  color: #ccc;
}
.level-btn.error {
  background: var(--alert-background-color);
  color: var(--alert-text-color);
}
.level-btn.warn {
  background: var(--warn-background-color);
  color: var(--warn-text-color);
}
.level-btn.info {
  background: var(--secondary-background-color);
  color: var(--secondary-text-color);
}
.actions {
  display: flex;
  gap: 4px;
  align-items: center;
}
.actions button {
  width: 20px;
  height: 20px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--primary-text-color);
  cursor: pointer;
  opacity: 0.6;
  transition: opacity 0.15s;
  position: relative;
}
.actions button:hover {
  opacity: 1;
}
#copy::before,
#copy::after {
  content: "";
  position: absolute;
  width: 8px;
  height: 10px;
  border: 1.5px solid currentColor;
  border-radius: 1px;
}
#copy::before {
  top: 4px;
  left: 4px;
  background: var(--primary-background-color);
}
#copy::after {
  top: 6px;
  left: 6px;
}
#download::before {
  content: "↓";
  font-size: 1rem;
  line-height: 20px;
}
#clear::before {
  content: "\\2261";
  font-size: 1.1rem;
  line-height: 20px;
}
#clear::after {
  content: "\\00d7";
  font-size: 0.6rem;
  position: absolute;
  top: 0;
  right: 1px;
}
#logs {
  flex: 1;
  overflow-y: auto;
  padding: 8px 0;
  font-family: monospace;
  font-size: 0.85rem;
}
#logs::-webkit-scrollbar {
  width: 6px;
}
#logs::-webkit-scrollbar-track {
  background: transparent;
}
#logs::-webkit-scrollbar-thumb {
  background: #333;
  border-radius: 3px;
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

const LEVEL_NAMES = ["none", "error", "warn", "info"];

export class Console extends HTMLElement {
  currentLevel = 3;

  connectedCallback() {
    this.jQuery = jQuery(this).attachShadowTemplate(style + html, ($) => {
      this.$logs = $("#logs");
      this.currentLevel = App.logLevel();

      // Level toggle buttons
      this.$levelBtns = $(".level-btn");
      this.$levelBtns.forEach((btn) => {
        const level = parseInt(btn.dataset.level);
        if (level === this.currentLevel) {
          btn.classList.add("active");
        }
        btn.addEventListener("click", () => this.setLevel(level));
      });

      // Action buttons
      $("#copy").on("click", () => this.copy());
      $("#download").on("click", () => this.download());
      $("#clear").on("click", () => this.clear());

      // Listen for real-time log events
      this.onLogEvent = this.onLogEvent.bind(this);
      document.addEventListener("sketch-event", this.onLogEvent);

      // Load existing logs
      this.loadLogs();
    });
  }

  disconnectedCallback() {
    document.removeEventListener("sketch-event", this.onLogEvent);
    this.jQuery().detach();
  }

  async setLevel(level) {
    this.currentLevel = level;

    // Update button states
    this.$levelBtns.forEach((btn) => {
      const btnLevel = parseInt(btn.dataset.level);
      btn.classList.toggle("active", btnLevel === level);
    });

    // Save the new log level - this triggers device restart
    const spinner = Status.wait();
    Log.loglevel(LEVEL_NAMES[level]).catch();
    await App.wait(10000);
    spinner.close();
    App.reload();
  }

  async loadLogs() {
    try {
      await Log.fetch();
      for (const log of Log) {
        this.addLog(log);
      }
    } catch (e) {
      console.error("Failed to load logs", e);
    }
  }

  onLogEvent(e) {
    if (e.detail) {
      this.addLog(e.detail);
    }
  }

  addLog(log) {
    const level = log.level || "info";
    const message = log.log || "";
    const scope = log.scope || "";
    const entry = document.createElement("div");
    entry.className = `log-entry log-${level}`;
    entry.innerHTML = `<span class="log-scope">[${this.escapeHtml(scope)}]</span>${this.escapeHtml(message)}`;
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
    Log.clear();
  }

  getLogsText() {
    const lines = [];
    for (const log of Log) {
      lines.push(`[${log.scope}] ${log.log}`);
    }
    return lines.join("\n");
  }

  copy() {
    const text = this.getLogsText();

    // Try modern clipboard API first (requires HTTPS)
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(() => {
        Status.information("Logs copied to clipboard");
      }).catch(() => {
        this.copyFallback(text);
      });
    } else {
      this.copyFallback(text);
    }
  }

  copyFallback(text) {
    // Fallback for HTTP: use temporary textarea
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    try {
      document.execCommand("copy");
      Status.information("Logs copied to clipboard");
    } catch (e) {
      Status.error("Failed to copy logs");
    }
    document.body.removeChild(textarea);
  }

  download() {
    const text = this.getLogsText();
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sprinkler-logs-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }
}
