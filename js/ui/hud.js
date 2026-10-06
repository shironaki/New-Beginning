/**
 * v3 UI — HUD and panels (DOM over the canvas).
 *
 * Diegetic and quiet: four need bars in the corner, a sky card with the clock,
 * a hotbar, one line of objective, and toasts for everything else. Panels
 * (fire, backpack, journal) are built on demand from plain objects, so game
 * systems never touch the DOM themselves.
 */
import { itemDef, itemEmoji, itemName } from "../sandbox/items.js";
import { UI, applyTheme } from "./uispec.js";

const NEED_DEFS = [
    { key: "food",    label: "Сытость",   icon: "🍖", color: "#d8a24a" },
    { key: "warmth",  label: "Тепло",     icon: "🔥", color: "#e07a3c" },
    { key: "fatigue", label: "Силы",      icon: "⚡", color: "#6fb3e0", invert: true },
    { key: "health",  label: "Здоровье",  icon: "❤️", color: "#cc4a5a" }
];

export class HUD {
    constructor(root, { onHotbar = () => {}, onAction = () => {} } = {}) {
        this.root = root;
        this.onHotbar = onHotbar;
        this.onAction = onAction;
        this.els = {};
        this.panelOpen = null;
        // The palette and the scales live in uispec.js; the stylesheet only
        // reads them. This is the one place they reach the document.
        applyTheme();
        this._build();
    }

    _build() {
        this.root.innerHTML = `
          <div class="hudTop">
            <div class="needsCard" id="needsCard"></div>
            <div class="skyCard" id="skyCard"></div>
          </div>
          <div class="objectiveBar" id="objectiveBar"></div>
          <div class="toasts" id="toasts"></div>
          <div class="hotbar" id="hotbar"></div>
          <div class="panelWrap hidden" id="panelWrap">
            <div class="panel" id="panel">
              <div class="panelHead"><span id="panelTitle"></span><button id="panelClose">✕</button></div>
              <div class="panelBody" id="panelBody"></div>
            </div>
          </div>
          <div class="storyWrap hidden" id="storyWrap">
            <div class="storyCard">
              <div class="storyTitle" id="storyTitle"></div>
              <div class="storyText" id="storyText"></div>
              <div class="storyNext" id="storyNext"></div>
              <button id="storyOk">Дальше</button>
            </div>
          </div>`;

        const $ = (id) => this.root.querySelector("#" + id);
        this.els = {
            needs: $("needsCard"), sky: $("skyCard"), objective: $("objectiveBar"),
            toasts: $("toasts"), hotbar: $("hotbar"),
            panelWrap: $("panelWrap"), panel: $("panel"), panelTitle: $("panelTitle"),
            panelBody: $("panelBody"), panelClose: $("panelClose"),
            storyWrap: $("storyWrap"), storyTitle: $("storyTitle"), storyText: $("storyText"),
            storyNext: $("storyNext"), storyOk: $("storyOk")
        };

        this.els.panelClose.addEventListener("click", () => this.closePanel());
        this.els.storyOk.addEventListener("click", () => this.hideStory());
        this.els.panelWrap.addEventListener("click", (e) => {
            if (e.target === this.els.panelWrap) this.closePanel();
        });

        // Need bars.
        this.els.needs.innerHTML = NEED_DEFS.map((n) => `
          <div class="need" data-need="${n.key}" role="meter" aria-label="${n.label}"
               aria-valuemin="0" aria-valuemax="100">
            <span class="needIcon" aria-hidden="true">${n.icon}</span>
            <div class="needBarOuter"><div class="needBar" style="background:${n.color}"></div></div>
            <span class="needVal"></span>
          </div>`).join("");
        this.needBars = {};
        this.needVals = {};
        this.needRows = {};
        NEED_DEFS.forEach((n) => {
            const row = this.els.needs.querySelector(`[data-need="${n.key}"]`);
            this.needRows[n.key] = row;
            this.needBars[n.key] = row.querySelector(".needBar");
            this.needVals[n.key] = row.querySelector(".needVal");
        });

        // Hotbar slots.
        this.els.hotbar.innerHTML = Array.from({ length: 6 }, (_, i) =>
            `<div class="slot" data-slot="${i}"><span class="slotKey">${i + 1}</span><span class="slotIcon"></span><span class="slotN"></span></div>`
        ).join("");
        this.els.hotbar.querySelectorAll(".slot").forEach((el) => {
            el.addEventListener("click", () => this.onHotbar(Number(el.dataset.slot)));
        });
    }

    /** Per-frame refresh. */
    update(state) {
        const { needs, clock, weather, inventory, objective, zoneName } = state;
        for (const n of NEED_DEFS) {
            const raw = needs[n.key];
            const v = Math.max(0, Math.min(100, n.invert ? 100 - raw : raw));
            const bar = this.needBars[n.key];
            const row = this.needRows[n.key];
            const pct = Math.round(v);
            bar.style.width = v + "%";
            // A number as well as a bar: "half full" is not a plan, "38 %" is.
            if (this.needVals[n.key].textContent !== pct + "%") {
                this.needVals[n.key].textContent = pct + "%";
                row.setAttribute("aria-valuenow", pct);
            }
            row.classList.toggle("low", v < UI.bar.low);
            row.classList.toggle("critical", v < UI.bar.critical);
        }

        const w = weather.info;
        this.els.sky.innerHTML = `
          <div class="skyTime">${clock.clockString()}</div>
          <div class="skyMeta">${clock.season.emoji} ${clock.season.name}, день ${clock.day}</div>
          <div class="skyMeta">${w.emoji} ${w.name} · ${Math.round(state.ambient)}°C</div>
          <div class="skyZone">${zoneName || ""}</div>`;

        this.els.objective.textContent = objective ? "🎯 " + objective : "";

        inventory.hotbar.forEach((slot, i) => {
            const el = this.els.hotbar.querySelector(`[data-slot="${i}"]`);
            el.classList.toggle("active", inventory.activeSlot === i);
            el.querySelector(".slotIcon").textContent = slot ? itemEmoji(slot.id) : "";
            el.querySelector(".slotN").textContent = slot && slot.n > 1 ? slot.n : "";
            el.title = slot ? itemName(slot.id) : "";
        });
        return this;
    }

    toast(text, icon = "") {
        const el = document.createElement("div");
        el.className = "toast";
        el.innerHTML = `${icon ? `<span class="toastIcon">${icon}</span>` : ""}${text}`;
        el.setAttribute("role", "status");
        this.els.toasts.appendChild(el);
        setTimeout(() => el.classList.add("show"), 10);
        setTimeout(() => {
            el.classList.remove("show");
            setTimeout(() => el.remove(), UI.toast.fadeMs);
        }, UI.toast.ms);
        while (this.els.toasts.children.length > UI.toast.max) this.els.toasts.firstChild.remove();
        return this;
    }

    /* ---- panels -------------------------------------------------------- */

    /**
     * @param {string} title
     * @param {Array} rows [{ label, icon, hint, disabled, action }] or { html }
     */
    openPanel(title, rows, name = "panel") {
        this.panelOpen = name;
        this.els.panelTitle.textContent = title;
        this.els.panelBody.innerHTML = "";
        for (const row of rows) {
            if (row.html !== undefined) {
                const d = document.createElement("div");
                d.className = "panelInfo";
                d.innerHTML = row.html;
                this.els.panelBody.appendChild(d);
                continue;
            }
            const b = document.createElement("button");
            b.className = "panelRow" + (row.disabled ? " disabled" : "");
            b.innerHTML = `<span class="rowIcon">${row.icon || "•"}</span>
                           <span class="rowLabel">${row.label}</span>
                           <span class="rowHint">${row.hint || ""}</span>`;
            if (!row.disabled) b.addEventListener("click", () => { row.action && row.action(); });
            this.els.panelBody.appendChild(b);
        }
        this.els.panelWrap.classList.remove("hidden");
        return this;
    }

    closePanel() {
        this.panelOpen = null;
        this.els.panelWrap.classList.add("hidden");
        return this;
    }

    get isPanelOpen() { return this.panelOpen !== null; }

    /* ---- story --------------------------------------------------------- */

    showStory({ title, text, next }) {
        this.els.storyTitle.textContent = title;
        this.els.storyText.textContent = text;
        this.els.storyNext.textContent = next ? "Дальше: " + next : "";
        this.els.storyWrap.classList.remove("hidden");
        this.storyShown = true;
        return this;
    }

    hideStory() {
        this.els.storyWrap.classList.add("hidden");
        this.storyShown = false;
        if (this.onAction) this.onAction("story_closed");
        return this;
    }

    get isStoryOpen() { return !!this.storyShown; }
}

/** Build the rows for the campfire panel — the heart of the prologue. */
export function fireRows(fire, inventory, actions) {
    const rows = [];
    rows.push({ html: `<b>${fire.lit ? "🔥 Костёр горит" : "🪵 Кострище"}</b><br>
        <small>${fire.status()}</small>` });

    // What is physically in the pit, newest on top, with how much is left.
    if (fire.stack && fire.stack.length) {
        const pile = fire.stack.slice().reverse().slice(0, 4).map((p) => {
            const pct = Math.round(p.burn * 100);
            return `${itemEmoji(p.id)} ${itemName(p.id).toLowerCase()} — ${pct}%`;
        }).join("<br>");
        rows.push({ html: `<small>В костре:<br>${pile}</small>` });
    }

    const fuels = inventory.list().filter((s) => (itemDef(s.id) || {}).burn > 0);
    for (const f of fuels.slice(0, 4)) {
        rows.push({
            icon: itemEmoji(f.id),
            label: `Подбросить ${itemName(f.id).toLowerCase()}`,
            hint: `×${f.n} · +${Math.round(itemDef(f.id).burn / 60)} мин горения`,
            action: () => actions.addFuel(f.id)
        });
    }
    if (!fuels.length) rows.push({ icon: "🪵", label: "Нет топлива", hint: "Собери хворост", disabled: true });

    if (!fire.lit) {
        rows.push({
            icon: "🔥", label: "Разжечь костёр",
            hint: fire.fuel > 0 ? "кремень" : "нужно топливо",
            disabled: fire.fuel <= 0, action: () => actions.light()
        });
    }

    // Raw food that the fire can actually do something with.
    const cookables = inventory.list().filter((s) => actions.canCook(s.id));
    for (const c of cookables.slice(0, 5)) {
        rows.push({
            icon: itemEmoji(c.id),
            label: `На вертел: ${itemName(c.id).toLowerCase()}`,
            hint: `×${c.n}`,
            disabled: !fire.lit,
            action: () => actions.putOnSpit(c.id)
        });
    }

    fire.spit.forEach((slot, i) => {
        if (!slot) return;
        const pct = Math.round(slot.progress * 100);
        const label = slot.state === "done" ? "Готово — снять"
            : slot.state === "burnt" ? "Сгорело — выбросить"
            : `Жарится… ${pct}%`;
        rows.push({
            icon: itemEmoji(slot.state === "raw" ? slot.itemId : slot.result),
            label, hint: `вертел ${i + 1}`,
            action: () => actions.takeFromSpit(i)
        });
    });

    if (fire.hasPot) {
        rows.push({ icon: "🫕", label: "Котелок", hint: fire.pot ? (fire.pot.done ? "готово" : "варится") : "пусто",
                    action: () => actions.openPot() });
    }
    return rows;
}
