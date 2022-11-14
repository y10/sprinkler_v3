import { jQuery } from "../system/jquery";
import { App } from "../models/app";

const html = `
<div class="container">
    <h1>Wifi</h1>
    <form>
        <br />
        <br />
        <br />
        <input id='ssid' name='ssid' length=32 type="text" placeholder='WiFi network name' autocomplete="username"><br />
        <br />
        <input id='pass' name='pass' length=64 type='password' placeholder='Network security key' autocomplete="current-password"><br />
        <br />
        <input id="chek" name='chek' type="checkbox" style="width:auto"><label for="chek">Show password</label>
    </form>
</div>
`
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

</style>
`;

export class WifiSettings extends HTMLElement {
  settings = {};

  connectedCallback() {
    this.jQuery = jQuery(this).attachShadowTemplate(style + html, async ($) => {
      this.txtPass = $("#pass");
      this.txtPass.on("change", this.onPassChange.bind(this));

      this.chkPass = $("#chek");
      this.chkPass.on("change", this.onPassToggle.bind(this));

      this.txtName = $("#ssid");
      this.txtName.value(App.ssid());
      this.txtName.on("change", this.onNameChange.bind(this));
    });
  }

  disconnectedCallback() {
    this.jQuery().detach();
  }

  onNameChange(e) {
    this.settings["ssid"] = this.txtName.value();
  }

  onPassChange() {
    this.settings["skey"] = this.txtPass.value();
  }

  onPassToggle() {
    const txtPass = this.txtPass.item();
    txtPass.type = txtPass.type == 'text' ? 'password' : 'text';
  }

  onSave(e) {
    if (Object.keys(this.settings).length > 0) {
      e.settings = { ...e.settings, ...this.settings };
      e.restartRequested = true;
    }
  }
}