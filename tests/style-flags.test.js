/**
 * Блок 73 — стиль из меню, а не только из адресной строки.
 *
 * Проверяется то, из-за чего это вообще завели: приоритет адреса над сохранённым
 * выбором (иначе ссылка сравнения врёт), запись и чтение через хранилище и
 * молчаливая стойкость к битому JSON в приватном режиме.
 */
import { suite, test, assert, run } from "./tiny.js";
import { loadStyle, saveStyle, styleKey } from "../js/ui/styleflags.js";

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

test("человеческая строка стиля описывает оба выключателя", () => {
    assert.ok(styleKey({ props3d: "off", hero3d: "smooth" }).includes("кривые"));
    assert.ok(styleKey({ props3d: "on", hero3d: "grade" }).includes("модели"));
});

test("тон кадра приходит из адреса и попадает в стиль", () => {
    const s = loadStyle({}, "?props3dTone=winter");
    assert.eq(s.props3dTone, "winter", "сравнение погоды на одном дереве — без пересборки");
});

await run("style-flags");
