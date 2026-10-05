/**
 * render/tilesart.js — procedural ground and prop art.
 *
 * No image assets: tiles and props are drawn from code. Ground is baked once
 * per 16×16 chunk, so the per-pixel work here costs nothing per frame.
 *
 * Art rules (keep them consistent, they are what makes it read as one world):
 *   • The sun sits top-left: highlights on the upper-left, shadow lower-right.
 *   • Nothing is a flat colour — every surface gets 3+ tones and organic noise.
 *   • Variation comes from smooth noise, never from a per-tile square blotch
 *     (that was the grid artefact in the first pass).
 *   • Props are silhouettes first: dark base, mid body, one bright rim light.
 */
import { T, tileInfo } from "../world/tiles.js";

/* ------------------------------------------------------------------ utils */

/** Deterministic hash → [0,1). */
function h(x, y, s = 0) {
    let n = (x * 374761393 + y * 668265263 + s * 2246822519) | 0;
    n = (n ^ (n >>> 13)) * 1274126177 | 0;
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

/** Smooth noise across tiles — large soft patches, no grid edges. */
function soft(x, y, scale = 8, seed = 0) {
    const fx = x / scale, fy = y / scale;
    const xi = Math.floor(fx), yi = Math.floor(fy);
    const tx = fx - xi, ty = fy - yi;
    const u = tx * tx * (3 - 2 * tx), v = ty * ty * (3 - 2 * ty);
    const a = h(xi, yi, seed), b = h(xi + 1, yi, seed);
    const c = h(xi, yi + 1, seed), d = h(xi + 1, yi + 1, seed);
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

function rgb(c) {
    if (c[0] === "#") {
        const s = c.slice(1);
        return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
    }
    const m = c.match(/-?\d+/g) || [0, 0, 0];
    return [+m[0], +m[1], +m[2]];
}

function css(r, g, b, a = 1) {
    const f = (v) => Math.max(0, Math.min(255, Math.round(v)));
    return a >= 1 ? `rgb(${f(r)},${f(g)},${f(b)})` : `rgba(${f(r)},${f(g)},${f(b)},${a})`;
}

export function shade(hex, amount) {
    const [r, g, b] = rgb(hex);
    return css(r + amount, g + amount, b + amount);
}

function mix(c1, c2, t) {
    const a = rgb(c1), b = rgb(c2);
    return css(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t);
}

/** Seasonal shift applied to living ground (grass, moss, meadow). */
export function seasonTint(season) {
    switch (season) {
        case "summer": return { c: "#8fbe4a", t: 0.10 };
        case "autumn": return { c: "#b8823a", t: 0.34 };
        case "winter": return { c: "#dfe8f0", t: 0.55 };
        default: return { c: "#7fc04f", t: 0.08 };
    }
}

const LIVING = new Set([T.GRASS, T.MEADOW, T.MOSS, T.GRASS_DRY, T.PINE_FLOOR]);

/* ------------------------------------------------------------------ ground */

/**
 * Paint one ground tile.
 * Draws in 8 px cells with noise-driven tone, then a type-specific detail pass.
 */
export function paintTile(ctx, id, px, py, size, tx, ty, season = "spring") {
    const info = tileInfo(id);
    let [base, dark, light] = info.colors;

    if (LIVING.has(id)) {
        const st = seasonTint(season);
        base = mix(base, st.c, st.t * 0.75);
        dark = mix(dark, st.c, st.t * 0.5);
        light = mix(light, st.c, st.t * 0.9);
    }

    // Tone is computed per 8 px cell from noise sampled in *continuous* world
    // space, so there is no tile-sized step anywhere — that was the grid
    // artefact of the first pass.
    const [br, bg, bb] = rgb(base);
    // How strongly the ground varies across metres. Burnt and bare ground is
    // blotchy; grass and snow are even.
    const amp = (id === T.ASH || id === T.SOOT) ? 26
        : (id === T.DIRT || id === T.SAND || id === T.GRAVEL || id === T.MUD) ? 18
        : LIVING.has(id) ? 16 : 12;
    // 4 px cells: fine enough that the eye reads grain, not a chequerboard.
    const cells = 8;
    const cs = size / cells;
    ctx.fillStyle = base;
    ctx.fillRect(px, py, size, size);
    for (let cy = 0; cy < cells; cy++) {
        for (let cx = 0; cx < cells; cx++) {
            const gx = tx * cells + cx, gy = ty * cells + cy;
            const macro = soft(gx, gy, 52, 11) - 0.5;      // broad sun/shade
            const meso = soft(gx, gy, 14, 23) - 0.5;       // patches
            const micro = soft(gx, gy, 3.2, 31) - 0.5;     // grain
            const tone = macro * amp + meso * (amp * 0.7) + micro * 5;
            // Hue drifts too, not just brightness: dry yellow-green here,
            // cold blue-green there. Flat colour is what kills ground art.
            const warm = (soft(gx, gy, 38, 97) - 0.5) * (LIVING.has(id) ? 20 : 10);
            ctx.fillStyle = css(br + tone + warm, bg + tone + warm * 0.45, bb + tone - warm * 0.7);
            ctx.fillRect(px + cx * cs, py + cy * cs, cs + 0.5, cs + 0.5);
            // Living ground: thin, trodden patches where earth shows through,
            // and deeper pools of shade. Continuous noise, so no tile edges.
            if (LIVING.has(id)) {
                const bare = soft(gx, gy, 34, 53);
                if (bare > 0.66) {
                    ctx.fillStyle = `rgba(104,84,56,${(bare - 0.66) * 1.5})`;
                    ctx.fillRect(px + cx * cs, py + cy * cs, cs + 0.5, cs + 0.5);
                } else if (bare < 0.3) {
                    ctx.fillStyle = `rgba(18,34,16,${(0.3 - bare) * 0.7})`;
                    ctx.fillRect(px + cx * cs, py + cy * cs, cs + 0.5, cs + 0.5);
                }
            }

            // Burnt ground keeps the memory of the fire: soft scorch smears
            // and pale drifts of ash, both continuous across tiles.
            if (id === T.ASH || id === T.SOOT) {
                const scorch = soft(gx, gy, 26, 71);
                if (scorch > 0.58) {
                    ctx.fillStyle = `rgba(26,21,18,${(scorch - 0.58) * 1.1})`;
                    ctx.fillRect(px + cx * cs, py + cy * cs, cs + 0.5, cs + 0.5);
                } else if (scorch < 0.3) {
                    ctx.fillStyle = `rgba(206,196,182,${(0.3 - scorch) * 0.55})`;
                    ctx.fillRect(px + cx * cs, py + cy * cs, cs + 0.5, cs + 0.5);
                }
            }

            // Sparse speckles of the palette's own light/dark tones.
            const k = h(gx, gy, 5);
            if (k > 0.93) {
                ctx.fillStyle = light; ctx.globalAlpha = 0.3;
                ctx.fillRect(px + cx * cs + k * 4, py + cy * cs + k * 3, 2, 1.5);
                ctx.globalAlpha = 1;
            } else if (k < 0.07) {
                ctx.fillStyle = dark; ctx.globalAlpha = 0.32;
                ctx.fillRect(px + cx * cs + k * 30, py + cy * cs + k * 24, 2, 1.5);
                ctx.globalAlpha = 1;
            }
        }
    }

    detailPass(ctx, id, px, py, size, tx, ty, { base, dark, light, season });
    ctx.globalAlpha = 1;
}

function detailPass(ctx, id, px, py, size, tx, ty, pal) {
    const { dark, light, season } = pal;

    switch (id) {
        case T.GRASS: case T.MEADOW: case T.MOSS: case T.GRASS_DRY: case T.PINE_FLOOR: {
            // Tufts, not lone sticks: three or four blades leaning out of one
            // root, lighter at the tip, with a darker blade behind.
            const winter = season === "winter";
            const tufts = 2 + Math.floor(h(tx, ty, 2) * 3);
            for (let i = 0; i < tufts; i++) {
                const gx = px + h(tx, ty, i * 3 + 1) * (size - 6) + 3;
                const gy = py + h(tx, ty, i * 7 + 2) * (size - 6) + 4;
                const n0 = h(tx, ty, i * 11);
                const blades = 3 + Math.floor(n0 * 2);
                ctx.lineCap = "round";
                for (let k = 0; k < blades; k++) {
                    const n = h(tx * 3 + i, ty * 5 + k, 19);
                    const len = (2.6 + n * 3.4) * (id === T.MOSS ? 0.7 : 1);
                    const lean = (k - (blades - 1) / 2) * (0.8 + n * 0.8);
                    const front = k % 2 === 0;
                    ctx.strokeStyle = winter ? "rgba(228,238,246,0.55)" : (front ? light : dark);
                    ctx.globalAlpha = front ? 0.5 : 0.34;
                    ctx.lineWidth = front ? 1 : 0.8;
                    ctx.beginPath();
                    ctx.moveTo(gx, gy);
                    ctx.quadraticCurveTo(gx + lean * 0.4, gy - len * 0.6, gx + lean, gy - len);
                    ctx.stroke();
                }
                ctx.globalAlpha = 1;
            }
            // Occasional flower / pebble / fallen needle.
            const spark = h(tx, ty, 77);
            if (id === T.MEADOW && spark > 0.86) {
                const c = ["#e8d05a", "#e6eaf0", "#d98ab0", "#9fc6ef"][Math.floor(spark * 97) % 4];
                const fx = px + 8 + spark * 12, fy = py + 10 + spark * 10;
                ctx.fillStyle = "rgba(40,60,30,0.3)";
                ctx.fillRect(fx, fy + 1.6, 1, 2.4);           // a stem under it
                ctx.fillStyle = c;
                ctx.beginPath(); ctx.arc(fx + 0.5, fy + 0.5, 1.4, 0, Math.PI * 2); ctx.fill();
                ctx.fillStyle = "rgba(255,255,255,0.5)";
                ctx.fillRect(fx - 0.4, fy - 0.4, 0.9, 0.9);
            }
            if (id === T.PINE_FLOOR && spark > 0.7) {
                ctx.strokeStyle = "rgba(60,48,30,0.5)";
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(px + 6 + spark * 14, py + 8 + spark * 12);
                ctx.lineTo(px + 10 + spark * 14, py + 12 + spark * 10);
                ctx.stroke();
                ctx.beginPath();
                ctx.moveTo(px + 7 + spark * 14, py + 11 + spark * 10);
                ctx.lineTo(px + 11 + spark * 14, py + 9 + spark * 10);
                ctx.stroke();
            }
            break;
        }

        case T.ASH: case T.SOOT: {
            // Soot flecks, charcoal bits and the odd live ember.
            for (let i = 0; i < 6; i++) {
                const a = h(tx, ty, i * 5 + 3);
                const gx = px + a * (size - 2), gy = py + h(tx, ty, i * 9 + 4) * (size - 2);
                ctx.fillStyle = a > 0.55 ? "rgba(28,24,22,0.55)" : "rgba(150,142,134,0.3)";
                ctx.fillRect(gx, gy, a > 0.85 ? 2 : 1, 1);
            }
            const ember = h(tx, ty, 61);
            if (ember > 0.95) {
                ctx.fillStyle = "rgba(220,110,50,0.55)";
                ctx.fillRect(px + ember * 20, py + ember * 18, 2, 2);
            }

            // Baked litter of the fire: charcoal lumps, burnt twigs, cracks.
            const d = h(tx, ty, 99);
            const dx = px + h(tx, ty, 13) * (size - 14) + 4;
            const dy = py + h(tx, ty, 14) * (size - 12) + 4;
            if (d > 0.94) {                                   // charcoal lump
                ctx.fillStyle = "rgba(0,0,0,0.25)";
                ctx.beginPath(); ctx.ellipse(dx + 1, dy + 2, 5, 2.4, 0, 0, Math.PI * 2); ctx.fill();
                ctx.fillStyle = "#211c19";
                ctx.beginPath();
                ctx.moveTo(dx - 4, dy + 1); ctx.lineTo(dx - 2, dy - 3);
                ctx.lineTo(dx + 3, dy - 2); ctx.lineTo(dx + 4, dy + 1);
                ctx.closePath(); ctx.fill();
                ctx.fillStyle = "rgba(150,140,130,0.25)";
                ctx.fillRect(dx - 2, dy - 2.5, 3, 1);
            } else if (d > 0.86) {                            // burnt twig
                ctx.strokeStyle = "rgba(32,26,22,0.75)";
                ctx.lineWidth = 1.4;
                ctx.beginPath();
                ctx.moveTo(dx - 6, dy + 2);
                ctx.quadraticCurveTo(dx, dy - 2, dx + 6, dy + 1);
                ctx.stroke();
                ctx.lineWidth = 1;
                ctx.beginPath(); ctx.moveTo(dx + 1, dy - 0.6); ctx.lineTo(dx + 4, dy - 4); ctx.stroke();
            } else if (d > 0.78) {                            // cracked, dry earth
                ctx.strokeStyle = "rgba(20,16,14,0.3)";
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(dx - 7, dy - 4); ctx.lineTo(dx - 1, dy + 1); ctx.lineTo(dx + 6, dy - 1);
                ctx.stroke();
            }
            break;
        }

        case T.SAND: {
            // Wind ripples.
            ctx.strokeStyle = "rgba(255,255,255,0.12)";
            ctx.lineWidth = 1;
            for (let i = 0; i < 2; i++) {
                const ry = py + 6 + i * 13 + h(tx, ty, i) * 5;
                ctx.beginPath();
                ctx.moveTo(px + 2, ry);
                ctx.quadraticCurveTo(px + size / 2, ry - 2.5, px + size - 2, ry);
                ctx.stroke();
            }
            ctx.fillStyle = "rgba(120,100,70,0.22)";
            for (let i = 0; i < 3; i++) {
                ctx.fillRect(px + h(tx, ty, i * 13) * size, py + h(tx, ty, i * 17) * size, 1, 1);
            }
            break;
        }

        case T.WATER: case T.DEEP: {
            const deep = id === T.DEEP;
            // Depth: the open water sinks towards blue-black, the shallows
            // keep a sandy glow. Continuous noise, so no tile steps.
            const q = size / 4;
            for (let cy2 = 0; cy2 < 4; cy2++) {
                for (let cx2 = 0; cx2 < 4; cx2++) {
                    const gx = tx * 4 + cx2, gy = ty * 4 + cy2;
                    const d = soft(gx, gy, 9, 13);
                    ctx.fillStyle = deep
                        ? `rgba(8,26,44,${0.18 + d * 0.3})`
                        : `rgba(16,54,78,${0.06 + d * 0.22})`;
                    // Exact, non-overlapping cells: translucent fills that
                    // overlap by half a pixel leave a grid of dark seams.
                    ctx.fillRect(px + cx2 * q, py + cy2 * q, q, q);
                }
            }
            // Caustics: bright wavy threads where the light hits the bottom.
            ctx.strokeStyle = deep ? "rgba(140,200,230,0.1)" : "rgba(225,245,255,0.22)";
            ctx.lineWidth = 1;
            for (let i = 0; i < 3; i++) {
                const ry = py + 4 + i * 10 + h(tx, ty, i) * 5;
                const rw = 7 + h(tx, ty, i + 5) * 15;
                const rx = px + h(tx, ty, i + 9) * (size - rw);
                ctx.beginPath();
                ctx.moveTo(rx, ry);
                ctx.quadraticCurveTo(rx + rw * 0.5, ry - 2.5, rx + rw, ry + 0.5);
                ctx.stroke();
            }
            if (!deep && h(tx, ty, 41) > 0.72) {       // sun glint on the shallows
                ctx.fillStyle = "rgba(255,255,255,0.3)";
                ctx.beginPath();
                ctx.ellipse(px + 8 + h(tx, ty, 3) * 14, py + 10 + h(tx, ty, 9) * 12, 3, 0.9, 0.3, 0, Math.PI * 2);
                ctx.fill();
            }
            break;
        }

        case T.STONE: case T.GRAVEL: case T.CLIFF: {
            // Chips of stone and hairline cracks. Angular, never square
            // blocks — axis-aligned rectangles here read as a tile grid.
            for (let i = 0; i < 5; i++) {
                const a = h(tx, ty, i * 7 + 2), b2 = h(tx, ty, i * 11 + 3), c2 = h(tx, ty, i * 5 + 9);
                const gx = px + a * (size - 8) + 2, gy = py + b2 * (size - 8) + 2;
                const w = 2 + c2 * 4, hh = 1.4 + a * 2.6;
                ctx.fillStyle = a > 0.5 ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.12)";
                ctx.beginPath();
                ctx.moveTo(gx, gy + hh * 0.6);
                ctx.lineTo(gx + w * 0.35, gy);
                ctx.lineTo(gx + w, gy + hh * 0.35);
                ctx.lineTo(gx + w * 0.7, gy + hh);
                ctx.closePath(); ctx.fill();
            }
            ctx.strokeStyle = "rgba(0,0,0,0.1)";
            ctx.lineWidth = 1;
            const crack = h(tx, ty, 77);
            if (crack > 0.85) {
                ctx.beginPath();
                ctx.moveTo(px + crack * size, py);
                ctx.lineTo(px + (1 - crack) * size * 0.8 + 3, py + size * 0.55);
                ctx.lineTo(px + crack * size * 0.6, py + size);
                ctx.stroke();
            }
            if (id === T.CLIFF) {
                // A rock face seen from above-front: dark mass, stacked
                // blocks of stone, lichen in the damp cracks. Cap and foot
                // shadow are added by paintEdges, which knows the neighbours.
                ctx.fillStyle = "rgba(18,16,15,0.3)";
                ctx.fillRect(px, py, size, size);
                // Courses of stone, offset like real masonry and jittered so
                // the wall never turns into a chequerboard.
                const blocks = 3 + Math.floor(h(tx, ty, 29) * 3);
                for (let i = 0; i < blocks; i++) {
                    const row = i % 2, col = Math.floor(i / 2);
                    const u = h(tx * 7 + i, ty * 13, 31);
                    const v = h(tx * 11, ty * 17 + i, 47);
                    const shift = ((ty * 3 + col) % 2) * 0.22 + (u - 0.5) * 0.18;
                    const bw = size * (0.36 + u * 0.3), bh = size * (0.26 + v * 0.22);
                    const bx = px + (shift + row * 0.42) * size + (v - 0.5) * 4;
                    const by = py + (col * 0.38 + (u - 0.5) * 0.12) * size;
                    ctx.fillStyle = `rgba(${Math.round(96 + u * 44)},${Math.round(92 + u * 42)},${Math.round(86 + u * 40)},0.75)`;
                    ctx.beginPath();
                    ctx.moveTo(bx, by + bh * 0.25);
                    ctx.lineTo(bx + bw * 0.3, by);
                    ctx.lineTo(bx + bw, by + bh * 0.2);
                    ctx.lineTo(bx + bw * 0.85, by + bh);
                    ctx.lineTo(bx + bw * 0.15, by + bh * 0.9);
                    ctx.closePath(); ctx.fill();
                    ctx.fillStyle = "rgba(255,255,255,0.12)";          // top facet
                    ctx.beginPath();
                    ctx.moveTo(bx, by + bh * 0.25);
                    ctx.lineTo(bx + bw * 0.3, by);
                    ctx.lineTo(bx + bw * 0.75, by + bh * 0.15);
                    ctx.lineTo(bx + bw * 0.35, by + bh * 0.35);
                    ctx.closePath(); ctx.fill();
                    ctx.fillStyle = "rgba(0,0,0,0.3)";                 // seam below
                    ctx.fillRect(bx + bw * 0.15, by + bh * 0.88, bw * 0.7, 1.6);
                }
                if (h(tx, ty, 83) > 0.72) {                            // lichen
                    ctx.fillStyle = "rgba(92,116,64,0.22)";
                    ctx.beginPath();
                    ctx.ellipse(px + h(tx, ty, 5) * size, py + h(tx, ty, 7) * size, 5, 3, 0.4, 0, Math.PI * 2);
                    ctx.fill();
                }
            }
            break;
        }

        case T.SNOW: {
            ctx.fillStyle = "rgba(255,255,255,0.55)";
            ctx.fillRect(px, py, size, 2);
            for (let i = 0; i < 3; i++) {
                ctx.fillStyle = "rgba(170,195,225,0.25)";
                ctx.fillRect(px + h(tx, ty, i) * size, py + h(tx, ty, i + 3) * size, 2, 1);
            }
            break;
        }

        case T.MUD: {
            ctx.fillStyle = "rgba(20,24,14,0.3)";
            for (let i = 0; i < 2; i++) {
                const a = h(tx, ty, i * 3);
                ctx.beginPath();
                ctx.ellipse(px + a * size, py + h(tx, ty, i * 5) * size, 4 + a * 4, 2 + a * 2, 0, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.fillStyle = "rgba(140,160,120,0.18)";
            ctx.fillRect(px + h(tx, ty, 8) * size, py + h(tx, ty, 9) * size, 2, 2);
            break;
        }

        case T.PATH: case T.COBBLE: case T.DIRT: {
            // Trodden earth: pebbles and wheel ruts.
            for (let i = 0; i < 5; i++) {
                const a = h(tx, ty, i * 5 + 1);
                ctx.fillStyle = a > 0.5 ? "rgba(255,245,220,0.13)" : "rgba(40,28,18,0.2)";
                ctx.fillRect(px + a * (size - 3), py + h(tx, ty, i * 7 + 6) * (size - 3), 1 + (a > 0.8 ? 1 : 0), 1);
            }
            if (id === T.COBBLE) {
                ctx.strokeStyle = "rgba(0,0,0,0.18)";
                ctx.lineWidth = 1;
                for (let i = 0; i < 2; i++) {
                    ctx.beginPath();
                    ctx.moveTo(px, py + i * 16 + 8);
                    ctx.lineTo(px + size, py + i * 16 + 8);
                    ctx.stroke();
                }
            }
            break;
        }

        case T.PLANK: {
            ctx.fillStyle = "rgba(0,0,0,0.22)";
            ctx.fillRect(px, py + size - 2, size, 1);
            for (let i = 0; i < 2; i++) {
                ctx.fillStyle = "rgba(0,0,0,0.18)";
                ctx.fillRect(px, py + 10 + i * 12, size, 1);
                ctx.fillStyle = "rgba(255,230,190,0.10)";
                ctx.fillRect(px, py + 11 + i * 12, size, 1);
            }
            break;
        }

        case T.FARM: case T.FARM_WET: {
            ctx.fillStyle = "rgba(0,0,0,0.22)";
            for (let i = 0; i < 3; i++) ctx.fillRect(px, py + 4 + i * 10, size, 2);
            ctx.fillStyle = "rgba(255,220,170,0.08)";
            for (let i = 0; i < 3; i++) ctx.fillRect(px, py + 6 + i * 10, size, 1);
            break;
        }
    }
}

/**
 * Soft transition between two ground types: a dithered fringe that fades out,
 * plus a thin darker contact line, which reads as a real edge rather than a
 * sawtooth.
 */
export function paintEdges(ctx, map, tx, ty, px, py, size) {
    const here = map.get(tx, ty);
    const dirs = [[0, -1, "n"], [1, 0, "e"], [0, 1, "s"], [-1, 0, "w"]];
    for (const [dx, dy, side] of dirs) {
        const other = map.get(tx + dx, ty + dy);
        if (other === here || other === T.VOID) continue;
        const oi = tileInfo(other), hi = tileInfo(here);
        if (here === T.CLIFF && !(oi.solid && !oi.liquid)) {
            // The lit top edge of the wall, only where it actually ends.
            ctx.fillStyle = "rgba(255,255,255,0.14)";
            if (side === "n") ctx.fillRect(px, py, size, 3);
            if (side === "w") ctx.fillRect(px, py, 2.5, size);
            if (side === "e") ctx.fillRect(px + size - 2.5, py, 2.5, size);
            if (side === "s") {
                ctx.fillStyle = "rgba(0,0,0,0.38)";       // the wall's own foot
                ctx.fillRect(px, py + size - 5, size, 5);
            }
            continue;
        }
        if (oi.solid && !oi.liquid) {
            // Contact shadow cast by a cliff onto the neighbouring ground.
            ctx.fillStyle = "rgba(0,0,0,0.20)";
            if (side === "n") ctx.fillRect(px, py, size, 4);
            if (side === "w") ctx.fillRect(px, py, 4, size);
            if (side === "e") ctx.fillRect(px + size - 3, py, 3, size);
            if (side === "s") ctx.fillRect(px, py + size - 3, size, 3);
            continue;
        }

        // Interlock the two *dry* grounds: a deep ragged fringe plus a
        // scatter of the neighbour's colour further in, so patches never
        // read as squares. Coasts are handled separately below — a gravel
        // comb poking into the sea looks terrible.
        const steps = 16;
        if (!oi.liquid && !hi.liquid) {
            for (let layer = 0; layer < 2; layer++) {
                ctx.fillStyle = oi.colors[layer === 0 ? 0 : 1];
                ctx.globalAlpha = layer === 0 ? 0.6 : 0.34;
                for (let i = 0; i < steps; i++) {
                    const n = h(tx * 13 + i, ty * 17 + layer, side.charCodeAt(0));
                    const n2 = h(tx * 31 + i * 3, ty * 7 + layer, side.charCodeAt(0) + 5);
                    const depth = (layer === 0 ? 4.5 : 10) * (0.2 + n * 1.1) * (0.6 + n2 * 0.7);
                    const seg = size / steps;
                    if (side === "n") ctx.fillRect(px + i * seg, py, seg, depth);
                    if (side === "s") ctx.fillRect(px + i * seg, py + size - depth, seg, depth);
                    if (side === "w") ctx.fillRect(px, py + i * seg, depth, seg);
                    if (side === "e") ctx.fillRect(px + size - depth, py + i * seg, depth, seg);
                }
            }
            ctx.globalAlpha = 0.4;
            ctx.fillStyle = oi.colors[1];
            for (let i = 0; i < 7; i++) {
                const n = h(tx * 23 + i * 5, ty * 29, side.charCodeAt(0) + 11);
                const n2 = h(tx * 17, ty * 41 + i * 3, side.charCodeAt(0) + 19);
                if (n2 > 0.62) continue;
                const along = n * size;
                const into = 4 + n2 * 13;
                const sz = 1.5 + n2 * 2.5;
                if (side === "n") ctx.fillRect(px + along, py + into, sz, sz);
                if (side === "s") ctx.fillRect(px + along, py + size - into - sz, sz, sz);
                if (side === "w") ctx.fillRect(px + into, py + along, sz, sz);
                if (side === "e") ctx.fillRect(px + size - into - sz, py + along, sz, sz);
            }
            ctx.globalAlpha = 1;
        }
        ctx.globalAlpha = 1;

        // --- the shoreline ------------------------------------------------
        // Land next to water: a band of wet, darker ground. Water next to
        // land: a band of bright shallows. Both follow a wobbling line, so
        // the coast never looks like a staircase of tiles.
        const band = (depthAt, paint) => {
            const fine = steps * 2;                            // 1 px teeth
            const seg = size / fine;
            for (let i = 0; i < fine; i++) {
                const d = depthAt(i);
                if (d <= 0) continue;
                // Exact segment width: overlapping translucent strips
                // double up and show as a comb of darker stripes.
                paint(i * seg, seg, d);
            }
        };
        // Low-frequency wobble: the band's inner edge is a slow wave along
        // the coast. High-frequency noise here turns into a comb of teeth.
        const along = (i) => (side === "n" || side === "s") ? tx * steps + i : ty * steps + i;
        const across = (side === "n" || side === "s") ? ty * steps : tx * steps;
        const wobble = (i, salt) => {
            const n = soft(along(i), across, 11, salt);        // slow swell
            const n2 = soft(along(i), across, 4.5, salt + 3);  // small bays
            return 0.3 + n * 1.0 + n2 * 0.45;
        };
        if (oi.liquid && !hi.liquid) {
            band((i) => wobble(i, 11) * 7, (off, len, d) => {
                ctx.fillStyle = "rgba(96,78,52,0.32)";            // wet ground
                if (side === "n") ctx.fillRect(px + off, py, len, d);
                if (side === "s") ctx.fillRect(px + off, py + size - d, len, d);
                if (side === "w") ctx.fillRect(px, py + off, d, len);
                if (side === "e") ctx.fillRect(px + size - d, py + off, d, len);
            });
            band((i) => wobble(i, 23) * 2.6, (off, len, d) => {
                ctx.fillStyle = "rgba(255,255,255,0.3)";          // dried foam line
                if (side === "n") ctx.fillRect(px + off, py, len, d);
                if (side === "s") ctx.fillRect(px + off, py + size - d, len, d);
                if (side === "w") ctx.fillRect(px, py + off, d, len);
                if (side === "e") ctx.fillRect(px + size - d, py + off, d, len);
            });
        } else if (hi.liquid && oi.liquid) {
            // Shallow meeting deep: a soft lip instead of a hard rectangle.
            const lighter = here === T.WATER;
            band((i) => wobble(i, 29) * 8, (off, len, d) => {
                ctx.fillStyle = lighter ? "rgba(10,34,56,0.18)" : "rgba(120,170,190,0.16)";
                if (side === "n") ctx.fillRect(px + off, py, len, d);
                if (side === "s") ctx.fillRect(px + off, py + size - d, len, d);
                if (side === "w") ctx.fillRect(px, py + off, d, len);
                if (side === "e") ctx.fillRect(px + size - d, py + off, d, len);
            });
        } else if (hi.liquid && !oi.liquid) {
            band((i) => wobble(i, 17) * 9, (off, len, d) => {
                ctx.fillStyle = "rgba(190,215,205,0.3)";          // sunlit shallows
                if (side === "n") ctx.fillRect(px + off, py, len, d);
                if (side === "s") ctx.fillRect(px + off, py + size - d, len, d);
                if (side === "w") ctx.fillRect(px, py + off, d, len);
                if (side === "e") ctx.fillRect(px + size - d, py + off, d, len);
            });
        }
    }
    ctx.globalAlpha = 1;
}

/* ======================================================================= */
/*  Props — drawn every frame, y-sorted with characters. Origin = the base.  */
/* ======================================================================= */

/**
 * Where the sun is. The renderer updates this once per frame from the clock;
 * props use it to throw a shadow in the right direction and length, which is
 * most of what makes a scene read as "morning" or "noon".
 */
export const SUN = { dx: 0.55, dy: 0.42, len: 1, alpha: 1 };

export function setSun(hour, daylight) {
    // Low sun in the morning and evening → long shadows pointing away from it.
    const t = Math.max(0, Math.min(1, (hour - 6) / 12));      // 0 at dawn, 1 at dusk
    const elevation = Math.sin(Math.max(0, Math.min(Math.PI, t * Math.PI)));
    SUN.dx = Math.cos(Math.PI * (0.15 + t * 0.7)) * -1.25;    // east → west
    SUN.dy = 0.34 + (1 - elevation) * 0.5;
    SUN.len = 0.55 + (1 - elevation) * 1.35;
    SUN.alpha = Math.max(0, Math.min(1, daylight)) * 0.9;
}

function shadowEllipse(ctx, w, hh, alpha = 0.3) {
    // A cast shadow stretching away from the sun, plus a soft contact pool
    // under the object. Grounding things this way is most of the "3D" feeling.
    if (SUN.alpha > 0.05) {
        const reach = w * SUN.len * SUN.alpha;
        ctx.save();
        ctx.fillStyle = `rgba(14,12,10,${alpha * 0.3 * SUN.alpha})`;
        ctx.beginPath();
        ctx.ellipse(SUN.dx * reach * 0.6, SUN.dy * hh * SUN.len * 0.8,
                    w * (1 + SUN.len * 0.55), hh * (1 + SUN.len * 0.25),
                    Math.atan2(SUN.dy * hh, SUN.dx * w) * 0.35, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
    ctx.fillStyle = `rgba(14,12,10,${alpha * 0.4})`;
    ctx.beginPath();
    ctx.ellipse(1.6, 1.2, w * 1.12, hh * 1.12, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = `rgba(14,12,10,${alpha})`;
    ctx.beginPath();
    ctx.ellipse(1.5, 1, w, hh, 0, 0, Math.PI * 2);
    ctx.fill();
}

/** Per-instance colour jitter so a forest is not a clone army. */
function jitterPalette(colors, seedA, seedB) {
    // Each plant gets its own shade: brightness, warmth and a little
    // saturation drift. A forest of identical greens looks like wallpaper.
    const k = (h(seedA, seedB, 17) - 0.5) * 26;
    const warm = (h(seedA, seedB, 29) - 0.5) * 20;
    const sat = 0.86 + h(seedA, seedB, 43) * 0.3;
    return colors.map((c) => {
        const [r, g, b] = rgb(c);
        const lum = (r + g + b) / 3;
        return css(lum + (r - lum) * sat + k + warm,
                   lum + (g - lum) * sat + k,
                   lum + (b - lum) * sat + k - warm * 0.5);
    });
}

const TREE_COLORS = {
    pine:        ["#35593a", "#274330", "#4e7d4b", "#16281c"],
    spruce:      ["#2d4f35", "#21402c", "#447045", "#13231a"],
    oak:         ["#44763a", "#375f30", "#63a24b", "#1e3418"],
    birch:       ["#5f9442", "#4c7a36", "#84b85a", "#2a401c"],
    willow:      ["#55713c", "#445c30", "#7a9552", "#26311a"],
    palm:        ["#3f8450", "#316a41", "#5aa96a", "#1c3a24"],
    ancient_oak: ["#33612f", "#265024", "#4d8340", "#16290f"]
};

const AUTUMN_COLORS = ["#b07a2c", "#8f6122", "#d79a3e", "#48300f"];

function conifer(ctx, obj, season = "spring") {
    const s = obj.size || 1;
    const pal = jitterPalette(TREE_COLORS[obj.kind] || TREE_COLORS.pine, obj.tx, obj.ty);
    const [mid, dark, lit, deep] = pal;
    const winter = season === "winter";
    const spruce = obj.kind === "spruce";
    const H = (spruce ? 50 : 46) * s;

    shadowEllipse(ctx, 13 * s, 5 * s, 0.32);

    // Trunk, visible between the lowest branches.
    ctx.fillStyle = "#4b3722";
    ctx.beginPath();
    ctx.moveTo(-3.4 * s, 0);
    ctx.quadraticCurveTo(-2.2 * s, -8 * s, -1.6 * s, -16 * s);
    ctx.lineTo(1.6 * s, -16 * s);
    ctx.quadraticCurveTo(2.2 * s, -8 * s, 3.4 * s, 0);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#5e472c";
    ctx.fillRect(0.2 * s, -16 * s, 1.8 * s, 16 * s);
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.fillRect(-3.2 * s, -16 * s, 1.2 * s, 16 * s);

    // Branch tiers. Each one is a drooping skirt of needle bundles, with its
    // own jitter — no two trees share a silhouette.
    const tiers = 5 + Math.floor(h(obj.tx, obj.ty, 47) * 3);
    for (let i = 0; i < tiers; i++) {
        const t = i / (tiers - 1);
        const j = h(obj.tx + i, obj.ty, 53);
        const w = (18 - t * 12) * s * (0.86 + j * 0.28);
        const y = -11 * s - t * (H - 16 * s);
        const tierH = (14 + j * 5) * s;
        const droop = (2 + j * 2.5) * s;

        // Body of the tier: a jagged skirt, deeper notches near the edge.
        const skirt = (scale, fill, dy) => {
            ctx.fillStyle = fill;
            ctx.beginPath();
            ctx.moveTo(0, y - tierH * scale + dy);
            for (let k = 1; k <= 6; k++) {
                const f = k / 6;
                const n = h(obj.tx + i * 3, obj.ty + k, 61);
                ctx.lineTo(w * f * scale, y - tierH * (1 - f) * scale + dy + (k % 2 ? 1 : 3.4) * s + f * droop);
            }
            ctx.lineTo(w * 0.5 * scale, y + 1.5 * s + dy);
            ctx.lineTo(-w * 0.5 * scale, y + 1.5 * s + dy);
            for (let k = 6; k >= 1; k--) {
                const f = k / 6;
                ctx.lineTo(-w * f * scale, y - tierH * (1 - f) * scale + dy + (k % 2 ? 2.6 : 0.8) * s + f * droop);
            }
            ctx.closePath(); ctx.fill();
        };
        skirt(1, deep, 2.2 * s);                    // shadow under the branches
        skirt(1, i % 2 ? dark : mid, 0);

        // Sunlit left half and shaded right half.
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = lit;
        ctx.beginPath();
        ctx.moveTo(-0.5 * s, y - tierH);
        ctx.lineTo(-w * 0.78, y + 0.5 * s + droop * 0.7);
        ctx.lineTo(-w * 0.26, y + 0.5 * s);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = deep;
        ctx.globalAlpha = 0.3;
        ctx.beginPath();
        ctx.moveTo(w * 0.16, y - tierH * 0.55);
        ctx.lineTo(w * 0.95, y + 1.5 * s + droop * 0.7);
        ctx.lineTo(w * 0.2, y + 1.5 * s);
        ctx.closePath(); ctx.fill();
        ctx.globalAlpha = 1;

        // Needle bundles along the lower edge: this is what makes it read as
        // a conifer instead of a stack of triangles.
        ctx.strokeStyle = i % 2 ? lit : mid;
        ctx.lineWidth = 0.9 * s;
        ctx.lineCap = "round";
        for (let k = 0; k < 7; k++) {
            const f = (k + 0.5) / 7;
            const n = h(obj.tx * 3 + i, obj.ty * 5 + k, 67);
            const dir = k % 2 ? 1 : -1;
            const ex = dir * w * f, ey = y - tierH * (1 - f) + 2 * s + f * droop;
            ctx.beginPath();
            ctx.moveTo(ex * 0.72, ey - 2.4 * s);
            ctx.lineTo(ex + dir * (1 + n * 2) * s, ey + (1 + n) * s);
            ctx.stroke();
        }

        if (i === tiers - 1) {                       // sun on the crown tip
            ctx.fillStyle = "rgba(255,240,190,0.26)";
            ctx.beginPath();
            ctx.moveTo(0, y - tierH);
            ctx.lineTo(-w * 0.45, y - tierH * 0.15);
            ctx.lineTo(0, y - tierH * 0.3);
            ctx.closePath(); ctx.fill();
        }
        if (winter) {                                // snow lying on the boughs
            ctx.fillStyle = "rgba(236,244,252,0.72)";
            ctx.beginPath();
            ctx.moveTo(-w * 0.5, y + 0.5 * s);
            for (let k = -3; k <= 3; k++) {
                const f = k / 3;
                ctx.lineTo(w * 0.5 * f, y - tierH * (1 - Math.abs(f)) * 0.9 + (k % 2 ? 0.5 : 2) * s);
            }
            ctx.closePath(); ctx.fill();
        }
    }
}

function broadleaf(ctx, obj, season) {
    const s = obj.size || 1;
    const autumn = season === "autumn" && obj.kind !== "ancient_oak";
    const winter = season === "winter" && obj.kind !== "ancient_oak";
    const pal = jitterPalette(autumn ? AUTUMN_COLORS : (TREE_COLORS[obj.kind] || TREE_COLORS.oak), obj.tx, obj.ty);
    const [mid, dark, lit, deep] = pal;
    const birch = obj.kind === "birch";
    const willow = obj.kind === "willow";
    const big = obj.kind === "ancient_oak" ? 1.45 : 1;
    const S = s * big;

    shadowEllipse(ctx, 15 * S, 5.5 * S, 0.32);

    /* ---- trunk ---------------------------------------------------------- */
    const trunk = birch ? "#d6d0c0" : "#5d4226";
    const trunkTop = (birch ? -34 : -30) * S;
    const halfBase = birch ? 3.2 * S : 5.5 * S;
    const halfTop = birch ? 1.6 * S : 2.4 * S;
    ctx.fillStyle = trunk;
    ctx.beginPath();
    ctx.moveTo(-halfBase, 0);
    ctx.quadraticCurveTo(-halfBase * 0.62, -12 * S, -halfTop, trunkTop);
    ctx.lineTo(halfTop, trunkTop);
    ctx.quadraticCurveTo(halfBase * 0.62, -12 * S, halfBase, 0);
    ctx.closePath(); ctx.fill();
    // Shaded right flank and a lit left edge.
    ctx.fillStyle = birch ? "#aba493" : "#452f19";
    ctx.beginPath();
    ctx.moveTo(halfTop * 0.4, trunkTop);
    ctx.lineTo(halfTop, trunkTop);
    ctx.quadraticCurveTo(halfBase * 0.62, -12 * S, halfBase, 0);
    ctx.lineTo(halfBase * 0.4, 0);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = birch ? "rgba(255,255,255,0.5)" : "rgba(214,178,120,0.18)";
    ctx.fillRect(-halfBase * 0.86, -8 * S, 1.2 * S, 8 * S);
    if (!birch) {                                    // bark furrows
        ctx.strokeStyle = "rgba(30,20,10,0.35)";
        ctx.lineWidth = 0.9 * S;
        for (let i = 0; i < 4; i++) {
            const fx = (-0.6 + i * 0.4) * halfBase;
            ctx.beginPath();
            ctx.moveTo(fx, -2 * S);
            ctx.quadraticCurveTo(fx * 0.8, -12 * S, fx * 0.5, -22 * S);
            ctx.stroke();
        }
    } else {                                         // birch lenticels
        ctx.fillStyle = "#3a3630";
        for (let i = 0; i < 9; i++) {
            const n = h(obj.tx, obj.ty + i, 7);
            const yy = -4 * S - i * 3.2 * S;
            const ww = (1.4 + n * 2.4) * S;
            ctx.fillRect((n - 0.5) * 3.4 * S, yy, ww, 0.9 * S);
            if (n > 0.7) ctx.fillRect((n - 0.8) * 3 * S, yy + 1.6 * S, ww * 0.5, 0.7 * S);
        }
        ctx.fillStyle = "rgba(60,52,44,0.5)";        // sooty base
        ctx.beginPath();
        ctx.moveTo(-halfBase, 0);
        ctx.quadraticCurveTo(0, -6 * S, halfBase, 0);
        ctx.closePath(); ctx.fill();
    }

    /* ---- limbs ---------------------------------------------------------- */
    const limbCol = birch ? "#c6c1b1" : "#523a20";
    ctx.strokeStyle = limbCol; ctx.lineCap = "round";
    const limbs = [[-1, -20, -12, -36], [1, -23, 11, -35], [-0.5, -26, -4, -42], [0.5, -27, 6, -41]];
    limbs.forEach(([x0, y0, x1, y1], i) => {
        ctx.lineWidth = (2.4 - i * 0.4) * S;
        ctx.beginPath();
        ctx.moveTo(x0 * S, y0 * S);
        ctx.quadraticCurveTo((x0 + x1) * 0.5 * S, (y0 + y1) * 0.62 * S, x1 * S, y1 * S);
        ctx.stroke();
    });

    /* ---- crown ----------------------------------------------------------
     * A cloud of clumps generated from the tile seed: every tree gets its own
     * outline. Three passes (shadow, body, sunlight) plus leaf dabs so the
     * canopy has texture instead of being one flat blob.
     */
    const clumpCount = willow ? 9 : 8;
    const cy = willow ? -36 : -42;
    const spread = willow ? 19 : 17;
    const clumps = [];
    for (let i = 0; i < clumpCount; i++) {
        const n1 = h(obj.tx * 3 + i, obj.ty, 71), n2 = h(obj.tx, obj.ty * 5 + i, 73);
        const a = (i / clumpCount) * Math.PI * 2 + (n1 - 0.5) * 0.6;
        const rad = spread * (0.45 + n2 * 0.55);
        clumps.push([
            Math.cos(a) * rad,
            cy + Math.sin(a) * rad * 0.62 + (willow ? Math.max(0, Math.sin(a)) * 7 : 0),
            (7.5 + n1 * 5.5) * (willow ? 0.85 : 1)
        ]);
    }
    clumps.push([0, cy - 2, spread * (birch ? 0.62 : 0.78)]);   // dense centre

    const paint = (fill, dx, dy, scale, alpha = 1) => {
        ctx.globalAlpha = alpha;
        ctx.fillStyle = fill;
        for (const [bx, by, br] of clumps) {
            ctx.beginPath();
            ctx.ellipse((bx + dx) * S, (by + dy) * S, br * scale * S, br * 0.82 * scale * S, 0, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1;
    };
    if (winter) {
        // Bare branches: a few twigs instead of a canopy.
        ctx.strokeStyle = limbCol;
        for (let i = 0; i < 12; i++) {
            const n = h(obj.tx + i, obj.ty * 2, 83);
            const a = Math.PI + (i / 11) * Math.PI;
            ctx.lineWidth = 0.9 * S;
            ctx.beginPath();
            ctx.moveTo(0, -28 * S);
            ctx.quadraticCurveTo(Math.cos(a) * 8 * S, (-34 - n * 4) * S,
                                 Math.cos(a) * (14 + n * 6) * S, (-36 - n * 8) * S);
            ctx.stroke();
        }
        return;
    }
    paint(deep, 1.6, 2.6, 1.0, 0.9);       // the canopy's own shadow
    paint(dark, 0, 0, 1.0);                // body
    paint(mid, -0.8, -1.4, 0.86);          // lit body
    paint(lit, -2.6, -3.4, 0.52, 0.75);    // sun from the upper left

    // Leaf dabs: small flecks of light and shade across the whole crown.
    for (let i = 0; i < 44; i++) {
        const n1 = h(obj.tx * 7 + i, obj.ty, 89), n2 = h(obj.tx, obj.ty * 11 + i, 97);
        const a = n1 * Math.PI * 2, rad = spread * Math.sqrt(n2) * 0.95;
        const lx = Math.cos(a) * rad, ly = cy + Math.sin(a) * rad * 0.62;
        const sun = lx < -2 && ly < cy + 2;           // the sunward shoulder
        const shade = lx > 3 && ly > cy;              // the lower right
        if (!sun && !shade) continue;
        ctx.fillStyle = sun ? lit : deep;
        ctx.globalAlpha = sun ? 0.32 : 0.2;
        ctx.beginPath();
        ctx.ellipse(lx * S, ly * S, (1 + n1 * 1.2) * S, (0.8 + n2 * 0.9) * S, a, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Willow: trailing curtains of leaves.
    if (willow) {
        ctx.lineCap = "round";
        for (let i = 0; i < 17; i++) {
            const n = h(obj.tx + i, obj.ty, 31), n2 = h(obj.tx, obj.ty + i, 37);
            const x0 = (-17 + i * 2.1) * S;
            const drop = (16 + n * 16) * S;
            const sway = (n2 - 0.5) * 5 * S;
            ctx.strokeStyle = i % 3 === 0 ? lit : (i % 3 === 1 ? mid : dark);
            ctx.globalAlpha = 0.85;
            ctx.lineWidth = (1.3 + n * 1.1) * S;
            ctx.beginPath();
            ctx.moveTo(x0, (cy + 6) * S);
            ctx.quadraticCurveTo(x0 + sway * 0.4, (cy + 6) * S + drop * 0.6,
                                 x0 + sway, (cy + 6) * S + drop);
            ctx.stroke();
            // leaves hanging off the strand
            ctx.lineWidth = 0.9 * S;
            for (let k = 1; k <= 3; k++) {
                const f = k / 3.4;
                const lxx = x0 + sway * f * f, lyy = (cy + 6) * S + drop * f;
                ctx.beginPath();
                ctx.moveTo(lxx, lyy);
                ctx.lineTo(lxx + (k % 2 ? 2 : -2) * S, lyy + 2.4 * S);
                ctx.stroke();
            }
        }
        ctx.globalAlpha = 1;
    }
    // Autumn: a few leaves already on the ground.
    if (autumn) {
        for (let i = 0; i < 5; i++) {
            const n = h(obj.tx + i * 3, obj.ty, 41);
            ctx.fillStyle = i % 2 ? mid : lit;
            ctx.globalAlpha = 0.8;
            ctx.beginPath();
            ctx.ellipse((-14 + n * 28) * S, (-1 + n * 3) * S, 2 * S, 1.2 * S, n * 3, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1;
    }
}

export function paintProp(ctx, obj, time = 0, season = "spring") {
    const kind = obj.kind;
    const s = obj.size || 1;

    // Wind: only foliage sways, and each tree on its own phase.
    if (TREE_COLORS[kind]) {
        const sway = Math.sin(time * 0.8 + obj.tx * 0.7 + obj.ty * 0.37) * 0.02;
        ctx.transform(1, 0, sway, 1, 0, 0);
        // No two trees the same height: ±18 %, and a slight horizontal flip.
        const grow = 0.84 + h(obj.tx, obj.ty, 41) * 0.36;
        const flip = h(obj.tx, obj.ty, 43) > 0.5 ? -1 : 1;
        ctx.scale(flip, 1);
        ctx.scale(grow, grow);
    }

    switch (kind) {
        case "pine": case "spruce":
            conifer(ctx, obj, season); break;

        case "oak": case "birch": case "willow": case "ancient_oak":
            broadleaf(ctx, obj, season); break;

        case "palm": {
            // A real palm: a thick curved trunk that reaches the crown, big
            // drooping fronds that fall below the growing point, coconuts.
            shadowEllipse(ctx, 14 * s, 4.6 * s, 0.3);
            const bend = (h(obj.tx, obj.ty, 11) - 0.5) * 12 * s;
            const topX = 3 * s + bend, topY = -46 * s;
            // Trunk as a tapered filled shape (thick boot, slim neck) — the old
            // version was three strokes of constant width plus evenly spaced
            // straight scars, which read as a ladder.
            const bez = (f) => {
                const u = 1 - f;
                return [u * u * 0 + 2 * u * f * (topX * 0.25) + f * f * topX,
                        2 * u * f * (-26 * s) + f * f * topY];
            };
            const halfW = (f) => (5.6 - 3.4 * f) * s;         // 11 px at the root, 4.4 at the crown
            const left = [], right = [];
            for (let i = 0; i <= 10; i++) {
                const f = i / 10;
                const [bx, by] = bez(f);
                const [bx2] = bez(Math.min(1, f + 0.05));
                const w = halfW(f);
                const tilt = (bx2 - bx) * 0.25;
                left.push([bx - w, by - tilt]); right.push([bx + w, by + tilt]);
            }
            ctx.fillStyle = "#6b5130";
            ctx.beginPath();
            ctx.moveTo(left[0][0], left[0][1]);
            for (const [x, y] of left) ctx.lineTo(x, y);
            for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i][0], right[i][1]);
            ctx.closePath(); ctx.fill();
            ctx.fillStyle = "#8a6b3f";                         // lit left side
            ctx.beginPath();
            ctx.moveTo(left[0][0], left[0][1]);
            for (const [x, y] of left) ctx.lineTo(x, y);
            for (let i = left.length - 1; i >= 0; i--) {
                const f = i / 10;
                ctx.lineTo(left[i][0] + halfW(f) * 0.75, left[i][1]);
            }
            ctx.closePath(); ctx.fill();
            ctx.fillStyle = "rgba(255,226,170,0.22)";          // rim
            ctx.beginPath();
            for (const [x, y] of left) ctx.lineTo(x + 0.4 * s, y);
            for (let i = left.length - 1; i >= 0; i--) ctx.lineTo(left[i][0] + 1.6 * s, left[i][1]);
            ctx.closePath(); ctx.fill();
            // Leaf scars: sparse, curved, following the trunk and shrinking with it.
            ctx.lineCap = "round";
            for (let i = 0; i < 5; i++) {
                const f = 0.12 + i * 0.16 + h(obj.tx, obj.ty, i * 9) * 0.03;
                const [cx2, cy2] = bez(f);
                const w = halfW(f) * 0.85;
                ctx.strokeStyle = i % 2 ? "rgba(62,44,24,0.5)" : "rgba(168,138,92,0.35)";
                ctx.lineWidth = (0.9 - f * 0.3) * s;
                ctx.beginPath();
                ctx.moveTo(cx2 - w, cy2 - 0.4 * s);
                ctx.quadraticCurveTo(cx2, cy2 + 1.8 * s, cx2 + w, cy2 - 0.6 * s);
                ctx.stroke();
            }
            ctx.fillStyle = "rgba(48,34,18,0.45)";             // root flare
            ctx.beginPath(); ctx.ellipse(0, -0.5 * s, 7 * s, 2.6 * s, 0, 0, Math.PI * 2); ctx.fill();
            // Fronds, drawn from the back row forward.
            const fronds = [
                [-2.98, 1.05], [-2.35, 1.15], [-0.80, 1.15], [-0.16, 1.05],
                [-2.62, 0.85], [-0.52, 0.85], [-1.90, 0.72], [-1.25, 0.72]
            ];
            fronds.forEach(([a0, scale], i) => {
                const sway = Math.sin(time * 0.8 + i * 1.3) * 0.06;
                const ang = a0 + sway;
                const len = (26 + h(obj.tx, obj.ty, i * 3) * 7) * s * scale;
                const dirX = Math.cos(ang), dirY = Math.sin(ang) * 0.5;
                // Midrib arcs up then droops down past the tip.
                // Arc up off the growing point, then fall well below it: a palm
                // frond hangs, it does not stick out like a fern leaf.
                const midX = topX + dirX * len * 0.5, midY = topY + dirY * len * 0.5 - 9 * s;
                const tipX = topX + dirX * len * 0.88, tipY = topY + dirY * len + 19 * s * scale;
                const dark = i < 4;
                ctx.strokeStyle = dark ? "#2d6239" : "#3c8049";
                ctx.lineWidth = 2.2 * s; ctx.lineCap = "round";
                ctx.beginPath();
                ctx.moveTo(topX, topY);
                ctx.quadraticCurveTo(midX, midY, tipX, tipY);
                ctx.stroke();
                ctx.strokeStyle = dark ? "#357040" : "#4a9456";
                ctx.lineWidth = 1.2 * s;
                for (let k = 1; k <= 7; k++) {
                    const f = k / 8;
                    const u = 1 - f;
                    const bx = u * u * topX + 2 * u * f * midX + f * f * tipX;
                    const by = u * u * topY + 2 * u * f * midY + f * f * tipY;
                    const tx2 = 2 * (u * (midX - topX) + f * (tipX - midX));
                    const ty2 = 2 * (u * (midY - topY) + f * (tipY - midY));
                    const nl = Math.hypot(tx2, ty2) || 1;
                    const nx = -ty2 / nl, ny = tx2 / nl;
                    const ll = (6.5 - f * 3) * s * scale;
                    ctx.beginPath();
                    ctx.moveTo(bx, by);
                    ctx.quadraticCurveTo(bx + nx * ll * 0.7, by + ny * ll * 0.7 + 1.5 * s,
                                         bx + nx * ll * 0.5, by + ny * ll + 3 * s);
                    ctx.moveTo(bx, by);
                    ctx.quadraticCurveTo(bx - nx * ll * 0.7, by - ny * ll * 0.7 + 1.5 * s,
                                         bx - nx * ll * 0.5, by - ny * ll + 3 * s);
                    ctx.stroke();
                }
            });
            ctx.fillStyle = "#5c4327";                                   // coconuts
            ctx.beginPath(); ctx.arc(topX - 3 * s, topY + 3.5 * s, 2.4 * s, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.arc(topX + 2.2 * s, topY + 4.5 * s, 2.1 * s, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = "rgba(255,240,210,0.28)";
            ctx.beginPath(); ctx.ellipse(topX - 3.8 * s, topY + 2.6 * s, 1 * s, 0.7 * s, -0.5, 0, Math.PI * 2); ctx.fill();
            break;
        }

        case "dead_tree": {
            // A tree that died standing: bare, pale, still has its shape.
            shadowEllipse(ctx, 10 * s, 3.8 * s, 0.26);
            const lean = (h(obj.tx, obj.ty, 5) - 0.5) * 6 * s;
            const top = -34 * s;
            ctx.fillStyle = "#6a5a48";                 // trunk with a root flare
            ctx.beginPath();
            ctx.moveTo(-5 * s, 0);
            ctx.quadraticCurveTo(-3.2 * s, -16 * s, lean - 2 * s, top);
            ctx.lineTo(lean + 2 * s, top);
            ctx.quadraticCurveTo(3.2 * s, -16 * s, 5 * s, 0);
            ctx.closePath(); ctx.fill();
            ctx.fillStyle = "#857460";
            ctx.beginPath();                            // lit left side
            ctx.moveTo(-5 * s, 0);
            ctx.quadraticCurveTo(-3.2 * s, -16 * s, lean - 2 * s, top);
            ctx.lineTo(lean - 0.4 * s, top);
            ctx.quadraticCurveTo(-1.4 * s, -16 * s, -2.2 * s, 0);
            ctx.closePath(); ctx.fill();
            ctx.fillStyle = "#4e4134";
            for (let i = 0; i < 5; i++) {               // bark cracks
                const yy = -4 * s - i * 6 * s;
                ctx.fillRect(-1.5 * s + h(obj.tx, obj.ty, i) * 3 * s, yy, 1 * s, 3.5 * s);
            }
            // Two bare limbs, tapering.
            const limb = (x1, y1, x2, y2, w) => {
                ctx.strokeStyle = "#6a5a48"; ctx.lineWidth = w; ctx.lineCap = "round";
                ctx.beginPath(); ctx.moveTo(x1, y1); ctx.quadraticCurveTo((x1 + x2) / 2, y1 - 4 * s, x2, y2); ctx.stroke();
            };
            limb(-2 * s, -20 * s, -12 * s, -29 * s, 2.6 * s);
            limb(-9 * s, -26 * s, -14 * s, -33 * s, 1.4 * s);
            limb(2 * s, -24 * s, 11 * s, -31 * s, 2.2 * s);
            limb(9 * s, -29 * s, 13 * s, -36 * s, 1.2 * s);
            ctx.fillStyle = "#3d3327";                  // splintered top
            ctx.beginPath();
            ctx.moveTo(lean - 2 * s, top); ctx.lineTo(lean - 0.5 * s, top - 4 * s);
            ctx.lineTo(lean + 1 * s, top - 1 * s); ctx.lineTo(lean + 2 * s, top - 3.5 * s);
            ctx.lineTo(lean + 2 * s, top);
            ctx.closePath(); ctx.fill();
            break;
        }

        case "burnt_tree": {
            // A trunk the fire went through: thick, black, split at the top,
            // grey ash on the windward side, stubs where branches burned off.
            shadowEllipse(ctx, 11 * s, 4 * s, 0.38);
            const lean = (h(obj.tx, obj.ty, 9) - 0.5) * 7 * s;
            const tall = 30 * s + h(obj.tx, obj.ty, 3) * 14 * s;
            const top = -tall;
            const halfTop = 2.4 * s, halfBottom = 6 * s;

            ctx.fillStyle = "#1e1917";                  // charred body
            ctx.beginPath();
            ctx.moveTo(-halfBottom, 0);
            ctx.quadraticCurveTo(-halfBottom * 0.55, -tall * 0.5, lean - halfTop, top);
            ctx.lineTo(lean + halfTop, top);
            ctx.quadraticCurveTo(halfBottom * 0.55, -tall * 0.5, halfBottom, 0);
            ctx.closePath(); ctx.fill();

            ctx.fillStyle = "#38302b";                  // weak light down the left
            ctx.beginPath();
            ctx.moveTo(-halfBottom, 0);
            ctx.quadraticCurveTo(-halfBottom * 0.55, -tall * 0.5, lean - halfTop, top);
            ctx.lineTo(lean - halfTop * 0.2, top);
            ctx.quadraticCurveTo(-halfBottom * 0.12, -tall * 0.5, -halfBottom * 0.45, 0);
            ctx.closePath(); ctx.fill();

            ctx.fillStyle = "rgba(150,142,132,0.35)";   // ash dust clinging on
            for (let i = 0; i < 4; i++) {
                const f = (i + 1) / 5;
                ctx.fillRect(-2.5 * s + lean * f, -tall * f, 1.6 * s, 4 * s);
            }
            ctx.fillStyle = "rgba(255,170,90,0.10)";    // the fire's last warmth
            ctx.fillRect(-halfBottom * 0.8, -3 * s, halfBottom * 1.6, 3 * s);

            // Branch stubs: short, thick, burnt off rather than snapped.
            const stub = (yy, dir, len, w) => {
                ctx.strokeStyle = "#241e1b"; ctx.lineWidth = w; ctx.lineCap = "round";
                ctx.beginPath();
                ctx.moveTo(dir * 1.5 * s, yy);
                ctx.quadraticCurveTo(dir * len * 0.6, yy - 2 * s, dir * len, yy - 4 * s);
                ctx.stroke();
            };
            stub(-tall * 0.45, -1, 9 * s, 3 * s);
            stub(-tall * 0.68, 1, 8 * s, 2.6 * s);
            stub(-tall * 0.85, -1, 5 * s, 1.8 * s);

            // Split, splintered crown.
            ctx.fillStyle = "#15110f";
            ctx.beginPath();
            ctx.moveTo(lean - halfTop, top);
            ctx.lineTo(lean - halfTop * 0.4, top - 6 * s);
            ctx.lineTo(lean + 0.2 * s, top - 1.5 * s);
            ctx.lineTo(lean + halfTop * 0.8, top - 4.5 * s);
            ctx.lineTo(lean + halfTop, top);
            ctx.closePath(); ctx.fill();
            break;
        }

        case "burnt_stump": {
            // A sawn-off trunk the fire ate into. The thing that makes a stump
            // readable is the CUT FACE: an ellipse of growth rings seen from
            // three quarters. Everything else is support for it.
            const sw = 9.5, sh = 11;
            shadowEllipse(ctx, sw + 2, 3.8, 0.34);
            ctx.fillStyle = "rgba(122,114,104,0.26)";              // ash collar
            ctx.beginPath(); ctx.ellipse(0, 1.2, sw + 2.5, 3.6, 0, 0, Math.PI * 2); ctx.fill();

            // Root flares: wedges that widen the trunk at the ground line, not
            // blobs under it (those read as little legs).
            ctx.fillStyle = "#2a2320";
            for (const [sgn, rw, rh] of [[-1, 5.4, 3.4], [1, 4.6, 2.8], [-0.35, 3.6, 2.2]]) {
                ctx.beginPath();
                ctx.moveTo(sgn * 2.2, -5.5);
                ctx.quadraticCurveTo(sgn * (2.2 + rw * 0.4), -rh, sgn * (2.2 + rw), 1.2);
                ctx.lineTo(sgn * 1.0, 1.2);
                ctx.closePath(); ctx.fill();
            }

            ctx.fillStyle = "rgba(24,22,18,0.3)";                   // contact shadow
            ctx.beginPath(); ctx.ellipse(0, 1.3, sw + 1.5, 2.2, 0, 0, Math.PI * 2); ctx.fill();

            // Body: a slightly barrelled trunk, charcoal with a lit left cheek.
            ctx.fillStyle = "#2b2422";
            ctx.beginPath();
            ctx.moveTo(-sw, 1.4);
            ctx.quadraticCurveTo(-sw - 0.6, -sh * 0.5, -sw + 1.2, -sh);
            ctx.lineTo(sw - 1.2, -sh);
            ctx.quadraticCurveTo(sw + 0.6, -sh * 0.5, sw, 1.4);
            ctx.closePath(); ctx.fill();
            ctx.fillStyle = "#423834";                              // lit flank
            ctx.beginPath();
            ctx.moveTo(-sw, 1.4);
            ctx.quadraticCurveTo(-sw - 0.6, -sh * 0.5, -sw + 1.2, -sh);
            ctx.lineTo(-sw + 4, -sh);
            ctx.quadraticCurveTo(-sw + 3.2, -sh * 0.5, -sw + 3.6, 1.4);
            ctx.closePath(); ctx.fill();
            ctx.fillStyle = "rgba(0,0,0,0.34)";                     // shaded flank
            ctx.beginPath();
            ctx.moveTo(sw - 4.2, -sh);
            ctx.quadraticCurveTo(sw - 1, -sh * 0.5, sw, 1.4);
            ctx.lineTo(sw - 3.4, 1.4);
            ctx.quadraticCurveTo(sw - 4.6, -sh * 0.5, sw - 5.6, -sh);
            ctx.closePath(); ctx.fill();

            // Charred bark: vertical cracks of two depths.
            for (let i = 0; i < 5; i++) {
                const n = h(obj.tx, obj.ty, i * 13);
                const cx2 = -sw + 2 + i * (sw * 2 - 4) / 4 + (n - 0.5) * 1.4;
                ctx.strokeStyle = i % 2 ? "rgba(10,8,7,0.55)" : "rgba(92,78,66,0.3)";
                ctx.lineWidth = i % 2 ? 1.1 : 0.7;
                ctx.beginPath();
                ctx.moveTo(cx2, -sh + 1.5 + n * 1.5);
                ctx.quadraticCurveTo(cx2 + (n - 0.5) * 1.6, -sh * 0.4, cx2 + (n - 0.5) * 2.4, 0.8);
                ctx.stroke();
            }

            // The cut face: rings, light grey ash outside, burnt-out heart.
            const topY = -sh - 0.4, rx0 = sw - 1.2, ry0 = 3.4;
            ctx.fillStyle = "#6d6054";
            ctx.beginPath(); ctx.ellipse(0, topY, rx0, ry0, 0, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = "#8a7b6a";                              // sun on the rim
            ctx.beginPath(); ctx.ellipse(-0.8, topY - 0.5, rx0 - 0.8, ry0 - 0.9, 0, 0, Math.PI * 2); ctx.fill();
            for (let r = 3; r >= 1; r--) {                          // growth rings
                ctx.strokeStyle = r % 2 ? "rgba(40,31,24,0.85)" : "rgba(176,162,142,0.75)";
                ctx.lineWidth = 0.9;
                ctx.beginPath();
                ctx.ellipse(-0.3, topY - 0.3, rx0 * (r / 4.2), ry0 * (r / 4.2), 0, 0, Math.PI * 2);
                ctx.stroke();
            }
            ctx.fillStyle = "#201915";                              // burnt-out heart
            ctx.beginPath(); ctx.ellipse(-0.3, topY - 0.2, rx0 * 0.18, ry0 * 0.2, 0, 0, Math.PI * 2); ctx.fill();
            ctx.strokeStyle = "rgba(20,16,13,0.7)"; ctx.lineWidth = 0.9;   // a split across the face
            ctx.beginPath();
            ctx.moveTo(-rx0 * 0.8, topY + 0.6);
            ctx.quadraticCurveTo(0, topY - 0.8, rx0 * 0.7, topY + 0.4);
            ctx.stroke();

            // Two splinters left standing where the trunk tore off.
            ctx.fillStyle = "#3a302b";
            ctx.beginPath();
            ctx.moveTo(-5.0, topY + 0.2); ctx.lineTo(-3.8, topY - 3.0); ctx.lineTo(-2.9, topY + 0.2);
            ctx.closePath(); ctx.fill();
            ctx.beginPath();
            ctx.moveTo(3.6, topY + 0.4); ctx.lineTo(4.4, topY - 2.0); ctx.lineTo(5.2, topY + 0.3);
            ctx.closePath(); ctx.fill();
            break;
        }

                case "burnt_beam": {
            shadowEllipse(ctx, 13, 3.5, 0.3);
            ctx.save(); ctx.rotate(-0.22);
            ctx.fillStyle = "#231d1a"; ctx.fillRect(-14, -8, 28, 8);
            ctx.fillStyle = "#39312b"; ctx.fillRect(-14, -8, 28, 2.5);
            ctx.fillStyle = "#4a3f36";
            for (let i = 0; i < 4; i++) ctx.fillRect(-12 + i * 7, -6, 1, 5);
            ctx.restore();
            break;
        }

        case "rock": case "ore_rock": {
            // Every boulder is its own stone: the outline is generated from
            // the tile seed, so no two rocks in a field repeat.
            const n0 = h(obj.tx, obj.ty, 9), n1 = h(obj.tx, obj.ty, 23), n2 = h(obj.tx, obj.ty, 37);
            const grow = 0.86 + n1 * 0.5;
            const flip = n2 > 0.5 ? -1 : 1;
            ctx.save();
            ctx.scale(flip * grow, grow);
            shadowEllipse(ctx, 12, 4.4, 0.3);

            // Base silhouette of a boulder, each vertex nudged by the seed.
            const base = [[-12, 0], [-10.5, -7], [-7, -13], [-2, -16.5],
                          [4, -15], [9.5, -9.5], [11.5, -3], [9.5, 0]];
            const pts = base.map(([x, y], i) => {
                const j1 = h(obj.tx * 3 + i, obj.ty * 5, 13) - 0.5;
                const j2 = h(obj.tx * 7, obj.ty * 11 + i, 17) - 0.5;
                return [x * (1 + j1 * 0.35), y * (1 + j2 * 0.4)];
            });
            const warm = n0 * 12;
            const body = kind === "ore_rock"
                ? css(100 + warm, 97 + warm, 92 + warm)
                : css(116 + warm, 114 + warm, 110 + warm);
            const bodyPath = () => {
                ctx.beginPath();
                pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
                ctx.closePath();
            };
            ctx.fillStyle = body;
            bodyPath(); ctx.fill();

            // Sunlit facet (upper left) and shaded facet (right).
            ctx.fillStyle = "rgba(255,255,255,0.2)";            // sunlit upper-left
            ctx.beginPath();
            ctx.moveTo(pts[1][0], pts[1][1]);
            ctx.lineTo(pts[2][0], pts[2][1]);
            ctx.lineTo(pts[3][0], pts[3][1]);
            ctx.lineTo(pts[3][0] - 3, pts[3][1] + 6);
            ctx.lineTo(pts[1][0] + 2, pts[1][1] + 3);
            ctx.closePath(); ctx.fill();
            ctx.fillStyle = "rgba(0,0,0,0.28)";                 // shaded right flank
            ctx.beginPath();
            ctx.moveTo(pts[4][0], pts[4][1]);
            ctx.lineTo(pts[5][0], pts[5][1]);
            ctx.lineTo(pts[6][0], pts[6][1]);
            ctx.lineTo(pts[7][0], pts[7][1]);
            ctx.lineTo(pts[4][0] - 2, pts[4][1] + 10);
            ctx.closePath(); ctx.fill();
            ctx.strokeStyle = "rgba(0,0,0,0.25)";               // cracks
            ctx.lineWidth = 0.9;
            ctx.beginPath();
            ctx.moveTo(pts[3][0], pts[3][1] + 1);
            ctx.lineTo(pts[3][0] + 1.5, -7);
            ctx.lineTo(pts[3][0] - 1, -1);
            ctx.stroke();
            // Lichen, only on some stones and only on the shaded side.
            if (n1 > 0.45) {
                ctx.fillStyle = "rgba(96,122,66,0.33)";
                ctx.beginPath(); ctx.ellipse(-6, -3.5, 3.4, 1.9, 0.3, 0, Math.PI * 2); ctx.fill();
                ctx.beginPath(); ctx.ellipse(-2.5, -1.6, 2, 1.1, 0, 0, Math.PI * 2); ctx.fill();
            }
            if (obj.ore) {
                // A vein running across the face, not three loose pixels.
                // Scaled to this particular stone (and clipped to it) so it
                // can never float above the silhouette.
                const topY = Math.min(...pts.map((pt) => pt[1]));
                const f = Math.min(1, Math.abs(topY) / 16.5) * 0.8;
                ctx.save();
                bodyPath(); ctx.clip();
                ctx.scale(f, f);
                const oreColors = { copper: "#d2823c", iron: "#c3cbd4", coal: "#1f1d1c", gem: "#63dcef" };
                const c = oreColors[obj.ore] || "#c0c0c0";
                ctx.strokeStyle = c; ctx.lineWidth = 1.8; ctx.lineCap = "round";
                ctx.beginPath();
                ctx.moveTo(-6.5, -3.5);
                ctx.quadraticCurveTo(-2, -9 - n0 * 2, 3.5, -5);
                ctx.stroke();
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(-3, -6.5); ctx.lineTo(-1, -2.5);
                ctx.moveTo(1.5, -7); ctx.lineTo(4, -9);
                ctx.stroke();
                ctx.fillStyle = c;
                ctx.beginPath(); ctx.arc(-5, -7, 1.5, 0, Math.PI * 2); ctx.fill();
                ctx.beginPath(); ctx.arc(2.6, -8.5, 1.2, 0, Math.PI * 2); ctx.fill();
                ctx.fillStyle = "rgba(255,255,255,0.6)";
                ctx.fillRect(-5.7, -7.8, 1.1, 1.1);
                ctx.fillRect(2, -9.1, 0.9, 0.9);
                ctx.restore();
            }
            // Chips of stone at the foot of the bigger boulders.
            if (n0 > 0.55) {
                ctx.fillStyle = css(96 + warm, 94 + warm, 90 + warm);
                ctx.beginPath(); ctx.ellipse(10, -1, 3, 1.9, 0.3, 0, Math.PI * 2); ctx.fill();
                ctx.fillStyle = "rgba(255,255,255,0.14)";
                ctx.beginPath(); ctx.ellipse(9.4, -1.6, 1.6, 0.9, 0.3, 0, Math.PI * 2); ctx.fill();
            }
            ctx.restore();
            break;
        }

        case "ruin_wall": {
            shadowEllipse(ctx, 14, 5, 0.3);
            const topL = -20 - h(obj.tx, obj.ty, 2) * 6;
            const topR = -13 - h(obj.tx, obj.ty, 4) * 9;
            // Broken silhouette: the wall never ends in a straight line.
            ctx.fillStyle = "#6a635a";
            ctx.beginPath();
            ctx.moveTo(-13, 0);
            ctx.lineTo(-13, topL);
            ctx.lineTo(-6, topL + 3);
            ctx.lineTo(-2, topL - 2);
            ctx.lineTo(3, topR);
            ctx.lineTo(9, topR + 4);
            ctx.lineTo(13, topR - 1);
            ctx.lineTo(13, 0);
            ctx.closePath(); ctx.fill();
            // Courses of stone.
            for (let r = 0; r < 6; r++) {
                const y = -3 - r * 4.5;
                if (y < topR - 2 && y < topL - 2) break;
                for (let c = 0; c < 4; c++) {
                    const bx = -13 + c * 7 + (r % 2 ? 3 : 0);
                    if (bx > 8 && y < topR) continue;
                    ctx.fillStyle = h(obj.tx + c, obj.ty + r, 3) > 0.5 ? "#7a7268" : "#5c564e";
                    ctx.fillRect(bx, y, 6, 3.6);
                }
            }
            ctx.fillStyle = "rgba(255,250,240,0.14)";       // sun on the top edge
            ctx.fillRect(-13, topL, 11, 2);
            ctx.fillStyle = "rgba(0,0,0,0.3)";
            ctx.fillRect(-13, -3, 26, 3);
            ctx.fillStyle = "rgba(90,110,60,0.35)";         // moss in the joints
            ctx.fillRect(-11, -8, 5, 2);
            ctx.fillRect(2, -14, 4, 2);
            // Fallen stones at the foot.
            for (let i = 0; i < 3; i++) {
                const k = h(obj.tx, obj.ty, i * 13);
                ctx.fillStyle = i % 2 ? "#6e665c" : "#58524a";
                ctx.beginPath();
                ctx.ellipse(-14 + k * 28, 1.5 + k * 2, 3 + k * 2, 2 + k, k * 2, 0, Math.PI * 2);
                ctx.fill();
            }
            break;
        }

        case "bush": {
            shadowEllipse(ctx, 11, 3.6, 0.26);
            const autumn = season === "autumn";
            const pal = jitterPalette(autumn ? ["#9a6a28", "#7d551f", "#c08a39"]
                                             : ["#3f6b33", "#30542a", "#6a9c4c"], obj.tx, obj.ty);
            ctx.strokeStyle = "#4a3a24"; ctx.lineWidth = 1.2;   // woody stems
            for (let i = -1; i <= 1; i++) {
                ctx.beginPath(); ctx.moveTo(i * 2, 0); ctx.quadraticCurveTo(i * 3, -4, i * 4, -8); ctx.stroke();
            }
            const clumps = [[0, -8, 9], [-7, -6, 6.5], [7, -6, 6], [-3, -13, 6.5], [4, -12, 6]];
            ctx.fillStyle = pal[1];
            for (const [bx, by, br] of clumps) {
                ctx.beginPath(); ctx.ellipse(bx + 1, by + 1.5, br, br * 0.8, 0, 0, Math.PI * 2); ctx.fill();
            }
            ctx.fillStyle = pal[0];
            for (const [bx, by, br] of clumps) {
                ctx.beginPath(); ctx.ellipse(bx, by, br * 0.92, br * 0.74, 0, 0, Math.PI * 2); ctx.fill();
            }
            ctx.fillStyle = pal[2];
            ctx.globalAlpha = 0.65;
            ctx.beginPath(); ctx.ellipse(-4, -12, 4.6, 3.2, -0.3, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.ellipse(-8, -7, 3, 2.1, -0.2, 0, Math.PI * 2); ctx.fill();
            ctx.globalAlpha = 1;
            if (obj.berries) {
                const spots = [[-6, -9], [3, -8], [0, -14], [7, -8], [-2, -5], [5, -14]];
                for (const [bx, by] of spots) {
                    ctx.fillStyle = "#5f1a33";
                    ctx.beginPath(); ctx.arc(bx, by + 0.6, 1.7, 0, Math.PI * 2); ctx.fill();
                    ctx.fillStyle = "#a6325f";
                    ctx.beginPath(); ctx.arc(bx, by, 1.6, 0, Math.PI * 2); ctx.fill();
                    ctx.fillStyle = "rgba(255,190,210,0.75)";
                    ctx.fillRect(bx - 0.8, by - 1, 1, 1);
                }
            }
            break;
        }

        case "herb": {
            // A culinary herb: a rosette of pointed leaves with a visible mid
            // vein, two or three flowering stems. Pointed leaves + a vein is
            // what separates a herb from a smudge of green.
            const type = obj.herbType || "mint";
            const leaf = type === "sage" ? "#86a079" : type === "yarrow" ? "#6f9154" : "#4f8f46";
            const leafDark = type === "sage" ? "#62775a" : type === "yarrow" ? "#4e6a3b" : "#376b31";
            const leafLit = type === "sage" ? "#a9bd9c" : type === "yarrow" ? "#8fae6d" : "#71b062";
            const bloom = type === "sage" ? "#8e7bbd" : type === "yarrow" ? "#e8e4d6" : "#b98fd0";

            ctx.fillStyle = "rgba(10,14,8,0.2)";
            ctx.beginPath(); ctx.ellipse(0, 0.5, 8.5, 2.8, 0, 0, Math.PI * 2); ctx.fill();

            // Rosette: pointed leaves drawn as two arcs meeting at a tip.
            const pointedLeaf = (ang, len, wide, fill, vein) => {
                const dx = Math.cos(ang), dy = Math.sin(ang) * 0.55;
                const tipX = dx * len, tipY = -2 + dy * len;
                const nx = -dy, ny = dx * 0.55;
                ctx.fillStyle = fill;
                ctx.beginPath();
                ctx.moveTo(0, -1.5);
                ctx.quadraticCurveTo(dx * len * 0.5 + nx * wide, -1.5 + dy * len * 0.5 + ny * wide, tipX, tipY);
                ctx.quadraticCurveTo(dx * len * 0.5 - nx * wide, -1.5 + dy * len * 0.5 - ny * wide, 0, -1.5);
                ctx.closePath(); ctx.fill();
                if (vein) {
                    ctx.strokeStyle = "rgba(255,255,255,0.22)"; ctx.lineWidth = 0.6;
                    ctx.beginPath(); ctx.moveTo(0, -1.5); ctx.lineTo(tipX * 0.92, tipY * 0.94); ctx.stroke();
                }
            };
            const leaves = 7;
            for (let i = 0; i < leaves; i++) {
                const back = i < 3;
                const a = Math.PI + (i / (leaves - 1)) * Math.PI * (back ? 1 : 1.05) +
                          (h(obj.tx, obj.ty, i) - 0.5) * 0.35;
                const len = 9.5 + h(obj.tx, obj.ty, i + 5) * 4.5;
                pointedLeaf(a, len, 3.0, back ? leafDark : (i % 2 ? leaf : leafLit), !back);
            }

            // Flowering stems.
            for (let i = -1; i <= 1; i++) {
                const n = h(obj.tx, obj.ty, 30 + i * 4);
                const bend = Math.sin(time * 1.1 + i * 1.4 + obj.tx * 0.4) * 1.2;
                const topY = -13 - n * 4 - (i === 0 ? 2.5 : 0);
                const topX = i * 3.2 + bend;
                ctx.strokeStyle = leafDark; ctx.lineWidth = 1.1; ctx.lineCap = "round";
                ctx.beginPath();
                ctx.moveTo(i * 1.2, -2);
                ctx.quadraticCurveTo(i * 2.4, topY * 0.55, topX, topY);
                ctx.stroke();
                // Leaf pair halfway up.
                ctx.strokeStyle = leaf; ctx.lineWidth = 1.4;
                ctx.beginPath();
                ctx.moveTo(i * 2.1, topY * 0.55);
                ctx.lineTo(i * 2.1 - 2.6, topY * 0.55 - 1.2);
                ctx.moveTo(i * 2.1, topY * 0.55);
                ctx.lineTo(i * 2.1 + 2.6, topY * 0.55 - 1.2);
                ctx.stroke();
                // The bloom: a little spike of beads.
                for (let b = 0; b < 4; b++) {
                    const by = topY + b * 1.5;
                    const bw = 1.5 - b * 0.22;
                    ctx.fillStyle = b === 0 ? shade(bloom, 18) : bloom;
                    ctx.beginPath();
                    ctx.ellipse(topX + (b % 2 ? 0.5 : -0.5), by, bw, bw * 0.85, 0, 0, Math.PI * 2);
                    ctx.fill();
                }
            }
            break;
        }

                case "firewood": {
            shadowEllipse(ctx, 9, 2.6, 0.22);
            const logs = [[-0.35, -8, 16], [0.25, -5, 15], [0.05, -2.5, 13]];
            for (let i = 0; i < logs.length; i++) {
                const [rot, yy, len] = logs[i];
                ctx.save(); ctx.translate(0, yy * 0.35); ctx.rotate(rot);
                ctx.fillStyle = i % 2 ? "#6d4f2c" : "#7d5c35";
                ctx.fillRect(-len / 2, -3, len, 3.4);
                ctx.fillStyle = "#9a7845";
                ctx.fillRect(-len / 2, -3, len, 1);
                ctx.fillStyle = "#c8a46a";
                ctx.beginPath(); ctx.ellipse(len / 2, -1.3, 1.1, 1.7, 0, 0, Math.PI * 2); ctx.fill();
                ctx.restore();
            }
            break;
        }

        case "reed": {
            // Reeds in the shallows: a ripple at the waterline, tall leaves
            // and a few brown cattail heads.
            ctx.fillStyle = "rgba(255,255,255,0.18)";
            ctx.beginPath(); ctx.ellipse(0, 0, 8, 2.4, 0, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = "rgba(20,50,60,0.22)";
            ctx.beginPath(); ctx.ellipse(0, 0.8, 6, 1.8, 0, 0, Math.PI * 2); ctx.fill();

            const stalks = 7;
            for (let i = 0; i < stalks; i++) {
                const n = h(obj.tx, obj.ty, i * 11);
                const x0 = (i / (stalks - 1) - 0.5) * 12;
                const len = 14 + n * 11;
                const bend = Math.sin(time * 1.3 + i * 0.7 + obj.tx * 0.5) * (1.5 + len * 0.08);
                ctx.strokeStyle = i % 2 ? "#5f8a3f" : "#4e7434";
                ctx.lineWidth = 1.9;
                ctx.lineCap = "round";
                ctx.beginPath();
                ctx.moveTo(x0 * 0.6, 0);
                ctx.quadraticCurveTo(x0 * 0.9 + bend * 0.4, -len * 0.55, x0 + bend, -len);
                ctx.stroke();
                // A leaf peeling off the stalk.
                if (i % 3 === 0) {
                    ctx.strokeStyle = "#6f9a4a"; ctx.lineWidth = 1.6;
                    ctx.beginPath();
                    ctx.moveTo(x0 * 0.7, -len * 0.25);
                    ctx.quadraticCurveTo(x0 + 5, -len * 0.5, x0 + 2 + bend, -len * 0.85);
                    ctx.stroke();
                }
                // Cattail.
                if (n > 0.3) {
                    ctx.fillStyle = "#6d4a24";
                    ctx.beginPath();
                    ctx.ellipse(x0 + bend, -len - 2.5, 1.9, 4.2, 0, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.fillStyle = "rgba(255,230,190,0.2)";
                    ctx.fillRect(x0 + bend - 1.3, -len - 4.5, 1, 3);
                    ctx.strokeStyle = "#5f8a3f"; ctx.lineWidth = 0.9;
                    ctx.beginPath();
                    ctx.moveTo(x0 + bend, -len - 6);
                    ctx.lineTo(x0 + bend + 0.6, -len - 9);
                    ctx.stroke();
                }
            }
            break;
        }

        case "grass_tuft": {
            // A dense clump, not a spray of hairs: a solid dark base, blades
            // in three tones with real width, a couple of seed heads.
            const winter = season === "winter", autumn = season === "autumn";
            const deep = winter ? "#8da0ac" : autumn ? "#6f5c2a" : "#3a5a28";
            const base = winter ? "#a9bac5" : autumn ? "#8d7638" : "#4e7236";
            const mid = winter ? "#c6d4de" : autumn ? "#b59a4e" : "#6f9a4a";
            const tip = winter ? "#e8f1f7" : autumn ? "#d8c074" : "#93c062";

            ctx.fillStyle = "rgba(10,16,8,0.24)";
            ctx.beginPath(); ctx.ellipse(0, 0.6, 9, 2.8, 0, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = deep;                                   // the clump itself
            ctx.beginPath(); ctx.ellipse(0, -2.2, 7, 3.4, 0, 0, Math.PI * 2); ctx.fill();

            const blades = 17;
            for (let i = 0; i < blades; i++) {
                const n = h(obj.tx, obj.ty, i * 7);
                const n2 = h(obj.tx, obj.ty, i * 7 + 3);
                const x0 = (i / (blades - 1) - 0.5) * 12;
                const dir = x0 >= 0 ? 1 : -1;
                const len = 8 + n * 11;
                const sway = Math.sin(time * 1.2 + i * 0.5 + obj.tx * 0.3) * (0.8 + len * 0.09);
                const tipX = x0 * 1.5 + dir * (2 + n2 * 4) + sway;
                const tipY = -len - 2;
                const ctrlX = x0 * 1.1 + dir * (0.5 + n2 * 1.2) + sway * 0.4;
                // Blades are tapered shapes, not 1px strokes — that is what
                // made the old tuft read as scribble.
                const w = 1.5 + n * 1.1;
                ctx.fillStyle = i % 3 === 0 ? tip : (i % 3 === 1 ? mid : base);
                ctx.beginPath();
                ctx.moveTo(x0 * 0.55 - w / 2, -1.2);
                ctx.quadraticCurveTo(ctrlX - w * 0.3, -len * 0.55, tipX, tipY);
                ctx.quadraticCurveTo(ctrlX + w * 0.3, -len * 0.55, x0 * 0.55 + w / 2, -1.2);
                ctx.closePath(); ctx.fill();
            }
            // Two seed heads leaning out of the clump.
            if (!winter) {
                for (const sgn of [-1, 1]) {
                    const n = h(obj.tx, obj.ty, sgn > 0 ? 41 : 47);
                    if (n < 0.4) continue;
                    const sway = Math.sin(time * 1.0 + sgn + obj.tx * 0.3) * 1.4;
                    const hx = sgn * (5 + n * 3) + sway, hy = -16 - n * 5;
                    ctx.strokeStyle = base; ctx.lineWidth = 1; ctx.lineCap = "round";
                    ctx.beginPath();
                    ctx.moveTo(sgn * 1.5, -2);
                    ctx.quadraticCurveTo(sgn * 3, hy * 0.5, hx, hy);
                    ctx.stroke();
                    ctx.fillStyle = autumn ? "#e0cc8a" : "#c2cf86";
                    for (let s2 = 0; s2 < 4; s2++) {
                        ctx.beginPath();
                        ctx.ellipse(hx + sgn * s2 * 0.4, hy + s2 * 1.5, 1.1 - s2 * 0.12, 0.8, 0, 0, Math.PI * 2);
                        ctx.fill();
                    }
                }
            }
            break;
        }

                case "flower": {
            const bend = Math.sin(time * 1.3 + obj.tx) * 1.3;
            const colors = [["#f0d75e", "#c9ae3a"], ["#e07a9a", "#b85776"],
                            ["#8aa8e8", "#6782c4"], ["#f2f0ea", "#cfcabd"]];
            const [petal, petalDark] = colors[(obj.variant || 0) % colors.length];
            ctx.strokeStyle = "#5f8a3f"; ctx.lineWidth = 1.2;
            ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(bend, -6, bend, -11); ctx.stroke();
            ctx.fillStyle = "#6f9a4a";
            ctx.beginPath(); ctx.ellipse(-2.6 + bend, -5, 2.8, 1.3, -0.4, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.ellipse(2.4 + bend, -7.5, 2.4, 1.1, 0.4, 0, Math.PI * 2); ctx.fill();
            for (let i = 0; i < 6; i++) {
                const a = (i / 6) * Math.PI * 2 + 0.3;
                ctx.fillStyle = Math.cos(a) < 0 ? petal : petalDark;
                ctx.beginPath();
                ctx.ellipse(bend + Math.cos(a) * 2.6, -12 + Math.sin(a) * 2.6, 2, 1.7, a, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.fillStyle = "#f7c14b";
            ctx.beginPath(); ctx.arc(bend, -12, 1.5, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = "rgba(255,255,255,0.5)";
            ctx.fillRect(bend - 1, -12.8, 1, 1);
            break;
        }

        case "driftwood": {
            shadowEllipse(ctx, 11, 2.6, 0.22);
            ctx.save(); ctx.rotate(-0.18);
            ctx.fillStyle = "#a89880"; ctx.fillRect(-12, -5, 24, 5);
            ctx.fillStyle = "#c3b49c"; ctx.fillRect(-12, -5, 24, 1.5);
            ctx.fillStyle = "#8a7c66";
            for (let i = 0; i < 4; i++) ctx.fillRect(-10 + i * 6, -4, 1, 4);
            ctx.restore();
            break;
        }

        case "tent": {
            shadowEllipse(ctx, 23, 7, 0.34);
            // Canvas, two tones, with a seam and a rolled-back door.
            ctx.fillStyle = "#6a5a40";
            ctx.beginPath(); ctx.moveTo(-21, 0); ctx.lineTo(0, -29); ctx.lineTo(21, 0); ctx.closePath(); ctx.fill();
            ctx.fillStyle = "#857047";
            ctx.beginPath(); ctx.moveTo(-21, 0); ctx.lineTo(0, -29); ctx.lineTo(-3, 0); ctx.closePath(); ctx.fill();
            ctx.fillStyle = "rgba(0,0,0,0.18)";
            ctx.beginPath(); ctx.moveTo(8, 0); ctx.lineTo(0, -29); ctx.lineTo(21, 0); ctx.closePath(); ctx.fill();
            // Folds.
            ctx.strokeStyle = "rgba(0,0,0,0.16)"; ctx.lineWidth = 1;
            for (let i = -2; i <= 2; i++) {
                if (!i) continue;
                ctx.beginPath(); ctx.moveTo(i * 7, 0); ctx.lineTo(i * 1.6, -24); ctx.stroke();
            }
            // Dark interior.
            ctx.fillStyle = "#15110c";
            ctx.beginPath(); ctx.moveTo(-7, 0); ctx.lineTo(0, -17); ctx.lineTo(7, 0); ctx.closePath(); ctx.fill();
            ctx.fillStyle = "#2b2319";
            ctx.beginPath(); ctx.moveTo(-7, 0); ctx.lineTo(-3, -14); ctx.lineTo(0, 0); ctx.closePath(); ctx.fill();
            // Ridge pole and guy lines.
            ctx.strokeStyle = "#4a3c2a"; ctx.lineWidth = 1.4;
            ctx.beginPath(); ctx.moveTo(0, -29); ctx.lineTo(0, -33); ctx.stroke();
            ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(-21, 0); ctx.lineTo(-27, 4); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(21, 0); ctx.lineTo(27, 4); ctx.stroke();
            ctx.fillStyle = "#3a2f21";
            ctx.fillRect(-28, 3, 3, 2); ctx.fillRect(25, 3, 3, 2);
            // A bedroll peeking out.
            ctx.fillStyle = "#7d6a4e";
            ctx.beginPath(); ctx.ellipse(0, -2, 6, 2.4, 0, 0, Math.PI * 2); ctx.fill();
            break;
        }

        case "hearth_ruin": {
            // The stove outlived the house: scorched brick, a cold black mouth
            // and soot licking up the chimney. It is a landmark, so it is big.
            ctx.save();
            ctx.scale(1.25, 1.25);
            shadowEllipse(ctx, 17, 6, 0.36);
            ctx.fillStyle = "#7d5d4c"; ctx.fillRect(-14, -26, 28, 26);
            for (let r = 0; r < 6; r++) {
                for (let c = 0; c < 4; c++) {
                    const bx = -14 + c * 7 + (r % 2 ? 3.5 : 0);
                    const k = h(obj.tx + c, obj.ty + r, 7);
                    ctx.fillStyle = k > 0.7 ? "#916b56" : k > 0.35 ? "#74564698" : "#5f453a";
                    ctx.fillRect(bx, -25 + r * 4.4, 6.2, 3.6);
                }
            }
            ctx.fillStyle = "rgba(255,230,200,0.12)"; ctx.fillRect(-14, -26, 28, 2);
            ctx.fillStyle = "rgba(0,0,0,0.32)"; ctx.fillRect(8, -26, 6, 26);
            // Broken chimney stub with soot.
            ctx.fillStyle = "#6b5044"; ctx.fillRect(-9, -36, 12, 10);
            ctx.fillStyle = "#523d33"; ctx.fillRect(-9, -36, 12, 2.4);
            ctx.fillStyle = "rgba(20,16,14,0.55)"; ctx.fillRect(-7, -36, 8, 4);
            // Mouth.
            ctx.fillStyle = "#0f0c0a";
            ctx.beginPath();
            ctx.moveTo(-8, 0); ctx.lineTo(-8, -12); ctx.quadraticCurveTo(0, -17, 8, -12);
            ctx.lineTo(8, 0); ctx.closePath(); ctx.fill();
            ctx.fillStyle = "rgba(90,60,40,0.35)";          // faint warmth inside
            ctx.beginPath(); ctx.ellipse(0, -4, 5, 2.6, 0, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = "rgba(24,20,17,0.6)";           // soot above the mouth
            ctx.beginPath();
            ctx.moveTo(-8, -12); ctx.quadraticCurveTo(0, -24, 8, -12);
            ctx.quadraticCurveTo(0, -15, -8, -12); ctx.closePath(); ctx.fill();
            ctx.fillStyle = "#2a2320"; ctx.fillRect(-14, -1.5, 28, 2.5);
            ctx.fillStyle = "#4a3f39";                      // spilled ash at its foot
            ctx.beginPath(); ctx.ellipse(-2, 1.5, 12, 3, 0, 0, Math.PI * 2); ctx.fill();
            ctx.restore();
            break;
        }

        case "diary": {
            shadowEllipse(ctx, 7, 2, 0.24);
            ctx.save(); ctx.rotate(-0.12);
            ctx.fillStyle = "#e5d8b4"; ctx.fillRect(-6, -4.5, 12, 4.5);
            ctx.fillStyle = "#c9b98f"; ctx.fillRect(-6, -4.5, 12, 1);
            ctx.fillStyle = "#6b4a2c"; ctx.fillRect(-7, -6, 13, 2);
            ctx.fillStyle = "#231c16";                          // burnt corner
            ctx.beginPath(); ctx.moveTo(3, -6); ctx.lineTo(6, -6); ctx.lineTo(6, -1); ctx.closePath(); ctx.fill();
            ctx.restore();
            break;
        }

        case "chest_old": {
            shadowEllipse(ctx, 12, 4, 0.3);
            ctx.fillStyle = "#5e4428"; ctx.fillRect(-11, -13, 22, 13);
            ctx.fillStyle = "#74552f"; ctx.fillRect(-11, -13, 22, 2);
            ctx.fillStyle = "#4a3620";
            ctx.beginPath(); ctx.ellipse(0, -13, 11, 5, 0, Math.PI, Math.PI * 2); ctx.fill();
            ctx.fillStyle = "#8a6a3c";
            ctx.beginPath(); ctx.ellipse(0, -13.5, 11, 4.4, 0, Math.PI, Math.PI * 2); ctx.fill();
            ctx.fillStyle = "#3c3a40"; ctx.fillRect(-12, -9, 24, 2); ctx.fillRect(-2.5, -11, 5, 7);
            ctx.fillStyle = "#c8b060"; ctx.fillRect(-1.5, -8, 3, 3);
            break;
        }

        case "campfire": {
            // Fire ring only; flames are drawn live by the renderer.
            // Chunky field stones set into the soil — never flat petals.
            shadowEllipse(ctx, 14, 5, 0.22);
            ctx.fillStyle = "#3a332c";
            ctx.beginPath(); ctx.ellipse(0, 0, 11, 5.5, 0, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = "#4a4139";
            ctx.beginPath(); ctx.ellipse(0, -0.5, 8, 3.8, 0, 0, Math.PI * 2); ctx.fill();
            const ring = [];
            for (let i = 0; i < 8; i++) {
                const a = (i / 8) * Math.PI * 2 + 0.3;
                ring.push({ a, x: Math.cos(a) * 12.5, y: Math.sin(a) * 6.2 });
            }
            ring.sort((p1, p2) => p1.y - p2.y);            // back stones first
            ring.forEach((st, i) => {
                const n = h(obj.tx + i, obj.ty, 5);
                const w = 3.4 + n * 1.6, hh = 2.6 + n * 1.3;
                const back = st.y < 0;
                ctx.fillStyle = "rgba(0,0,0,0.3)";          // seated in the soil
                ctx.beginPath();
                ctx.ellipse(st.x, st.y + hh * 0.55, w * 1.05, hh * 0.5, 0, 0, Math.PI * 2);
                ctx.fill();
                // Faceted body: flat-ish bottom, bumpy top.
                ctx.fillStyle = back ? "#4a443d" : "#565049";
                ctx.beginPath();
                ctx.moveTo(st.x - w, st.y + hh * 0.5);
                ctx.lineTo(st.x - w * 0.8, st.y - hh * 0.3);
                ctx.lineTo(st.x - w * 0.25, st.y - hh);
                ctx.lineTo(st.x + w * 0.45, st.y - hh * 0.85);
                ctx.lineTo(st.x + w, st.y - hh * 0.1);
                ctx.lineTo(st.x + w * 0.85, st.y + hh * 0.5);
                ctx.closePath(); ctx.fill();
                ctx.fillStyle = "rgba(230,224,210,0.26)";   // sunlit top-left facet
                ctx.beginPath();
                ctx.moveTo(st.x - w * 0.8, st.y - hh * 0.3);
                ctx.lineTo(st.x - w * 0.25, st.y - hh);
                ctx.lineTo(st.x + w * 0.2, st.y - hh * 0.6);
                ctx.lineTo(st.x - w * 0.5, st.y - hh * 0.15);
                ctx.closePath(); ctx.fill();
                ctx.fillStyle = "rgba(18,15,12,0.3)";       // sooted inner face
                ctx.beginPath();
                ctx.ellipse(st.x - st.x * 0.22, st.y - st.y * 0.25 + hh * 0.1,
                            w * 0.45, hh * 0.4, 0, 0, Math.PI * 2);
                ctx.fill();
            });
            break;
        }

        default: {
            shadowEllipse(ctx, 7, 2.4, 0.22);
            ctx.fillStyle = "#8a7a6a";
            ctx.fillRect(-5, -8, 10, 8);
        }
    }
}

/**
 * The fire pit: whatever is actually lying in it, then the flames.
 *
 * `stack` comes straight from `Campfire.stack` — one entry per piece of fuel
 * with how much of it is left — so the player sees the brushwood they threw
 * in, sees it char, and sees the log underneath still going.
 *
 * @param {number} intensity 0..1
 * @param {Array<{id:string,burn:number,seed:number}>} stack
 */
export function paintFlames(ctx, intensity, time, stack = []) {
    const lit = intensity > 0;

    // Bed of ash and old charcoal, always there once a fire has lived here.
    ctx.fillStyle = "#2c2724";
    ctx.beginPath(); ctx.ellipse(0, -0.5, 8.5, 3.8, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#3d3733";
    ctx.beginPath(); ctx.ellipse(-1.5, -1.2, 5, 2.2, 0, 0, Math.PI * 2); ctx.fill();

    // --- what is in the pit ------------------------------------------------
    const pieces = stack.length ? stack.slice(-5) : (lit ? [{ id: "firewood", burn: 1, seed: 0 }] : []);
    const paintPile = (alpha) => {
        pieces.forEach((piece, i) => {
            const b = Math.max(0, Math.min(1, piece.burn));
            const n = ((piece.seed || 0) % 100) / 100;
            const slot = i - (pieces.length - 1) / 2;
            ctx.save();
            ctx.globalAlpha = alpha;
            ctx.translate(slot * 2.6 + (n - 0.5) * 2, -1 - i * 0.7);
            ctx.rotate((n - 0.5) * 0.9 + slot * 0.35);
            drawFuelPiece(ctx, piece.id, b, lit, time, n);
            ctx.restore();
        });
        ctx.globalAlpha = 1;
    };
    paintPile(1);

    if (!lit) {
        // Cold pit: a wisp of ash, two charred ends sticking out.
        ctx.fillStyle = "rgba(120,114,106,0.35)";
        ctx.beginPath(); ctx.ellipse(0, -2, 6, 2.4, 0, 0, Math.PI * 2); ctx.fill();
        return;
    }

    // --- heat --------------------------------------------------------------
    ctx.fillStyle = `rgba(255,120,40,${0.3 * intensity})`;
    ctx.beginPath(); ctx.ellipse(0, -1, 10, 4.6, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = `rgba(255,190,90,${0.25 * intensity})`;
    ctx.beginPath(); ctx.ellipse(0, -1.5, 5.5, 2.6, 0, 0, Math.PI * 2); ctx.fill();

    // Flame tongues: three layers, each with its own wobble and a notched
    // silhouette, so it never reads as a plain triangle.
    const flick = 0.78 + Math.sin(time * 11.3) * 0.11 + Math.sin(time * 6.7) * 0.08;
    const H = (15 + intensity * 11) * flick;
    const layers = [
        { c: `rgba(206,62,18,${0.55 + 0.2 * intensity})`, w: 9.5, h: H, drift: 1.4, wob: 9.1 },
        { c: `rgba(244,128,30,${0.7 + 0.2 * intensity})`, w: 6.6, h: H * 0.78, drift: 2.1, wob: 12.3 },
        { c: `rgba(255,222,150,${0.75 + 0.2 * intensity})`, w: 3.6, h: H * 0.44, drift: 2.9, wob: 15.7 }
    ];
    for (const L of layers) {
        const lean = Math.sin(time * 5.5 + L.drift) * L.drift;
        ctx.fillStyle = L.c;
        ctx.beginPath();
        ctx.moveTo(-L.w, -1);
        for (let k = 1; k <= 5; k++) {
            const f = k / 5;
            const wob = Math.sin(time * L.wob - f * 5 + L.drift) * (1.1 + f * 1.6);
            ctx.lineTo(-L.w * (1 - f * 0.92) + wob + lean * f, -1 - L.h * f);
        }
        for (let k = 4; k >= 0; k--) {
            const f = k / 5;
            const wob = Math.sin(time * L.wob - f * 5 + L.drift + 1.7) * (1.1 + f * 1.6);
            ctx.lineTo(L.w * (1 - f * 0.92) + wob + lean * f, -1 - L.h * f);
        }
        ctx.quadraticCurveTo(0, 2, -L.w, -1);
        ctx.closePath();
        ctx.fill();
    }

    // The near half of the pile again, over the flames: you should always be
    // able to see what you threw in and how far gone it is.
    paintPile(0.72);

    // A detached lick of flame, for life.
    const lickY = -H - 4 - ((time * 26) % 10);
    ctx.fillStyle = `rgba(255,170,60,${0.4 * intensity})`;
    ctx.beginPath();
    ctx.ellipse(Math.sin(time * 4) * 3, lickY, 1.8, 3.2, 0, 0, Math.PI * 2);
    ctx.fill();
}

/**
 * One piece of fuel in the pit. `b` is how much of it is left (1 → fresh,
 * 0 → ash); as it drops the piece shrinks, blackens and starts glowing along
 * its cracks.
 */
function drawFuelPiece(ctx, id, b, lit, time, n) {
    const char = 1 - b;                       // how charred it is
    const glow = lit ? 0.35 + 0.3 * Math.sin(time * 5 + n * 6) : 0;
    const wood = (base, lightC) => {
        ctx.fillStyle = mix(base, "#241e1a", char * 0.85);
        return mix(lightC, "#3a2f28", char * 0.8);
    };

    switch (id) {
        case "hay": {                          // a wisp of straw, burns to nothing
            const len = 7 * (0.4 + b * 0.6);
            for (let i = -2; i <= 2; i++) {
                ctx.strokeStyle = mix("#c9a94e", "#2a2420", char * 0.9);
                ctx.lineWidth = 0.8;
                ctx.beginPath();
                ctx.moveTo(i * 1.6, 0);
                ctx.quadraticCurveTo(i * 2.2, -len * 0.6, i * 3 + n, -len);
                ctx.stroke();
            }
            break;
        }
        case "firewood": {                     // crossed sticks
            const len = 13 * (0.55 + b * 0.45);
            for (const rot of [-0.5, 0.35]) {
                ctx.save(); ctx.rotate(rot);
                const litC = wood("#6d4f2c", "#9a7845");
                ctx.fillRect(-len / 2, -1.6, len, 2.6);
                ctx.fillStyle = litC;
                ctx.fillRect(-len / 2, -1.6, len, 0.9);
                if (lit) {                      // embers along the stick
                    ctx.fillStyle = `rgba(255,140,50,${glow * (0.4 + char)})`;
                    ctx.fillRect(-len / 2 + 1, -0.4, len - 2, 0.8);
                }
                ctx.restore();
            }
            break;
        }
        case "plank": {
            const len = 15 * (0.6 + b * 0.4);
            const litC = wood("#8a6436", "#b08450");
            ctx.fillRect(-len / 2, -2, len, 3.4);
            ctx.fillStyle = litC;
            ctx.fillRect(-len / 2, -2, len, 1);
            if (lit) {
                ctx.fillStyle = `rgba(255,150,60,${glow})`;
                ctx.fillRect(-len / 2, 0.6, len, 0.8);
            }
            break;
        }
        case "log": {                          // the big one, lasts
            const len = 18 * (0.65 + b * 0.35);
            const r = 3.4 * (0.7 + b * 0.3);
            const litC = wood("#5e4428", "#8a6a3c");
            ctx.fillRect(-len / 2, -r, len, r * 1.8);
            ctx.fillStyle = litC;
            ctx.fillRect(-len / 2, -r, len, r * 0.6);
            ctx.fillStyle = mix("#c8a46a", "#30261f", char);
            ctx.beginPath(); ctx.ellipse(len / 2, -r * 0.1, 1.4, r * 0.85, 0, 0, Math.PI * 2); ctx.fill();
            if (lit) {                          // split cracks glowing orange
                ctx.fillStyle = `rgba(255,120,40,${glow})`;
                ctx.fillRect(-len / 2 + 2, -0.5, len - 4, 1);
                ctx.fillStyle = `rgba(255,200,110,${glow * 0.8})`;
                ctx.fillRect(-len / 4, -0.2, len / 3, 0.6);
            }
            break;
        }
        case "coal": case "charcoal": {        // lumps that glow from within
            for (let i = 0; i < 3; i++) {
                const sz = (2.4 - i * 0.4) * (0.6 + b * 0.4);
                const ox = (i - 1) * 3 + n * 1.5, oy = -1 + (i % 2) * 1.2;
                ctx.fillStyle = id === "coal" ? "#1b1a1c" : "#2a241f";
                ctx.beginPath();
                ctx.moveTo(ox - sz, oy); ctx.lineTo(ox - sz * 0.4, oy - sz);
                ctx.lineTo(ox + sz * 0.7, oy - sz * 0.7); ctx.lineTo(ox + sz, oy + sz * 0.3);
                ctx.closePath(); ctx.fill();
                if (lit) {
                    ctx.fillStyle = `rgba(255,90,25,${0.3 + glow * 0.6})`;
                    ctx.fillRect(ox - sz * 0.6, oy - sz * 0.4, sz * 1.1, sz * 0.5);
                }
            }
            break;
        }
        case "resin": {
            ctx.fillStyle = mix("#7a4b1c", "#2a1f16", char);
            ctx.beginPath(); ctx.ellipse(0, -1, 3.2 * (0.6 + b * 0.4), 2 * (0.6 + b * 0.4), 0, 0, Math.PI * 2); ctx.fill();
            if (lit) {
                ctx.fillStyle = `rgba(255,210,120,${glow})`;
                ctx.beginPath(); ctx.ellipse(-0.6, -1.6, 1.2, 0.8, 0, 0, Math.PI * 2); ctx.fill();
            }
            break;
        }
        default: {
            const len = 11 * (0.6 + b * 0.4);
            ctx.fillStyle = mix("#6a5033", "#241e1a", char * 0.85);
            ctx.fillRect(-len / 2, -1.5, len, 2.6);
            if (lit) {
                ctx.fillStyle = `rgba(255,140,50,${glow})`;
                ctx.fillRect(-len / 2 + 1, -0.3, len - 2, 0.8);
            }
        }
    }
}

/** Something roasting on the spit. */
export function paintSpitItem(ctx, slotIndex, state, _emoji, itemId = "") {
    const x = slotIndex === 0 ? -7.5 : 7.5;
    const y = -17;
    ctx.save();
    ctx.translate(x, y);

    const fish = /fish/.test(itemId);
    const burnt = state === "burnt";
    const done = state === "done";
    const body = burnt ? "#2a2522" : done ? "#8a5a2e" : fish ? "#9fb0b8" : "#b4624f";
    const top = burnt ? "#3a3330" : done ? "#b07a3e" : fish ? "#c3d0d6" : "#cc7d66";

    if (fish) {
        ctx.fillStyle = body;
        ctx.beginPath(); ctx.ellipse(0, 0, 5.5, 2.6, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = top;
        ctx.beginPath(); ctx.ellipse(-0.6, -0.7, 4.4, 1.5, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = body;
        ctx.beginPath(); ctx.moveTo(5, 0); ctx.lineTo(8, -2.4); ctx.lineTo(8, 2.4); ctx.closePath(); ctx.fill();
    } else {
        ctx.fillStyle = body;
        ctx.beginPath(); ctx.ellipse(0, 0, 4.6, 3.4, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = top;
        ctx.beginPath(); ctx.ellipse(-0.6, -1, 3.4, 2, 0, 0, Math.PI * 2); ctx.fill();
    }
    // Skewer through it.
    ctx.strokeStyle = "#6a5436"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(-8, 0.5); ctx.lineTo(8, 0.5); ctx.stroke();
    if (done) {                                   // a little steam
        ctx.fillStyle = "rgba(255,240,210,0.35)";
        ctx.beginPath(); ctx.arc(0, -5, 1.6, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
}
