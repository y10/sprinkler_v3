import { String, Router, Status } from "../system";
import { jQuery } from "../system/jquery";
import { App } from "../system/app";

const template = (self) => `
<sketch-slider start="${self.currentIndex}">
  ${
    App.zones().count() > 0
      ? "<sprinkler-sequence-builder></sprinkler-sequence-builder>"
      : "<sprinkler-list-empty></sprinkler-list-empty>"
  }
  ${String.join(
    App.zones(),
    (x) =>
      `<sprinkler-settings-zone zone-id="${x.id}"></sprinkler-settings-zone>`
  )}
</sketch-slider>`;
export class Schedule extends HTMLElement {
  connectedCallback() {
    this.jQuery = jQuery(this).attachShadow(($) => {
      $(this).on("navigate-from", this.onSave.bind(this));
    });

    this.render();
  }

  disconnectedCallback() {
    this.jQuery().detach();
  }

  onRemove(e) {
    App.zones(e.detail.id).remove();
    this.render();
  }

  async onSave(e) {
    try {
      if (await App.save()) {
        Router.refresh();
      } else {
        Router.refresh();
        Status.error(
          "Failed to save zones to the server. <a href='./index.html' taget='self'>Reload</a>"
        );
      }
    } catch (error) {
      Status.error(error);
    }
  }

  render() {
    this.jQuery().html(template(this), ($) => {
      $("sketch-slider").on("remove", this.onRemove.bind(this));
    });
  }
}
