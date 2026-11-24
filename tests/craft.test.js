/**
 * tests — ремесло как единственный способ выбраться из первого дня.
 *
 * Сюжет здесь не в рецептах, а в порядке: без топора дерево не свалить, топор
 * нигде не лежит — значит крафт обязан быть доступен голыми руками из того, что
 * поднимается на пляже. Тесты держат именно эту цепочку, плюс границы: место под
 * результат, огонь как инструмент, списание материалов до начала работы (сейв в
 * середине крафта не должен печатать топоры) и постройки в сохранении.
 */
import { suite, test, assert, run } from "./tiny.js";
import { ITEMS, itemDef } from "../js/sandbox/items.js";
import { PROPS, requiredTool, propDef } from "../js/sandbox/gather.js";
import { RECIPES, recipeById, checkRecipe, craftCost, needPick, craftPlan, craftTime } from "../js/sandbox/craft.js";
import { Inventory } from "../js/sandbox/inventory.js";
import { Campfire } from "../js/survival/campfire.js";
import { TILE_SIZE } from "../js/world/tiles.js";

const WORK = new Set(["chop", "mine", "gather"]);

suite("craft data");

test("recipes only reference items and props that exist", () => {
    for (const r of RECIPES) {
        assert.ok(r.id && r.name && r.emoji, `${r.id}: паспорт неполный`);
        assert.ok(!r.place || r.out === undefined, `${r.id}: либо постройка, либо предмет`);
        for (const need of r.needs) {
            assert.gt(need.n, 0, `${r.id}: пустая потребность`);
            for (const id of (need.id ? [need.id] : need.any)) assert.ok(itemDef(id), `${r.id}: нет предмета ${id}`);
        }
        for (const [id, n] of r.out || []) {
            assert.ok(itemDef(id), `${r.id}: результат ${id} не существует`);
            assert.gt(n, 0);
            assert.lte(n, ITEMS[id].stack, `${r.id}: ${id}×${n} не влезет в стек`);
        }
        assert.ok(!r.place || PROPS[r.place], `${r.id}: постройка ${r.place} не описана в мире`);
        if (r.tool) assert.ok(["axe", "pick", "knife", "hoe", "rod"].includes(r.tool), `${r.id}: неизвестный инструмент`);
        assert.ok(WORK.has(r.work || "gather"), `${r.id}: жест ${r.work} не запечён в спрайт`);
        assert.gte(r.time, 1, `${r.id}: работу нельзя сделать быстрее секунды`);
    }
});

test("nothing in the first chain needs a tool you cannot craft", () => {
    // Камень, бревно и волокно поднимаются голыми руками — значит топор доступен.
    const inv = new Inventory({ slots: 12 });
    inv.add("stone", 2); inv.add("firewood", 2); inv.add("fiber", 2);
    assert.ok(checkRecipe(inv, recipeById("axe_stone")).ok, "каменный топор нельзя сваять без инструментов");
    // ...а кирка уже требует топор: топорище стесывают, а не ломают.
    const pick = checkRecipe(inv, recipeById("pick_stone"));
    assert.not(pick.ok, "кирка не должна быть доступна без топора");
    assert.eq(pick.needTool, "axe");
});

test("a tag need prefers the common material and saves the rare one", () => {
    const inv = new Inventory({ slots: 12 });
    inv.add("flint", 1); inv.add("stone", 6);
    assert.deep(needPick(inv, { any: ["stone", "flint"], n: 2 }), [["stone", 2]],
        "крафт съедает кремень, хотя камней завались");
});

test("cost and time: a better tool shortens the work", () => {
    const inv = new Inventory({ slots: 12 });
    inv.add("log", 2); inv.add("stone", 4); inv.add("fiber", 4); inv.add("firewood", 4);
    assert.deep(craftCost(inv, recipeById("axe_stone")), [["stone", 2], ["firewood", 2], ["fiber", 2]]);
    const r = recipeById("plank");
    assert.gt(craftTime(r, 1), craftTime(r, 2), "более высокий тир инструмента не ускоряет работу");
});

test("craftPlan puts what you can do first", () => {
    const inv = new Inventory({ slots: 12 });
    inv.add("fiber", 9);
    const plan = craftPlan(inv);
    assert.eq(plan[0].recipe.id, "rope", "верёвка из трёх пучков волокна должна быть первой");
    assert.ok(plan.every((p) => "ok" in p && Array.isArray(p.missing)));
});

/* ------------------------------------------------------------------ в игре */

const dom = (await import("./dom-harness.js")).installDOM();
const { Game } = await import("../js/main.js");
const { startCraft, openCraft, startPickup } = await import("../js/ui/hands.js");
const { snapshotWorld, restoreWorld } = await import("../js/world/persistence.js");

function boot(seed = "craft-valley") {
    const g = new Game({ canvas: dom.doc.getElementById("game"), hudRoot: dom.doc.getElementById("hud"), seed });
    for (let i = 0; i < 4; i++) { g.update(1 / 60); g.render(); }
    // Свободная клетка перед героем: иначе проверка упирается в то, что
    // генератор посадил на это место в этом сиде.
    g.placeSafely(g.zone.spawn.x, g.zone.spawn.y);
    const at = g.player.facingPoint(22);
    g.zone.clearTile(Math.floor(at.x / TILE_SIZE), Math.floor(at.y / TILE_SIZE));
    return g;
}

/** Довести начатую работу до конца: крафт живёт в handAction, как еда. */
function finish(g, maxFrames = 1200) {
    for (let i = 0; i < maxFrames && g.inventory.handAction; i++) { g.update(1 / 60); g.render(); }
    assert.not(g.inventory.handAction, "работа зависла и не отдала руки");
}

suite("craft in the real game");

test("materials are spent up front and the hero works with the right gesture", () => {
    const g = boot();
    g.inventory.add("stone", 4); g.inventory.add("log", 2); g.inventory.add("fiber", 4); g.inventory.add("firewood", 4);
    const before = g.inventory.count("stone");
    assert.ok(startCraft(g, "axe_stone"), "крафт топора отказал при полных материалах");
    assert.eq(g.inventory.count("stone"), before - 2, "материалы списались только по окончании");
    assert.eq(g.player.actionKind, "gather", "жест не совпадает с описанием рецепта");
    assert.gt(g.player.actionTimer, 0, "замаха нет — герой крафтится стоя");
    finish(g);
    assert.ok(g.inventory.has("axe_stone"), "топор не появился");
});

test("the starting zone bootstraps stone and wood without any tool", () => {
    const g = boot();
    const loose = (id) => g.zone.objects.filter((o) => !o.depleted && !o.removed && requiredTool(o.kind) === null
        && (propDef(o.kind)?.drops || []).some(([item]) => item === id));
    for (const id of ["stone", "firewood", "fiber"]) {
        assert.gt(loose(id).length, 0, `${id} в стартовой локации нечем добыть голыми руками`);
    }
    const pile = loose("stone")[0];
    g.player.x = pile.x; g.player.y = pile.y + 16;
    g.harvest(pile);
    for (let i = 0; i < 240 && !g.inventory.has("stone"); i++) {
        if (!g.inventory.handAction) startPickup(g, pile);
        g.update(1 / 60); g.render();
    }
    assert.ok(g.inventory.has("stone"), "камень с осыпи не доехал до рюкзака");
});

test("the axe unlocks the trees, and wood becomes planks", () => {
    const g = boot();
    // Порода не важна — важен запрет: любое дерево в долине просит топор.
    const tree = g.zone.objects.find((o) => requiredTool(o.kind) === "axe" && !o.depleted && !o.removed);
    assert.ok(tree, "в долине нет ни одного дерева, которое просит топор");
    // Встать вплотную: подбор добычи проверяет расстояние, и проверка эта
    // правильная — с другого конца долины пень не ощупаешь.
    g.player.x = tree.x; g.player.y = tree.y + 16;
    assert.ok(/топор/i.test(g.interactLabel(tree) || ""), "дерево открыто без топора");
    g.inventory.add("stone", 4); g.inventory.add("log", 2); g.inventory.add("fiber", 4); g.inventory.add("firewood", 4);
    assert.ok(startCraft(g, "axe_stone")); finish(g);
    assert.not(/топор/i.test(g.interactLabel(tree) || ""), "топор не открыл дерево");
    for (let i = 0; i < 10 && !tree.depleted; i++) { g.harvest(tree); g.update(1 / 60); g.render(); }
    assert.ok(tree.depleted, "дерево не валится за десять ударов топора");
    // Добыча лежит на пне, её поднимают руками: как игрок, ждём и тыкаем E.
    for (let i = 0; i < 400 && tree.loot?.length; i++) {
        if (!g.inventory.handAction) startPickup(g, tree);
        g.update(1 / 60); g.render();
    }
    assert.gte(g.inventory.count("charcoal") + g.inventory.count("firewood"), 2, "дерево не отдало добычу");
    assert.ok(startCraft(g, "plank"), "из бревна нельзя выпиловать доски топором");
    finish(g);
    assert.ok(g.inventory.has("plank"), "доски не появились");
});

test("a campfire is built in front of the hero and survives a save", () => {
    const g = boot();
    g.inventory.add("stone", 6); g.inventory.add("firewood", 4);
    assert.ok(startCraft(g, "campfire"), "кострище не крафтится");
    finish(g);
    const built = g.zone.objects.filter((o) => o.built);
    assert.eq(built.length, 1, "постройка не появилась в мире");
    assert.ok(g.fires.has(g.fireKey(g.zone, built[0])), "у кострища нет своего огня");

    const back = restoreWorld(g.seed, snapshotWorld(g.world));
    const zone = back.get(g.zone.id);
    assert.eq(zone.objects.filter((o) => o.built).length, 1, "постройка потерялась при загрузке");
});

test("a refusal gives the materials back", () => {
    const g = boot();
    g.inventory.add("stone", 6); g.inventory.add("firewood", 4);
    const spy = g.buildProp;
    g.buildProp = () => null;                 // место оказалось занято
    assert.ok(startCraft(g, "campfire"));
    finish(g);
    g.buildProp = spy;
    assert.eq(g.inventory.count("stone"), 6, "отказ не вернул камни");
    assert.eq(g.inventory.count("firewood"), 4, "отказ не вернул хворост");
    assert.eq(g.zone.objects.filter((o) => o.built).length, 0);
});

test("you cannot build into a wall", () => {
    const g = boot();
    // Не ищем конкретную воду: в этом сиде её может не быть. Берём любую
    // клетку, которая строиться не пускает, но рядом с которой стоят, —
    // это и есть стена (обрыв, глубокая вода, край карты).
    let wall = null;
    for (let ty = 1; ty < g.zone.h - 1 && !wall; ty++) for (let tx = 1; tx < g.zone.w - 1; tx++) {
        if (g.zone.isFree(tx, ty)) continue;
        if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => g.zone.isFree(tx + dx, ty + dy))) { wall = { tx, ty }; break; }
    }
    assert.ok(wall, "в тестовой локации нет ни одной недоступной клетки");
    g.inventory.add("stone", 6); g.inventory.add("firewood", 4);
    g.player.facingPoint = () => ({ x: wall.tx * TILE_SIZE + 16, y: wall.ty * TILE_SIZE + 16 });
    assert.eq(g.buildProp("campfire"), null, "кострище влезло в стену");
    assert.ok(startCraft(g, "campfire")); finish(g);
    assert.eq(g.zone.objects.filter((o) => o.built).length, 0, "стройка сквозь отказ всё-таки встала");
    assert.eq(g.inventory.count("stone"), 6, "отказ не вернул камни");
    assert.eq(g.inventory.count("firewood"), 4, "отказ не вернул хворост");
});

test("fire-only recipes wait for a lit campfire", () => {
    const g = boot();
    g.inventory.add("firewood", 4); g.inventory.add("resin", 4);
    const spot = { kind: "campfire", x: g.player.x, y: g.player.y + 20, tx: 0, ty: 0 };
    g.zone.objects.push(spot);
    const fire = new Campfire({ bus: g.bus });
    g.fires.set(g.fireKey(g.zone, spot), fire);
    assert.not(g.nearLitFire(), "огонь нашёлся там, где его не зажигали");
    assert.not(startCraft(g, "torch"), "факел крафтится без костра");
    fire.addFuel("firewood"); fire.light();
    assert.ok(fire.lit && g.nearLitFire(), "костёр в двух шагах не виден рецепту");
    assert.ok(startCraft(g, "torch"), "у горящего костра факел не делается");
    finish(g);
    assert.gte(g.inventory.count("torch"), 2, "факелы не появились");
});

test("the world tells you where the missing tool comes from", () => {
    const g = boot();
    const gated = g.zone.objects.find((o) => requiredTool(o.kind) === "axe" && !o.depleted && !o.removed);
    assert.ok(gated, "в пепелище нет ни одного дерева под топор");
    const label = g.interactLabel(gated);
    assert.ok(/топор/.test(label) && label.length < 40, `подпись цели слишком длинная для HUD: ${label}`);
    g.player.x = gated.x; g.player.y = gated.y + 16;
    g.interact = gated; g.doInteract();
    const pile = g.hud.els.toasts.children;
    const said = pile.length ? (pile[pile.length - 1].innerHTML || "") : "";
    assert.ok(/Ремесл/.test(said) || /крафт/.test(said), `тост не объясняет, где брать топор: ${said}`);
    assert.ok(/2× Камень|камень/i.test(said), "в тосте нет состава рецепта");
});

test("the panel lists reasons, not dead buttons", () => {
    const g = boot();
    openCraft(g);
    assert.eq(g.hud.panelOpen, "craft", "панель ремесла не открылась");
    assert.gt(g.hud._panelRows.length, RECIPES.length, "в панели меньше строк, чем рецептов");
    g.hud.closePanel();
    assert.not(g.hud.isPanelOpen, "панель не закрывается");
});

run();
