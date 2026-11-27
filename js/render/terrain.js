/** Natural ground is one continuous surface, baked in world coordinates.
 * No overlapping per-tile coastline/cliff rectangles. Built floors keep their
 * authored square geometry; water animation queries the very same field.
 */
import { waterIce } from "../world/water-state.js";
import { T, tileInfo } from "../world/tiles.js";
import { groundPalette, paintTile, paintSnowGround } from "./tilesart.js";
import { woodedEdge } from "../world/edges.js";
import { receivesSnow } from "../world/surface.js";
const built = new Set([T.PLANK, T.COBBLE, T.FARM, T.FARM_WET]);
/** Земля, на которой что-то растёт: она ровная и тёплая, не в кляксах.
 *  Один набор на модуль — раньше этот список пересобирался на каждый пиксель,
 *  а в запёке их ~200 тысяч на чанк. */
const LIVING = new Set([T.GRASS, T.MEADOW, T.MOSS, T.PINE_FLOOR, T.GRASS_DRY]);
/** Открытый грунт: его красят пятнами. Пол и булыжник остаются своими. */
const OPEN_GROUND = new Set([T.ASH, T.SOOT, T.DIRT, T.MUD, T.SAND, T.GRAVEL, T.STONE,
    T.GRASS, T.MEADOW, T.PINE_FLOOR, T.GRASS_DRY]);
/** Выжженное покрытие: свои пятна (уголь, а не перегной) и свой слой мусора. */
const scorched = new Set([T.ASH, T.SOOT]);
const parse = (s) => s.startsWith("#") ? [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16)) : s.match(/\d+/g).slice(0, 3).map(Number);
const clamp = (n) => Math.max(0, Math.min(255, Math.round(n)));
/** Дешёвый целый шум 0..1: четыре узла решётки, как у valueNoise, не нужны. */
function hash2(x, y, s = 0) {
    let n = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 2246822519)) | 0;
    n = (Math.imul(n ^ (n >>> 13), 1274126177)) | 0;
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

/** Continuous optical depth: do not derive colour from the solid/not-solid threshold. */
export function seaColour(distance) {
    const stops = [[0, [160, 177, 146]], [20, [112, 170, 161]], [52, [64, 143, 160]],
        [96, [43, 107, 139]], [180, [29, 67, 99]]];
    const d = Math.max(0, distance || 0);
    for (let i = 1; i < stops.length; i++) if (d <= stops[i][0]) {
        const [a, ca] = stops[i - 1], [b, cb] = stops[i];
        let t = (d - a) / (b - a); t = t * t * (3 - 2 * t);
        return ca.map((v, k) => v + (cb[k] - v) * t);
    }
    return stops[stops.length - 1][1].slice();
}

export function terrainColour(field, wx, wy, season, palette) {
    const s = field.sample(wx, wy), water = tileInfo(s.id).liquid;
    let r = 0, g = 0, b = 0, sum = 0;
    for (const [id, w] of s.weights) {
        if (tileInfo(id).liquid !== water || (id === T.CLIFF) !== (s.id === T.CLIFF)) continue;
        const c = palette[id]; r += c[0] * w; g += c[1] * w; b += c[2] * w; sum += w;
    }
    if (sum) { r /= sum; g /= sum; b /= sum; }
    else [r, g, b] = palette[s.id];
    // Зерно земли. Печёный рельеф получал две октавы на ±6 ярк. ед., тогда как
    // `paintTile` даёт тайловой земле ±24: из-за этого любой биом выглядел
    // закрашенным листом. Теперь четыре октавы — патчи, пятна, крупицы, — но
    // дешёвые: пиксельный шум берётся целочисленным хешем, а не valueNoise
    // (тот на каждую выборку читает четыре узла решётки), и сдвиг домена —
    // синусом. Иначе запёк чанка дорожает вдвое, а чанки пекутся на ходу.
    const living = LIVING.has(s.id);
    const blotchy = s.id === T.ASH || s.id === T.SOOT || s.id === T.DIRT || s.id === T.MUD;
    const rocky = s.id === T.STONE;
    const sandy = s.id === T.SAND || s.id === T.GRAVEL;
    const amp = blotchy ? 18 : rocky ? 16 : sandy ? 11 : living ? 12 : 10;
    // Доменный сдвиг: value-noise без него даёт пятно с квадратными углами
    // (уровневые линии совпадают с осями решётки). Синус дешевле ещё одного
    // шума, а рваность границы даёт ровно ту же.
    const warpX = Math.sin(wy * 0.055 + Math.sin(wx * 0.021) * 1.4) * 22;
    const warpY = Math.sin(wx * 0.047 - Math.sin(wy * 0.019) * 1.4) * 22;
    const macro = field.noise(wx + warpX, wy + warpY, 57, 82) - 0.5;
    const meso = field.noise(wx + warpX * 0.5, wy + warpY * 0.5, 21, 83) - 0.5;
    const patch = field.noise(wx + warpX * 0.25, wy + warpY * 0.25, 9, 85) - 0.5;
    const grain = field.noise(wx, wy, 6.5, 81) - 0.5;
    // Ступень с дизером. Непрерывный шум читается «облаками», шум по пикселю —
    // статикой; пиксель-арт живёт между: плоские тона пятна, а граница ступени
    // рассыпана в 1 px. Зерно (grain/pix) кванту не подлежит — иначе шуршит.
    const pix = hash2(wx, wy, 401);
    const blot = macro * (amp * 0.3) + meso * (amp * 0.42) + patch * (amp * 0.5);
    const quant = amp * 0.5;
    let tone = Math.round((blot + (pix - 0.5) * quant * 0.8) / quant) * quant
        + grain * (amp * 0.18) + (hash2(wx, wy, 84) - 0.5) * (amp * 0.1);
    if (rocky) {
        // Камень — это плита, а не песок: у него трещины. Узкая складка по
        // волне даёт линию разлома, и плита перестаёт быть серой кашей.
        const seam = Math.abs(Math.sin(wx * 0.062 + Math.sin(wy * 0.031) * 1.9 + field.noise(wx, wy, 40, 86) * 3.4));
        tone -= Math.max(0, 0.22 - seam) * 150;
        const seam2 = Math.abs(Math.sin(wy * 0.048 - Math.sin(wx * 0.024) * 1.3 + field.noise(wx, wy, 33, 87) * 2.7));
        tone -= Math.max(0, 0.16 - seam2) * 120;
    }
    // Тон уходит в тепло/холод вместе с пятном, а не отдельно от него.
    const warm = meso * (living ? 18 : 9);
    r += warm; g += warm * 0.45; b -= warm * 0.7;
    if (water) {
        if (field.biome === "shore") [r, g, b] = seaColour(s.coast);
        const ice = waterIce(field.map, wx, wy, s.id);
        if (ice.cover > 0) {
            // Unsafe depth is OPEN dark water with separated plates, never the
            // same continuous pale floor as walkable shallow/fresh ice.
            const fractures = Math.abs(Math.sin(wx * .055 + Math.sin(wy * .035)) * Math.sin(wy * .061 + Math.cos(wx * .027)));
            const coverage = ice.broken ? (fractures > .32 ? Math.min(.52, ice.cover) : .03) : ice.cover;
            const c = ice.broken ? [108, 142, 157] : [194, 216, 225];
            r += (c[0] - r) * coverage; g += (c[1] - g) * coverage; b += (c[2] - b) * coverage;
            if (ice.broken) { r *= .72; g *= .78; b *= .88; }
        }
        tone *= 0.45;
        if (s.water < 0.58) {
            const foam = (0.58 - s.water) / 0.08 * 0.28;
            r += (215 - r) * foam; g += (225 - g) * foam; b += (202 - b) * foam;
        }
    } else {
        // Пятна материала поверх тайловой маски. Тайл отвечает за «что это»,
        // пятна — за «какое оно»: сдутый пепел, высыхающий бугор, жирная
        // земля в понижении. Без этого поляна остаётся одним цветом, и кадр
        // читается закрашенным фоном, а не нарисованной землёй.
        const open = OPEN_GROUND.has(s.id);
        if (open) {
            // Пятно материала — жёсткое, как мазок кисти: оно либо есть, либо
            // его нет. Софт-градиент на весь экран читается аэрографом. Пороги
            // берутся из уже посчитанной macro-октавы — отдельного шума не надо.
            const drift = macro + 0.5;
            const paleT = 0.63, deepT = 0.36;
            // Пляж не может быть в пятнах так же, как пепелище: у песка свои
            // правила — только светлая грива, и та вдвое слабее.
            const kStain = scorched.has(s.id) ? 1 : sandy ? 0.4 : living ? 0.85 : 0.7;
            let pale = (drift > paleT ? 0.22 : 0) * kStain;
            let deep = (drift < deepT ? 0.2 : 0) * (sandy ? 0.35 : 1);
            // Граница — зубцом в 1 px по хешу (не по чётности: черёд по чётности
            // даёт «дверную сетку» на весь кадр — артефакт, за который и ругались).
            const near = Math.abs(drift - paleT) < 0.05 || Math.abs(drift - deepT) < 0.05;
            if (near && hash2(wx, wy, 311) > 0.54) pale = Math.max(pale, 0.14 * kStain);
            else if (near) deep = Math.max(deep, 0.11 * (sandy ? 0.35 : 1));
            if (pale > 0 || deep > 0) {
                const [pr, pg, pb] = scorched.has(s.id) ? [216, 205, 184] : living ? [174, 162, 108] : [200, 188, 156];
                const [nr, ng, nb] = scorched.has(s.id) ? [33, 28, 26] : living ? [36, 52, 29] : [62, 50, 37];
                r += (pr - r) * pale + (nr - r) * deep;
                g += (pg - g) * pale + (ng - g) * deep;
                b += (pb - b) * pale + (nb - b) * deep;
            }
        }
        // Actual elevation also affects walking uphill. Hillshade uses the
        // same world-space normal and cannot restart at a chunk edge.
        const elevation = field.shadeElevation || field.elevation;
        const dx = (elevation.call(field, wx + 6, wy) - elevation.call(field, wx - 6, wy)) / 12;
        const dy = (elevation.call(field, wx, wy + 6) - elevation.call(field, wx, wy - 6)) / 12;
        if (field.projected) {
            // Exposed earth along the home shelf: material bands follow
            // HEIGHT, never tile rows. Keep the flat summit ash-covered.
            const bank = Math.max(0, Math.min(1, (Math.hypot(dx, dy) - .10) * 5));
            const strata = Math.max(0, 1 - Math.abs(Math.sin(field.elevation(wx, wy) * .30 + field.noise(wx, wy, 38, 612) * .7)) * 5);
            r += (123 - r) * bank * .7; g += (106 - g) * bank * .7; b += (81 - b) * bank * .7;
            tone += Math.max(-30, Math.min(24, (dx + dy) * 65)) - strata * bank * 10 * Math.max(0, field.noise(wx, wy, 27, 613) * 2 - .8);
        } else tone += Math.max(-16, Math.min(16, (-dx - dy) * 48));
        if (s.cliff > 0.05 && s.cliff < 0.5) tone -= s.cliff * 23;
        if (s.id === T.CLIFF) {
            const edge = Math.min(wx, wy, field.map.widthPx - wx, field.map.heightPx - wy) < 288;
            if (edge && woodedEdge(field.biome)) {
                [r, g, b] = ["ashfall", "ruins"].includes(field.biome) ? [91, 87, 64] : [72, 88, 55];
            }
            const rock = field.noise(wx, wy, 42, 215);
            tone += Math.sin(wy * 0.15 + rock * 9) * 6;
            // Light rim and dark exposed face follow the contour, not tile rows.
            const below = field.sample(wx, wy + 5).cliff;
            const above = field.sample(wx, wy - 4).cliff;
            const face = Math.max(0, Math.min(1, (s.cliff - below) * 7));
            const rim = Math.max(0, Math.min(1, (0.62 - above) * 6));
            tone += 5 - face * 34 + rim * 18;
        }
        if (season === "winter" && (receivesSnow(s.id) || s.id === T.CLIFF)) {
            const cover = Math.max(0.25, field.noise(wx, wy, 70, 553) * 0.8);
            r += (219 - r) * cover; g += (230 - g) * cover; b += (232 - b) * cover;
        }
        if (s.id === T.SAND && season !== "winter" && s.coast > -18) {
            const wet = Math.max(0, Math.min(1, 1 + s.coast / 18)) * 0.65;
            r += (153 - r) * wet; g += (144 - g) * wet; b += (105 - b) * wet;
        } else if (s.water > 0.12) tone -= s.water * 27;
    }
    return [clamp(r + tone), clamp(g + tone), clamp(b + tone)];
}

export function bakeTerrain(ctx, zone, cx, cy, size, season, inset = 0) {
    const stride = size - inset * 2;
    const field = zone.terrain, ox = cx * stride - inset, oy = cy * stride - inset;
    const palette = Object.keys(T).reduce((p, k) => { p[T[k]] = parse(groundPalette(T[k], season)[0]); return p; }, {});
    const pixels = ctx.createImageData(size, size), data = pixels.data;
    const step = 2;
    for (let y = 0; y < size; y += step) for (let x = 0; x < size; x += step) {
        const c = terrainColour(field, ox + x + 1, oy + y + 1, season, palette);
        for (let dy = 0; dy < step; dy++) for (let dx = 0; dx < step; dx++) {
            const at = ((y + dy) * size + x + dx) * 4;
            data[at] = c[0]; data[at + 1] = c[1]; data[at + 2] = c[2]; data[at + 3] = 255;
        }
    }
    ctx.putImageData(pixels, 0, 0);
    // Ground details distributed in world space, never clipped to a tile rim.
    for (let gy = ((3 - oy) % 9 + 9) % 9 - 9; gy < size + 9; gy += 9) for (let gx = ((3 - ox) % 11 + 11) % 11 - 11; gx < size + 11; gx += 11) {
        // Мусор не сидит на решётке: точка сдвинута по хешу, а плотность
        // собрана в кучи отдельным низкочастотным шумом. Ровные промежутки
        // глаз читает как узор, кучи — как землю.
        const x = gx + (field.noise(gx + 11, gy + 7, 6, 913) - 0.5) * 9;
        const y = gy + (field.noise(gx + 5, gy + 13, 6, 917) - 0.5) * 9;
        const wx = Math.round(ox + x), wy = Math.round(oy + y);
        const v = field.noise(wx, wy, 3, 778);
        if (field.noise(wx, wy, 34, 781) < 0.4) continue;
        const s = field.sample(wx, wy);
        if (tileInfo(s.id).liquid && !waterIce(zone.map, wx, wy, s.id).broken && waterIce(zone.map, wx, wy, s.id).cover >= 0.55) {
            if (v > 0.75) {
                ctx.strokeStyle = "rgba(238,248,251,0.65)"; ctx.lineWidth = 0.55;
                ctx.beginPath(); ctx.moveTo(x - 4, y - 3); ctx.lineTo(x, y); ctx.lineTo(x + 6, y - 1);
                ctx.moveTo(x, y); ctx.lineTo(x + 2, y + 4); ctx.stroke();
            }
            continue;
        }
        if (tileInfo(s.id).liquid || s.id === T.CLIFF || built.has(s.id) || v < 0.63) continue;
        if (zone.def.biome === "shore" && s.id === T.SAND && season !== "winter") {
            const wrack = s.coast > -42 && s.coast < -12;
            if (wrack && v > 0.76) {
                ctx.strokeStyle = "rgba(78,84,45,0.55)"; ctx.lineWidth = 0.7;
                ctx.beginPath(); ctx.moveTo(x - 3, y); ctx.lineTo(x, y - 1.4); ctx.lineTo(x + 4, y + 0.5); ctx.stroke();
            } else if (v > 0.86) {
                ctx.fillStyle = "#eee0b7";
                ctx.beginPath(); ctx.ellipse(x, y, 1.6, 1, v * 3, 0, Math.PI * 2); ctx.fill();
                ctx.fillStyle = "#b9a57c"; ctx.fillRect(x, y - 0.8, 0.5, 1.6);
            }
        }
        const living = LIVING.has(s.id);
        // Лесная подстилка: хвоинки и мелкие сучья. Один тёмный квадрат на 11×9 px
        // читался как грязь; теперь это сетчатый слой из двух тонов.
        if (s.id === T.PINE_FLOOR && season !== "winter") {
            ctx.strokeStyle = v > 0.8 ? "rgba(84,66,42,0.5)" : "rgba(40,46,30,0.42)";
            ctx.lineWidth = 0.5;
            ctx.beginPath();
            ctx.moveTo(x - 2, y + v * 2); ctx.lineTo(x + 2, y - v * 2);
            ctx.moveTo(x - 1, y - 1.6); ctx.lineTo(x + 1.4, y + 2);
            ctx.stroke();
            continue;
        }
        ctx.fillStyle = season === "winter" ? "rgba(242,248,251,0.32)" : living ? "rgba(49,65,28,0.22)" : "rgba(22,21,18,0.14)";
        ctx.fillRect(x + v * 4, y - v * 3, living ? 1 : 2, living ? 2 + v * 2 : 1);
        // Выжженная земля помнит пожар: угольки и пепельные подтёки. Без них
        // Пепелище — это ровное серо-коричневое поле, и кадр не читается.
        if (scorched.has(s.id) && season !== "winter") {
            if (v > 0.83) {
                ctx.fillStyle = "rgba(18,16,15,0.62)";
                ctx.fillRect(x + v * 3, y, 2, 1);
                ctx.fillRect(x + v * 3 + 1, y + 1, 1, 1);
            } else if (v > 0.7) {
                ctx.fillStyle = "rgba(226,216,198,0.22)";
                ctx.fillRect(x - 2, y + 1, 3, 1);
            }
        }
    }
    for (let y = Math.floor(oy / 32) * 32 - oy; y < size; y += 32) for (let x = Math.floor(ox / 32) * 32 - ox; x < size; x += 32) {
        const tx = (ox + x) / 32, ty = (oy + y) / 32, id = zone.map.get(tx, ty);
        if (!built.has(id)) continue;
        paintTile(ctx, id, x, y, 32, tx, ty, season, zone.map);
        if (season === "winter") paintSnowGround(ctx, id, x, y, 32, tx, ty);
    }
}

export function drawTerrainWater(ctx, zone, camera, time, daylight) {
    const b = { left: camera.x - 16, top: camera.y - 16, right: camera.x + camera.viewW + 16, bottom: camera.y + camera.viewH + 16 + (zone.playableRelief?.maxHeight || 0) }, z = camera.zoom;
    ctx.save();
    ctx.strokeStyle = `rgba(179,219,215,${0.08 + daylight * 0.12})`; ctx.lineWidth = Math.max(0.7, z * 0.45);
    ctx.beginPath();
    for (let y = Math.floor(b.top / 13) * 13; y <= b.bottom; y += 13) {
        for (let x = Math.floor(b.left / 24) * 24; x <= b.right; x += 24) {
            const xx = x + Math.sin(y * 0.14 + time * 0.6) * 6;
            const yy = y + Math.sin(x * 0.027 + time * 0.7) * 2;
            if (!tileInfo(zone.terrain.sample(xx, yy).id).liquid || !tileInfo(zone.terrain.sample(xx + 9, yy).id).liquid) continue;
            const ice = waterIce(zone.map, xx, yy);
            if (ice.cover >= 0.55 && !ice.broken) continue;
            const p = camera.worldToScreen(xx, yy);
            ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + (5 + Math.sin(time + x) * 3) * z, p.y - z * 0.4);
        }
    }
    ctx.stroke(); ctx.restore();
}
