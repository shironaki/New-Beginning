/**
 * UI — HUD and panels (DOM over the canvas).
 *
 * Diegetic and quiet: five need bars in the corner, a sky card with the clock,
 * a hotbar, one line of objective, and toasts for everything else. Panels
 * (fire, backpack, journal) are built on demand from plain objects, so game
 * systems never touch the DOM themselves.
 */
import { itemDef, itemEmoji, itemName } from "../sandbox/items.js";
import { quickFood, holdable } from "./quick-actions.js";
import { UI, applyTheme } from "./uispec.js";

const NEED_DEFS = [
    { key: "food",    label: "Сытость",   icon: "🍖", color: "#d8a24a" },
    { key: "warmth",  label: "Тепло",     icon: "🔥", color: "#e07a3c" },
    { key: "fatigue", label: "Бодрость",      icon: "⚡", color: "#6fb3e0", invert: true },
    { key: "stamina", label: "Выносливость", icon: "🏃", color: "#8fbc78" },
    { key: "health",  label: "Здоровье",  icon: "❤️", color: "#cc4a5a" }
];

export class HUD {
    constructor(root, { onHotbar = () => {}, onAction = () => {}, onEquipment = () => {}, onProvisions = () => {}, onEat = () => {}, onBag = () => {}, onCondition = () => {} } = {}) {
        this.root = root;
        this.onHotbar = onHotbar;
        this.actions = { onEquipment, onProvisions, onEat, onBag, onCondition };
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
            <div class="needsDisclosure" id="needsDisclosure">
              <button type="button" class="needSummary" id="needSummary" aria-expanded="false" aria-controls="needsDetails"></button>
              <div class="needsDetails" id="needsDetails" hidden>
                <div class="needsCard" id="needsCard"></div>
                <button type="button" id="conditionButton" class="conditionButton">Состояние и причины</button>
              </div>
            </div>
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
            disclosure: $("needsDisclosure"), summary: $("needSummary"), details: $("needsDetails"),
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
        // An open panel owns the keyboard: arrows walk the rows, Tab cannot
        // leave the dialog, Esc closes it. Without this the hero kept walking
        // behind the panel and Tab fell through to the browser chrome.
        this.els.panelWrap.addEventListener("keydown", (e) => this._panelKey(e));
        this.els.storyWrap.addEventListener("keydown", (e) => this._storyKey(e));

        // Need bars.
        this.els.needs.innerHTML = NEED_DEFS.map((n) => `
          <div class="need" data-need="${n.key}" role="meter" aria-label="${n.label}"
               aria-valuemin="0" aria-valuemax="100">
            <span class="needIcon" aria-hidden="true">${n.icon}</span><span class="needLabel"><span class="needFull">${n.label}</span><span class="needShort">${n.key === "stamina" ? "Выносл." : n.label}</span></span>
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

        $("conditionButton").addEventListener("click", () => this.actions.onCondition());
        this.els.summary.addEventListener("click", () => { this.needsPinned = !this.needsPinned; this.setNeedsExpanded(this.needsPinned); });
        this.els.disclosure.addEventListener("pointerenter", (e) => { if (e.pointerType !== "touch") this.setNeedsExpanded(true); });
        this.els.disclosure.addEventListener("pointerleave", () => { if (!this.needsPinned) this.setNeedsExpanded(false); });
        this.els.disclosure.addEventListener("focusin", () => this.setNeedsExpanded(true));
        this.els.disclosure.addEventListener("focusout", (e) => {
            if (!this.els.disclosure.contains?.(e.relatedTarget)) { this.needsPinned = false; this.setNeedsExpanded(false); }
        });
        this.els.disclosure.addEventListener("keydown", (e) => {
            if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); this.needsPinned = false; this.setNeedsExpanded(false); }
        });
        this.els.hotbar.setAttribute("role", "group");
        this.els.hotbar.setAttribute("aria-label", "Предметы под рукой");
        this.els.hotbar.innerHTML = `<button type="button" id="heldItem" class="quickItem"></button>
            <button type="button" id="eatItem" class="quickItem"></button>
            <button type="button" id="chooseFood" class="quickIcon foodChooser" aria-label="Выбрать еду">Еда</button>
            <button type="button" id="quickBag" class="quickIcon" aria-label="Рюкзак">🎒</button>`;
        for (const [id, action] of [["heldItem", "onEquipment"], ["eatItem", "onEat"], ["chooseFood", "onProvisions"], ["quickBag", "onBag"]]) {
            this.els[id] = $(id);
            this.els[id].addEventListener("click", () => this.actions[action]());
        }
    }

    setNeedsExpanded(open) {
        this.els.details.hidden = !open;
        this.els.summary.setAttribute("aria-expanded", String(open));
        if (!open) this.needsPinned = false;
    }

    /** Per-frame refresh. */
    update(state) {
        const { needs, clock, weather, inventory, objective, zoneName } = state;
        let worst = null;
        for (const n of NEED_DEFS) {
            const raw = n.key === "stamina" ? (state.player?.stamina ?? 100) : needs[n.key];
            const v = Math.max(0, Math.min(100, n.invert ? 100 - raw : raw));
            const bar = this.needBars[n.key];
            const row = this.needRows[n.key];
            const pct = Math.round(v);
            if (!worst || v < worst.value) worst = { ...n, value: v, pct };
            bar.style.width = v + "%";
            // A number as well as a bar: "half full" is not a plan, "38 %" is.
            if (this.needVals[n.key].textContent !== pct + "%") {
                this.needVals[n.key].textContent = pct + "%";
                row.setAttribute("aria-valuenow", pct);
            }
            row.classList.toggle("low", v < UI.bar.low);
            row.classList.toggle("critical", v < UI.bar.critical);
        }

        const summaryHTML = `<span class="summaryIcon" aria-hidden="true">${worst.icon}</span><span>${worst.label}</span><b>${worst.pct}%</b><span aria-hidden="true">⌄</span><i style="width:${worst.pct}%;background:${worst.color}"></i>`;
        if (this.els.summary.innerHTML !== summaryHTML) this.els.summary.innerHTML = summaryHTML;
        this.els.summary.setAttribute("aria-label", `${worst.label} ${worst.pct}%. Все показатели`);
        this.els.summary.classList.toggle("critical", worst.value < UI.bar.critical);

        const w = weather.info;
        this.els.sky.innerHTML = `
          <div class="skyTime">${clock.clockString()}</div>
          <div class="skyMeta">${clock.season.emoji} ${clock.season.name}, день ${clock.day}</div>
          <div class="skyMeta">${w.emoji} ${w.name} · ${Math.round(state.ambient)}°C</div>
          <div class="skyZone">${zoneName || ""}</div>`;

        // Owner requested no persistent hints/objectives over the scene. Journal retains the goal.
        this.els.objective.textContent = "";

        const held = inventory.active, tool = held && holdable(held.id) ? held.id : null;
        const food = quickFood(inventory, state.quickFoodId);
        const card = (icon, title, subtitle) => `<span class="quickGlyph" aria-hidden="true">${icon}</span><span class="quickText"><small>${subtitle}</small><b>${title}</b></span>`;
        const equipText = card(tool ? itemEmoji(tool) : "✋", tool ? itemName(tool) : "Предмет", "В руке");
        if (this.els.heldItem.innerHTML !== equipText) this.els.heldItem.innerHTML = equipText;
        this.els.heldItem.setAttribute("aria-label", tool ? `В руке ${itemName(tool)}. Сменить предмет` : "Выбрать предмет в руку");
        const eatText = card(food ? itemEmoji(food) : "—", food ? `${itemName(food)} ×${inventory.count(food)}` : "Нет еды", "Съесть");
        if (this.els.eatItem.innerHTML !== eatText) this.els.eatItem.innerHTML = eatText;
        this.els.eatItem.disabled = !food;
        this.els.eatItem.setAttribute("aria-label", food ? `Съесть ${itemName(food)}. Осталось ${inventory.count(food)}` : "Нет еды");
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

    /* ---- keyboard ------------------------------------------------------ */

    /** Everything inside the open panel a keyboard can land on, in order. */
    _doc() {
        return this.root.ownerDocument || (typeof document !== "undefined" ? document : null);
    }

    /**
     * Keyboard stops inside the open panel, in reading order: the rows we
     * built, then the close button. Kept as a list rather than a DOM query so
     * the order is exactly the order the rows were added in.
     */
    _focusables() {
        const rows = (this._panelRows || []).filter((b) => !b.disabled);
        return rows.concat(this.els.panelClose.disabled ? [] : [this.els.panelClose]);
    }

    _move(step) {
        const items = this._focusables();
        if (!items.length) return;
        const doc = this._doc();
        const at = items.indexOf(doc && doc.activeElement);
        const next = items[(at + step + items.length * 2) % items.length];
        if (next && typeof next.focus === "function") next.focus();
    }

    _panelKey(e) {
        const k = e.key;
        if (k === "Escape") { e.preventDefault(); e.stopPropagation(); this.closePanel(); return; }
        if (k === "ArrowDown") { e.preventDefault(); e.stopPropagation(); this._move(1); return; }
        if (k === "ArrowUp") { e.preventDefault(); e.stopPropagation(); this._move(-1); return; }
        if (k === "Home") { e.preventDefault(); const f = this._focusables()[0]; f && f.focus(); return; }
        if (k === "End") {
            e.preventDefault();
            const all = this._focusables(); const f = all[all.length - 1]; f && f.focus(); return;
        }
        if (k === "Tab") {                      // the trap itself
            const items = this._focusables();
            if (!items.length) return;
            e.preventDefault();
            this._move(e.shiftKey ? -1 : 1);
        }
    }

    _storyKey(e) {
        if (e.key === "Escape" || e.key === "Enter") {
            e.preventDefault(); e.stopPropagation(); this.hideStory();
        } else if (e.key === "Tab") {
            e.preventDefault();
            this.els.storyOk.focus();
        }
    }

    /* ---- panels -------------------------------------------------------- */

    /**
     * @param {string} title
     * @param {Array} rows [{ label, icon, hint, disabled, action }] or { html }
     */
    openPanel(title, rows, name = "panel", { locked = false } = {}) {
        this.setNeedsExpanded(false);
        this.panelLocked = locked;
        this.els.panelClose.disabled = locked;
        this.panelOpen = name;
        this.els.panelTitle.textContent = title;
        this.els.panelBody.innerHTML = "";
        this._panelRows = [];
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
            if (row.disabled) { b.disabled = true; b.tabIndex = -1; }
            b.innerHTML = `<span class="rowIcon">${row.icon || "•"}</span>
                           <span class="rowLabel">${row.label}</span>
                           <span class="rowHint">${row.hint || ""}</span>`;
            if (!row.disabled) b.addEventListener("click", () => { row.action && row.action(); });
            this._panelRows.push(b);
            this.els.panelBody.appendChild(b);
        }
        this.els.panelWrap.classList.remove("hidden");
        // Hand the keyboard over, and remember where to hand it back.
        const doc = this._doc();
        this._returnFocus = doc ? doc.activeElement : null;
        const first = this._focusables()[0];
        if (first && typeof first.focus === "function") first.focus();
        return this;
    }

    closePanel(force = false) {
        if (this.panelLocked && !force) return this;
        this.panelLocked = false; this.els.panelClose.disabled = false;
        this.panelOpen = null;
        this.els.panelWrap.classList.add("hidden");
        // Back to the game: the canvas, or whatever opened the panel.
        const back = this._returnFocus;
        this._returnFocus = null;
        if (back && typeof back.focus === "function" && back.isConnected !== false) back.focus();
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
        if (typeof this.els.storyOk.focus === "function") this.els.storyOk.focus();
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
    if (fire.exposure) rows.push({ html: `<small>${fire.exposure.label} · сырость ${Math.round(fire.damp * 100)}%<br>Тепло ${Math.round(fire.intensity * 100)}% · расход ×${fire.exposure.burn.toFixed(2)}</small>` });

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
            icon: itemEmoji(!slot.ready ? slot.itemId : slot.result),
            label, hint: `вертел ${i + 1}`,
            action: () => actions.takeFromSpit(i)
        });
    });

    if (fire.hasPot) {
        rows.push({ icon: "🫕", label: "Котелок", hint: fire.pot ? (fire.pot.done ? "готово" : "варится") : "пусто",
                    action: () => actions.openPot() });
    }
    if (fire.spit.some(Boolean) || fire.pot) rows.push({ icon: "🔥", label: "Оставить готовиться",
        action: () => actions.resume?.() });
    return rows;
}
