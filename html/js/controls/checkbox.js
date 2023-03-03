import { jQuery } from "../system/jquery";

const template = (self) => `
<style>
.checkbox-input {
    clip: rect(0 0 0 0);
    -webkit-clip-path: inset(100%);
            clip-path: inset(100%);
    height: 1px;
    overflow: hidden;
    position: absolute;
    white-space: nowrap;
    width: 1px;
  }
  .checkbox-input:checked + .checkbox-tile {
    box-shadow: 0 5px 10px rgba(0, 0, 0, 0.1);
    color: var(--info-background-color);
  }
  .checkbox-input:checked + .checkbox-tile .checkbox-icon, 
  .checkbox-input:checked + .checkbox-tile .checkbox-text {
    color: var(--info-background-color);
  }

  .checkbox-input:disabled + .checkbox-tile .checkbox-icon, 
  .checkbox-input:disabled + .checkbox-tile .checkbox-text {
    color: #494949;
  }

  .checkbox-tile {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    width: 7rem;
    min-height: 7rem;
    box-shadow: 0 5px 10px rgba(0, 0, 0, 0.1);
    transition: 0.15s ease;
    cursor: pointer;
    position: relative;
  }
  
  .checkbox-icon {
    transition: 0.375s ease;
  }
  .checkbox-icon svg {
    width: 3rem;
    height: 3rem;
  }

  .checkbox-text {
    color: currentColor;
    transition: 0.375s ease;
    text-align: center;
    background: transparent;
    width: 7rem;
    border:0;
    outline:0;
  }

</style>
<div class="checkbox">
    <label class="checkbox-wrapper">
        <input type="checkbox" class="checkbox-input" ${self.hasAttribute("checked") ? 'checked' : ''} ${self.hasAttribute("disabled") ? 'disabled' : ''} />
        <span class="checkbox-tile">
            <span class="checkbox-icon">
                <slot></slot>
            </span>
            <input type="text" placeholder="${self.getAttribute("placeholder")}" value="${self.getAttribute("text")}" ${self.hasAttribute("readonly") ? 'disabled' : ''} class="checkbox-text" />
        </span>
    </label>
</div>
`
export class Checkbox extends HTMLElement {

  connectedCallback() {
    this.jQuery = jQuery(this).attachShadowTemplate(template, ($) => {
      this.checkbox = $('.checkbox-input')
        .on('click', this.onCheckClick.bind(this));
      this.textbox = $('.checkbox-text')
        .on('focus', this.onTextFocus.bind(this))
        .on('change', this.onChange.bind(this));
      this.icon = $('.checkbox-icon')
        .onClick(this.onClick.bind(this));
    });
  }

  disconnectedCallback() {
    this.jQuery().detach();
  }

  get disabled() {
    return this.checkbox.item().disabled;
  }

  set disabled(value) {
    return this.checkbox.item().disabled = value;
  }

  get readonly() {
    return this.textbox.item().readonly;
  }

  get checked() {
    return this.checkbox.item().checked;
  }

  set checked(value) {
    this.checkbox.item().checked = value;
    this.onChecked();
    return value;
  }

  get text() {
    return this.textbox.item().value
  }

  set text(value) {
    this.textbox.item().value = value;
  }

  onClick(e) {
    e.cancelBubble = true;
    e.preventDefault();
    const {ticks, clicks} = e;
    if (clicks > 1 || ticks > 800) 
    {
      this.onPick(e)
    }
    else
    {
      this.onCheck(e)
    }
  }

  
  async onTextFocus(e) {
    await new Promise(done=>setTimeout(done, 800));
    if (this.checked == false) {
      this.checked = true;
    }
  }

  onCheckClick(e) {
    e.cancelBubble = true;
    e.preventDefault();
  }

  onCheck(e) {
    if (this.dispatchEvent(new Event('check', {cancelable: true})))
    {
      this.checked = !this.checked
    }
  }

  onChecked() {
    this.dispatchEvent(new Event('checked'))
  }

  onPick(e) {
    if (this.dispatchEvent(new Event('pick', {cancelable: true}))) {
      this.dispatchEvent(new Event('picked'));
    }    
  }

  onChange(e) {
    this.dispatchEvent(new Event('changed'))
  }
}