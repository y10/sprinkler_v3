import { jQuery } from "../system/jquery";
import { App } from "../system/app";
import { Http } from "../system/http";
import { Status } from "../system/status";

const html = `
<div class="container">
    <h1>Alexa</h1>
    <br />
    <br />
    <br />
    <button type="button" id="alexa-toggle">Enable</button>
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
button {
  border: 0;
  border-radius: 0.3rem;
  line-height: 2.4rem;
  font-size: 1.2rem;
  width: 100%;
  margin: 8px 0;
}
button.enabled {
  background-color: var(--info-background-color);
  color: var(--info-text-color);
}
button.disabled {
  background-color: var(--secondary-background-color);
  color: var(--secondary-text-color);
}
</style>
`;

export class AlexaSettings extends HTMLElement {
  alexaEnabled = true;

  connectedCallback() {
    this.jQuery = jQuery(this).attachShadowTemplate(style + html, async ($) => {
      this.alexaEnabled = App.alexaEnabled();

      this.$btnToggle = $("#alexa-toggle");
      this.updateToggleButton();
      this.$btnToggle.on("click", async () => {
        const newState = !this.alexaEnabled;
        const spinner = Status.wait(5000);
        try {
          await Http.json('POST', 'api/settings', { alexaEnabled: newState });
          this.alexaEnabled = newState;
          this.updateToggleButton();
          spinner.close();
          await App.wait(3000);
          App.reload();
        } catch (error) {
          Status.error(error);
          spinner.close();
        }
      });
    });
  }

  disconnectedCallback() {
    this.jQuery().detach();
  }

  updateToggleButton() {
    const btn = this.$btnToggle.item();
    btn.textContent = this.alexaEnabled ? "Enabled" : "Disabled";
    btn.className = this.alexaEnabled ? "enabled" : "disabled";
  }
}
