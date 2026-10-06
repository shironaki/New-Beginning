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
        case "winter": return { c: "#e8f1f8", t: 0.86 };
        default: return { c: "#7fc04f", t: 0.08 };
    }
}

const LIVING = new Set([T.GRASS, T.MEADOW, T.MOSS, T.GRASS_DRY, T.PINE_FLOOR]);
/** Ground that snow settles on without being alive. */
const DUSTABLE = new Set([T.DIRT, T.PATH, T.SAND, T.FARM, T.FARM_WET, T.GRAVEL, T.STONE, T.COBBLE, T.ASH, T.SOOT]);
const WINTER_DUST = 0.42;       // share of the winter tint such ground takes

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
    } else if (season === "winter" && DUSTABLE.has(id)) {
        // Winter does not stop at the grass: bare soil, paths and sand get a
        // dusting too, otherwise the valley reads as green ground under snow.
        const st = seasonTint(season);
        base = mix(base, st.c, st.t * WINTER_DUST);
        dark = mix(dark, st.c, st.t * WINTER_DUST * 0.7);
        light = mix(light, st.c, st.t * WINTER_DUST * 1.2);
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
    // ~2.7 px cells: at the camera's zoom that is a couple of screen pixels,
    // fine enough that a close-up reads as grain instead of as soft blur.
    const cells = 12;
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
            // Undergrowth: clover rosettes and dry stalks, placed from a
            // continuous field so patches drift across tiles instead of
            // appearing once per tile like a stamp.
            if (!winter && id !== T.PINE_FLOOR) {
                const fx = px + h(tx, ty, 123) * size, fy = py + h(tx, ty, 131) * size;
                const patch = soft(tx * size + (fx - px), ty * size + (fy - py), 26, 137);
                if (patch > 0.68) {                       // clover
                    ctx.fillStyle = `rgba(92,142,70,${0.3 + (patch - 0.68) * 1.2})`;
                    for (let k = 0; k < 3; k++) {
                        const a = k * 2.1 + patch * 3;
                        ctx.beginPath();
                        ctx.ellipse(fx + Math.cos(a) * 1.6, fy + Math.sin(a) * 1.1, 1.5, 1.1, a, 0, Math.PI * 2);
                        ctx.fill();
                    }
                } else if (patch < 0.3 && id === T.GRASS_DRY) {   // dry stalk
                    ctx.strokeStyle = "rgba(186,172,110,0.5)";
                    ctx.lineWidth = 0.8;
                    ctx.beginPath();
                    ctx.moveTo(fx, fy);
                    ctx.quadraticCurveTo(fx + 1.5, fy - 4, fx + 3, fy - 7);
                    ctx.stroke();
                }
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
            // Burn scars at the scale of the fire, not of the tile: wide
            // patches where the ground burned through, and pale drifts where
            // the ash settled. Without this the whole valley is one flat tone.
            {
                const CELLS = ASH.cells, q = size / CELLS;
                for (let cy2 = 0; cy2 < CELLS; cy2++) {
                    for (let cx2 = 0; cx2 < CELLS; cx2++) {
                        const gx = tx * CELLS + cx2, gy = ty * CELLS + cy2;
                        const n = soft(gx, gy, 26, 71) * 0.7 + soft(gx, gy, 9, 17) * 0.3;
                        // A second, slower field decides what KIND of burn this
                        // patch is: scorched earth still holds the fire's rust,
                        // cold ash has gone blue-grey. Lightness alone made the
                        // whole burn read as one grey photograph.
                        const kind = Math.max(-1, Math.min(1, (soft(gx, gy, 38, 7) - 0.5) * ASH.kindGain));
                        if (n > ASH.charAt) {
                            const k = Math.min(1, (n - ASH.charAt) * ASH.charGain);
                            ctx.fillStyle = mixRGBA(ASH.char, kind > 0 ? ASH.scorch : ASH.coldChar,
                                                    Math.abs(kind) * ASH.tint, k);
                        } else {
                            const k = Math.min(1, (ASH.charAt - n) * ASH.drift);
                            ctx.fillStyle = mixRGBA(ASH.ash, kind > 0 ? ASH.emberAsh : ASH.coldAsh,
                                                    Math.abs(kind) * ASH.tint, k);
                        }
                        ctx.fillRect(px + cx2 * q, py + cy2 * q, q, q);
                        // A wash of colour on top of the lightness: rust where
                        // the fire cooked the earth, cold blue where the ash
                        // lay wet. Without it the burn is a grey photograph.
                        const hue = Math.abs(kind) - ASH.washFrom;
                        if (hue > 0) {
                            const c = kind > 0 ? ASH.scorch : ASH.coldAsh;
                            ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${(hue * ASH.washA).toFixed(3)})`;
                            ctx.fillRect(px + cx2 * q, py + cy2 * q, q, q);
                        }
                    }
                }
            }
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
            // Wind ripples. The crests are found from a CONTINUOUS field in
            // world space: per-tile strokes at a fixed height turned the
            // whole beach into corrugated cardboard every 32 px.
            const step = 2;
            for (let yy = 0; yy < size; yy += step) {
                for (let xx = 0; xx < size; xx += step) {
                    const wx = tx * size + xx, wy = ty * size + yy;
                    const warp = (soft(wx * 0.5, wy * 0.5, 16, 7) - 0.5) * 7;
                    const phase = wy * 0.21 + Math.sin(wx * 0.045) * 1.6 + warp;
                    const v = Math.sin(phase);
                    if (v > 0.80) {
                        ctx.fillStyle = `rgba(255,252,236,${(v - 0.8) * 0.55})`;
                        ctx.fillRect(px + xx, py + yy, step, step);
                    } else if (v < -0.86) {
                        ctx.fillStyle = `rgba(120,98,62,${(-v - 0.86) * 0.5})`;
                        ctx.fillRect(px + xx, py + yy, step, step);
                    }
                }
            }
            // Shells and dark grains, scattered, never on a grid.
            for (let i = 0; i < 4; i++) {
                const a = h(tx * 3 + i, ty * 5, i * 13), b = h(tx, ty * 7 + i, i * 17 + 3);
                if (b > 0.9) {
                    ctx.fillStyle = "rgba(255,250,240,0.32)";
                    ctx.beginPath();
                    ctx.ellipse(px + a * size, py + b * size, 1.6, 1, a * 3, 0, Math.PI * 2);
                    ctx.fill();
                } else {
                    ctx.fillStyle = "rgba(120,100,70,0.22)";
                    ctx.fillRect(px + a * size, py + b * size, 1, 1);
                }
            }
            break;
        }

        case T.WATER: case T.DEEP: {
            const deep = id === T.DEEP;
            // Depth: the open water sinks towards blue-black, the shallows
            // keep a sandy glow. Continuous noise, so no tile steps.
            // Eight cells a side, not four: at four the depth noise shows as
            // chequerboard patches two tiles wide on open water.
            const CELLS = 8, q = size / CELLS;
            for (let cy2 = 0; cy2 < CELLS; cy2++) {
                for (let cx2 = 0; cx2 < CELLS; cx2++) {
                    const gx = tx * CELLS + cx2, gy = ty * CELLS + cy2;
                    const d = soft(gx, gy, 6, 13) * 0.6 + soft(gx, gy, 2.5, 29) * 0.4;
                    // Small amplitude on purpose: strong depth noise at this
                    // scale turns open water into a chequerboard of tiles.
                    ctx.fillStyle = deep
                        ? `rgba(8,26,44,${0.26 + d * 0.08})`
                        : `rgba(16,54,78,${0.08 + d * 0.08})`;
                    // Exact, non-overlapping cells: translucent fills that
                    // overlap by half a pixel leave a grid of dark seams.
                    ctx.fillRect(px + cx2 * q, py + cy2 * q, q, q);
                }
            }
            // Caustics: a continuous net of light across the bottom, found
            // the same way as the sand ripples so it never repeats per tile.
            const cstep = 2;
            for (let yy = 0; yy < size; yy += cstep) {
                for (let xx = 0; xx < size; xx += cstep) {
                    const wx = tx * size + xx, wy = ty * size + yy;
                    const a1 = Math.sin(wx * 0.09 + (soft(wx, wy, 13, 3) - 0.5) * 6);
                    const a2 = Math.sin(wy * 0.11 + (soft(wx, wy, 11, 9) - 0.5) * 6);
                    const v = a1 * 0.6 + a2 * 0.6;
                    if (v > 0.74) {
                        const k = (v - 0.74) * (deep ? 0.5 : 1.1);
                        ctx.fillStyle = deep ? `rgba(150,205,235,${k * 0.5})`
                                             : `rgba(228,248,255,${k * 0.8})`;
                        ctx.fillRect(px + xx, py + yy, cstep, cstep);
                    }
                }
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
                // A rock face, not masonry: irregular facets scattered on a
                // jittered grid in WORLD space and clipped to the tile by
                // clamping their corners, so one wall is one wall and the
                // same four blocks are never stamped per tile.
                ctx.fillStyle = "rgba(16,14,13,0.34)";
                ctx.fillRect(px, py, size, size);
                const x0 = tx * size, y0 = ty * size;
                const CELL = 16;
                const gx0 = Math.floor(x0 / CELL) - 1, gx1 = Math.floor((x0 + size) / CELL) + 1;
                const gy0 = Math.floor(y0 / CELL) - 1, gy1 = Math.floor((y0 + size) / CELL) + 1;
                const cl = (x) => Math.max(px, Math.min(px + size, x));
                const cv = (y) => Math.max(py, Math.min(py + size, y));
                for (let gy = gy0; gy <= gy1; gy++) {
                    for (let gx = gx0; gx <= gx1; gx++) {
                        // Facet centre: a grid point pushed far off the grid.
                        const jx = (h(gx, gy, 31) - 0.5) * CELL * 0.9;
                        const jy = (h(gx, gy, 37) - 0.5) * CELL * 0.9;
                        const cxw = gx * CELL + CELL / 2 + jx;
                        const cyw = gy * CELL + CELL / 2 + jy;
                        const r = CELL * (0.52 + h(gx, gy, 41) * 0.55);
                        const asp = 0.62 + h(gx, gy, 43) * 0.7;
                        const rot = h(gx, gy, 47) * Math.PI;
                        const nv = 5 + Math.floor(h(gx, gy, 53) * 2.9);
                        const tone = Math.round(78 + h(gx, gy, 59) * 56 - h(gx, gy, 61) * 14);
                        const px0 = px + (cxw - x0), py0 = py + (cyw - y0);
                        if (px0 < px - r * 2 || px0 > px + size + r * 2) continue;
                        if (py0 < py - r * 2 || py0 > py + size + r * 2) continue;
                        const vx = [], vy = [];
                        for (let i = 0; i < nv; i++) {
                            const a = rot + (i / nv) * Math.PI * 2;
                            const k = 0.72 + h(gx * 7 + i, gy * 5, 67) * 0.56;
                            vx.push(px0 + Math.cos(a) * r * k);
                            vy.push(py0 + Math.sin(a) * r * k * asp);
                        }
                        const poly = (dx, dy, from, to, close) => {
                            ctx.beginPath();
                            for (let i = from; i <= to; i++) {
                                const j = ((i % nv) + nv) % nv;
                                if (i === from) ctx.moveTo(cl(vx[j] + dx), cv(vy[j] + dy));
                                else ctx.lineTo(cl(vx[j] + dx), cv(vy[j] + dy));
                            }
                            if (close) ctx.lineTo(cl(px0), cv(py0));
                            ctx.closePath();
                            ctx.fill();
                        };
                        ctx.fillStyle = `rgba(${tone},${tone - 2},${tone - 7},0.82)`;
                        poly(0, 0, 0, nv - 1, false);
                        // Light grazes the upper-left of every facet.
                        ctx.fillStyle = "rgba(255,252,244,0.08)";
                        poly(0, 0, Math.round(nv * 0.5), Math.round(nv * 0.5) + Math.max(1, Math.round(nv * 0.35)), true);
                        ctx.fillStyle = "rgba(0,0,0,0.16)";
                        poly(0, 0, 0, Math.max(1, Math.round(nv * 0.3)), true);
                        // Deep crevice under the facet.
                        // A crevice, but only when both ends really are
                        // inside this tile: a clamped end drags the line
                        // across the whole tile as a black scar.
                        const i1 = Math.min(1, nv - 1);
                        const inside = (x, y) => x > px && x < px + size && y > py && y < py + size;
                        if (h(gx, gy, 71) > 0.55 && inside(vx[0], vy[0]) && inside(vx[i1], vy[i1])) {
                            ctx.strokeStyle = "rgba(0,0,0,0.26)";
                            ctx.lineWidth = 1.2;
                            ctx.beginPath();
                            ctx.moveTo(vx[0], vy[0]);
                            ctx.lineTo(vx[i1], vy[i1]);
                            ctx.stroke();
                        }
                        // Lichen in the damp hollows, spread over metres.
                        if (soft(cxw, cyw, 22, 93) > 0.66) {
                            ctx.fillStyle = "rgba(92,116,64,0.18)";
                            ctx.beginPath();
                            ctx.ellipse(cl(px0), cv(py0 + r * 0.3), r * 0.5, r * 0.3, 0.4, 0, Math.PI * 2);
                            ctx.fill();
                        }
                    }
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
            // Peat: hummocks of dark moss, standing water between them and
            // sedge poking out. A flat brown sheet is what made the swamp
            // read as "dirt with props on it".
            const step = 2;
            for (let yy = 0; yy < size; yy += step) {
                for (let xx = 0; xx < size; xx += step) {
                    const wx = tx * size + xx, wy = ty * size + yy;
                    const hum = soft(wx, wy, 11, 17);          // hummock field
                    if (hum > 0.62) {                          // raised peat moss
                        const k = (hum - 0.62) * 1.6;
                        ctx.fillStyle = `rgba(86,100,56,${k * 0.5})`;
                        ctx.fillRect(px + xx, py + yy, step, step);
                    } else if (hum < 0.34) {                   // standing water
                        const k = (0.34 - hum) * 2.2;
                        ctx.fillStyle = `rgba(28,40,38,${k * 0.5})`;
                        ctx.fillRect(px + xx, py + yy, step, step);
                        if (soft(wx, wy, 4, 23) > 0.74) {      // sky in the pool
                            ctx.fillStyle = `rgba(150,178,180,${k * 0.3})`;
                            ctx.fillRect(px + xx, py + yy, step, step);
                        }
                    }
                }
            }
            // Sedge on the hummocks, a bubble now and then in the water —
            // sparse and never twice the same, or the bog turns into a field
            // of identical glyphs.
            for (let i = 0; i < 3; i++) {
                const a = h(tx * 3 + i, ty * 5, i * 13), b2 = h(tx, ty * 7 + i, i * 17 + 3);
                const roll = h(tx * 11 + i, ty * 13, 29);
                const gx = px + a * size, gy = py + b2 * size;
                const wet = soft(tx * size + a * size, ty * size + b2 * size, 11, 17);
                if (wet > 0.56 && roll > 0.62) {
                    const blades = 2 + Math.floor(roll * 3);
                    const scale = 0.7 + a * 0.9;
                    const tilt = (b2 - 0.5) * 1.1;
                    ctx.strokeStyle = `rgba(${118 + Math.round(a * 26)},${138 + Math.round(b2 * 24)},84,${0.34 + a * 0.26})`;
                    ctx.lineWidth = 0.8 + a * 0.4;
                    for (let k = 0; k < blades; k++) {
                        const lean = (k - (blades - 1) / 2) * 1.5 + tilt;
                        const len = (4 + h(tx + k, ty + i, 31) * 3.5) * scale;
                        ctx.beginPath();
                        ctx.moveTo(gx, gy);
                        ctx.quadraticCurveTo(gx + lean * 0.5, gy - len * 0.6, gx + lean, gy - len);
                        ctx.stroke();
                    }
                } else if (wet < 0.3 && roll > 0.86) {
                    ctx.strokeStyle = "rgba(190,204,196,0.18)";
                    ctx.lineWidth = 0.7;
                    ctx.beginPath();
                    ctx.arc(gx, gy, 0.9 + a * 1.1, 0, Math.PI * 2);
                    ctx.stroke();
                }
            }
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
/**
 * Round one corner of a tile with the neighbour's ground, so a pond stops
 * being a rectangle. The arc wobbles with world noise: a perfect quarter
 * circle on every corner is its own kind of grid.
 */
function cornerPath(ctx, px, py, size, sx, sy, radius, seed) {
    const cx = px + (sx > 0 ? size : 0);
    const cy = py + (sy > 0 ? size : 0);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    const steps = 7;
    for (let i = 0; i <= steps; i++) {
        const a = (i / steps) * (Math.PI / 2);
        const r = radius * (0.68 + h(seed + i, seed * 3, 19) * 0.64);
        ctx.lineTo(cx - sx * Math.cos(a) * r, cy - sy * Math.sin(a) * r);
    }
    ctx.closePath();
}

/**
 * The burn, in numbers. The fire that took the valley did not leave one grey:
 * where it sat longest the earth is scorched rust, where it only passed the
 * ash settled cold and blue. Two noise fields — one for lightness, one for
 * the kind of burn — keep the ground from reading as a grey photograph.
 */
export const ASH = {
    cells: 8,               // sub-cells per tile side
    charAt: 0.56,           // noise above this is burned-through ground
    charGain: 0.5,          // α ramp of the dark patches
    drift: 0.28,            // α ramp of the pale drifts
    tint: 0.85,             // how far a patch may travel from neutral
    kindGain: 2.6,          // contrast of the warm/cold field
    washFrom: 0.15,         // below this the patch stays neutral
    washA: 0.34,             // α of the colour wash at full warm/cold
    char: [22, 18, 16],     // neutral charcoal
    scorch: [96, 48, 20],   // warm: earth cooked by the fire
    coldChar: [30, 34, 44], // cold: wet soot in the shade
    ash: [214, 206, 194],   // neutral ash drift
    emberAsh: [216, 188, 150], // warm drift, still holding the ember colour
    coldAsh: [168, 184, 202]   // cold drift, blue by the morning
};

/** Mix two rgb triplets and hand back an rgba() string. */
function mixRGBA(a, b, t, alpha) {
    const r = Math.round(a[0] + (b[0] - a[0]) * t);
    const g = Math.round(a[1] + (b[1] - a[1]) * t);
    const bl = Math.round(a[2] + (b[2] - a[2]) * t);
    return `rgba(${r},${g},${bl},${alpha.toFixed(3)})`;
}

/**
 * A lone tile of water, in numbers. Mine galleries are full of them, and a
 * tile painted edge to edge is a square pond however nicely the rim wobbles.
 * So the tile is given back to the floor and the water is drawn inside it as
 * a closed, uneven blob.
 */
export const PUDDLE = {
    lobes: 9,            // control points around the rim
    rMin: 0.2,           // of a tile — the pinched side
    rMax: 0.4,           // of a tile — the wide side
    offset: 0.07,        // how far the blob may sit off-centre
    rimA: 0.42,          // α of the damp ring around it
    rimW: 2.0,           // px of that ring
    deepA: 0.5,          // α of the darker middle
    sheen: 0.45,         // size of the highlight, as a fraction of the blob
    sheenA: 0.16
};

/** Trace the uneven rim of one puddle; the path is left open for fill/stroke. */
function puddlePath(ctx, tx, ty, cx, cy, rx, ry) {
    const N = PUDDLE.lobes;
    const px2 = [], py2 = [];
    for (let i = 0; i < N; i++) {
        const a = (i / N) * Math.PI * 2;
        const k = PUDDLE.rMin + h(tx * 7 + i, ty * 11 + i * 3, 29) * (PUDDLE.rMax - PUDDLE.rMin);
        const kk = k / PUDDLE.rMax;
        px2.push(cx + Math.cos(a) * rx * kk);
        py2.push(cy + Math.sin(a) * ry * kk);
    }
    ctx.beginPath();
    // Through the midpoints, with the control points as the corners: a closed
    // curve with no kinks and no straight tile edge anywhere on it.
    ctx.moveTo((px2[N - 1] + px2[0]) / 2, (py2[N - 1] + py2[0]) / 2);
    for (let i = 0; i < N; i++) {
        const j = (i + 1) % N;
        ctx.quadraticCurveTo(px2[i], py2[i], (px2[i] + px2[j]) / 2, (py2[i] + py2[j]) / 2);
    }
    ctx.closePath();
}

/** Where the blob sits inside its tile, in units of the tile. */
export function puddleGeom(tx, ty, size) {
    return {
        cx: size / 2 + (h(tx, ty, 17) - 0.5) * size * PUDDLE.offset * 2,
        cy: size / 2 + (h(tx, ty, 19) - 0.5) * size * PUDDLE.offset * 2,
        rx: size * PUDDLE.rMax,
        ry: size * PUDDLE.rMax * 0.86          // flattened by the 3/4 view
    };
}

/** Trace the puddle of tile (tx,ty) whose top-left corner is at (px,py). */
export function puddleScreenPath(ctx, tx, ty, px, py, size, grow = 0) {
    const g = puddleGeom(tx, ty, size);
    puddlePath(ctx, tx, ty, px + g.cx, py + g.cy, g.rx + grow, g.ry + grow);
}

/**
 * A lone tile of water and the floor it lies on, or -1. Majority vote, not
 * the first neighbour: a gallery floor is a mix of rock and spoil, and
 * picking the odd tile out would leave a pale square.
 */
export function loneWaterFloor(map, tx, ty) {
    if (!tileInfo(map.get(tx, ty)).liquid) return -1;
    for (const [ddx, ddy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (tileInfo(map.get(tx + ddx, ty + ddy)).liquid) return -1;
    }
    let floorId = -1, bestVotes = 0;
    const votes = new Map();
    for (const [ddx, ddy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        const id = map.get(tx + ddx, ty + ddy);
        const info = tileInfo(id);
        if (info.liquid || info.solid || !info.colors) continue;
        const v = (votes.get(id) || 0) + 1;
        votes.set(id, v);
        if (v > bestVotes) { bestVotes = v; floorId = id; }
    }
    return floorId;
}

/** Paint the water of one puddle on top of an already-painted floor tile. */
function paintPuddle(ctx, map, tx, ty, px, py, size, floorId) {
    // Whatever the puddle lies on: the first dry neighbour wins.
    const floor = tileInfo(floorId);
    const water = tileInfo(map.get(tx, ty)).colors;
    const g = puddleGeom(tx, ty, size);
    const cx = px + g.cx, cy = py + g.cy, rx = g.rx, ry = g.ry;

    // 2. Damp ground soaked around the rim.
    ctx.save();
    ctx.globalAlpha = PUDDLE.rimA;
    ctx.fillStyle = floor.colors[2] || floor.colors[1];
    puddlePath(ctx, tx, ty, cx, cy, rx + PUDDLE.rimW, ry + PUDDLE.rimW);
    ctx.fill();
    ctx.restore();

    // 3. The water itself, with a darker middle and one flat highlight.
    ctx.fillStyle = water[0];
    puddlePath(ctx, tx, ty, cx, cy, rx, ry);
    ctx.fill();
    ctx.save();
    ctx.globalAlpha = PUDDLE.deepA;
    ctx.fillStyle = water[1] || water[0];
    puddlePath(ctx, tx, ty, cx + 0.5, cy + 1, rx * 0.62, ry * 0.58);
    ctx.fill();
    ctx.globalAlpha = PUDDLE.sheenA;
    ctx.fillStyle = "#dff0f6";
    ctx.beginPath();
    ctx.ellipse(cx - rx * 0.22, cy - ry * 0.3, rx * PUDDLE.sheen * 0.5, ry * PUDDLE.sheen * 0.26,
                -0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return true;
}

export function paintEdges(ctx, map, tx, ty, px, py, size, season = "spring") {
    let here = map.get(tx, ty);
    const dirs = [[0, -1, "n"], [1, 0, "e"], [0, 1, "s"], [-1, 0, "w"]];
    // A single tile of water is a puddle, not a pond. The tile is handed back
    // to the floor — edges, scree and contact shadows included, otherwise the
    // clean tile shows as a bright square — and the water is drawn at the end
    // as a closed blob lying on top of it.
    const puddleFloor = loneWaterFloor(map, tx, ty);
    if (puddleFloor >= 0) {
        paintTile(ctx, puddleFloor, px, py, size, tx, ty, season);
        here = puddleFloor;
    }
    for (const [dx, dy, side] of dirs) {
        const other = map.get(tx + dx, ty + dy);
        if (other === here || other === T.VOID) continue;
        const oi = tileInfo(other), hi = tileInfo(here);
        if (here === T.CLIFF && !(oi.solid && !oi.liquid)) {
            // The lit top edge of the wall, only where it actually ends —
            // and ragged, because a rock rim is not a ruler.
            ctx.fillStyle = "rgba(255,255,255,0.13)";
            const teeth = 8, seg = size / teeth;
            for (let i = 0; i < teeth; i++) {
                const d = 1.6 + h(tx * 5 + i, ty * 7, side.charCodeAt(0)) * 2.6;
                if (side === "n") ctx.fillRect(px + i * seg, py, seg, d);
                if (side === "w") ctx.fillRect(px, py + i * seg, d * 0.9, seg);
                if (side === "e") ctx.fillRect(px + size - d * 0.9, py + i * seg, d * 0.9, seg);
            }
            if (side === "s") {
                // The wall's own foot: a gradient, not a black bar.
                for (let i = 0; i < 4; i++) {
                    ctx.fillStyle = `rgba(0,0,0,${0.16 - i * 0.03})`;
                    ctx.fillRect(px, py + size - 6 + i * 1.5, size, 1.6);
                }
            }
            continue;
        }
        if (oi.solid && !oi.liquid) {
            // A skirt of scree: the rock does not end on the tile border, it
            // spills a ragged fringe of rubble onto the floor. Without this
            // every gallery wall and every cliff is a straight line on the
            // grid, and the mine reads as a tiled dungeon.
            const teeth = 16, seg = size / teeth;
            for (let layer = 0; layer < 2; layer++) {
                ctx.fillStyle = oi.colors[layer === 0 ? 1 : 2];
                ctx.globalAlpha = layer === 0 ? 0.72 : 0.4;
                for (let i = 0; i < teeth; i++) {
                    const n = h(tx * 19 + i, ty * 23 + layer, side.charCodeAt(0));
                    const n2 = h(tx * 7 + i * 3, ty * 13 + layer, side.charCodeAt(0) + 7);
                    const d = (layer === 0 ? 3.2 : 6.5) * (0.25 + n * 1.2) * (0.55 + n2 * 0.8);
                    if (side === "n") ctx.fillRect(px + i * seg, py, seg, d);
                    if (side === "s") ctx.fillRect(px + i * seg, py + size - d, seg, d);
                    if (side === "w") ctx.fillRect(px, py + i * seg, d, seg);
                    if (side === "e") ctx.fillRect(px + size - d, py + i * seg, d, seg);
                }
            }
            ctx.globalAlpha = 1;
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
            // Is that water a puddle? Then no dried foam line on our side —
            // a white rim around one tile of water looks like a light box.
            let landRound = 0;
            for (const [ddx, ddy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                if (!tileInfo(map.get(tx + dx + ddx, ty + dy + ddy)).liquid) landRound++;
            }
            const puddle = landRound >= 3;
            // A lone puddle is drawn as a blob; a band hugging the tile
            // border would put a square halo right back around it.
            if (landRound >= 4) continue;
            band((i) => wobble(i, 11) * (puddle ? 4 : 7), (off, len, d) => {
                ctx.fillStyle = "rgba(96,78,52,0.32)";            // wet ground
                if (side === "n") ctx.fillRect(px + off, py, len, d);
                if (side === "s") ctx.fillRect(px + off, py + size - d, len, d);
                if (side === "w") ctx.fillRect(px, py + off, d, len);
                if (side === "e") ctx.fillRect(px + size - d, py + off, d, len);
            });
            if (!puddle) band((i) => wobble(i, 23) * 2.6, (off, len, d) => {
                ctx.fillStyle = "rgba(255,255,255,0.3)";          // dried foam line
                if (side === "n") ctx.fillRect(px + off, py, len, d);
                if (side === "s") ctx.fillRect(px + off, py + size - d, len, d);
                if (side === "w") ctx.fillRect(px, py + off, d, len);
                if (side === "e") ctx.fillRect(px + size - d, py + off, d, len);
            });
        } else if (hi.liquid && oi.liquid) {
            // Shallow meeting deep: a soft lip instead of a hard rectangle.
            // A wide, ragged blend — the step from shallow to deep is the
            // biggest colour jump on the map and a straight tile edge there
            // reads as a painted rectangle.
            const lighter = here === T.WATER;
            band((i) => 4 + wobble(i, 29) * 9, (off, len, d) => {
                ctx.fillStyle = lighter ? "rgba(10,34,56,0.16)" : "rgba(104,160,184,0.16)";
                if (side === "n") ctx.fillRect(px + off, py, len, d);
                if (side === "s") ctx.fillRect(px + off, py + size - d, len, d);
                if (side === "w") ctx.fillRect(px, py + off, d, len);
                if (side === "e") ctx.fillRect(px + size - d, py + off, d, len);
            });
            band((i) => 1.5 + wobble(i, 37) * 4, (off, len, d) => {
                ctx.fillStyle = lighter ? "rgba(10,34,56,0.14)" : "rgba(104,160,184,0.14)";
                if (side === "n") ctx.fillRect(px + off, py, len, d);
                if (side === "s") ctx.fillRect(px + off, py + size - d, len, d);
                if (side === "w") ctx.fillRect(px, py + off, d, len);
                if (side === "e") ctx.fillRect(px + size - d, py + off, d, len);
            });
        } else if (hi.liquid && !oi.liquid) {
            // A puddle is not a coast: a tile of water ringed by land gets a
            // plain damp rim, not surf and sand tongues. (Mine galleries are
            // full of them, and a foaming square reads as a glowing bug.)
            let landAround = 0;
            for (const [ddx, ddy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                const nb = tileInfo(map.get(tx + ddx, ty + ddy));
                if (!nb.liquid) landAround++;
            }
            if (landAround >= 3) {
                band((i) => wobble(i, 17) * 3.5, (off, len, d) => {
                    ctx.fillStyle = "rgba(40,54,58,0.35)";           // damp rim
                    if (side === "n") ctx.fillRect(px + off, py, len, d);
                    if (side === "s") ctx.fillRect(px + off, py + size - d, len, d);
                    if (side === "w") ctx.fillRect(px, py + off, d, len);
                    if (side === "e") ctx.fillRect(px + size - d, py + off, d, len);
                });
                continue;
            }
            // Tongues of the bank poking into the water. Without them the
            // waterline stays exactly where the tile grid put it, and a pond
            // reads as a swimming pool however nice the foam is.
            band((i) => (wobble(i, 37) - 0.95) * 15, (off, len, d) => {
                ctx.fillStyle = oi.colors[0];
                if (side === "n") ctx.fillRect(px + off, py, len, d);
                if (side === "s") ctx.fillRect(px + off, py + size - d, len, d);
                if (side === "w") ctx.fillRect(px, py + off, d, len);
                if (side === "e") ctx.fillRect(px + size - d, py + off, d, len);
            });
            band((i) => (wobble(i, 37) - 1.25) * 13, (off, len, d) => {
                ctx.fillStyle = oi.colors[1];                     // their dry crest
                if (side === "n") ctx.fillRect(px + off, py, len, d);
                if (side === "s") ctx.fillRect(px + off, py + size - d, len, d);
                if (side === "w") ctx.fillRect(px, py + off, d, len);
                if (side === "e") ctx.fillRect(px + size - d, py + off, d, len);
            });
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
    // --- the coastline ---------------------------------------------------
    // A pond painted tile by tile is a rectangle, and nothing in nature is.
    // Where two neighbours on the same corner are the other medium, that
    // corner gets rounded off with their ground.
    const hereLiquid = tileInfo(here).liquid === true;
    // How much water is this tile part of? A single puddle gets no coastline
    // at all — carving bays and foam into one tile draws a bright frame.
    let liquidAround = 0;
    if (hereLiquid) {
        for (const [ddx, ddy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            if (tileInfo(map.get(tx + ddx, ty + ddy)).liquid) liquidAround++;
        }
    }
    const isPuddle = hereLiquid && liquidAround <= 1;
    const atSide = (dx, dy) => {
        const id = map.get(tx + dx, ty + dy);
        return { id, liquid: tileInfo(id).liquid === true, void: id === T.VOID };
    };
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const a = atSide(sx, 0), b = atSide(0, sy), d = atSide(sx, sy);
        if (a.void || b.void) continue;
        const seed = tx * 7 + ty * 13 + sx + sy * 2;
        // Each corner bites a different amount — a pond rounded by the same
        // quarter circle four times is just a rectangle with cut corners.
        const bite = size * ((isPuddle ? 0.3 : 0.16) + h(tx + sx, ty + sy, 23) * 0.3);
        if (hereLiquid && !a.liquid && !b.liquid) {
            const land = tileInfo(a.id).colors;
            cornerPath(ctx, px, py, size, sx, sy, bite, seed);
            ctx.fillStyle = land[1];
            ctx.fill();
            ctx.save();                                 // wet sand at the line
            ctx.globalAlpha = 0.45;
            ctx.fillStyle = land[0];
            cornerPath(ctx, px, py, size, sx, sy, bite * 0.7, seed + 3);
            ctx.fill();
            ctx.restore();
            // Foam follows the carved line, not the tile edge — but a lone
            // puddle has no surf, only a shape.
            if (!isPuddle) {
                ctx.strokeStyle = "rgba(236,252,255,0.45)";
                ctx.lineWidth = 1.6;
                cornerPath(ctx, px, py, size, sx, sy, bite, seed);
                ctx.stroke();
            }
        } else if (!hereLiquid && a.liquid && b.liquid && d.liquid) {
            // A headland sticking into the water gets its point rounded off.
            const sea = tileInfo(a.id).colors;
            cornerPath(ctx, px, py, size, sx, sy, bite * 0.9, seed + 11);
            ctx.fillStyle = sea[0];
            ctx.fill();
        }
    }

    if (puddleFloor >= 0) paintPuddle(ctx, map, tx, ty, px, py, size, puddleFloor);
}

/* ======================================================================= */
/*  Props — drawn every frame, y-sorted with characters. Origin = the base.  */
/* ======================================================================= */

/**
 * Where the sun is. The renderer updates this once per frame from the clock;
 * props use it to throw a shadow in the right direction and length, which is
 * most of what makes a scene read as "morning" or "noon".
 */
export const SUN = { dx: 0.55, dy: 0.42, len: 1, alpha: 1, hour: 12 };

/**
 * Cast-shadow contract. A shadow is the cheapest depth cue there is, and the
 * one thing that stops props from looking like stickers lying on the ground.
 *
 *   len      shadow length as a multiple of the object's HEIGHT — this is
 *            what makes a tree's shadow long and a mushroom's short. At noon
 *            `lenNoon`, near the horizon `lenLow`, by the sun's elevation;
 *   squash   the ground plane is seen at a slant, so it foreshortens;
 *   alpha    strongest at noon, fading out as the sun sets — after that the
 *            light map takes over and there is no sun shadow at all;
 *   contact  the small dark pool directly under the object; that one stays at
 *            every hour, because it is contact, not sunlight.
 */
export const SHADOW = {
    lenNoon: 0.34,
    lenLow: 1.65,
    squash: 0.42,
    alphaNoon: 0.30,
    alphaLow: 0.20,
    softSteps: 3,          // stacked ellipses -> a penumbra, not a hard ring
    softGrow: 0.16,
    maxLen: 64,            // u; a 46 u tree at dusk would otherwise cross a field
    contactAlpha: 0.42,
    contactGrow: 1.12,
    azDawn: 1.05,          // shadow direction x at first light …
    azDusk: 0.20,          // … and at last light; y comes from the elevation
    riseStart: 5.0,        // h, the sun clears the ridge
    riseEnd: 7.5,
    setStart: 17.5,
    setEnd: 20.5
};

/** Place the sun for the hour; every prop reads `SUN` when it draws. */
export function setSun(hour, daylight) {
    SUN.hour = hour;
    const span = Math.max(0.001, SHADOW.setEnd - SHADOW.riseStart);
    const t = Math.max(0, Math.min(1, (hour - SHADOW.riseStart) / span));
    const elevation = Math.sin(Math.PI * t);          // 0 horizon .. 1 noon
    // Azimuth is deliberately NOT a full east-to-west swing. Every prop in
    // this game is shaded for a key light at the upper left, all day; if the
    // cast shadow crossed to the other side in the evening it would fight the
    // shading on the object throwing it. So the shadow stays in the lower
    // right and only swings within that quadrant: long and far out at dawn,
    // tucked under the object at dusk.
    SUN.dx = SHADOW.azDawn + (SHADOW.azDusk - SHADOW.azDawn) * t;
    SUN.dy = 0.30 + (1 - elevation) * 0.36;
    SUN.len = SHADOW.lenNoon + (1 - elevation) * (SHADOW.lenLow - SHADOW.lenNoon);
    let day = Math.max(0, Math.min(1, daylight));     // fade, never pop
    if (hour < SHADOW.riseEnd) {
        day *= Math.max(0, (hour - SHADOW.riseStart) / (SHADOW.riseEnd - SHADOW.riseStart));
    }
    if (hour > SHADOW.setStart) {
        day *= Math.max(0, 1 - (hour - SHADOW.setStart) / (SHADOW.setEnd - SHADOW.setStart));
    }
    SUN.alpha = Math.max(0, Math.min(1, day));
}

/**
 * Firelight contract. After sunset the sun stops throwing shadows and the
 * camp becomes the only light in the valley — so the camp has to throw them
 * instead. A fire is a POINT light: every object around it throws its shadow
 * straight away from the flame, longer the closer it stands, and the whole
 * fan of shadows breathes with the fire. That single effect is what turns a
 * night scene from "the same picture, darker" into a place with a fire in it.
 *
 *   len        shadow length as a multiple of the object's height, at the
 *              light's centre; falls off with distance;
 *   near       u — inside this radius the object IS the fire pit, no shadow;
 *   dayFade    how much of the fire shadow the sun washes out at noon;
 *   flicker    depth of the length wobble, in step with `paintFlames`.
 */
export const FIRELIGHT = {
    maxLights: 8,
    len: 1.15,
    maxLen: 72,
    near: 10,
    minStrength: 0.06,
    falloff: 1.45,         // (1 - d/r) ^ falloff — a fire's reach ends fast
    alpha: 0.38,
    dayFade: 0.85,
    flicker: 0.09,
    flickerSpeed: 6.7,
    softSteps: 2,
    softGrow: 0.2
};

/* Fixed pool: the renderer refills it every frame, nothing is allocated. */
const FIRES = [];
for (let i = 0; i < FIRELIGHT.maxLights; i++) FIRES.push({ x: 0, y: 0, r: 0, i: 0, on: false });
let FIRE_N = 0;
/** World position of whatever is drawing right now (set per prop/character). */
const ORIGIN = { x: 0, y: 0 };
/** Clock for the flicker, so prop painters need not thread it through. */
let SHADOW_TIME = 0;

/**
 * Hand the painter this frame's point lights, in WORLD coordinates.
 * @param {Array<{x:number,y:number,r:number,i:number}>} list
 */
export function setFireLights(list) {
    FIRE_N = 0;
    if (!list) return;
    for (let i = 0; i < list.length && FIRE_N < FIRELIGHT.maxLights; i++) {
        const L = list[i];
        if (!L || !(L.r > 0)) continue;
        const slot = FIRES[FIRE_N++];
        slot.x = L.x; slot.y = L.y; slot.r = L.r;
        slot.i = L.i === undefined ? 1 : L.i;
    }
}

/** Where the thing being drawn stands, so point lights know their direction. */
export function setShadowOrigin(wx, wy) { ORIGIN.x = wx; ORIGIN.y = wy; }

/**
 * Soft plants give way when somebody walks through them, in numbers.
 * The lean is a shear of the whole plant away from the walker; releasing it
 * is a damped spring, so grass springs back with one small wobble instead of
 * snapping upright. Per-plant state lives on the prop (`_bend`, `_bendAt`),
 * so this costs nothing to walk away from and allocates nothing per frame.
 */
export const BEND = {
    radius: 26,        // px — the walker pushes plants this far around them
    maxLean: 0.42,     // shear at point-blank range (x' = x - lean*y)
    squash: 0.16,      // the plant also loses this fraction of height, at most
    falloff: 1.7,      // >1 — the push is concentrated near the walker
    runBoost: 0.5,     // + this fraction of the lean at full running speed
    runAt: 118,        // px/s that counts as "full speed" (the run speed)
    releaseTau: 0.26,  // s — decay of the spring once the walker leaves
    wobbleHz: 3.4,     // Hz of the spring-back wobble
    kinds: {           // only things with stems bend; trunks and rocks do not
        grass_tuft: 1, reed: 1, herb: 1, fern: 1, wheat: 1,
        flower: 1, sapling: 0.7, bush: 0.45, berry_bush: 0.45
    }
};

/**
 * The wind as the plants feel it, in numbers. One field for the whole frame:
 * a steady lean downwind plus a gust that travels across the valley, so a
 * squall bends the whole meadow the same way at the same moment instead of
 * every tuft wobbling on its own private timer.
 */
export const BREEZE = {
    leanPerStrength: 0.085,   // shear of the steady lean at strength 1
    gustPerStrength: 0.075,   // extra shear at the crest of a gust
    gustHz: 0.37,             // how often a gust rolls through
    gustWave: 0.013,          // rad per px — the gust travels, it does not pulse
    treeScale: 0.45,          // trunks give less than stems
    maxLean: 0.3              // nothing bends past this, however hard it blows
};

const BREEZE_STATE = { ang: 0, str: 0.35, cos: 1, sin: 0 };

/** The sky tells the painter how hard it blows, once per frame. */
export function setBreeze(angle, strength) {
    BREEZE_STATE.ang = angle || 0;
    BREEZE_STATE.str = strength === undefined ? 0.35 : strength;
    BREEZE_STATE.cos = Math.cos(BREEZE_STATE.ang);
    BREEZE_STATE.sin = Math.sin(BREEZE_STATE.ang);
}

/**
 * Signed shear the wind puts on a plant standing at (wx, wy) this frame.
 * Positive leans the top to the right (downwind is +x when the wind blows east).
 */
export function windLean(wx, wy, time, scale = 1) {
    const B = BREEZE_STATE;
    if (!B.str) return 0;
    const phase = time * BREEZE.gustHz * Math.PI * 2 - (wx * B.cos + wy * B.sin) * BREEZE.gustWave;
    const gust = (Math.sin(phase) * 0.6 + Math.sin(phase * 2.3 + 1.1) * 0.4);
    const lean = (BREEZE.leanPerStrength + BREEZE.gustPerStrength * gust) * B.str * B.cos * scale;
    return Math.max(-BREEZE.maxLean, Math.min(BREEZE.maxLean, lean));
}

const WALKER = { x: 0, y: 0, on: false, speed: 0 };

/** Who is pushing through the undergrowth this frame (world coords). */
export function setWalker(wx, wy, on = true, speed = 0) {
    WALKER.x = wx; WALKER.y = wy; WALKER.on = !!on;
    WALKER.speed = speed || 0;
}

/**
 * Signed lean for one plant: positive bends the top to the right. Keeps the
 * strongest recent push on the prop and lets it spring back from there.
 */
export function plantBend(obj, kind, time) {
    const weight = BEND.kinds[kind];
    if (!weight) return 0;
    let push = 0;
    if (WALKER.on) {
        const dx = obj.x - WALKER.x, dy = (obj.y - WALKER.y) * 1.4;  // 3/4 view: vertical reach is shorter
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < BEND.radius) {
            const k = Math.pow(1 - d / BEND.radius, BEND.falloff);
            // A run flattens grass harder than a stroll does.
            const fast = 1 + Math.min(1, WALKER.speed / BEND.runAt) * BEND.runBoost;
            push = BEND.maxLean * weight * k * fast * (dx >= 0 ? 1 : -1);
            if (push > BEND.maxLean) push = BEND.maxLean;
            else if (push < -BEND.maxLean) push = -BEND.maxLean;
        }
    }
    const held = obj._bend || 0;
    if (Math.abs(push) >= Math.abs(held) || (push !== 0 && Math.sign(push) !== Math.sign(held))) {
        obj._bend = push;
        obj._bendAt = time;
        return push;
    }
    if (!held) return 0;
    const age = time - (obj._bendAt || 0);
    const live = held * Math.exp(-age / BEND.releaseTau) * Math.cos(age * BEND.wobbleHz * Math.PI * 2 * 0.25);
    if (Math.abs(live) < 0.004) { obj._bend = 0; return 0; }
    return live;
}

/**
 * Cast shadows only (no contact pool): one from the sun, one per fire.
 * Shared by props and characters so a settler by the fire throws the same
 * shadow a barrel does.
 */
export function castShadow(ctx, w, hh, alpha, height, time = 0) {
    const tall = height || w * 2.2;
    if (SUN.alpha > 0.04) {
        const reach = Math.min(SHADOW.maxLen, tall * SUN.len) * SUN.alpha;
        const lit = SHADOW.alphaLow + (SHADOW.alphaNoon - SHADOW.alphaLow) *
            Math.max(0, 1 - (SUN.len - SHADOW.lenNoon) / (SHADOW.lenLow - SHADOW.lenNoon));
        smear(ctx, SUN.dx, SUN.dy, reach, w, hh, lit * alpha * SUN.alpha,
              SHADOW.softSteps, SHADOW.softGrow);
    }
    if (!FIRE_N) return;
    const day = 1 - FIRELIGHT.dayFade * SUN.alpha;
    if (day <= 0.02) return;
    for (let i = 0; i < FIRE_N; i++) {
        const L = FIRES[i];
        const dx = ORIGIN.x - L.x, dy = ORIGIN.y - L.y;
        const d = Math.hypot(dx, dy);
        if (d >= L.r || d < FIRELIGHT.near) continue;
        let k = Math.pow(1 - d / L.r, FIRELIGHT.falloff) * L.i;
        if (k < FIRELIGHT.minStrength) continue;
        // Breathe with the flame — same slow double sine the light map uses.
        k *= 1 - FIRELIGHT.flicker + Math.sin(time * FIRELIGHT.flickerSpeed + L.x) * FIRELIGHT.flicker;
        const reach = Math.min(FIRELIGHT.maxLen, tall * FIRELIGHT.len * k) * day;
        if (reach < 2) continue;
        smear(ctx, dx / d, (dy / d) * 0.9 + 0.1, reach, w, hh,
              FIRELIGHT.alpha * alpha * k * day, FIRELIGHT.softSteps, FIRELIGHT.softGrow);
    }
}

/** One stretched, foreshortened, soft-edged shadow in direction (dx, dy). */
function smear(ctx, dx, dy, reach, w, hh, a, steps, grow) {
    if (a <= 0.004 || reach <= 0.5) return;
    const ang = Math.atan2(dy * SHADOW.squash, dx);
    const ex = dx * reach * 0.5;
    const ey = dy * reach * 0.5 * SHADOW.squash;
    for (let i = steps; i >= 1; i--) {
        const k = 1 + (i - 1) * grow;
        ctx.fillStyle = `rgba(14,12,10,${a / (i * 1.35)})`;
        ctx.beginPath();
        ctx.ellipse(ex, ey, (w + reach * 0.5) * k,
                    Math.max(hh, reach * 0.22 * SHADOW.squash) * k, ang, 0, Math.PI * 2);
        ctx.fill();
    }
}

/**
 * How tall each prop is, in body units — ONE table, read by everything that
 * needs to know an object's size: its cast shadow, the y-sort, and the fade
 * that keeps the hero visible when he walks behind a trunk. A number here is
 * the object's drawn height from the ground to its crown, not its footprint.
 */
export const PROP_HEIGHT = {
    pine: 50, spruce: 50,
    oak: 46, birch: 46, willow: 46, ancient_oak: 46, palm: 46,
    burnt_tree: 38, dead_tree: 34,
    hearth_ruin: 34, tent: 30, ruin_wall: 26,
    rock: 14, ore_rock: 14, burnt_stump: 13, bush: 12, chest_old: 11,
    burnt_beam: 7, campfire: 6, firewood: 6, driftwood: 5, diary: 3
};
/** These grow with the prop's own `size`; the rest are built, not grown. */
const HEIGHT_SCALES = new Set([
    "pine", "spruce", "oak", "birch", "willow", "ancient_oak", "palm",
    "burnt_tree", "dead_tree"
]);

/** Drawn height of a prop, u. */
/**
 * One colour that stands for a prop at a distance: what its reflection in
 * the water is made of. Crown colour for trees, stone for rock, bark for
 * everything else — no reflection needs more detail than that.
 */
export function propTone(kind) {
    const tree = TREE_COLORS[kind];
    if (tree) return tree[0];
    if (kind === "rock" || kind === "boulder" || kind === "stone" || kind === "ore_rock") return "#7e8a90";
    if (kind === "reed" || kind === "grass_tuft" || kind === "herb" || kind === "fern") return "#4e7236";
    return "#5a4530";
}

export function propHeight(kind, size = 1) {
    const base = PROP_HEIGHT[kind];
    if (base === undefined) return 10;
    return HEIGHT_SCALES.has(kind) ? base * size : base;
}

/**
 * Ground shadow for a prop standing at the origin.
 *
 * @param {number} w      half-width of the footprint, u
 * @param {number} hh     half-depth of the footprint, u
 * @param {number} alpha  contact strength
 * @param {number} height how tall the thing is, u — the cast shadow is this
 *                        long times the sun factor, so a tree throws a tree's
 *                        shadow and a mushroom throws a mushroom's
 */
function shadowEllipse(ctx, w, hh, alpha = 0.3, height = 0, time = SHADOW_TIME) {
    ctx.save();
    castShadow(ctx, w, hh, alpha, height, time);
    ctx.restore();
    // Contact: always there, sun or no sun. Without it everything floats.
    ctx.fillStyle = `rgba(14,12,10,${alpha * SHADOW.contactAlpha})`;
    ctx.beginPath();
    ctx.ellipse(1.2, 1, w * SHADOW.contactGrow, hh * SHADOW.contactGrow, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = `rgba(14,12,10,${alpha})`;
    ctx.beginPath();
    ctx.ellipse(1, 0.8, w * 0.82, hh * 0.82, 0, 0, Math.PI * 2);
    ctx.fill();
}

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

    shadowEllipse(ctx, 13 * s, 5 * s, 0.32, propHeight(obj.kind, s));

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

    shadowEllipse(ctx, 15 * S, 5.5 * S, 0.32, propHeight(obj.kind, S));

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

    // Willow: curtains that hang from the UNDERSIDE of the crown, longest
    // at the shoulders and parted over the trunk. A row of equal strands
    // starting at one height is a mop, not a tree.
    if (willow) {
        ctx.lineCap = "round";
        const strands = 36;
        for (let i = 0; i < strands; i++) {
            const t = (i + 0.5) / strands;                  // 0..1 across
            const u = (t - 0.5) * 2;                        // -1..1
            const n = h(obj.tx + i, obj.ty, 31), n2 = h(obj.tx, obj.ty + i, 37);
            const x0 = u * spread * (0.96 + n * 0.1);
            // Follow the dome: the curtain starts where the crown ends.
            const dome = Math.sqrt(Math.max(0, 1 - u * u));
            const yStart = cy + dome * spread * 0.56 + 2;
            // Longest at the shoulders, parted in the middle over the trunk.
            const part = Math.abs(u) < 0.16 ? 0.35 : 1;
            const drop = (9 + dome * 10 + n * 13) * part;
            const sway = (n2 - 0.5) * 4 + u * 1.5;
            const shade = Math.abs(u) > 0.45 ? (u > 0 ? dark : lit) : mid;
            ctx.strokeStyle = n > 0.7 ? lit : shade;
            ctx.globalAlpha = 0.42 + n2 * 0.34;
            ctx.lineWidth = (0.55 + n * 0.75) * S;
            ctx.beginPath();
            ctx.moveTo(x0 * S, yStart * S);
            ctx.quadraticCurveTo((x0 + sway * 0.35) * S, (yStart + drop * 0.62) * S,
                                 (x0 + sway) * S, (yStart + drop) * S);
            ctx.stroke();
            // Leaves: short dashes down the strand, denser near the tip.
            ctx.lineWidth = 0.6 * S;
            const leaves = 2 + Math.floor(n2 * 3);
            for (let k = 1; k <= leaves; k++) {
                const f = 0.35 + (k / (leaves + 0.6)) * 0.6;
                const lxx = (x0 + sway * f * f) * S, lyy = (yStart + drop * f) * S;
                ctx.beginPath();
                ctx.moveTo(lxx, lyy);
                ctx.lineTo(lxx + (k % 2 ? 1.7 : -1.7) * S, lyy + 2.1 * S);
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

/* ============================ stone ============================ */

/**
 * Boulder contract. A field of rocks used to be a field of ONE rock: same
 * silhouette, same white facet in the same corner, twenty times over. A
 * stone is cheap to draw and the eye counts repeats instantly, so every
 * boulder is now built from a seeded archetype, its own palette and its own
 * facets, and it sits IN the ground rather than on it.
 *
 *   kinds    archetype weights — a field mixes round boulders, flat slabs,
 *            angular shards and little clusters;
 *   aspect   height / width per archetype;
 *   jitter   radial noise on the outline, as a fraction of the radius;
 *   buried   how deep the stone sinks into the soil, as a fraction of height;
 *   stone    rock types with their base colour and weight.
 */
export const ROCK = {
    kinds: [["boulder", 40], ["slab", 26], ["shard", 18], ["cluster", 16]],
    grow: [0.74, 1.34],
    verts: [7, 11],
    radius: 12,
    aspect: { boulder: 0.82, slab: 0.46, shard: 1.04, cluster: 0.66 },
    jitter: 0.26,
    tilt: 0.26,            // rad, ± — a slab that lies askew reads as fallen
    buried: 0.16,
    stone: [
        ["granite", [118, 116, 112], 40],
        ["sandstone", [134, 119, 96], 22],
        ["basalt", [84, 83, 86], 22],
        ["flint", [102, 107, 113], 16]
    ],
    litA: 0.22,            // sunlit facet, upper left
    midA: 0.09,            // the plane between lit and shaded
    darkA: 0.30,           // shaded flank, lower right
    rimA: 0.30,            // bright edge where the light grazes the top
    crackA: 0.16,
    lichen: 0.45,
    chips: 0.5
};

/** Pick from a weighted table with a 0..1 roll. */
export function pick(table, roll) {
    let total = 0;
    for (const row of table) total += row[row.length - 1];
    let acc = 0;
    for (const row of table) {
        acc += row[row.length - 1] / total;
        if (roll <= acc) return row;
    }
    return table[table.length - 1];
}

/** Seeded outline of one stone: n vertices around a tilted ellipse. */
export function rockOutline(out, rx, ry, n, tilt, jitter, seedA, seedB) {
    out.length = 0;
    const cos = Math.cos(tilt), sin = Math.sin(tilt);
    for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const k = 1 - jitter * 0.5 + h(seedA + i * 7, seedB + i * 13, 61) * jitter;
        // Flatten the underside: a boulder meets the ground along a line,
        // it does not balance on a point.
        const flat = Math.sin(a) > 0.4 ? 0.62 : 1;
        const x = Math.cos(a) * rx * k;
        const y = Math.sin(a) * ry * k * flat;
        out.push([x * cos - y * sin, x * sin + y * cos]);
    }
    return out;
}

const RP = [];              // scratch outline, reused every call
const ORE_COLORS = { copper: "#d2823c", iron: "#c3cbd4", coal: "#1f1d1c", gem: "#63dcef" };

function facet(ctx, pts, lx, ly, keepLit, alpha, color) {
    ctx.fillStyle = color || (keepLit ? `rgba(255,252,244,${alpha})` : `rgba(0,0,0,${alpha})`);
    ctx.beginPath();
    let started = false;
    for (const [x, y] of pts) {
        const d = x * lx + y * ly;
        if (keepLit ? d > 0 : d < 0) {
            if (started) ctx.lineTo(x, y); else { ctx.moveTo(x, y); started = true; }
        }
    }
    if (!started) return;
    ctx.lineTo(-ly * 1.5, lx * 1.5);          // close through the middle
    ctx.closePath();
    ctx.fill();
}

/**
 * One stone, standing at the origin, already scaled by the caller.
 * @param {number} grade 0..1 — size of this particular stone
 */
function stoneBody(ctx, seedA, seedB, grade, tone, archetype, ore = null) {
    const n = Math.round(ROCK.verts[0] + h(seedA, seedB, 71) * (ROCK.verts[1] - ROCK.verts[0]));
    const asp = ROCK.aspect[archetype] || 0.8;
    const rx = ROCK.radius * grade;
    const ry = rx * asp;
    const tilt = (h(seedA, seedB, 83) - 0.5) * 2 * ROCK.tilt *
                 (archetype === "slab" ? 1.6 : 1);
    const pts = rockOutline(RP, rx, ry, n, tilt, ROCK.jitter, seedA, seedB);
    const sink = ry * ROCK.buried;
    // Stand the stone on its OWN lowest vertex, not on the ellipse it was
    // generated from: the underside is flattened, so an ellipse-based offset
    // left every boulder hovering a third of its height above its shadow.
    let bottom = -Infinity;
    for (const [, y] of pts) if (y > bottom) bottom = y;

    ctx.save();
    ctx.translate(0, -bottom + sink);        // the lowest point sinks into the soil
    const body = () => {
        ctx.beginPath();
        pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.closePath();
    };
    ctx.fillStyle = css(tone[0], tone[1], tone[2]);
    body(); ctx.fill();

    // Light comes from the upper left all day in this game.
    const lx = -0.68, ly = -0.73;
    facet(ctx, pts, lx, ly, true, ROCK.litA);
    facet(ctx, pts, -ly, lx, true, ROCK.midA);
    facet(ctx, pts, -lx, -ly, false, ROCK.darkA);

    // Grazing rim on the top-left edge.
    ctx.strokeStyle = `rgba(255,250,238,${ROCK.rimA})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    let on = false;
    for (const [x, y] of pts) {
        if (x * lx + y * ly > rx * 0.42) {
            if (on) ctx.lineTo(x, y); else { ctx.moveTo(x, y); on = true; }
        } else on = false;
    }
    ctx.stroke();

    // Cracks follow the stone's own tilt, so they read as bedding planes.
    ctx.save();
    body(); ctx.clip();
    ctx.strokeStyle = `rgba(0,0,0,${ROCK.crackA})`;
    ctx.lineWidth = 0.7;
    const cracks = 1 + Math.floor(h(seedA, seedB, 91) * 2.4);
    for (let i = 0; i < cracks; i++) {
        // Short, broken bedding planes — a line across the whole stone reads
        // as a wire lying on it, not as rock.
        const oy = (h(seedA + i, seedB, 97) - 0.5) * ry * 1.1;
        const x0 = -rx * (0.2 + h(seedA, seedB + i, 99) * 0.6);
        const x1 = rx * (0.15 + h(seedA + i, seedB, 101) * 0.6);
        ctx.beginPath();
        ctx.moveTo(x0, oy + Math.tan(tilt) * x0);
        ctx.quadraticCurveTo((x0 + x1) / 2, oy + (h(seedA, seedB + i, 103) - 0.5) * ry * 0.4,
                             x1, oy + Math.tan(tilt) * x1);
        ctx.stroke();
    }
    // Lichen clings to the shaded, damp side.
    if (h(seedA, seedB, 103) < ROCK.lichen) {
        ctx.fillStyle = "rgba(104,128,70,0.30)";
        for (let i = 0; i < 3; i++) {
            const a = 2.2 + h(seedA + i, seedB, 107) * 1.4;
            ctx.beginPath();
            ctx.ellipse(Math.cos(a) * rx * 0.55, Math.sin(a) * ry * 0.5 + ry * 0.2,
                        rx * (0.16 + h(seedA, seedB + i, 109) * 0.16),
                        ry * 0.16, a, 0, Math.PI * 2);
            ctx.fill();
        }
    }
    // An ore vein lives ON the stone's face, inside its outline.
    if (ore) {
        ctx.save();
        body(); ctx.clip();
        const f = Math.min(1.1, rx / 11);
        ctx.scale(f, f);
        const c = ORE_COLORS[ore] || "#c0c0c0";
        ctx.strokeStyle = c; ctx.lineWidth = 1.7; ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(-5.5, 1);
        ctx.quadraticCurveTo(-1.5, -3.5 - h(seedA, seedB, 151) * 2, 4, 0.5);
        ctx.stroke();
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(-2.5, -1.5); ctx.lineTo(-0.8, 2);
        ctx.moveTo(1.5, -2); ctx.lineTo(3.4, -3.6);
        ctx.stroke();
        ctx.fillStyle = c;
        ctx.beginPath(); ctx.arc(-4.2, -2.2, 1.4, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(2.4, -3.4, 1.1, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,0.55)";
        ctx.fillRect(-4.8, -2.9, 1, 1);
        ctx.fillRect(2, -3.9, 0.8, 0.8);
        ctx.restore();
    }
    ctx.restore();
    ctx.restore();

    // The seam where stone meets soil: tight, dark, right under the body —
    // this is the line that says "sunk in" instead of "placed on top".
    ctx.fillStyle = "rgba(28,23,18,0.34)";
    ctx.beginPath();
    ctx.ellipse(0, 0, rx * 0.86, Math.max(1.3, ry * 0.16), 0, 0, Math.PI * 2);
    ctx.fill();
    return { rx, ry, bottom };
}

export function paintProp(ctx, obj, time = 0, season = "spring") {
    const kind = obj.kind;
    const s = obj.size || 1;
    // Point lights need to know where this prop stands in the world.
    setShadowOrigin(obj.x, obj.y);
    SHADOW_TIME = time;

    // Wind: only foliage sways, and each tree on its own phase.
    if (TREE_COLORS[kind]) {
        // Own phase per tree, plus the gust the whole valley shares.
        const own = Math.sin(time * 0.8 + obj.tx * 0.7 + obj.ty * 0.37) * 0.02;
        const sway = own - windLean(obj.x, obj.y, time, BREEZE.treeScale);
        ctx.transform(1, 0, sway, 1, 0, 0);
        // No two trees the same height: ±18 %, and a slight horizontal flip.
        const grow = 0.84 + h(obj.tx, obj.ty, 41) * 0.36;
        const flip = h(obj.tx, obj.ty, 43) > 0.5 ? -1 : 1;
        ctx.scale(flip, 1);
        ctx.scale(grow, grow);
    }

    // Undergrowth gives way to whoever walks through it — and to the wind.
    const weight = BEND.kinds[kind] || 0;
    const lean = plantBend(obj, kind, time)
               + (weight ? windLean(obj.x, obj.y, time, weight) : 0);
    if (lean) {
        ctx.transform(1, 0, -lean, 1, 0, 0);
        ctx.scale(1, 1 - Math.abs(lean) / BEND.maxLean * BEND.squash);
    }

    switch (kind) {
        case "pine": case "spruce":
            conifer(ctx, obj, season); break;

        case "oak": case "birch": case "willow": case "ancient_oak":
            broadleaf(ctx, obj, season); break;

        case "palm": {
            // A real palm: a thick curved trunk that reaches the crown, big
            // drooping fronds that fall below the growing point, coconuts.
            shadowEllipse(ctx, 14 * s, 4.6 * s, 0.3, propHeight(kind, s));
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
                // The blade first, as a filled leaf: a frond drawn only with
                // strokes reads as a feather duster. Mass, then leaflets.
                const at = (f) => {
                    const u = 1 - f;
                    return [u * u * topX + 2 * u * f * midX + f * f * tipX,
                            u * u * topY + 2 * u * f * midY + f * f * tipY];
                };
                const bladeW = (f) => (1.2 + Math.sin(f * Math.PI) * 5.4) * s * scale;
                const edgeL = [], edgeR = [];
                for (let k = 0; k <= 8; k++) {
                    const f = k / 8;
                    const [bx, by] = at(f);
                    const [nx2, ny2] = at(Math.min(1, f + 0.08));
                    const dxT = nx2 - bx, dyT = ny2 - by;
                    const nl = Math.hypot(dxT, dyT) || 1;
                    const w = bladeW(f);
                    edgeL.push([bx - (dyT / nl) * w, by + (dxT / nl) * w]);
                    edgeR.push([bx + (dyT / nl) * w, by - (dxT / nl) * w]);
                }
                ctx.fillStyle = dark ? "#2a5a36" : "#357444";
                ctx.beginPath();
                edgeL.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
                for (let k = edgeR.length - 1; k >= 0; k--) ctx.lineTo(edgeR[k][0], edgeR[k][1]);
                ctx.closePath(); ctx.fill();
                ctx.fillStyle = dark ? "rgba(120,190,120,0.16)" : "rgba(150,210,140,0.2)";
                ctx.beginPath();                                   // lit upper half
                edgeL.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
                for (let k = 8; k >= 0; k--) { const [bx, by] = at(k / 8); ctx.lineTo(bx, by); }
                ctx.closePath(); ctx.fill();
                ctx.strokeStyle = dark ? "#23492c" : "#2d6239";    // midrib
                ctx.lineWidth = 1.8 * s; ctx.lineCap = "round";
                ctx.beginPath();
                ctx.moveTo(topX, topY);
                ctx.quadraticCurveTo(midX, midY, tipX, tipY);
                ctx.stroke();
                ctx.strokeStyle = dark ? "#2f6a3b" : "#428a4e";
                ctx.lineWidth = 0.9 * s;
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
            // Height, lean, girth and every limb come from the tile seed —
            // a row of identical skeletons is the fastest way to make a
            // forest look printed on wallpaper.
            const n0 = h(obj.tx, obj.ty, 5), n1 = h(obj.tx, obj.ty, 15), n2 = h(obj.tx, obj.ty, 25);
            const tall = (28 + n1 * 14) * s;
            shadowEllipse(ctx, 10 * s, 3.8 * s, 0.26, tall * 1.05);
            const lean = (n0 - 0.5) * 7 * s;
            const top = -tall;
            const halfBottom = (4.2 + n2 * 1.8) * s;
            const halfTop = halfBottom * (0.38 + n0 * 0.2);
            ctx.fillStyle = "#6a5a48";                 // trunk with a root flare
            ctx.beginPath();
            ctx.moveTo(-halfBottom, 0);
            ctx.quadraticCurveTo(-halfBottom * 0.64, top * 0.47, lean - halfTop, top);
            ctx.lineTo(lean + halfTop, top);
            ctx.quadraticCurveTo(halfBottom * 0.64, top * 0.47, halfBottom, 0);
            ctx.closePath(); ctx.fill();
            ctx.fillStyle = "#857460";
            ctx.beginPath();                            // lit left side
            ctx.moveTo(-halfBottom, 0);
            ctx.quadraticCurveTo(-halfBottom * 0.64, top * 0.47, lean - halfTop, top);
            ctx.lineTo(lean - halfTop * 0.2, top);
            ctx.quadraticCurveTo(-halfBottom * 0.28, top * 0.47, -halfBottom * 0.44, 0);
            ctx.closePath(); ctx.fill();
            ctx.fillStyle = "#4e4134";
            for (let i = 0; i < 5; i++) {               // bark cracks
                const yy = -4 * s - i * (tall / 6);
                ctx.fillRect(-1.5 * s + h(obj.tx, obj.ty, i) * 3 * s, yy, 1 * s, 3.5 * s);
            }
            // Bare limbs: 3–5 of them, alternating sides, thinning upwards.
            const limb = (x1, y1, x2, y2, w) => {
                ctx.strokeStyle = "#6a5a48"; ctx.lineWidth = Math.max(0.8, w); ctx.lineCap = "round";
                ctx.beginPath();
                ctx.moveTo(x1, y1);
                ctx.quadraticCurveTo((x1 + x2) / 2, y1 - Math.abs(y2 - y1) * 0.5, x2, y2);
                ctx.stroke();
            };
            const count = 3 + Math.floor(h(obj.tx, obj.ty, 35) * 2.9);
            for (let i = 0; i < count; i++) {
                const t = 0.42 + (i / count) * 0.52;            // up the trunk
                const side = (i % 2 === 0 ? -1 : 1) * (h(obj.tx + i, obj.ty, 45) > 0.15 ? 1 : -1);
                const y1 = top * t;
                const len = (7 + h(obj.tx, obj.ty + i, 55) * 7) * s * (1.1 - t * 0.5);
                const rise = (4 + h(obj.tx + i, obj.ty + i, 65) * 7) * s;
                const x1 = side * halfTop * 0.8 + lean * t;
                limb(x1, y1, x1 + side * len, y1 - rise, (2.6 - t * 1.4) * s);
                if (h(obj.tx + i, obj.ty, 75) > 0.55) {          // a fork near the end
                    limb(x1 + side * len * 0.7, y1 - rise * 0.7,
                         x1 + side * len * 1.1, y1 - rise * 1.6, (1.3 - t * 0.5) * s);
                }
            }
            ctx.fillStyle = "#3d3327";                  // splintered top
            ctx.beginPath();
            ctx.moveTo(lean - halfTop, top); ctx.lineTo(lean - halfTop * 0.3, top - 4 * s);
            ctx.lineTo(lean + halfTop * 0.4, top - 1 * s); ctx.lineTo(lean + halfTop, top - 3.5 * s);
            ctx.lineTo(lean + halfTop, top);
            ctx.closePath(); ctx.fill();
            break;
        }

        case "burnt_tree": {
            // A trunk the fire went through: thick, black, split at the top,
            // grey ash on the windward side, stubs where branches burned off.
            shadowEllipse(ctx, 11 * s, 4 * s, 0.38, propHeight(kind, s));
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
            // Scale: a stump is what is LEFT of a trunk, so it must read as
            // narrower than `burnt_tree` (half-width 6 u) and far shorter than
            // any standing tree. 0.66 puts the body at ~12.5 u across.
            ctx.save();
            ctx.scale(0.66 * s, 0.66 * s);
            // A sawn-off trunk the fire ate into. The thing that makes a stump
            // readable is the CUT FACE: an ellipse of growth rings seen from
            // three quarters. Everything else is support for it.
            const sw = 9.5, sh = 11;
            shadowEllipse(ctx, sw + 2, 3.8, 0.34, propHeight(kind, s));
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
            ctx.restore();
            break;
        }

                case "burnt_beam": {
            // A fallen roof beam. Length, angle, how deeply it burned and
            // where it split all come from the tile seed: seven identical
            // black bricks laid at the same angle was the giveaway that the
            // ruin was built by a loop.
            {
                const n0 = h(obj.tx, obj.ty, 11), n1 = h(obj.tx, obj.ty, 21), n2 = h(obj.tx, obj.ty, 31);
                const len = 20 + n0 * 16, thick = 5 + n1 * 3.5;
                const ang = (n2 - 0.5) * 2.4;
                shadowEllipse(ctx, len * 0.5, thick * 0.6, 0.28, propHeight(kind, s));
                ctx.save(); ctx.rotate(ang);
                ctx.fillStyle = "#211b18";                      // charred body
                ctx.beginPath();
                ctx.moveTo(-len / 2, -thick);
                ctx.lineTo(len / 2 - 2 - n0 * 3, -thick + n1);
                ctx.lineTo(len / 2, 0.6);
                ctx.lineTo(-len / 2 + 1, 0);
                ctx.closePath(); ctx.fill();
                ctx.fillStyle = "#3a322c";                      // dusty top face
                ctx.beginPath();
                ctx.moveTo(-len / 2, -thick);
                ctx.lineTo(len / 2 - 2 - n0 * 3, -thick + n1);
                ctx.lineTo(len / 2 - 4, -thick + n1 + 2.2);
                ctx.lineTo(-len / 2 + 1.5, -thick + 2.4);
                ctx.closePath(); ctx.fill();
                // Cracks across the char — the grain the fire opened up.
                ctx.fillStyle = "#4e4239";
                const cracks = 3 + Math.floor(n1 * 4);
                for (let i = 0; i < cracks; i++) {
                    const f = (i + 0.5) / cracks;
                    const cx = -len / 2 + len * f + (h(obj.tx + i, obj.ty, 41) - 0.5) * 3;
                    ctx.fillRect(cx, -thick + 1, 0.9, thick - 1.4);
                }
                // The splintered end, where it broke off the roof.
                ctx.fillStyle = "#171210";
                ctx.beginPath();
                ctx.moveTo(len / 2 - 2 - n0 * 3, -thick + n1);
                ctx.lineTo(len / 2 + 2, -thick * 0.5);
                ctx.lineTo(len / 2, 0.6);
                ctx.closePath(); ctx.fill();
                // Ash collected along the lee side.
                if (n2 > 0.4) {
                    ctx.fillStyle = "rgba(188,180,168,0.22)";
                    ctx.beginPath();
                    ctx.ellipse(-len * 0.1, 1.2, len * 0.42, 2.2, 0, 0, Math.PI * 2);
                    ctx.fill();
                }
                ctx.restore();
            }
            break;
        }

        case "rock": case "ore_rock": {
            // Archetype, palette and outline all come from the tile seed, so
            // a scree slope is a scree slope and not the same stone stamped
            // twenty times (see ROCK above).
            const n0 = h(obj.tx, obj.ty, 9), n1 = h(obj.tx, obj.ty, 23), n2 = h(obj.tx, obj.ty, 37);
            const arch = pick(ROCK.kinds, h(obj.tx, obj.ty, 113))[0];
            const rockType = pick(ROCK.stone, h(obj.tx, obj.ty, 127));
            const base = rockType[1];
            const warm = (n0 - 0.5) * 16;
            const dim = kind === "ore_rock" ? -12 : 0;
            const tone = [base[0] + warm + dim, base[1] + warm * 0.8 + dim, base[2] + warm * 0.5 + dim];
            const grow = (ROCK.grow[0] + n1 * (ROCK.grow[1] - ROCK.grow[0])) * s;
            const flip = n2 > 0.5 ? -1 : 1;

            // The pool belongs to THIS stone: a slab's shadow is wide and
            // thin, a shard's is small. Anything bigger reads as a hole.
            const foot = ROCK.radius * grow * 0.92;
            shadowEllipse(ctx, foot, foot * 0.30, 0.30,
                          propHeight(kind, s) * grow * (ROCK.aspect[arch] || 0.8) * 1.2);
            ctx.save();
            ctx.scale(flip, 1);
            if (arch === "cluster") {
                // Little ones first, so the big stone sits in front of them.
                ctx.save(); ctx.translate(-7 * grow, -1.5 * grow);
                stoneBody(ctx, obj.tx * 5 + 1, obj.ty * 3, grow * 0.52, tone, "boulder");
                ctx.restore();
                ctx.save(); ctx.translate(8 * grow, -0.5 * grow);
                stoneBody(ctx, obj.tx + 7, obj.ty * 9 + 2, grow * 0.44, tone, "shard");
                ctx.restore();
            }
            const geo = stoneBody(ctx, obj.tx, obj.ty, grow, tone, arch, obj.ore || null);
            if (arch === "cluster") {
                ctx.save(); ctx.translate(6 * grow, 1.5 * grow);
                stoneBody(ctx, obj.tx * 11, obj.ty + 5, grow * 0.38, tone, "slab");
                ctx.restore();
            }
            if (season === "winter") {
                // Snow settles on the upward faces only.
                ctx.fillStyle = "rgba(240,248,255,0.62)";
                ctx.beginPath();
                ctx.ellipse(-geo.rx * 0.12, -geo.ry * 1.5, geo.rx * 0.74, geo.ry * 0.3,
                            -0.12, Math.PI, Math.PI * 2);
                ctx.fill();
            }
            // Chips knocked off the bigger stones, lying around the foot.
            if (n0 > 1 - ROCK.chips) {
                ctx.fillStyle = css(tone[0] - 16, tone[1] - 16, tone[2] - 16);
                for (let i = 0; i < 3; i++) {
                    const a = 0.3 + h(obj.tx + i, obj.ty, 131) * 2.6;
                    const d = geo.rx * (0.85 + h(obj.tx, obj.ty + i, 137) * 0.5);
                    const cx = Math.cos(a) * d, cy = Math.sin(a) * geo.ry * 0.5;
                    if (cy < -geo.ry * 0.2) continue;
                    ctx.beginPath();
                    ctx.ellipse(cx, cy, 1.6 + h(obj.tx, obj.ty, 139 + i) * 2,
                                1 + h(obj.tx, obj.ty, 149 + i) * 1.1, a, 0, Math.PI * 2);
                    ctx.fill();
                }
            }
            ctx.restore();
            break;
        }

        case "ruin_wall": {
            shadowEllipse(ctx, 14, 5, 0.3, propHeight(kind, s));
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
            // A shrub, not a green blob: woody stems, clumps of foliage on a
            // seeded dome, pointed leaf dabs on the sunward side, berries
            // hanging where there are leaves to hang from.
            const n0 = h(obj.tx, obj.ty, 11), n1 = h(obj.tx, obj.ty, 21);
            const wide = (9 + n0 * 5) * s, high = (11 + n1 * 6) * s;
            shadowEllipse(ctx, wide * 1.05, wide * 0.34, 0.26, high * 1.1);
            const winter = season === "winter";
            const autumn = season === "autumn";
            const pal = jitterPalette(autumn ? ["#9a6a28", "#7d551f", "#c08a39"]
                                             : ["#3f6b33", "#30542a", "#6a9c4c"], obj.tx, obj.ty);
            // Stems first — they show between the clumps and in winter they
            // are the whole plant.
            ctx.strokeStyle = "#4a3a24"; ctx.lineCap = "round";
            const stems = 3 + Math.floor(h(obj.tx, obj.ty, 31) * 3);
            for (let i = 0; i < stems; i++) {
                const a = (i / (stems - 1 || 1) - 0.5) * 1.5 + (h(obj.tx + i, obj.ty, 41) - 0.5) * 0.4;
                const len = high * (0.55 + h(obj.tx, obj.ty + i, 51) * 0.5);
                ctx.lineWidth = (1.6 - i * 0.12) * s;
                ctx.beginPath();
                ctx.moveTo(0, 0);
                ctx.quadraticCurveTo(Math.sin(a) * len * 0.3, -len * 0.55,
                                     Math.sin(a) * len * 0.75, -len);
                ctx.stroke();
            }
            if (!winter) {
                // Clumps on a dome, each its own size and offset.
                const clumps = 5 + Math.floor(h(obj.tx, obj.ty, 61) * 3);
                const place = [];
                for (let i = 0; i < clumps; i++) {
                    const t = (i + 0.5) / clumps;
                    const a = Math.PI + t * Math.PI;
                    const r = wide * (0.52 + h(obj.tx + i, obj.ty, 71) * 0.5);
                    place.push([
                        Math.cos(a) * wide * 0.72 + (h(obj.tx, obj.ty + i, 81) - 0.5) * 2.4 * s,
                        -high * 0.52 + Math.sin(a) * high * 0.4,
                        r * 0.62
                    ]);
                }
                ctx.fillStyle = pal[1];
                for (const [bx, by, br] of place) {
                    ctx.beginPath(); ctx.ellipse(bx + 0.8, by + 1.4, br, br * 0.82, 0, 0, Math.PI * 2); ctx.fill();
                }
                ctx.fillStyle = pal[0];
                for (const [bx, by, br] of place) {
                    ctx.beginPath(); ctx.ellipse(bx, by, br * 0.9, br * 0.74, 0, 0, Math.PI * 2); ctx.fill();
                }
                // Leaf dabs: light on the sunward shoulder, dark in the hollow.
                for (let i = 0; i < 22; i++) {
                    const na = h(obj.tx * 5 + i, obj.ty, 91), nb = h(obj.tx, obj.ty * 7 + i, 97);
                    const a = na * Math.PI * 2, rad = Math.sqrt(nb);
                    const lx = Math.cos(a) * wide * 0.78 * rad;
                    const ly = -high * 0.52 + Math.sin(a) * high * 0.38 * rad;
                    const sun = lx < 0 && ly < -high * 0.45;
                    ctx.fillStyle = sun ? pal[2] : pal[1];
                    ctx.globalAlpha = sun ? 0.6 : 0.4;
                    ctx.beginPath();
                    ctx.ellipse(lx, ly, (1 + na * 1.3) * s, (0.7 + nb * 0.8) * s, a, 0, Math.PI * 2);
                    ctx.fill();
                }
                ctx.globalAlpha = 1;
                if (obj.berries) {
                    const count = 4 + Math.floor(h(obj.tx, obj.ty, 101) * 6);
                    for (let i = 0; i < count; i++) {
                        const na = h(obj.tx + i * 3, obj.ty, 103), nb = h(obj.tx, obj.ty + i * 5, 107);
                        const bx = (na - 0.5) * wide * 1.5;
                        const by = -high * (0.3 + nb * 0.55);
                        ctx.strokeStyle = "rgba(60,44,26,0.6)"; ctx.lineWidth = 0.6 * s;
                        ctx.beginPath(); ctx.moveTo(bx, by - 2 * s); ctx.lineTo(bx, by); ctx.stroke();
                        ctx.fillStyle = "#5f1a33";
                        ctx.beginPath(); ctx.arc(bx, by + 0.6 * s, 1.7 * s, 0, Math.PI * 2); ctx.fill();
                        ctx.fillStyle = "#a6325f";
                        ctx.beginPath(); ctx.arc(bx, by, 1.6 * s, 0, Math.PI * 2); ctx.fill();
                        ctx.fillStyle = "rgba(255,190,210,0.75)";
                        ctx.fillRect(bx - 0.8 * s, by - 1 * s, 1 * s, 1 * s);
                    }
                }
            } else {
                // Winter: bare twigs with a little snow caught in the fork.
                ctx.fillStyle = "rgba(238,246,252,0.7)";
                for (let i = 0; i < 4; i++) {
                    const nx = (h(obj.tx + i, obj.ty, 111) - 0.5) * wide;
                    const ny = -high * (0.4 + h(obj.tx, obj.ty + i, 113) * 0.5);
                    ctx.beginPath(); ctx.ellipse(nx, ny, 2.2 * s, 1.1 * s, 0, 0, Math.PI * 2); ctx.fill();
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
            shadowEllipse(ctx, 9, 2.6, 0.22, propHeight(kind, s));
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
            shadowEllipse(ctx, 11, 2.6, 0.22, propHeight(kind, s));
            ctx.save(); ctx.rotate(-0.18);
            ctx.fillStyle = "#a89880"; ctx.fillRect(-12, -5, 24, 5);
            ctx.fillStyle = "#c3b49c"; ctx.fillRect(-12, -5, 24, 1.5);
            ctx.fillStyle = "#8a7c66";
            for (let i = 0; i < 4; i++) ctx.fillRect(-10 + i * 6, -4, 1, 4);
            ctx.restore();
            break;
        }

        case "tent": {
            // Canvas sags, it does not stretch over a ruler. Ridge dips in
            // the middle, the walls bow out, the hem buckles on the ground,
            // and the whole thing is seeded so no two camps look stamped.
            const n0 = h(obj.tx, obj.ty, 11), n1 = h(obj.tx, obj.ty, 23);
            const W = 21 + n0 * 3, Hh = 28 + n1 * 4;
            const sagK = 1.6 + n0 * 1.4;
            shadowEllipse(ctx, W * 1.1, 7, 0.34, propHeight(kind, s));
            // Silhouette with bowed walls and a dipped ridge.
            const wall = (dir) => {
                ctx.beginPath();
                ctx.moveTo(dir * W, 0);
                ctx.quadraticCurveTo(dir * W * 0.62, -Hh * 0.46, dir * 1.2, -Hh + sagK);
                ctx.lineTo(0, -Hh);
                ctx.lineTo(0, 0);
                ctx.closePath();
            };
            ctx.fillStyle = "#6a5a40"; wall(1); ctx.fill();
            ctx.fillStyle = "#8a7449"; wall(-1); ctx.fill();          // sunward side
            ctx.fillStyle = "rgba(0,0,0,0.16)";                        // far half dims
            ctx.beginPath();
            ctx.moveTo(W * 0.45, 0);
            ctx.quadraticCurveTo(W * 0.62, -Hh * 0.46, 1.2, -Hh + sagK);
            ctx.lineTo(0, -Hh); ctx.lineTo(W * 0.45, 0);
            ctx.closePath(); ctx.fill();
            // Folds: each one hangs from the ridge and fades out at the hem.
            for (let i = -3; i <= 3; i++) {
                if (!i) continue;
                const t = i / 3;
                const foot = t * W * 0.9 + (h(obj.tx + i, obj.ty, 31) - 0.5) * 2;
                const head = t * 2.2;
                ctx.strokeStyle = i < 0 ? "rgba(255,240,210,0.13)" : "rgba(0,0,0,0.15)";
                ctx.lineWidth = 0.9 + Math.abs(t) * 0.6;
                ctx.beginPath();
                ctx.moveTo(foot, -1);
                ctx.quadraticCurveTo(foot * 0.55, -Hh * 0.5, head, -Hh + sagK + 1);
                ctx.stroke();
            }
            // Stitched seam along the ridge and a patch sewn on the cloth.
            ctx.strokeStyle = "rgba(60,48,32,0.5)"; ctx.lineWidth = 0.8;
            ctx.setLineDash([1.6, 1.8]);
            ctx.beginPath();
            ctx.moveTo(-W * 0.86, -1.5);
            ctx.quadraticCurveTo(0, -3.2 - n1, W * 0.86, -1.5);
            ctx.stroke();
            ctx.setLineDash([]);
            if (n1 > 0.4) {
                ctx.fillStyle = "rgba(118,98,66,0.9)";
                ctx.fillRect(-W * 0.55, -Hh * 0.52, 5.5, 4.4);
                ctx.strokeStyle = "rgba(52,42,28,0.55)"; ctx.lineWidth = 0.6;
                ctx.setLineDash([1.2, 1.4]);
                ctx.strokeRect(-W * 0.55, -Hh * 0.52, 5.5, 4.4);
                ctx.setLineDash([]);
            }
            // Door: rolled back to one side, dark inside, bedroll showing.
            ctx.fillStyle = "#15110c";
            ctx.beginPath();
            ctx.moveTo(-7, 0);
            ctx.quadraticCurveTo(-5.5, -11, 0, -17);
            ctx.quadraticCurveTo(5.5, -11, 7, 0);
            ctx.closePath(); ctx.fill();
            ctx.fillStyle = "#2b2319";
            ctx.beginPath();
            ctx.moveTo(-7, 0); ctx.quadraticCurveTo(-5, -10, -1.5, -14.5);
            ctx.lineTo(0, 0); ctx.closePath(); ctx.fill();
            // The door flap, rolled up and tied off to the side.
            ctx.fillStyle = "#86714d";
            ctx.beginPath();
            ctx.ellipse(7.6, -7.5, 2.3, 7.4, 0.12, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = "rgba(255,240,210,0.16)";
            ctx.beginPath();
            ctx.ellipse(6.8, -7.5, 0.9, 6.8, 0.12, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = "rgba(0,0,0,0.24)";
            ctx.beginPath();
            ctx.ellipse(8.8, -7.5, 0.8, 6.6, 0.12, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = "rgba(58,47,33,0.75)"; ctx.lineWidth = 0.9;
            for (const ty2 of [-11.5, -4]) {                            // ties
                ctx.beginPath();
                ctx.moveTo(5.2, ty2); ctx.lineTo(10, ty2 + 0.6);
                ctx.stroke();
            }
            // Ridge pole, guy lines under tension, pegs.
            ctx.strokeStyle = "#4a3c2a"; ctx.lineWidth = 1.4; ctx.lineCap = "round";
            ctx.beginPath(); ctx.moveTo(0, -Hh); ctx.lineTo(0, -Hh - 4); ctx.stroke();
            ctx.lineWidth = 0.9;
            for (const dir of [-1, 1]) {
                ctx.beginPath();
                ctx.moveTo(dir * 1.2, -Hh + sagK + 1);
                ctx.quadraticCurveTo(dir * (W * 0.8), -Hh * 0.34, dir * (W + 7), 4);
                ctx.stroke();
                ctx.fillStyle = "#3a2f21";
                ctx.fillRect(dir * (W + 7) - 1.5, 3, 3, 2.2);
            }
            // Hem shadow: the cloth meets the ground, it does not hover.
            ctx.fillStyle = "rgba(0,0,0,0.26)";
            ctx.beginPath(); ctx.ellipse(0, 0.6, W * 0.96, 2.6, 0, 0, Math.PI * 2); ctx.fill();
            // A bedroll peeking out of the door.
            ctx.fillStyle = "#7d6a4e";
            ctx.beginPath(); ctx.ellipse(0, -2, 6, 2.4, 0, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = "rgba(255,240,210,0.16)";
            ctx.beginPath(); ctx.ellipse(-1.6, -2.8, 3.4, 1.2, 0, 0, Math.PI * 2); ctx.fill();
            break;
        }

        case "hearth_ruin": {
            // The stove outlived the house: scorched brick, a cold black mouth
            // and soot licking up the chimney. It is a landmark, so it is big.
            ctx.save();
            ctx.scale(1.25, 1.25);
            shadowEllipse(ctx, 17, 6, 0.36, propHeight(kind, s));
            ctx.fillStyle = "#7d5d4c"; ctx.fillRect(-14, -26, 28, 26);
            // Courses of brick: every brick its own tone, length and a
            // chipped corner or two. A grid of identical rectangles was the
            // thing that made the stove look printed on the ground.
            for (let r = 0; r < 6; r++) {
                const rowShift = (r % 2 ? 3.5 : 0) + (h(obj.tx, obj.ty + r, 17) - 0.5) * 1.6;
                let bx = -14 + rowShift - 7;
                while (bx < 14) {
                    const k = h(obj.tx + Math.round(bx), obj.ty + r, 7);
                    const bw = 5.2 + k * 2.6;
                    const x1 = Math.max(-14, bx), x2 = Math.min(14, bx + bw);
                    if (x2 > x1) {
                        const by = -25 + r * 4.4 + (k - 0.5) * 0.5;
                        ctx.fillStyle = k > 0.7 ? "#916b56" : k > 0.35 ? "#775849" : "#5f453a";
                        ctx.fillRect(x1, by, x2 - x1, 3.6);
                        ctx.fillStyle = "rgba(255,236,206,0.1)";       // lit top edge
                        ctx.fillRect(x1, by, x2 - x1, 0.7);
                        if (k > 0.82) {                                 // chipped corner
                            ctx.fillStyle = "rgba(40,30,26,0.4)";
                            ctx.fillRect(x2 - 1.4, by + 2.2, 1.4, 1.4);
                        }
                    }
                    bx += bw + 0.8;
                }
            }
            // Fire-blackened brick creeps up from the mouth.
            ctx.fillStyle = "rgba(22,18,16,0.3)";
            ctx.beginPath();
            ctx.moveTo(-10, 0);
            ctx.quadraticCurveTo(-7, -16, 0, -22);
            ctx.quadraticCurveTo(7, -16, 10, 0);
            ctx.closePath(); ctx.fill();
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
            shadowEllipse(ctx, 7, 2, 0.24, propHeight(kind, s));
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
            // Planks, iron and wear. A chest is a box the player will walk up
            // to and look at, so it gets grain, bands with rivets and a hasp.
            const n0 = h(obj.tx, obj.ty, 13), n1 = h(obj.tx, obj.ty, 27);
            shadowEllipse(ctx, 12, 4, 0.3, propHeight(kind, s));
            const W2 = 11, bodyTop = -13;
            ctx.fillStyle = "#5e4428"; ctx.fillRect(-W2, bodyTop, W2 * 2, 13);
            // Vertical planks with their own tone and grain.
            for (let i = 0; i < 5; i++) {
                const px2 = -W2 + i * (W2 * 2 / 5);
                const k = h(obj.tx + i, obj.ty, 33);
                ctx.fillStyle = `rgba(${Math.round(104 + k * 26)},${Math.round(76 + k * 20)},${Math.round(44 + k * 14)},0.55)`;
                ctx.fillRect(px2 + 0.3, bodyTop + 0.5, W2 * 2 / 5 - 0.8, 12.2);
                ctx.fillStyle = "rgba(40,28,16,0.35)";
                ctx.fillRect(px2, bodyTop + 0.5, 0.6, 12.2);
                ctx.strokeStyle = "rgba(48,34,20,0.3)"; ctx.lineWidth = 0.5;
                ctx.beginPath();
                ctx.moveTo(px2 + 1.4, bodyTop + 2 + k * 2);
                ctx.quadraticCurveTo(px2 + 2.4, bodyTop + 6, px2 + 1.2, bodyTop + 11);
                ctx.stroke();
            }
            ctx.fillStyle = "rgba(0,0,0,0.26)";                 // shaded right flank
            ctx.fillRect(W2 - 3.4, bodyTop, 3.4, 13);
            // Domed lid.
            ctx.fillStyle = "#4a3620";
            ctx.beginPath(); ctx.ellipse(0, bodyTop, W2, 5, 0, Math.PI, Math.PI * 2); ctx.fill();
            ctx.fillStyle = "#8a6a3c";
            ctx.beginPath(); ctx.ellipse(0, bodyTop - 0.5, W2, 4.4, 0, Math.PI, Math.PI * 2); ctx.fill();
            ctx.fillStyle = "rgba(255,232,190,0.2)";            // light along the dome
            ctx.beginPath(); ctx.ellipse(-2.5, bodyTop - 1.6, 6.5, 2.4, -0.18, Math.PI, Math.PI * 2); ctx.fill();
            // Iron bands with rivets, hasp and lock.
            const band2 = (y, hgt) => {
                ctx.fillStyle = "#3c3a40"; ctx.fillRect(-W2 - 1, y, W2 * 2 + 2, hgt);
                ctx.fillStyle = "rgba(255,255,255,0.14)"; ctx.fillRect(-W2 - 1, y, W2 * 2 + 2, 0.6);
                ctx.fillStyle = "#232226";
                for (let i = 0; i < 6; i++) ctx.fillRect(-W2 + 0.6 + i * 4, y + hgt * 0.3, 0.9, 0.9);
            };
            band2(-9.5, 2.2);
            band2(-4, 1.8);
            ctx.fillStyle = "#3c3a40"; ctx.fillRect(-2.5, -11.5, 5, 7.5);
            ctx.fillStyle = "#c8b060"; ctx.fillRect(-1.5, -8.4, 3, 3);   // brass lock
            ctx.fillStyle = "rgba(255,248,200,0.5)"; ctx.fillRect(-1.2, -8.1, 1, 1);
            ctx.fillStyle = "rgba(20,16,12,0.6)"; ctx.fillRect(-0.5, -7.2, 1, 1.4);
            // Wear: a chipped corner and moss at the foot on older chests.
            if (n0 > 0.5) {
                ctx.fillStyle = "rgba(40,28,16,0.5)";
                ctx.beginPath();
                ctx.moveTo(-W2, -2.5); ctx.lineTo(-W2 + 3, 0); ctx.lineTo(-W2, 0);
                ctx.closePath(); ctx.fill();
            }
            if (n1 > 0.6) {
                ctx.fillStyle = "rgba(96,122,66,0.3)";
                ctx.beginPath(); ctx.ellipse(-4, -0.4, 5, 1.4, 0, 0, Math.PI * 2); ctx.fill();
            }
            break;
        }

        case "campfire": {
            // Fire ring only; flames are drawn live by the renderer.
            // Chunky field stones set into the soil — never flat petals.
            shadowEllipse(ctx, 14, 5, 0.22, propHeight(kind, s));
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
            shadowEllipse(ctx, 7, 2.4, 0.22, 7);
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
