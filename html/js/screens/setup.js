import { jQuery, Router, Status, Http } from "../system";
import { App } from "../system/app";

const html = `
<sketch-slider>
  <sprinkler-setup-general></sprinkler-setup-general>
  <sprinkler-setup-wifi></sprinkler-setup-wifi>
  <sprinkler-setup-alexa></sprinkler-setup-alexa>
  <sprinkler-time></sprinkler-time>
</sketch-slider>
`
export class Setup extends HTMLElement {

  connectedCallback() {
    this.jQuery = jQuery(this).attachShadowTemplate(html, ($) => {
      $(this).on('navigate-from', this.onGoback.bind(this));
    });
  }

  disconnectedCallback() {
    this.jQuery().detach();
  }

  async onGoback(e) {
    e.settings = {};
    this.jQuery("sketch-slider > *").forEach((x) => {
      if ("onSave" in x) {
        x.onSave(e);
      }
    });

    if (Object.keys(e.settings).length > 0) {
     
      const spinner = Status.wait();
      try {
        await App.settings(e.settings);
      } catch (error) {
        Status.error(error);
        await spinner;
      }

      if (e.restartRequested) {
        await App.wait(5000);
        App.resatart();
      } else {
        spinner.close();
      }
    }

    Router.refresh();
  }
}