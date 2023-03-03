import { jQuery } from "../system/jquery";

const template = `
<style>
</style>
<div class="container">
  <sketch-pattern-lock matrix="2x3"></sketch-pattern-lock>
</div>`;
export class ZonesPath extends HTMLElement {
  connectedCallback() {
    this.jQuery = jQuery(this).attachShadowTemplate(template, async ($) => {
      this.$zones = $("sketch-pattern-lock");
      this.$zones.item().setPattern([1,3,2,5,6,4])
    });
  }

  disconnectedCallback() {
    this.jQuery().detach();
  }
}
