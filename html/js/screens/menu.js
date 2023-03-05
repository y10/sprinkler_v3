import { jQuery } from "../system/jquery";
import { Http } from "../system/http";
import { Status } from "../system/status";
import { Router } from "../system/router";
import { Version } from "../config";
import { App } from "../system/app";

const template = (self) => `
<style>

.container {
  width: 80vw;
  max-width: 300px;
}

button {
  border: 0;
  border-radius: 0.3rem;
  background-color: var(--secondary-background-color);
  line-height: 2.4rem;
  font-size: 1.2rem;
  width: 100%;
  color: var(--secondary-text-color);
  margin: 8px 0;
}

#update{
  background-color: var(--warn-background-color);
  color: var(--warn-text-color);
}

#reset{
  background-color: var(--alert-background-color);
  color: var(--alert-text-color);
}
</style>

<div class="container">
  <button id="zones">zones</button>
  <button id="setup">general</button>
  <button id="schedule">schedule</button>
  <button id="status">enabled</button>
  <button id="update">firmware update</button>
  <button id="reset">factory reset</button>
  <button id="restart">restart</button>
  <br>
  <div align="right">v${Version}</div>
</div>
`
export class Menu extends HTMLElement {
  connectedCallback() {
    this.jQuery = jQuery(this).attachShadowTemplate(template, ($) => {
      $('#reset').on('click', this.reset.bind(this));
      $('#restart').on('click', this.restart.bind(this));
      $('#zones').on('click', this.gotoZones.bind(this));
      $('#schedule').on('click', this.gotoSchedule.bind(this));
      $('#setup').on('click', this.gotoSetup.bind(this));
      $('#update').on('click', this.gotoUpdate.bind(this));
      this.$btnStatus = $('#status').on('click', this.gotoStatus.bind(this));
      $('#info').on('click', this.gotoInfo.bind(this));

      if ($(this).inViewport()) {
        this.update().catch();
      }
    });
  }

  disconnectedCallback() {
    this.jQuery().detach();
  }

  gotoSetup() {
    Router.navigate('setup');
  }

  gotoZones() {
    Router.navigate('zones');
  }

  gotoSchedule() {
    Router.navigate('schedule');
  }

  gotoUpdate() {
    Router.navigate('update');
  }

  async gotoStatus(e) {
    const spinner = Status.wait(5000);
    const element = e.srcElement;
    const command = element.innerText == "enabled" ? "disable" : "enable";
    try {
      const state = await Http.json('POST', `api/schedule/${command}`);
      this.update(state);
      spinner.close();
    } catch (error) {
      Status.error(error);
    } 
    await spinner;
  }

  gotoInfo() {
    Router.navigate('info');
  }

  async restart() {
    const spinner = Status.wait(10000);
    Http.json('POST', 'esp/restart').catch();
    await spinner;
    App.reload();
  }

  async reset() {
    if (confirm("Are you sure you want to continue? This will wipe out your settings completely!")) {
      const spinner = Status.wait();
      Http.json('POST', 'esp/reset').catch();
      await spinner;
      App.reload();
    }
  }

  async update(options) {
    if (!options) {
      options = {...await this.state()};
      console.log(options);
    }

    const {state} = options;
    this.$btnStatus.text(state == "enabled" ? "enabled" : "disabled");
  }

  async state() {
    try {
      return await Http.json('GET', 'api/schedule');
    } catch (error) {
      console.error(error);
      return { state: "disabled" };
    }
  }
}