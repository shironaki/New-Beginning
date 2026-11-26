/**
 * ui/styleflags.js — переключатели стиля, доступные без адресной строки.
 *
* До сих пор «3D-пропы» и «риг героя» включались только параметром в URL
 * (?props3d=off, ?hero3d=smooth). Живой 3D — тот же переключатель: ?hero3d=live. На телефоне адресной строки нет — и игрок
 * оставался с тем стилем, который выбрал один раз при запуске. Здесь общий
 * источник правды для всех: параметр адреса > сохранённый выбор > значение по
 * умолчанию. Параметр адреса сознательно главенствует: ссылка сравнения
 * («вот как выглядит без 3D») должна работать одинаково в любом браузере,
 * независимо от того, что кто-то когда-то нажимал в меню.
 */
const KEY = "***";

const parseQuery = (search) => {
    const out = {};
    try {
        const p = new URLSearchParams(search);
        const props = p.get("props3d"), hero = p.get("hero3d"), tone = p.get("props3dTone");
        if (props === "off" || props === "vector") out.props3d = "off";
        else if (props === "on" || props === "model") out.props3d = "on";
        if (hero === "off" || hero === "grade" || hero === "smooth" || hero === "live") out.hero3d = hero;
        if (tone) out.props3dTone = tone;
    } catch { /* нет URL — нет и переопределения */ }
    return out;
};

const readStore = () => {
    try {
        const raw = globalThis.localStorage?.getItem(KEY);
        const obj = raw ? JSON.parse(raw) : null;
        return obj && typeof obj === "object" ? obj : {};
    } catch { return {}; }        // приватный режим, переполнение, битый JSON
};

/**
 * Что играет в этом браузере прямо сейчас. fallback — значения по умолчанию
 * (их задаёт bootstrap: он один знает, что «по умолчанию» значит для 3D-рига).
 */
export function loadStyle(fallback = {}, search = globalThis.location?.search || "") {
    return { ...fallback, ...readStore(), ...parseQuery(search) };
}

/** Запомнить выбор. Возвращает то, что реально лежит в хранилище. */
export function saveStyle(patch) {
    const next = { ...readStore(), ...patch };
    try { globalThis.localStorage?.setItem(KEY, JSON.stringify(next)); } catch { /* тише, чем падение игры */ }
    return next;
}

/**
 * Забыть сохранённый выбор. Нужно ровно для одного случая: сохранённый стиль
 * что-то сломал (или ломает запуск), а у владельца ни адресной строки, ни
 * консоли — на телефоне это единственный способ вернуться к значениям по
 * умолчанию, не чивя хранилище руками.
 */
export function clearStyle() {
    try { globalThis.localStorage?.removeItem(KEY); } catch { /* приватный режим — там и так пусто */ }
    return true;
}

/** Ключ для штампа сборки: видно, что меню и адрес строки не разошлись. */
export function styleKey(style) {
    return `пропы ${style.props3d === "off" ? "кривые" : "модели"} · риг ${style.hero3d || "по умолчанию"}`;
}
