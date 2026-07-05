import { jQuery } from "../system/jquery";
import { Router } from "../system/router";
import { App } from "../system/app";

const template = (self) => `
<div id="conainer">
    <sketch-menu-toggle></sketch-menu-toggle>
    <sketch-outlet>
        <sprinkler-main></sprinkler-main>
    </sketch-outlet>
    <sketch-snackbar></sketch-snackbar>
    <sketch-spinner></sketch-spinner>
</div>`;
export class Index extends HTMLElement {

    connectedCallback() {

        jQuery(this).attachShadow(async ($) => {
            this.jQuery = $;
            $(document).on('back', this.onBack.bind(this));
            $(document).on('escape', this.onEscape.bind(this));
            $(document).on('refresh', this.onRefresh.bind(this));
            $(document).on('spinning', this.onSpinning.bind(this));
            $(document).on('navigate', this.onNavigate.bind(this));
            $(document).on('notification', this.onNotification.bind(this));
            this.render();
        });

        // Bind the chain listener ONCE (render() re-runs on 'refresh' — binding there would stack duplicates).
        if (!this._onChainChange) {
            this._onChainChange = () => this._syncToggleToChain();
            App.chain().addEventListener('change', this._onChainChange);
        }
    }

    disconnectedCallback() {
        if (this._onChainChange) {
            App.chain().removeEventListener('change', this._onChainChange);
            this._onChainChange = null;
        }
        this.jQuery().detach();
    }

    // On the landing page, morph the hamburger to X while the chain has zones.
    _syncToggleToChain() {
        const onMain = this.$Outlet?.item()?.lastElement?.tagName === 'SPRINKLER-MAIN';
        if (!onMain) return;
        const toggle = this.$Toggle?.item();
        if (!toggle) return;
        App.chain().hasItems() ? toggle.open() : toggle.close();
    }

    onEscape(e) {
        this.close()
    }

    onRefresh(e) {
        this.render();
    };
    
    onToggle(e) {
        // On the landing page with a chain present, the X clears the chain (accepted overload).
        const onMain = this.$Outlet?.item()?.lastElement?.tagName === 'SPRINKLER-MAIN';
        if (onMain && App.chain().hasItems()) {
            App.chain().clear();
            return;
        }
        this.$Toggle.item().opened ? this.close() : this.open();
    }

    onSpinning(e) {
        this.$Spinner.item().spinning = e.detail.spinning;
    }

    onNotification(e) {
        this.$Snack.item().show(e.detail);
    }

    onBack(e) {
        const spinner = this.$Spinner.item();
        if (spinner.spinning) {
            spinner.spinning = false;
            e.preventDefault();
            return false;
        }

        if (!this.$Outlet.item().back()) {
            e.preventDefault();
            return false;
        }

        this.$Snack.item().hide();
        return true;
    }

    async onNavigate(e) {
        const { screen, options } = e.detail;
        if (!(await this.$Outlet.item().navigate(screen, options))) {
            e.preventDefault();
        }
    }

    onNavigateTo(e) {
        this.$Toggle.item().open();

        // Clear an idle chain when navigating away from the landing page to a real screen
        // (schedule/settings/etc.). "menu" and "zone" are overlays on main and must preserve it.
        const to = e.detail && e.detail.to;
        const chain = App.chain();
        if (to && to != "main" && to != "menu" && to != "zone" && chain.hasItems() && !chain.isActive()) {
            chain.clear();
        }
    }

    onNavigateFrom(e) {
        if (e.detail.to == "main") {
            // Returning to the landing page: keep the X if a chain still has items, else hamburger.
            this._syncToggleToChain();
        }
        else if (e.detail.to == "menu") {
        }
    }

    close() {
        Router.goback();
    }

    open() {
        Router.navigate('menu');
    }

    render() {
        this.jQuery().html(template(this), ($) => {

            this.$Spinner = $('sketch-spinner');
            this.$Toggle = $('sketch-menu-toggle')
                .on('click', this.onToggle.bind(this));
            this.$Outlet = $('sketch-outlet')
                .on('navigate-to', this.onNavigateTo.bind(this))
                .on('navigate-from', this.onNavigateFrom.bind(this));
            this.$Slider = $('sketch-slider');
            this.$Snack = $('sketch-snackbar');

        });
    };
}
