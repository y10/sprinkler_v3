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

#pipe {
  background-color: var(--blue-background-color);
  color: var(--blue-text-color);
}

#pump {
  background-color: var(--info-background-color);
  color: var(--info-text-color);
}

#update {
  background-color: var(--warn-background-color);
  color: var(--warn-text-color);
}

#restart {
  background-color: var(--accent-background-color);
  color: var(--accent-text-color);
}

#reset{
  background-color: var(--alert-background-color);
  color: var(--alert-text-color);
}
</style>

<div class="container">
  <button id="setup">setup</button>
  <button id="zones">zones</button>
  <button id="pipe" style="display: none">city water</button>
  <button id="pump">well water</button>
  <button id="schedule">schedule</button>
  <button id="status">enabled</button>
  <button id="update">firmware update</button>
  <button id="reset">factory reset</button>
  <button id="console">console</button>
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
      this.$btnPipe = $('#pipe').on('click', this.usePump.bind(this));
      this.$btnPump = $('#pump').on('click', this.usePipe.bind(this));
      this.$btnState = $('#status').on('click', this.gotoStatus.bind(this));
      $('#update').on('click', this.gotoUpdate.bind(this));
      $('#console').on('click', this.gotoConsole.bind(this));
      $('#info').on('click', this.gotoInfo.bind(this));

      if ($(this).inViewport()) {
        this.refresh().catch();
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

  gotoConsole() {
    Router.navigate('console');
  }

  async usePipe() {
    await this.use('utility')
  }

  async usePump() {
    await this.use('punmp')
  }
  
  async use(source) {
    const spinner = Status.wait(5000);
    try {
      await Http.json('POST', `api/use/${source}/water`);
    } catch (error) {
      if (error.name != 'timeout') {
          Status.error(error);
          spinner.close();
      }
    } 
    await spinner;
    App.reload();
  }

  async gotoStatus(e) {
    const spinner = Status.wait(5000);
    const element = e.srcElement;
    const command = element.innerText == "enabled" ? "disable" : "enable";
    try {
      await Http.json('POST', `api/schedule/${command}`);
      this.refresh();
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

  async refresh() {
    let state = { enabled: 0, source: "pump" };
    try {
      const s = await Http.json('GET', 'api/settings');
      state = {...state, ...s}
    } catch (error) {
      console.error(error);
    }

    this.$btnState.text(state.enabled ? "enabled" : "disabled");
    this.$btnPump.css('display', state.source == "pump" ? '' : 'none');
    this.$btnPipe.css('display', state.source != "pump" ? '' : 'none');
  }
}