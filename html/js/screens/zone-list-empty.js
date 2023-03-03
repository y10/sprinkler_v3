import { jQuery, Router } from "../system";

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

a {
  color: var(--primary-text-color);
}

.container > * {
  margin: 0.5rem 0.5rem;
}

@media screen and (min-height: 730px) {
  .container {
    max-width: 500px;
  }
}

</style>
<div class="container">
<p>No sprinkler zone has been created. You should <a id="add-zones" href="./zones" onClick="return false;">add new</a> zone(s) to proceed.</p>
</div>`;
export class EmptyZoneList extends HTMLElement {
  connectedCallback() {
    this.jQuery = jQuery(this).attachShadowTemplate(template, ($) => {
      $('#add-zones').on('click', this.gotoSettings.bind(this));
    });
  }

  disconnectedCallback() {
    this.jQuery().detach();
  }

  gotoSettings()
  {
    Router.navigate('zones', {popup: true});
    return false;
  }
}
