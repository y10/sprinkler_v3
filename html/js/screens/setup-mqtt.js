import { jQuery } from "../system/jquery";
import { App } from "../system/app";
import { Http } from "../system/http";
import { Status } from "../system/status";

const html = `
<div class="container">
    <h1>MQTT</h1>
    <form>
        <br />
        <br />
        <br />
        <input id='mqtt-host' name='mqtt-host' length=64 type="text" placeholder='homeassistant.local'><br />
        <br />
        <input id='mqtt-port' name='mqtt-port' type='number' placeholder='1883'><br />
        <br />
        <input id='mqtt-user' name='mqtt-user' length=32 type="text" placeholder='Username'><br />
        <br />
        <input id='mqtt-pass' name='mqtt-pass' length=64 type='password' placeholder='Password'><br />
        <br />
        <input id="mqtt-show-pass" type="checkbox" style="width:auto"><label for="mqtt-show-pass">Show password</label>
        <br /><br />
        <button type="button" id="mqtt-toggle">Enable</button>
    </form>
</div>
`;

const style = `
<style>
.container {
  width: 80vw;
  max-width:300px;
}
h1 {
  position: absolute;
  top: 0;
}
@media screen and (min-height: 730px) {
  h1 { top: 6%; }
}
input {
    padding: 8px;
    font-size: 1em;
    width: 100%;
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

export class MqttSettings extends HTMLElement {
  settings = {};
  mqttEnabled = false;

  connectedCallback() {
    this.jQuery = jQuery(this).attachShadowTemplate(style + html, async ($) => {
      this.txtHost = $("#mqtt-host");
      this.txtHost.value(App.mqttHost());
      this.txtHost.on("change", () => {
        this.settings["mqttHost"] = this.txtHost.value();
      });

      this.txtPort = $("#mqtt-port");
      this.txtPort.value(App.mqttPort() || 1883);
      this.txtPort.on("change", () => {
        this.settings["mqttPort"] = parseInt(this.txtPort.value()) || 1883;
      });

      this.txtUser = $("#mqtt-user");
      this.txtUser.value(App.mqttUser());
      this.txtUser.on("change", () => {
        this.settings["mqttUser"] = this.txtUser.value();
      });

      this.txtPass = $("#mqtt-pass");
      this.txtPass.on("change", () => {
        this.settings["mqttPass"] = this.txtPass.value();
      });

      this.chkShowPass = $("#mqtt-show-pass");
      this.chkShowPass.on("change", () => {
        const txtPass = this.txtPass.item();
        txtPass.type = txtPass.type == 'text' ? 'password' : 'text';
      });

      this.mqttEnabled = App.mqttEnabled();
      this.$btnToggle = $("#mqtt-toggle");
      this.updateToggleButton();
      this.$btnToggle.on("click", async () => {
        const newState = !this.mqttEnabled;
        const spinner = Status.wait(5000);
        try {
          await Http.json('POST', 'api/settings', { mqttEnabled: newState });
          this.mqttEnabled = newState;
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
    btn.textContent = this.mqttEnabled ? "Enabled" : "Disabled";
    btn.className = this.mqttEnabled ? "enabled" : "disabled";
  }

  onSave(e) {
    if (Object.keys(this.settings).length > 0) {
      e.settings = { ...e.settings, ...this.settings };
      e.restartRequested = true;
    }
  }
}
