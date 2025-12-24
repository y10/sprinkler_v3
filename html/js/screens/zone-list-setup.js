import { Status, Router, String } from "../system";
import { jQuery } from "../system/jquery";
import { Icons } from "../assets/icons";
import { App } from "../system/app";
import { MAX_ZONES } from "../config";

const template = (self) => `
<style>
.container {
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
}

</style>
<div class="container">
  <h1>Zones</h1>
    ${String.join(
      [...Array(MAX_ZONES).keys()].map((o, i) => App.zones(i + 1)),
      (x) =>
        `<sketch-checkbox zone-id="${x.id}" placeholder="Zone ${x.id}" text="${
          x.name
        }" ${x.defined() ? "checked" : ""}></sketch-checkbox>`
    )}
</div>`;
export class ZonesSettings extends HTMLElement {
  connectedCallback() {
    this.jQuery = jQuery(this).attachShadowTemplate(template, ($) => {
      $(this).on("navigate-from", this.onSave.bind(this));

      $("sketch-checkbox")
        .on("checked", this.onZoneChecked.bind(this))
        .on("changed", this.onZoneChanged.bind(this))
        .forEach(el => el.icon = Icons.sprinkler);
    });
  }

  disconnectedCallback() {
    this.jQuery().detach();
  }

  onZoneChanged(e) {
    const checkbox = e.srcElement;
    const zoneid = checkbox.getAttribute("zone-id");
    if (checkbox.text) {
      App.zones(zoneid).name = checkbox.text;
    }
  }

  onZoneChecked(e) {
    const checkbox = e.srcElement;
    const zoneid = checkbox.getAttribute("zone-id");
    if (checkbox.checked) {
      App.zones().create(zoneid);
    } else {
      App.zones().remove(zoneid);
    }
  }

  async onSave(e) {
    try {
      if (await App.save()) {
        Router.refresh();
      } else {
        Router.refresh();
        Status.error("Failed to save zones to the server. <a href='./index.html' taget='self'>Reload</a>");
      }
    } catch (error) {
      Status.error(error);
    }
  }

  activate() {
    App.zones().current = null;
  }
}
