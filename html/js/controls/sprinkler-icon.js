import { jQuery } from "../system/jquery";
import { Icons } from "../assets/icons";

const template = (self) => `
<style>
:host {
  display: block;
}
.icon {
  display: block;
  width: ${self.size};
  height: ${self.size};
  color: ${self.disabled ? '#494949' : 'var(--info-background-color)'};
  opacity: ${self.disabled ? '0.15' : '1'};
  transition: color 0.2s;
}
.icon svg {
  width: 100%;
  height: 100%;
}
</style>
<span class="icon">${Icons.sprinkler.replace(/width='100' height='100'/, "width='100%' height='100%'")}</span>
`;

export class SprinklerIcon extends HTMLElement {
  connectedCallback() {
    this.size = this.getAttribute("size") || "6rem";
    this.disabled = this.hasAttribute("disabled");

    this.jQuery = jQuery(this).attachShadowTemplate(template);
  }

  disconnectedCallback() {
    this.jQuery().detach();
  }
}
