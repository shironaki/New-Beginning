/**
 * tests/browser-boot.test.js — запускается ли игра в БРАУЗЕРЕ, а не только в node.
 *
 * Bootstrap в `js/main.js` живёт внутри `if (typeof document !== "undefined"
 * && typeof window !== "undefined")`, и ни один другой тест его не исполняет:
 * именно так висячий `if (!trial)` — остаток удалённого пилота — пережил
 * несколько блоков и выдал владельцу чёрный экран без единого объяснения. Здесь
 * тот же путь проходится по-настоящему: ловушка берётся из index.html как есть,
 * DOM — общий harness, событие DOMContentLoaded — настоящее.
 */
import { suite, test, assert, run } from "./tiny.js";
import { installDOM } from "./dom-harness.js";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const TRAP = (html.match(/<script>([\s\S]*?)<\/script>/) || [])[1] || "";

/** Окно, в котором браузерный bootstrap может дойти до первого кадра. */
function browser() {
    const dom = installDOM();
    const win = dom.win;
    win.devicePixelRatio = 1;
    win.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
    win.visualViewport = { width: 960, height: 540, addEventListener() {}, removeEventListener() {} };
    const frames = [], timers = [];
    win.requestAnimationFrame = (fn) => { frames.push(fn); return frames.length; };
    win.cancelAnimationFrame = () => {};
    win.setTimeout = (fn, ms) => { timers.push(fn); return timers.length; };
    globalThis.requestAnimationFrame = win.requestAnimationFrame;
    globalThis.cancelAnimationFrame = win.cancelAnimationFrame;
    // Ловушка ставит watchdog на 15 секунд; в тесте он не должен будить процесс.
    globalThis.setTimeout = win.setTimeout;
    assert.ok(TRAP.length > 200, "в index.html нет встроенного скрипта-ловушки");
    // eslint-disable-next-line no-new-func — скрипт читается из файла как есть,
    // иначе тест проверяет копию, а не то, что играет в браузере.
    new Function("window", "document", "performance", "localStorage", "location", TRAP)(
        win, globalThis.document, globalThis.performance || { now: () => 0 },
        globalThis.localStorage, win.location);
    return { win, doc: globalThis.document, frames, timers, elements: dom.elements };
}
const flush = async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); };

/* Bootstrap вешается на DOMContentLoaded в момент исполнения модуля, поэтому
   каждый сценарий обязан получить СВОЁ исполнение: `?boot=n` — тот же файл для
   ESM уже другой модуль. Без этого второй тест молча слушал чужое окно. */
let bootSeq = 0;
async function boot(b) {
    // Слушатель bootstrap — async: его падение становится unhandledRejection,
    // и без сбора этого процесса тест убивал бы весь `npm test` молча. Теперь
    // причина попадает в утверждение и в отчёт печатается строкой.
    let boom = null;
    const grab = (e) => { boom = e; };
    process.on("unhandledRejection", grab);
    try {
        await import(`../js/main.js?boot=${++bootSeq}`);
        b.win.dispatch("DOMContentLoaded", {});
        await flush();
        await new Promise((r) => setImmediate(r));
    } catch (e) { boom = e; }
    process.off("unhandledRejection", grab);
    if (boom) throw boom;
}

suite("browser bootstrap");

test("ловушка в index.html ставит обработчики ДО подключения модуля", () => {
    assert.ok(html.indexOf("window.__bootFail =") < html.indexOf('src="js/main.js"'),
        "после модуля обработчик уже не ловит ошибку линковки ESM");
    assert.ok(/window\.addEventListener\("error"/.test(TRAP));
    assert.ok(/unhandledrejection/.test(TRAP), "отклонённый промис bootstrap — тоже чёрный экран");
    assert.ok(/setTimeout\(/.test(TRAP), "watchdog: «запустилась и молчит» обязано отличаться от «упала»");
    const b = browser();
    assert.ok(b.win.__boot && b.win.__boot.stages.length === 0, "ловушка обязана стартовать пустой");
    assert.ok(b.timers.length >= 1, "watchdog не поставлен");
});

test("bootstrap доходит до первого кадра и ни на чём не падает", async () => {
    const b = browser();
    let thrown = null;
    try {
        await boot(b);
    } catch (e) { thrown = e; }
    assert.eq(thrown && /is not defined/.test(thrown.message) ? thrown.message : null, null,
        "висячая ссылка в bootstrap — это и есть чёрный экран без объяснений");
    assert.eq(thrown && thrown.message, null, `bootstrap бросил: ${thrown && thrown.message}`);
    assert.ok(b.win.GAME, "window.GAME — признак того, что игра собрана и стиль применён");
    const stages = b.win.__boot.stages.join(" → ");
    assert.ok(/игра собрана/.test(stages), `до «игра собрана» не дошло: ${stages}`);
    assert.ok(/стиль применён/.test(stages), `стиль не применён: ${stages}`);
    assert.ok(/start\(\) вызван/.test(stages), `игра не стартовала: ${stages}`);
    // Первый кадр — то, чего ждёт watchdog.
    b.frames.forEach((fn) => fn(0));
    await flush();
    assert.eq(b.win.__boot.started, true, `флаг первого кадра не выставлен; стадии: ${stages}`);
    assert.eq(b.win.__boot.error, null, "ловушка не должна кричать на удачном запуске");
});

test("если страница не та — на экране текст, а не чёрная дыра", async () => {
    const b = browser();
    // Убираем канвас: раньше здесь был молчаливый `return`, и превью молчало.
    b.doc.getElementById = () => null;
    await boot(b);
    const box = b.doc.documentElement.children.find((el) => el.getAttribute("role") === "alert");
    assert.ok(box, "красный блок не показан — значит пустой экран снова не объяснён");
    assert.ok(/нет #game\/#hud/.test(box.querySelector("#bootErr").textContent),
        "в блоке нет причины — только стек бесполезен");
    assert.ok(/дошло до/.test(box.innerHTML), "в блоке нет списка стадий");
});

test("падение после загрузки тоже попадает на экран, а не в консоль", async () => {
    const b = browser();
    b.win.dispatch("error", { error: Error("сломанный кадр") });
    const box = b.doc.documentElement.children.find((el) => el.getAttribute("role") === "alert");
    assert.ok(box, "ошибка окна не выведена на экран");
    assert.ok(/сломанный кадр/.test(box.querySelector("#bootErr").textContent));
    // Кнопка сброса обязана быть: на телефоне это единственный выход, если
    // сохранённый вид ломает запуск.
    const reset = box.querySelector("#bootReset");
    assert.ok(/nb\.style\.v1/.test(html), "сброс чистит не тот ключ");
    assert.ok(reset, "в блоке нет кнопки сброса сохранённого вида");
});

await run("browser-boot");
