/**
 * tools/replay.js — record a run as a script of key presses, play it back, and
 * prove the game answers the same way every time.
 *
 * A replay is a tiny text file: `seconds key down/up`, one event per line,
 * plus a header with the seed. Playing it back at 30, 60 and 120 FPS has to
 * put the hero on the very same pixel — that is the contract the whole
 * movement model was built around (analytic integration, no Euler), and this
 * is the tool that keeps it honest.
 *
 *   node tools/replay.js record walk.replay --seconds 20     scripted walk
 *   node tools/replay.js play walk.replay                    30/60/120 FPS
 *   node tools/replay.js check                               the built-in script
 *   npm run replay
 *
 * Exit code 1 if any two frame rates disagree by more than the tolerance.
 * Zero dependencies: the software canvas and the fake DOM, like every other
 * tool here.
 */
import fs from "node:fs";
import { ShimCanvas } from "./canvas-shim.js";
import { installDOM, key as sendKey } from "../tests/dom-harness.js";

const dom = installDOM();
const baseCreate = globalThis.document.createElement;
globalThis.document.createElement = (tag) =>
    (tag === "canvas" ? new ShimCanvas(300, 150) : baseCreate(tag));

const screen = new ShimCanvas(640, 384);
screen.addEventListener = () => {};
screen.style = {};
const hudRoot = globalThis.document.getElementById("hud");
globalThis.document.getElementById = (id) => (id === "game" ? screen : hudRoot);

const { Game } = await import("../js/main.js");

/** The contract this tool enforces, in numbers. */
export const REPLAY = {
    rates: [30, 60, 120],      // frame rates every replay is played back at
    tolerance: 0.5,            // px the hero may differ between rates
    needTolerance: 0.02,       // same, for the needs bars (0..100)
    defaultSeconds: 18,
    seed: "ashes-and-grain"
};

/**
 * The built-in script: starts, stops, turns, reverses, sprints and lets go —
 * every transition the inertia model has to get right, in one minute of tape.
 */
const F = 1 / 30;          // the coarsest frame tested: events land on its grid
export const SCRIPT = [
    [0 * F, "KeyD", 1], [42 * F, "KeyD", 0],                    // start, coast to a stop
    [66 * F, "KeyW", 1], [90 * F, "KeyD", 1], [123 * F, "KeyW", 0],  // diagonal, then straight
    [144 * F, "ShiftLeft", 1],                                  // sprint
    [192 * F, "KeyD", 0], [195 * F, "KeyA", 1],                     // hard reverse at speed
    [240 * F, "ShiftLeft", 0],
    [276 * F, "KeyA", 0], [288 * F, "KeyS", 1],                     // down
    [330 * F, "KeyS", 0],
    [348 * F, "KeyA", 1], [351 * F, "KeyW", 1], [396 * F, "KeyW", 0],
    [420 * F, "KeyA", 0],                                      // let everything go
    [465 * F, "KeyD", 1], [480 * F, "KeyD", 0]                    // one short tap
];

function newGame(seed) {
    const g = new Game({ canvas: screen, hudRoot, seed });
    g.hud.hideStory();
    g.paused = false;
    return g;
}

/**
 * Play a script at a fixed frame rate and hand back the state it ended in.
 * Nothing here is random: the same script and seed always land on the pixel.
 */
export function playAt(script, fps, seconds, seed = REPLAY.seed) {
    const game = newGame(seed);
    const dt = 1 / fps;
    const frames = Math.round(seconds * fps);
    let next = 0;
    for (let i = 0; i < frames; i++) {
        const t = i * dt;
        // Events land on frame boundaries, as they do in a real game. The
        // script's times sit on the 1/30 s grid so every tested rate applies
        // them at the same simulated moment; epsilon guards the binary dust.
        while (next < script.length && script[next][0] <= t + 1e-9) {
            const [, code, down] = script[next++];
            sendKey(dom.win, code, !!down);
        }
        game.update(dt);
    }
    const p = game.player;
    return {
        x: p.x, y: p.y, dist: p.dist, phase: p.phase,
        vx: p.vx, vy: p.vy,
        food: game.needs.food, warmth: game.needs.warmth,
        fatigue: game.needs.fatigue, minute: game.clock.minute
    };
}

/** Parse a replay file: `# seed <seed>` plus `seconds code down` per line. */
export function parseReplay(text) {
    const script = [];
    let seed = REPLAY.seed, seconds = REPLAY.defaultSeconds;
    for (const raw of text.split("\n")) {
        const line = raw.trim();
        if (!line) continue;
        if (line.startsWith("#")) {
            const m = /^#\s*(seed|seconds)\s+(\S+)/.exec(line);
            if (m && m[1] === "seed") seed = m[2];
            if (m && m[1] === "seconds") seconds = Number(m[2]);
            continue;
        }
        const [t, code, down] = line.split(/\s+/);
        script.push([Number(t), code, down === "1" || down === "down"]);
    }
    script.sort((a, b) => a[0] - b[0]);
    return { script, seed, seconds };
}

/** The inverse: a replay file from a script. */
export function formatReplay(script, seed, seconds) {
    const head = `# seed ${seed}\n# seconds ${seconds}\n`;
    return head + script.map(([t, code, d]) => `${t.toFixed(3)} ${code} ${d ? 1 : 0}`).join("\n") + "\n";
}

/**
 * Play one script at every frame rate and report the spread. Returns
 * `{ ok, rows, spread }` — nothing is printed, so tests can use it too.
 */
export function compareRates(script, seconds, seed = REPLAY.seed, rates = REPLAY.rates) {
    const rows = rates.map((fps) => ({ fps, ...playAt(script, fps, seconds, seed) }));
    const spread = (key) => Math.max(...rows.map((r) => r[key])) - Math.min(...rows.map((r) => r[key]));
    const dx = spread("x"), dy = spread("y"), dd = spread("dist");
    const dn = Math.max(spread("food"), spread("warmth"), spread("fatigue"));
    return {
        ok: dx <= REPLAY.tolerance && dy <= REPLAY.tolerance
            && dd <= REPLAY.tolerance * 2 && dn <= REPLAY.needTolerance,
        rows, dx, dy, dd, dn
    };
}

/* ------------------------------------------------------------------ CLI -- */

const [cmd, file] = process.argv.slice(2);
const arg = (name, dflt) => {
    const i = process.argv.indexOf("--" + name);
    return i < 0 ? dflt : Number(process.argv[i + 1]);
};

if (cmd === "record") {
    const seconds = arg("seconds", REPLAY.defaultSeconds);
    const out = file || "walk.replay";
    fs.writeFileSync(out, formatReplay(SCRIPT, REPLAY.seed, seconds));
    console.log(`📼 ${SCRIPT.length} событий, ${seconds} с → ${out}`);
} else {
    let script = SCRIPT, seed = REPLAY.seed, seconds = REPLAY.defaultSeconds;
    if (cmd === "play") {
        if (!file || !fs.existsSync(file)) {
            console.error(`нет файла реплея: ${file}`);
            process.exit(1);
        }
        ({ script, seed, seconds } = parseReplay(fs.readFileSync(file, "utf8")));
    }
    const res = compareRates(script, seconds, seed);
    console.log(`\n▶ реплей: seed "${seed}", ${seconds} с, ${script.length} событий\n`);
    console.log("  fps        x          y       путь     сыт    тепло  усталость");
    for (const r of res.rows) {
        console.log(`  ${String(r.fps).padStart(3)}  ${r.x.toFixed(3).padStart(9)} `
            + `${r.y.toFixed(3).padStart(9)} ${r.dist.toFixed(2).padStart(9)} `
            + `${r.food.toFixed(2).padStart(7)} ${r.warmth.toFixed(2).padStart(7)} `
            + `${r.fatigue.toFixed(2).padStart(9)}`);
    }
    console.log(`\n  разброс: x ${res.dx.toFixed(4)} px, y ${res.dy.toFixed(4)} px, `
        + `путь ${res.dd.toFixed(4)} px, нужды ${res.dn.toFixed(4)}`);
    console.log(`  допуск:  ${REPLAY.tolerance} px / ${REPLAY.needTolerance}\n`);
    if (res.ok) {
        console.log("✅ все частоты кадров сходятся\n");
    } else {
        console.log("❌ частоты кадров расходятся\n");
        process.exit(1);
    }
}
