import { String, Status, Http, Wsc, jQuery, Router } from "../system";
import { Icons } from "../assets/icons";
import { App } from "../system/app";
import { MAX_ZONES } from "../config";

const template = (self) => `
<style>
.container {
  width: 80vw;
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  margin-left: auto;
  margin-right: auto;
  max-width: 1024px;
}

.container > * {
  margin: 0.5rem 0.5rem;
}

h1 {
  position: absolute;
  top: 0;
}

@media screen and (min-height: 730px) {
  h1 { top: 6%; }
  .container {
    max-width: 500px;
  }
}

</style>
<div class="container">
    ${App.zones().count() > 0 ? String.join(
      [...Array(MAX_ZONES).keys()].map((o, i) => App.zones(i + 1)),
      (x) =>
        x.defined() ? 
        `<sketch-checkbox zone-id="${x.id}" placeholder="Zone ${x.id}" text="${x.name}" readonly>
          ${Icons.sprinkler}
        </sketch-checkbox>` : 
        `<span style="
          width: 7rem;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
        ">☼</span>`
    ) : '<sprinkler-list-empty></sprinkler-list-empty>'} 
</div>`;
export class ZoneList extends HTMLElement {
  connectedCallback() {
    this.jQuery = jQuery(this).attachShadowTemplate(template, ($) => {
      $("sketch-checkbox")
        .on('pick', this.onZoneClick.bind(this))
        .on('check', this.onZoneChecking.bind(this));
        
      Wsc.on("state", this.onUpdate, this);
      if ($(this).inViewport()) {
        this.updateAll().catch();
      }
    });
  }

  disconnectedCallback() {
    Wsc.off("state", this.onUpdate);
    this.jQuery().detach();
  }

  onUpdate(event) {
    this.update(event);
  }

  onZoneClick(e) {
    const checkbox = e.srcElement;
    const zoneid = checkbox.getAttribute("zone-id");
    Router.navigate('zone', { popup: true, params:{'zone-id': zoneid} });
  }

  onZoneChecking(e) 
  {
    e.preventDefault(); 
    this.onZoneCheck(e);
  }

  async onZoneCheck(e) {
    const checkbox = e.srcElement;
    const checked = !checkbox.checked;
    const command = checked
      ? checkbox.style.color
        ? "resume"
        : "start"
      : "stop";
    const zoneid = checkbox.getAttribute("zone-id");
    checkbox.disabled = true;
    try {
      const timer = await Http.json("GET", `api/zone/${zoneid}/${command}`);
      this.update(timer);
    } catch (error) {
      console.error(error);
    }
    checkbox.disabled = false;
  }

  activate() {
    Wsc.off("state", this.onUpdate);
    Wsc.on("state", this.onUpdate, this);
    App.zones().current = null;
    this.updateAll();
  }

  deactivate() {
    Wsc.off("state", this.onUpdate);
  }

  async updateAll(retryCount = 0) {
    const MAX_RETRY_ATTEMPTS = 5;
    try {
      if (retryCount) {
        console.warn(`Attempt #${retryCount + 1}`);
      }
      const timers = await Http.json("GET", `api/state`);
      if (Object.keys(timers).length > 0) {
        this.jQuery(`sketch-checkbox`).forEach((x, i) => {
          const zone = i + 1;
          const state =
            zone in timers ? timers[zone] : { zone, state: "stopped" };
          this.update(state);
        });
      }
    } catch (error) {
      console.error(error);
      if (retryCount >= MAX_RETRY_ATTEMPTS) {
        console.error(`Max retry attempts (${MAX_RETRY_ATTEMPTS}) reached`);
        return;
      }
      const delay = Math.min(Math.pow(2, retryCount) * 1000, 30000);
      await new Promise((done)=>setTimeout(done, delay));
      await this.updateAll(retryCount + 1);
    }
  }

  update(timer) {
    const { state, zone } = timer;
    if (zone) {
      this.jQuery(`.container sketch-checkbox:nth-child(${zone})`).forEach(
        (e, i) => {
          if (state == "paused") {
            e.style.color = "var(--warn-background-color)";
            e.checked = false;
          } else if (state == "stopped") {
            e.style.color = "";
            e.checked = false;
          } else {
            e.style.color = "";
            e.checked = true;
          }
        }
      );
    }
  }
}
