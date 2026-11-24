/**
 * tools/hero-strip.js — плёнка героя прямо в игре: те же кадры, что видит движок.
 *
 *   node tools/hero-strip.js --pose walk --dir right --frames 8
 *   node tools/hero-strip.js --pose attack --frames 6 --out .artifacts/hero-attack.png
 *
 * Инструмент поднимает настоящий `Game` (seed, зона, погода — как в tools/scene.js),
 * вручную выставляет фазу шага и рисует кадр, а затем вырезает героя из готового
 * рендера. Верхний ряд — запечённый 3D-спрайт, нижний — прежний вектор, поэтому
 * разница видна не «вообще», а на конкретной земле, в конкретной тени.
 */
import fs from "node:fs";
import path from "node:path";
import { ShimCanvas, encodePNG } from "./canvas-shim.js";
import { installDOM } from "../tests/dom-harness.js";

const args = process.argv.slice(2);
const flag = (name, dflt = null) => {
    const i = args.indexOf("--" + name);
    if (i < 0) return dflt;
    const v = args[i + 1];
    return v === undefined || v.startsWith("--") ? true : v;
};
const num = (name, dflt) => {
    const v = flag(name, null);
    return v === null || v === true ? dflt : Number(v);
};

const POSE = String(flag("pose", "walk"));
const DIR = String(flag("dir", "right"));
const FRAMES = num("frames", POSE === "walk" ? 8 : 6);
const ZOOM = num("zoom", 2.4);
const HOUR = num("hour", 17);
const OUT = path.resolve(String(flag("out", ".artifacts/hero-strip.png")));
const CELL = { w: 150, h: 168 };
const MODES = String(flag("modes", "sprite,vector")).split(",");
// --tints "#446d68,#8f3b3b,…" — ряд на каждый цвет куртки: слева кадры спрайта,
// справа те же кадры вектором. Проверяет цветовые дорожки: герой из запекки должен
// краситься тем же look, что и поселенец, — без единого перепека. Полоса слева
// показывает сам цвет.
// Запись — hex (тогда это куртка) или пары ключ=hex через пробел: "coat=#123 skin=#456".
const TINTS = flag("tints", null) ? String(flag("tints")).split(",").map(t => t.trim()).filter(Boolean).map(entry => {
    if (!entry.includes("=")) return { coat: entry };
    const look = {};
    for (const kv of entry.split(/\s+/)) {
        const [k, v] = kv.split("=");
        if (k && v) look[k] = v;
    }
    return look;
}) : null;

fs.mkdirSync(path.dirname(OUT), { recursive: true });

installDOM();
const baseCreate = globalThis.document.createElement;
globalThis.document.createElement = (tag) => (tag === "canvas" ? new ShimCanvas(300, 150) : baseCreate(tag));

const W = 960, H = 560;
const screen = new ShimCanvas(W, H);
screen.addEventListener = () => {};
screen.style = {};
const hudRoot = globalThis.document.getElementById("hud");
globalThis.document.getElementById = (id) => (id === "game" ? screen : hudRoot);

const { Game } = await import("../js/main.js");
const { HERO3D } = await import("../js/render/hero3d.js");

const game = new Game({ canvas: screen, hudRoot, seed: "ashes-and-grain" });
game.hud.hideStory();
game.paused = false;
game.findInteractable = () => null;
game.clock.minute = Math.round(HOUR * 60);
game.camera.zoom = ZOOM;
for (let i = 0; i < 8; i++) { game.update(1 / 60); game.render(); }

const player = game.player;
player.dir = DIR;

// --tool axe_stone [--hand left] — положить предмет в руку, не трогая сумку.
// Хват (позиция кулака, угол, порядок слоёв) надо снимать прямо здесь, а не
// догадываться о нём по скриншотам игры.
const TOOL = flag("tool", null);
if (TOOL) {
    const hand = String(flag("hand", "right"));
    const inv = game.inventory;
    inv.hands = inv.hands || { left: null, right: null };
    inv.hands.left = hand === "left" ? { id: TOOL, n: 1 } : null;
    inv.hands.right = hand === "left" ? null : { id: TOOL, n: 1 };
    console.log(`в руке ${hand}: ${TOOL}`);
}

function shoot(k) {
    const phase = (k / FRAMES) * Math.PI * 2;
    player.anim = phase;
    player.gait = POSE === "idle" || POSE === "torch" ? 0 : 1;
    player.moving = player.gait > 0;
    player.runBlend = POSE === "run" ? 1 : 0;
    const action = ["attack", "chop", "mine", "gather"].includes(POSE) ? 0.35 * (1 - k / FRAMES) : 0;
    player.actionTimer = action;
    player.actionKind = action ? (POSE === "attack" ? "tool" : POSE) : null;
    // Поза покоя и факела живут от времени рендера — как в tools/scene.js (--pose-time).
    game.renderer.time = k * 0.17;
    if (POSE === "torch") {
        game.inventory.add("torch", 1);
        const i = game.inventory.list().findIndex((s) => s.id === "torch");
        if (i >= 0) game.inventory.setActive(i);
    }
    game.camera.snapTo(player.x, player.y - 8);
    game.render();
    // Центр героя на экране: камера садится на точку (x, y-8), ноль персонажа — линия стоп.
    return { cx: W / 2, cy: H / 2 + 8 * ZOOM };
}

function grab(c) {
    const out = new ShimCanvas(CELL.w, CELL.h);
    const x0 = Math.round(c.cx - CELL.w / 2);
    const y0 = Math.round(c.cy - CELL.h * 0.78);
    for (let y = 0; y < CELL.h; y += 1) {
        for (let x = 0; x < CELL.w; x += 1) {
            const sx = x0 + x, sy = y0 + y;
            const d = (y * CELL.w + x) * 4;
            if (sx < 0 || sy < 0 || sx >= W || sy >= H) { out.data[d + 3] = 255; continue; }
            const s = (sy * W + sx) * 4;
            out.data[d] = screen.data[s]; out.data[d + 1] = screen.data[s + 1];
            out.data[d + 2] = screen.data[s + 2]; out.data[d + 3] = 255;
        }
    }
    return out;
}

const rows = [];
if (TINTS) {
    for (const tint of TINTS) {
        game.look = Object.assign({}, game.look, tint);   // look живёт на Game (main.js)
        const cells = [];
        for (const vector of [false, true]) {
            HERO3D.enabled = !vector;
            for (let k = 0; k < FRAMES; k += 1) cells.push(grab(shoot(k)));
        }
        rows.push({ mode: `${Object.entries(tint).map(([k, v]) => `${k} ${v}`).join(" ")} · спрайт | вектор`, cells, tint: Object.values(tint)[0] });
    }
} else {
    for (const mode of MODES) {
        HERO3D.enabled = mode !== "vector";
        const cells = [];
        for (let k = 0; k < FRAMES; k += 1) cells.push(grab(shoot(k)));
        rows.push({ mode, cells });
    }
}

const pad = 6;
const cols = Math.max(...rows.map(r => r.cells.length));
const sheet = new ShimCanvas(cols * (CELL.w + pad) + pad, rows.length * (CELL.h + pad + 16) + pad);
sheet.data.fill(30);
if (TINTS) {
    const rgb = TINTS.map(tint => {
        const c = String(tint.coat || tint.skin || tint.hair || "#808080").replace("#", "");
        return [parseInt(c.slice(0, 2), 16), parseInt(c.slice(2, 4), 16), parseInt(c.slice(4, 6), 16)];
    });
    rows.forEach((row, r) => {
        const i = rgb[Math.min(r, rgb.length - 1)];
        const y0 = pad + r * (CELL.h + pad + 16);
        for (let y = 0; y < CELL.h; y += 1) {
            for (let x = 0; x < 4; x += 1) {
                const d = ((y0 + y) * sheet.width + x) * 4;
                sheet.data[d] = i[0]; sheet.data[d + 1] = i[1]; sheet.data[d + 2] = i[2]; sheet.data[d + 3] = 255;
            }
        }
    });
}
rows.forEach((row, r) => {
    row.cells.forEach((cell, c) => {
        const ox = pad + c * (CELL.w + pad);
        const oy = pad + r * (CELL.h + pad + 16);
        for (let y = 0; y < cell.height; y += 1) {
            for (let x = 0; x < cell.width; x += 1) {
                const s = (y * cell.width + x) * 4;
                const d = ((oy + y) * sheet.width + ox + x) * 4;
                sheet.data[d] = cell.data[s]; sheet.data[d + 1] = cell.data[s + 1];
                sheet.data[d + 2] = cell.data[s + 2]; sheet.data[d + 3] = 255;
            }
        }
    });
});
fs.writeFileSync(OUT, encodePNG(sheet, [30, 30, 30]));
console.log(`STRIP: ${rows.map(r => `${r.mode} ${r.cells.length}`).join(", ")} → ${OUT} (${sheet.width}×${sheet.height})`);
