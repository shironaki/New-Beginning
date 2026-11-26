/**
 * Блок 73 — стиль из меню, а не только из адресной строки.
 *
 * Проверяется то, из-за чего это вообще завели: приоритет адреса над сохранённым
 * выбором (иначе ссылка сравнения врёт), запись и чтение через хранилище и
 * молчаливая стойкость к битому JSON в приватном режиме.
 */
import { suite, test, assert, run } from "./tiny.js";
import { readFileSync } from "node:fs";
import { loadStyle, saveStyle, styleKey, clearStyle } from "../js/ui/styleflags.js";

// Хранилище как в браузере, но в памяти теста.
const store = new Map();
globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k)
};

suite("приоритет источника стиля");

test("без адреса и без хранилища играют значения по умолчанию", () => {
    store.clear();
    const s = loadStyle({ hero3d: "grade", props3d: "on" }, "");
    assert.eq(s.hero3d, "grade");
    assert.eq(s.props3d, "on");
});

test("выбор из меню запоминается и переживает перезагрузку", () => {
    store.clear();
    saveStyle({ props3d: "off", hero3d: "smooth" });
    const s = loadStyle({ hero3d: "grade", props3d: "on" }, "");
    assert.eq(s.props3d, "off", "пропы должны остаться выключенными");
    assert.eq(s.hero3d, "smooth", "и гладкий риг должен вернуться");
});

test("параметр адреса главнее сохранённого выбора", () => {
    store.clear();
    saveStyle({ props3d: "off" });
    const s = loadStyle({ props3d: "on" }, "?props3d=on");
    assert.eq(s.props3d, "on", "ссылка сравнения обязана работать в любом браузере");
    const off = loadStyle({ props3d: "on" }, "?props3d=off");
    assert.eq(off.props3d, "off");
    const vec = loadStyle({ props3d: "on" }, "?props3d=vector&hero3d=off");
    assert.eq(vec.props3d, "off", "«vector» — тот же смысл, что «off»");
    assert.eq(vec.hero3d, "off");
});

test("незнакомый параметр не портит сохранённый стиль", () => {
    store.clear();
    saveStyle({ hero3d: "smooth" });
    const s = loadStyle({ props3d: "on" }, "?hero3d=luna&props3d=nope");
    assert.eq(s.hero3d, "smooth", "мусор в адресе не должен выключать то, что игрок выбрал");
    assert.eq(s.props3d, "on");
});

test("битое хранилище — не причина не играть", () => {
    store.set("nb.style", "{сломанный");
    const s = loadStyle({ props3d: "on" }, "");
    assert.eq(s.props3d, "on", "должны остаться значения по умолчанию");
    assert.ok(saveStyle({ props3d: "off" }), "и запись после этого обязана пройти");
    assert.eq(loadStyle({}, "").props3d, "off");
});

suite("штамп сборки говорит то же, что меню");

test("кнопка в ловушке запуска чистит ровно тот же ключ", () => {
    // index.html живёт вне модулей и обязан знать то же имя, что и хранилище
    // стиля: разъехались — и «Забыть сохранённый вид» ничего не забывает.
    const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
    assert.ok(/localStorage\.removeItem\("nb\.style\.v1"\)/.test(html), "в index.html нет сброса ключа nb.style.v1");
    assert.ok(html.indexOf("window.__bootFail =") < html.indexOf('src="js/main.js"'), "ловушка обязана стоять до модуля");
});

test("сохранённый вид можно забыть одним пальцем — без консоли", () => {
    // Смысл ровно один: чёрный экран из-за сохранённого стиля обязан иметь
    // выход на телефоне, где нет ни адресной строки, ни разработчика.
    store.clear();
    saveStyle({ hero3d: "smooth", props3d: "off", broken: "?" });
    assert.eq(store.size, 1);
    assert.ok(clearStyle());
    assert.eq(store.size, 0);
    const back = loadStyle({ hero3d: "grade", props3d: "on" }, "");
    assert.eq(back.hero3d, "grade");
    assert.eq(back.props3d, "on");
    assert.eq(back.broken, undefined);
});

test("человеческая строка стиля описывает оба выключателя", () => {
    assert.ok(styleKey({ props3d: "off", hero3d: "smooth" }).includes("кривые"));
    assert.ok(styleKey({ props3d: "on", hero3d: "grade" }).includes("модели"));
});

test("тон кадра приходит из адреса и попадает в стиль", () => {
    const s = loadStyle({}, "?props3dTone=winter");
    assert.eq(s.props3dTone, "winter", "сравнение погоды на одном дереве — без пересборки");
});

test("живой 3D — такой же переключатель, как грейд и гладкий", () => {
    const s = loadStyle({ hero3d: "grade", props3d: "on" }, "?hero3d=live");
    assert.eq(s.hero3d, "live", "?hero3d=live обязан читаться: иначе «лист ↔ live» сравнивается только из кода");
    assert.eq(saveStyle({ hero3d: "live" }).hero3d, "live", "выбор с телефона обязан переживать перезагрузку");
    assert.ok(styleKey({ hero3d: "live", props3d: "on" }).includes("live"), "меню и штамп показывают одно и то же");
});

await run("style-flags");
