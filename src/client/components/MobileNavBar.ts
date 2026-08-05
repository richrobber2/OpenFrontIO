import { html, LitElement, TemplateResult } from "lit";
import { customElement } from "lit/decorators.js";
import { assetUrl } from "../../core/AssetUrls";
import { NavNotificationsController } from "./NavNotificationsController";

@customElement("mobile-nav-bar")
export class MobileNavBar extends LitElement {
  private _notifications = new NavNotificationsController(this);

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener("showPage", this._onShowPage);

    const current = window.currentPageId;
    if (current) {
      this.updateComplete.then(() => {
        this._updateActiveState(current);
      });
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("showPage", this._onShowPage);
  }

  private _onShowPage = (e: Event) => {
    const pageId = (e as CustomEvent).detail;
    this._updateActiveState(pageId);
  };

  private _updateActiveState(pageId: string) {
    this.querySelectorAll(".nav-menu-item").forEach((el) => {
      const inner = el.querySelector("button");
      if ((el as HTMLElement).dataset.page === pageId) {
        el.classList.add("active");
        inner?.classList.add("active");
      } else {
        el.classList.remove("active");
        inner?.classList.remove("active");
      }
    });
  }

  private _renderDot(color: string): TemplateResult {
    return html`<span class="relative ml-2 shrink-0 -mt-2 w-2 h-2">
      <span class="absolute inset-0 ${color} rounded-full animate-ping"></span>
      <span class="absolute inset-0 ${color} rounded-full"></span>
    </span>`;
  }

  render() {
    window.currentPageId ??= "page-play";
    const currentPage = window.currentPageId;

    return html`
      <!-- Border Segments (Custom right border with gap for button) -->
      <div
        class="absolute right-0 top-0 w-px bg-transparent"
        style="height: calc(50% - 64px)"
      ></div>
      <div
        class="absolute right-0 bottom-0 w-px bg-transparent"
        style="height: calc(50% - 64px)"
      ></div>

      <div
        class="flex-1 w-full flex flex-col justify-start overflow-y-auto pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))] pl-[max(1.25rem,env(safe-area-inset-left))] pr-5 gap-2"
      >
        <!-- Logo + Menu -->
        <div
          class="grid grid-cols-[minmax(0,1fr)_3rem] items-start gap-3 text-malibu-blue mb-2"
        >
          <div class="flex flex-col items-center gap-1">
            <img
              src=${assetUrl("images/OpenFrontLogo.svg")}
              alt="OpenFront"
              class="w-auto h-auto max-w-[220px] max-h-[4.5rem]"
            />
            <div
              id="game-version"
              class="l-header__highlightText text-center"
            ></div>
          </div>
          <button
            id="mobile-menu-close"
            class="w-12 h-12 -mt-1 rounded-xl grid place-items-center text-white/80 bg-white/5 border border-white/10 active:bg-white/15 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-malibu-blue"
            data-i18n-aria-label="common.close"
            data-i18n-title="common.close"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              class="w-7 h-7"
              aria-hidden="true"
            >
              <path
                d="M6 6l12 12M18 6 6 18"
                stroke-width="1.8"
                stroke-linecap="round"
              />
            </svg>
          </button>
        </div>
        <!-- Mobile Navigation Menu Items -->
        <button
          class="nav-menu-item block w-full min-h-12 py-2 text-left font-bold uppercase tracking-[0.05em] text-white/70 transition-all duration-200 cursor-pointer hover:text-blue-600 hover:translate-x-2.5 hover:drop-shadow-[0_0_20px_rgba(37,99,235,0.5)] text-[clamp(18px,2.8vh,32px)] [&.active]:text-blue-600 [&.active]:translate-x-2.5 [&.active]:drop-shadow-[0_0_20px_rgba(37,99,235,0.5)] ${currentPage ===
          "page-play"
            ? "active"
            : ""}"
          data-page="page-play"
          data-i18n="main.play"
        ></button>
        <div
          class="nav-menu-item flex items-center w-full cursor-pointer"
          data-page="page-news"
          @click=${this._notifications.onNewsClick}
        >
          <button
            class="block text-left font-bold uppercase tracking-[0.05em] text-white/70 transition-all duration-200 cursor-pointer hover:text-blue-600 hover:translate-x-2.5 hover:drop-shadow-[0_0_20px_rgba(37,99,235,0.5)] [&.active]:text-blue-600 [&.active]:translate-x-2.5 [&.active]:drop-shadow-[0_0_20px_rgba(37,99,235,0.5)] text-[clamp(18px,2.8vh,32px)] min-h-12 py-2"
            data-i18n="main.news"
          ></button>
          ${this._notifications.showNewsDot()
            ? this._renderDot("bg-red-500")
            : ""}
        </div>
        <button
          class="nav-menu-item block w-full text-left font-bold uppercase tracking-[0.05em] text-white/70 transition-all duration-200 cursor-pointer hover:text-blue-600 hover:translate-x-2.5 hover:drop-shadow-[0_0_20px_rgba(37,99,235,0.5)] [&.active]:text-blue-600 [&.active]:translate-x-2.5 [&.active]:drop-shadow-[0_0_20px_rgba(37,99,235,0.5)] text-[clamp(18px,2.8vh,32px)] min-h-12 py-2"
          data-page="page-leaderboard"
          data-i18n="main.leaderboard"
        ></button>
        <button
          class="no-crazygames nav-menu-item block w-full text-left font-bold uppercase tracking-[0.05em] text-white/70 transition-all duration-200 cursor-pointer hover:text-blue-600 hover:translate-x-2.5 hover:drop-shadow-[0_0_20px_rgba(37,99,235,0.5)] [&.active]:text-blue-600 [&.active]:translate-x-2.5 [&.active]:drop-shadow-[0_0_20px_rgba(37,99,235,0.5)] text-[clamp(18px,2.8vh,32px)] min-h-12 py-2"
          data-page="page-clan"
          data-i18n="main.clans"
        ></button>
        <div
          class="no-crazygames nav-menu-item flex items-center w-full cursor-pointer"
          data-page="page-item-store"
          @click=${this._notifications.onStoreClick}
        >
          <button
            class="block text-left font-bold uppercase tracking-[0.05em] text-white/70 transition-all duration-200 cursor-pointer hover:text-blue-600 hover:translate-x-2.5 hover:drop-shadow-[0_0_20px_rgba(37,99,235,0.5)] [&.active]:text-blue-600 [&.active]:translate-x-2.5 [&.active]:drop-shadow-[0_0_20px_rgba(37,99,235,0.5)] text-[clamp(18px,2.8vh,32px)] min-h-12 py-2"
            data-i18n="main.store"
          ></button>
          ${this._notifications.showStoreDot()
            ? this._renderDot("bg-red-500")
            : ""}
        </div>
        <button
          class="nav-menu-item block w-full text-left font-bold uppercase tracking-[0.05em] text-white/70 transition-all duration-200 cursor-pointer hover:text-blue-600 hover:translate-x-2.5 hover:drop-shadow-[0_0_20px_rgba(37,99,235,0.5)] [&.active]:text-blue-600 [&.active]:translate-x-2.5 [&.active]:drop-shadow-[0_0_20px_rgba(37,99,235,0.5)] text-[clamp(18px,2.8vh,32px)] min-h-12 py-2"
          data-page="page-settings"
          data-i18n="main.settings"
        ></button>
        <button
          id="mobile-nav-account-button"
          class="nav-menu-item block w-full text-left font-bold uppercase tracking-[0.05em] text-white/70 transition-all duration-200 cursor-pointer hover:text-blue-600 hover:translate-x-2.5 hover:drop-shadow-[0_0_20px_rgba(37,99,235,0.5)] [&.active]:text-blue-600 [&.active]:translate-x-2.5 [&.active]:drop-shadow-[0_0_20px_rgba(37,99,235,0.5)] text-[clamp(18px,2.8vh,32px)] min-h-12 py-2"
          data-page="page-account"
          data-i18n="main.account"
        ></button>
        <div
          class="nav-menu-item flex items-center w-full cursor-pointer"
          data-page="page-help"
          @click=${this._notifications.onHelpClick}
        >
          <button
            class="block text-left font-bold uppercase tracking-[0.05em] text-white/70 transition-all duration-200 cursor-pointer hover:text-blue-600 hover:translate-x-2.5 hover:drop-shadow-[0_0_20px_rgba(37,99,235,0.5)] [&.active]:text-blue-600 [&.active]:translate-x-2.5 [&.active]:drop-shadow-[0_0_20px_rgba(37,99,235,0.5)] text-[clamp(18px,2.8vh,32px)] min-h-12 py-2"
            data-i18n="main.help"
          ></button>
          ${this._notifications.showHelpDot()
            ? this._renderDot("bg-yellow-400")
            : ""}
        </div>
        <div
          class="flex flex-col w-full mt-auto [.in-game_&]:hidden items-end justify-end pt-4 border-t border-white/10"
        ></div>
      </div>
    `;
  }
}
