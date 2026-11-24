/**
 * Редактор внешности.
 *
 * Панель собрана из чипов (`{chip}` у hud.openPanel), а не из строк «нажми —
 * прокрутится следующее значение». Причина прямая: с телефона прокрутка вслепую
 * — игрок не видит, что именно выбрано, и «причёска не выбирается» была
 * претензией номер один. Чип показывает все варианты разом, выбранный
 * подсвечен (aria-pressed), правит только кнопка «Применить».
 *
 * Превью рисует героя три раза — спереди, в профиль и со спины: коса, хвост и
 * пучок существуют только сзади, и показывать их «в лицо» значит врать.
 */
import { DEFAULT_LOOK, drawCharacter } from "../render/character.js";
import { HERO3D } from "../render/hero3d.js";

export const APPEARANCE = {
    gender: [["male", "Мужчина"], ["female", "Женщина"]],
    hairStyle: [["short", "Короткие"], ["long", "Длинные"], ["braid", "Коса"],
        ["ponytail", "Хвост"], ["bun", "Пучок"], ["buzz", "Ёжик"]],
    skin: [["#e0b594", "Светлая"], ["#ba8864", "Смуглая"], ["#80553e", "Тёмная"]],
    hair: [["#302b29", "Тёмные"], ["#825332", "Каштановые"], ["#ba985b", "Светлые"], ["#969b96", "Седые"]],
    coat: [["#446d68", "Хвойный"], ["#785044", "Глина"], ["#526078", "Сумерки"], ["#8e7952", "Песок"]],
    pants: [["#48473e", "Пепел"], ["#3a2f28", "Кора"], ["#35452f", "Мох"], ["#2f3a4a", "Ночь"]],
    accent: [["#c9a063", "Охра"], ["#a95143", "Рябина"], ["#96aaa6", "Туман"]]
};

const NAMES = {
    gender: "Пол", hairStyle: "Причёска", skin: "Кожа", hair: "Волосы",
    coat: "Пальто", pants: "Штаны", accent: "Шарф"
};
/** Форма (пол, причёска) рисуется геометрией; цвет — палитрой листа. */
const SHAPE = new Set(["gender", "hairStyle"]);
/** Ракурсы превью: причёски сзади видно только со спины. */
const ANGLES = [["down", "перед"], ["right", "профиль"], ["up", "спина"]];

export function normalizeLook(value) {
    const out = { ...DEFAULT_LOOK };
    for (const [key, values] of Object.entries(APPEARANCE)) {
        if (value?.[key] !== undefined && !values.some(([v]) => v === value[key])) {
            throw Error("Некорректная внешность");
        }
        out[key] = value?.[key] ?? out[key];
    }
    out.stubble = out.gender === "male";
    return out;
}

/** Случайный образ из тех же списков: честный перебор, а не свой генератор. */
export function randomLook(pick = Math.random) {
    const out = {};
    for (const [key, values] of Object.entries(APPEARANCE)) {
        // До 1.0 включительно быть не должно: floor(1*len) = len → undefined.
        const r = Math.max(0, Math.min(0.999999, pick()));
        out[key] = values[Math.floor(r * values.length)][0];
    }
    return normalizeLook(out);
}

function chipLabel(key, value, name) {
    if (SHAPE.has(key)) return name;
    // Цвета показываем образцом, а не подписью: «Каштановые» и «Светлые» на
    // глаз не отличить, а квадратик цвета — отличает.
    return `<i class="apSwatch" style="background:${value}"></i>${name}`;
}

/** Cosmetic editor with a live rotating preview, apply/cancel and saved values. */
export function openAppearance(game, back = () => game.hud.closePanel(), initial = false) {
    let draft = normalizeLook(game.look);
    const show = () => {
        const rows = [{
            html: '<canvas id="appearancePreview" width="480" height="200" aria-label="Внешность персонажа"></canvas>'
        }];
        for (const [key, values] of Object.entries(APPEARANCE)) {
            rows.push({ caption: NAMES[key] });
            for (const [value, name] of values) {
                rows.push({
                    chip: key,
                    label: chipLabel(key, value, name),
                    selected: draft[key] === value,
                    action: () => {
                        draft[key] = value;
                        // Щетина — часть пола, а не отдельный каприз: у женщины
                        // её быть не может, и хранить её «как было» нельзя.
                        draft.stubble = draft.gender === "male";
                        show();
                    }
                });
            }
        }
        rows.push({
            label: "Случайный образ", icon: "⚄",
            action: () => { draft = randomLook(); show(); }
        });
        // Честность важнее красоты: гладкий риг — это запечённый лист, в нём
        // форма одна, а цвета перекраиваются палитрой. Пока лист подключён,
        // причёски и фигура меняют превью и векторного героя, но не сам лист.
        if (HERO3D.enabled && HERO3D.ready) {
            rows.push({ html: "<p class='panelInfo'>Включён 3D-риг: он перекрашивается по палитре, а причёску и фигуру меняет векторный герой — риг «выкл».</p>" });
        }
        rows.push({
            label: initial ? "Начать путь" : "Применить", icon: "✔",
            action: () => { game.look = normalizeLook(draft); back(); }
        });
        if (!initial) rows.push({ label: "Отмена", icon: "✕", action: back });
        game.hud.openPanel(initial ? "Тот, кто вернулся" : "Внешность", rows, "appearance", { locked: initial });
        paintPreview(game.hud.els.panelBody, draft);
    };
    show();
}

/**
 * Превью: та же функция отрисовки, что и в игре (drawCharacter сама решает,
 * брать запечённый лист или вектор), поэтому панель не может пообещать одно,
 * а показать другое. Три ракурса — потому что выбор причёски иначе не виден.
 */
export function paintPreview(root, look) {
    const canvas = root?.querySelector?.("#appearancePreview");
    const ctx = canvas?.getContext?.("2d");
    if (!ctx) return false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const scale = 3.2, baseY = canvas.height - 14;
    ANGLES.forEach(([dir], i) => {
        ctx.save();
        ctx.translate(Math.round(canvas.width * (0.2 + i * 0.3)), baseY);
        ctx.scale(scale, scale);
        drawCharacter(ctx, { dir, look, idleTime: 1 });
        ctx.restore();
    });
    return true;
}
