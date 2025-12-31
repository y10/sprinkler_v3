import { jQuery } from "../system/jquery";
import { App } from "../system/app";

const html = `
<div class="container">
    <h1>Alexa</h1>
    <div class="devices">
        <button id="alexa-toggle" class="device-btn system"></button>
        <div id="zone-list"></div>
    </div>
</div>
`;

const style = `
<style>
.container {
  width: 80vw;
  max-width: 300px;
}
h1 {
  position: absolute;
  top: 0;
}
@media screen and (min-height: 730px) {
  h1 { top: 6%; }
}
.devices {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
#zone-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.device-btn {
  border: 0;
  border-radius: 0.3rem;
  padding: 12px 16px;
  font-size: 1rem;
  width: 100%;
  text-align: center;
  cursor: pointer;
}
.device-btn.system {
  background-color: var(--secondary-background-color);
  color: var(--secondary-text-color);
}
.device-btn.system.enabled {
  background-color: var(--info-background-color);
  color: var(--info-text-color);
}
.device-btn.zone {
  background-color: var(--secondary-background-color);
  color: var(--secondary-text-color);
  opacity: 0.7;
  cursor: default;
}
</style>
`;

export class AlexaSettings extends HTMLElement {
  settings = {};
  alexaEnabled = true;

  connectedCallback() {
    this.jQuery = jQuery(this).attachShadowTemplate(style + html, async ($) => {
      this.alexaEnabled = App.alexaEnabled();

      // System toggle button
      this.$toggle = $("#alexa-toggle");
      this.updateToggleButton();
      this.$toggle.on("click", () => {
        this.alexaEnabled = !this.alexaEnabled;
        this.settings["alexaEnabled"] = this.alexaEnabled;
        this.updateToggleButton();
      });

      // Zone list (read-only)
      const $zoneList = $("#zone-list");
      for (const zone of App.zones()) {
        if (zone.defined() && zone.name) {
          const btn = document.createElement("button");
          btn.className = "device-btn zone";
          btn.textContent = zone.name;
          btn.disabled = true;
          $zoneList.item().appendChild(btn);
        }
      }
    });
  }

  disconnectedCallback() {
    this.jQuery().detach();
  }

  updateToggleButton() {
    const name = App.friendlyName() || "Sprinkler";
    // Pluralize
    const lastChar = name.charAt(name.length - 1);
    const plural = (lastChar === 's' || lastChar === 'x' || lastChar === 'z')
      ? name + "es"
      : name + "s";

    this.$toggle.item().textContent = plural;
    this.$toggle.item().classList.toggle("enabled", this.alexaEnabled);
  }

  onSave(e) {
    if (Object.keys(this.settings).length > 0) {
      e.settings = { ...e.settings, ...this.settings };
      e.restartRequested = true;
    }
  }
}
