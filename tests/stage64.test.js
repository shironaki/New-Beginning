import { test, assert, run } from "./tiny.js";
import fs from "node:fs";
import path from "node:path";
import { NoteOutbox } from "../js/dev/note-outbox.js";
import { createServer, storeNote, noteIdentity, noteStem } from "../serve.js";
import { MemoryStorage } from "../js/core/save.js";
import { Campfire } from "../js/survival/campfire.js";
import { Inventory } from "../js/sandbox/inventory.js";
import { startPotFromInventory, canReceive } from "../js/survival/cooking-actions.js";
import { Renderer } from "../js/render/renderer.js";
import { installDOM, FakeElement } from "./dom-harness.js";
const dom = installDOM();
const { Game } = await import("../js/main.js");
const note = (i = 1) => ({ text: `report ${i}`, at: "2026-10-09T06:00:00Z", zone: "shore", x: i, y: 2 });
const ack = { ok: true, pushed: true, file: "receipt.md" };
function boot() {
    const g = new Game({ canvas: new FakeElement("canvas"), hudRoot: new FakeElement(), seed: 1066618561 });
    g.save.storage = new MemoryStorage(); g.hud.hideStory(); return g;
}
const click = (g, text) => {
    const row = g.hud._panelRows.find((r) => r.innerHTML.includes(`>${text}</span>`));
    assert.ok(row, text); row.dispatch("click");
};
const temp = () => { fs.mkdirSync(".artifacts", { recursive: true }); return fs.mkdtempSync(path.resolve(".artifacts/notes-test-")); };
test("legacy queue migrates without dropping reports above forty; delivery leaves an exportable archive", async () => {
    const s = new MemoryStorage(); s.setItem("notes", JSON.stringify(Array.from({ length: 80 }, (_, i) => note(i))));
    const q = new NoteOutbox(s, "notes"); assert.eq(q.read().length, 80);
    assert.eq(await q.flush(async () => ack), 80); assert.eq(q.read().length, 0); assert.eq(q.all().length, 80);
    assert.eq(new NoteOutbox(s, "notes").all().length, 80);
});
test("HTTP success and disk-only success never acknowledge Git delivery", async () => {
    const q = new NoteOutbox(new MemoryStorage(), "notes"); q.push(note());
    for (const receipt of [null, { ok: true }, { ok: true, file: "x", pushed: false }, { ok: false, pushed: true, file: "x" }]) {
        assert.eq(await q.flush(async () => receipt), 0); assert.eq(q.read().length, 1);
    }
    assert.eq(await q.flush(async () => ack), 1); assert.eq(q.read().length, 0);
});
test("concurrent flushes share one request and never overwrite reports added during await", async () => {
    const q = new NoteOutbox(new MemoryStorage(), "notes"); q.push(note(1));
    let finish, requests = 0;
    const a = q.flush(() => { requests++; return new Promise((r) => { finish = r; }); });
    const b = q.flush(() => { throw Error("duplicate request"); }); assert.eq(a, b);
    q.push(note(2)); finish(ack); await a;
    assert.eq(requests, 1); assert.eq(q.read().length, 1); assert.eq(q.read()[0].x, 2);
});
test("quota pressure discards pictures but preserves every text and receipt", async () => {
    const s = new MemoryStorage(); const set = s.setItem.bind(s);
    s.setItem = (key, value) => { if (value.includes('"shot":')) throw Error("quota"); set(key, value); };
    const q = new NoteOutbox(s, "notes");
    assert.ok(q.push({ ...note(), shot: "data:image/png;base64,abc" })); assert.ok(q.picturesDropped);
    assert.eq(q.all()[0].text, note().text); assert.ok(q.all()[0].shotOmitted);
    await q.flush(async () => ack); assert.eq(new NoteOutbox(s, "notes").read().length, 0);
});
test("unavailable storage returns failure, keeps text in memory, and never claims persistence", () => {
    const q = new NoteOutbox({ getItem: () => null, setItem: () => { throw Error("disabled"); } }, "notes");
    assert.not(q.push(note())); assert.ok(q.lastError); assert.eq(q.all().length, 1);
});
test("corrupt archive is not silently overwritten; clear removes delivered copies only", async () => {
    const s = new MemoryStorage(); s.setItem("notes", "{broken");
    const broken = new NoteOutbox(s, "notes"); assert.not(broken.push(note())); assert.eq(s.getItem("notes"), "{broken");
    const q = new NoteOutbox(s, "good"); q.push(note(1)); await q.flush(async () => ack); q.push(note(2));
    q.clearDelivered(); assert.eq(q.all().length, 1); assert.eq(q.read()[0].x, 2);
});
test("server retries reuse a receipt and imported legacy notes instead of creating duplicates", () => {
    const root = temp();
    try {
        const a = storeNote(note(), root), b = storeNote({ ...note(), delivery: ack }, root);
        assert.eq(a.file, b.file); assert.ok(b.duplicate);
        const legacy = note(2); fs.writeFileSync(path.join(root, "docs/notes/legacy.md"), `# ${legacy.text}\n\n<!-- ${legacy.at} -->\n`);
        assert.eq(storeNote(legacy, root).file, "legacy.md");
        assert.eq(noteIdentity(note()), noteIdentity({ ...note(), shot: "different screenshot" }));
    } finally { fs.rmSync(root, { recursive: true }); }
});
test("server keeps binary captures outside Git's notes directory and rejects invalid reports", () => {
    const root = temp();
    try {
        const a = storeNote({ ...note(), shot: "data:image/png;base64,YWJj" }, root);
        assert.ok(fs.existsSync(path.join(root, `.artifacts/notes/${a.id}.png`)));
        assert.eq(fs.readdirSync(path.join(root, "docs/notes")).length, 1);
        assert.throws(() => storeNote({ ...note(), at: "bad" }, root));
        assert.throws(() => storeNote({ ...note(), x: null }, root));
        assert.not(noteStem({ ...note(), zone: "../../evil" }, 1).includes("/"));
    } finally { fs.rmSync(root, { recursive: true }); }
});
test("HTTP loopback: authenticated post, retry and complete list; disk success is explicitly unpushed", async () => {
    const root = temp(); fs.writeFileSync(path.join(root, "dev.config.json"), JSON.stringify({ sha256: "test-token" }));
    const server = createServer({ root, reload: false, commitNotes: false });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${server.address().port}`;
    try {
        assert.eq((await fetch(url + "/__dev/notes")).status, 403);
        const headers = { "x-dev-token": "test-token", "content-type": "application/json" };
        const post = () => fetch(url + "/__dev/note", { method: "POST", headers, body: JSON.stringify(note()) }).then((r) => r.json());
        const a = await post(), b = await post(); assert.ok(a.ok); assert.not(a.pushed); assert.eq(a.file, b.file);
        const list = await (await fetch(url + "/__dev/notes", { headers })).json(); assert.eq(list.count, 1);
    } finally { await new Promise((resolve) => server.close(resolve)); fs.rmSync(root, { recursive: true }); }
});
test("part-cooked food returns the original item on both spit and embers", () => {
    const f = new Campfire(); f.addFuel("log"); f.light(); f.putOnSpit("meat_raw"); f.putInEmbers("fish_raw"); f.update(20);
    assert.eq(f.spit[0].state, "cooking"); assert.eq(f.takeFromSpit(0).id, "meat_raw");
    assert.eq(f.takeFromEmbers(0).id, "fish_raw");
});
test("invalid recipes, insufficient repeated ingredients and occupied pot do not consume food", () => {
    const f = new Campfire().installPot(), inv = new Inventory(); inv.add("berry", 1); inv.add("meat_raw", 1);
    assert.not(startPotFromInventory(f, inv, ["berry", "berry"])); assert.eq(inv.count("berry"), 1);
    assert.not(startPotFromInventory(f, inv, ["meat_raw"])); assert.eq(inv.count("meat_raw"), 1);
    inv.add("berry"); assert.ok(startPotFromInventory(f, inv, ["berry", "berry"])); assert.eq(inv.count("berry"), 0);
    f.pot.done = true; inv.add("berry", 2);
    assert.not(startPotFromInventory(f, inv, ["berry", "berry"])); assert.eq(inv.count("berry"), 2);
});
test("one and three ingredients work; cancelling UI selection spends nothing", () => {
    const g = boot(), fire = new Campfire().installPot(); fire.addFuel("log"); fire.light(); g.inventory.add("herb_mint", 1);
    g.openPot(fire, () => {}); click(g, "Мята"); click(g, "Готовить");
    assert.eq(fire.pot.ingredients.length, 1); assert.eq(g.inventory.count("herb_mint"), 0);
    fire.pot.done = true; fire.takePot();
    g.openPot(fire, () => {}); click(g, "Ягоды"); assert.eq(g.inventory.count("berry"), 3);
    click(g, "Очистить выбор"); assert.eq(g.inventory.count("berry"), 3);
    click(g, "Ягоды"); click(g, "Ягоды"); click(g, "Ягоды"); click(g, "Готовить");
    assert.eq(fire.pot.ingredients.length, 3); assert.eq(g.inventory.count("berry"), 0); assert.not(g.hud.isPanelOpen);
});
test("full backpack cannot discard a finished pot or spit dish", () => {
    const g = boot(), f = new Campfire().installPot(); f.startPot(["berry", "berry"]); f.pot.done = true;
    g.inventory = new Inventory({ slots: 1 }); g.inventory.add("knife"); assert.not(canReceive(g.inventory, "berry_jam"));
    g.openPot(f, () => {}); assert.ok(f.pot?.done);
    g.inventory.clear(); g.openPot(f, () => {}); assert.eq(g.inventory.count("berry_jam"), 1); assert.eq(f.pot, null);
});
test("chunk gutters overlap at one uniform scale over fractional camera positions and zoom", () => {
    for (const zoom of [1, 1.25, 2.4, 3.1, 4.8]) for (const x of [0, .1, 13.3, 210.73]) {
        const calls = [], cv = { width: 528, height: 586, groundLift: 57, groundInset: 8 };
        const r = { camera: { x, y: .37, viewW: 1400, viewH: 800, offsetX: .1, offsetY: .2, zoom },
            ctx: { drawImage: (...args) => calls.push(args) }, stats: {}, chunkCache: new Map(), bakeChunk: () => cv };
        const zone = { id: "test", map: { dirtyChunks: new Set(), chunksInRect: () => [{cx:0,cy:0,key:"0"},{cx:1,cy:0,key:"1"}] } };
        Renderer.prototype.drawGround.call(r, zone);
        assert.near(calls[0][1] + calls[0][3] - calls[1][1], 16 * zoom);
        assert.near(calls[0][3] / cv.width, zoom); assert.near(calls[0][4] / cv.height, zoom);
    }
});
test("note 028 expanded: two hands without permanent captions or objective/control tutorial", () => {
    const g = boot(); g.update(0); assert.eq(g.hud.els.objective.textContent, g.story.objective);
    assert.ok(g.hud.els.hotbar.innerHTML.includes('id="leftHand"'));
    assert.ok(g.hud.els.hotbar.innerHTML.includes('id="rightHand"'));
    assert.not(g.hud.els.hotbar.innerHTML.includes('>Еда<'));
    assert.not(g.hud.els.hotbar.innerHTML.includes('>⌄</button>'));
});
test("full backpack preserves a finished spit dish in the real fire menu", () => {
    const g = boot(), obj = g.zone.objects.find((o) => o.kind === "campfire");
    g.openFire(obj); const f = g.fires.get(g.fireKey(g.zone, obj));
    f.putOnSpit("meat_raw"); f.spit[0].state = "done";
    g.inventory = new Inventory({ slots: 1 }); g.inventory.add("knife");
    g.openFire(obj); click(g, "Готово — снять"); assert.ok(f.spit[0]);
    g.inventory.clear(); g.openFire(obj); click(g, "Готово — снять");
    assert.eq(f.spit[0], null); assert.eq(g.inventory.count("meat_roast"), 1);
});
await run("stage64");
