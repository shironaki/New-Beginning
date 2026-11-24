/** Small, authored head silhouette; adult proportions, not a rectangular mask.
 * Coordinates are normalised to head width/height. Shared by all characters. */
import { BODY, GAIT, sexOf, q } from "./charspec.js";
function shade(c, amount) {
    const n = parseInt(c.slice(1), 16);
    return `rgb(${[n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.max(0, Math.min(255, v + amount))).join(",")})`;
}
export function drawHead(ctx, { x, y, dir, slant = 0, look, time }) {
    const w = BODY.headW * sexOf(look).head, h = BODY.headH, side = dir === "left" ? -1 : 1;
    const profile = dir === "left" || dir === "right", back = dir === "up";
    const quarter = profile ? Math.min(1, Math.abs(slant)) : 0;
    const away = profile && slant < -0.5;
    const polygon = (points, colour) => {
        ctx.fillStyle = colour; ctx.beginPath();
        points.forEach(([a, b], i) => { const xx = q(a * w), yy = q(b * h); if (i) ctx.lineTo(xx, yy); else ctx.moveTo(xx, yy); });
        ctx.closePath(); ctx.fill();
    };
    ctx.save(); ctx.translate(q(x), q(y));
    // Neck is narrow and visible above the shirt collar.
    polygon([[-0.19, 0.86], [0.2, 0.85], [0.23, 1.2], [-0.19, 1.2]], shade(look.skin, -20));
    if (profile) ctx.scale(side, 1);
    polygon([[-0.31, 0.04], [0.22, 0], [0.43, 0.21], [0.43, 0.51],
        [profile ? 0.58 - quarter * 0.1 : 0.43, 0.62], [0.37, 0.74], [0.26, 0.93], [-0.08, 0.98],
        [-0.37, 0.77], [-0.46, 0.38]], look.skin);
    polygon([[0.28, 0.28], [0.43, 0.24], [0.43, 0.66], [0.26, 0.93], [-0.08, 0.98],
        [-0.1, 0.86], [0.2, 0.79]], shade(look.skin, -25));
    polygon([[-0.36, 0.36], [-0.1, 0.25], [-0.12, 0.61], [-0.29, 0.73]], shade(look.skin, 14));
    if (profile) polygon([[-0.27, 0.5], [-0.08, 0.45], [-0.05, 0.7], [-0.22, 0.75]], shade(look.skin, -13));
    const hair = look.hair;
    polygon([[-0.48, 0.53], [-0.52, 0.16], [-0.31, -0.03], [0.06, -0.11],
        [0.38, 0.01], [0.5, 0.24], [0.27, 0.29], [0.11, 0.18], [-0.05, 0.35],
        [-0.28, 0.3], [-0.3, 0.57]], hair);
    polygon([[-0.42, 0.13], [-0.16, 0], [0.07, 0.01], [-0.03, 0.13], [-0.36, 0.24]], shade(hair, 21));
    if (back) {
        polygon([[-0.47, 0.28], [0.44, 0.19], [0.42, 0.73], [0.2, 0.91],
            [0.02, 0.84], [-0.21, 0.91], [-0.43, 0.68]], hair);
        polygon([[0.27, 0.23], [0.44, 0.27], [0.41, 0.71], [0.2, 0.9], [0.18, 0.55]], shade(hair, -18));
    } else {
        const blink = time % GAIT.blinkEvery < GAIT.blinkFor;
        ctx.fillStyle = "#3c3027";
        const eye = (a) => {
            ctx.fillRect(q(a * w), q(0.48 * h), q(profile ? 0.16 * w : 0.12 * w), blink ? 0.5 : 0.8);
            ctx.fillStyle = shade(hair, 8);
            ctx.fillRect(q(a * w - 0.3), q(0.37 * h), profile ? 1.5 : 1.2, 0.5);
        };
        if (profile) {
            if (!away) eye(0.24);
            if (slant > 0.5) eye(-0.14);
        } else { eye(-0.3); eye(0.15); }
        if (!profile) {
            polygon([[0, 0.55], [0.09, 0.71], [-0.04, 0.74], [-0.09, 0.66]], shade(look.skin, -28));
        }
        if (look.stubble) polygon([[-0.29, 0.75], [-0.05, 0.79], [0.34, 0.73], [0.22, 0.92], [-0.07, 0.96]], shade(look.skin, -38));
        ctx.fillStyle = shade(look.skin, -46);
        ctx.fillRect(q((profile ? 0.23 : -0.09) * w), q(0.8 * h), 1.1, 0.5);
    }
    if (away) polygon([[-0.48, 0.28], [0.18, 0.22], [0.15, 0.64], [-0.04, 0.87], [-0.33, 0.81], [-0.46, 0.63]], hair);
    if (look.hairStyle === "long") polygon([[-0.48, 0.3], [-0.31, 0.36], [-0.27, 1.07], [-0.52, 1.01]], hair);
    if (look.hairStyle === "braid") {
        for(let i=0;i<6;i++) {
            ctx.fillStyle=i%2?shade(hair,14):hair;ctx.beginPath();
            ctx.ellipse(-w*.4+Math.sin(time*1.7+i*.3)*.18,h*.8+i*.65,.9,.65,.2,0,Math.PI*2);ctx.fill();
        }
        ctx.fillStyle=look.accent;ctx.fillRect(-w*.4-.8,h*.8+3.6,1.6,.8);
    }
    if(look.hairStyle === "long") polygon([[-.49,.4],[-.28,.65],[-.27,1.28],[-.57,1.21]],hair);
    // Причёска — это силуэт, а не цвет. «Хвост», «пучок» и «ёжик» живут на
    // затылке (-x = назад) и обязаны быть видны со спины: иначе выбор в
    // редакторе ничего не меняет в кадре, а именно это и было претензией.
    const style = look.hairStyle;
    if (style === "buzz") {
        // Сбитый в ноль волос ниже и светлее: шапка остаётся, но висок и
        // затылок отдают кожей — на 42-пиксельной фигуре это единственный
        // способ отличить «ёжик» от «коротких».
        const bare = shade(look.skin, -10);
        if (back) polygon([[-0.42, 0.46], [0.42, 0.42], [0.44, 0.92], [-0.42, 0.94]], bare);
        else {
            polygon([[-0.46, 0.32], [-0.3, 0.28], [-0.3, 0.64], [-0.46, 0.68]], bare);
            if (!profile) polygon([[0.3, 0.28], [0.46, 0.32], [0.46, 0.68], [0.3, 0.64]], bare);
        }
    }
    if (style === "bun") {
        // Пучок обязан сидеть на черепе, а не висеть рядом: сзади по центру и
        // чуть сдвинутый назад в профиль и анфас.
        const bx = back ? 0 : -0.2, by = back ? -0.02 : -0.1;
        ctx.fillStyle = shade(hair, -10);
        ctx.beginPath(); ctx.ellipse(q(bx * w), q(by * h), q(w * 0.24), q(h * 0.22), 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = hair;
        ctx.beginPath(); ctx.ellipse(q(bx * w), q(by * h - 0.4), q(w * 0.19), q(h * 0.17), 0, 0, Math.PI * 2); ctx.fill();
    }
    if (style === "ponytail") {
        // Три звена с раскачкой: хвост должен жить, а не быть пятном. Частота и
        // фаза те же, что у косы, чтобы две «живые» детали не пульсировали вразнобой.
        for (let i = 0; i < 5; i += 1) {
            const sway = Math.sin(time * 1.7 + i * 0.5) * 0.2;
            ctx.fillStyle = i % 2 ? shade(hair, -14) : hair;
            ctx.beginPath();
            ctx.ellipse(q((back ? -0.1 - i * 0.08 : -0.44 - i * 0.07) * w + sway),
                q((0.2 + i * 0.38) * h), q(w * (0.19 - i * 0.025)), q(h * (0.17 - i * 0.02)), 0.2, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.fillStyle = look.accent;
        ctx.fillRect(q((back ? -0.08 : -0.44) * w), q(0.1 * h), q(w * 0.16), 1);
    }
    ctx.restore();
}
