/**
 * tools/screenshot.js — render the real game headlessly and save PNGs.
 *
 *   npm run shot            all scenes
 *   npm run shot -- night   only scenes whose name contains "night"
 *
 * Uses tools/canvas-shim.js (software Canvas 2D) so graphics work can be
 * reviewed without a browser. Output goes to .artifacts/ (git-ignored).
 */
import fs from "node:fs";
import path from "node:path";
import { ShimCanvas, encodePNG } from "./canvas-shim.js";
import { installDOM } from "../tests/dom-harness.js";

const OUT = path.resolve(".artifacts");
fs.mkdirSync(OUT, { recursive: true });

// A DOM whose canvases are real (software) pixel buffers.
const dom = installDOM();
const baseCreate = globalThis.document.createElement;
globalThis.document.createElement = (tag) =>
    (tag === "canvas" ? new ShimCanvas(300, 150) : baseCreate(tag));

const screen = new ShimCanvas(960, 560);
// The game attaches touch listeners to the canvas; a no-op is enough here.
screen.addEventListener = () => {};
screen.style = {};
const hudRoot = globalThis.document.getElementById("hud");
globalThis.document.getElementById = (id) => (id === "game" ? screen : hudRoot);

const { Game } = await import("../js/main.js");

function frames(game, n, dt = 1 / 60) {
    for (let i = 0; i < n; i++) { game.update(dt); game.render(); }
}

/** Put the hero next to the first object of a kind, facing it. */
function standAt(game, kind, dx = 0, dy = 26) {
    const obj = game.zone.objects.find((o) => o.kind === kind && !o.removed);
    if (!obj) return null;
    game.player.x = obj.x + dx;
    game.player.y = obj.y + dy;
    game.player.dir = dy > 0 ? "up" : "down";
    game.camera.snapTo(game.player.x, game.player.y - 10);
    return obj;
}

const scenes = [
    {
        name: "01-camp-midday",
        about: "Лагерь на пепелище, полдень",
        setup(g) {
            g.clock.minute = 12 * 60;
            standAt(g, "campfire", -6, 30);
        }
    },
    {
        name: "02-camp-dusk-fire",
        about: "Сумерки, костёр горит, еда на вертеле",
        setup(g) {
            g.clock.minute = 20 * 60 + 20;
            const obj = standAt(g, "campfire", -10, 28);
            const fire = g.fires.get(g.fireKey(g.zone, obj));
            fire.addFuel("log"); fire.addFuel("log");
            fire.light({ hasFlint: true });
            fire.putOnSpit("fish_raw");
            fire.update(20);
            g.inventory.add("axe_stone", 1);
            g.inventory.setActive(g.inventory.list().findIndex((s) => s.id === "axe_stone"));
        }
    },
    {
        name: "03-camp-night",
        about: "Глубокая ночь у огня",
        setup(g) {
            g.clock.minute = 1 * 60;
            const obj = standAt(g, "campfire", -14, 24);
            const fire = g.fires.get(g.fireKey(g.zone, obj));
            fire.addFuel("coal"); fire.light({ hasFlint: true });
            fire.update(5);
        }
    },
    {
        name: "04-hero-closeup",
        about: "Герой крупно в шаге: нож в руке, колено работает",
        setup(g) {
            g.clock.minute = 11 * 60;
            standAt(g, "tent", 46, 18);
            g.player.dir = "right";
            // Mid-stride, so the sheet shows the walk and not a statue.
            g.player.moving = true;
            g.player.gait = 1;
            g.player.anim = Math.PI * 0.35;
            g.camera.zoom = 6;
            g.camera.snapTo(g.player.x, g.player.y - 6);
        }
    },
    {
        name: "05-ruins-house",
        about: "Сгоревший дом героя",
        setup(g) {
            g.clock.minute = 9 * 60;
            standAt(g, "hearth_ruin", 0, 60);
            g.camera.zoom = 2.1;
            g.camera.snapTo(g.player.x, g.player.y - 40);
        }
    },
    {
        name: "09-fire-fuel-closeup",
        about: "Костёр крупно: видно хворост, полено и уголь",
        setup(g) {
            g.clock.minute = 21 * 60;
            const obj = standAt(g, "campfire", -26, 20);
            const fire = g.fires.get(g.fireKey(g.zone, obj));
            fire.addFuel("log"); fire.addFuel("firewood"); fire.addFuel("coal");
            fire.light({ hasFlint: true });
            fire.update(2400);                 // the log is half gone by now
            fire.putOnSpit("fish_raw");
            fire.update(200);
            g.camera.zoom = 6;
            g.camera.snapTo(obj.x, obj.y - 8);
        }
    },
    {
        name: "06-forest-noon",
        about: "Старый бор, полдень",
        setup(g) {
            g.enterZone("forest", null, true);
            g.clock.minute = 13 * 60;
        }
    },
    {
        name: "07-meadow-dawn",
        about: "Тихая низина на рассвете",
        setup(g) {
            g.enterZone("meadow", null, true);
            g.clock.minute = 6 * 60;
        }
    },
    {
        name: "10-tree-closeup",
        about: "Берёза и сосны крупно",
        setup(g) {
            g.enterZone("meadow", null, true);
            g.clock.minute = 12 * 60;
            const birch = g.zone.objects.find((o) => o.kind === "birch");
            if (birch) {
                g.player.x = birch.x - 40; g.player.y = birch.y + 20;
                g.camera.zoom = 4;
                g.camera.snapTo(birch.x, birch.y - 30);
            }
        }
    },
    {
        name: "11-highland-noon",
        about: "Каменная гряда: руда только здесь",
        setup(g) { g.enterZone("highland", null, true); g.clock.minute = 12 * 60; }
    },
    {
        name: "12-swamp-noon",
        about: "Торфяное болото",
        setup(g) { g.enterZone("swamp", null, true); g.clock.minute = 11 * 60; }
    },
    {
        name: "13-road-noon",
        about: "Разбитый тракт",
        setup(g) { g.enterZone("road", null, true); g.clock.minute = 14 * 60; }
    },
    {
        name: "14-ruins-village",
        about: "Сгоревшее село",
        setup(g) { g.enterZone("ruins", null, true); g.clock.minute = 10 * 60; }
    },
    {
        name: "15-sacred-grove",
        about: "Священная роща",
        setup(g) { g.enterZone("sacred", null, true); g.clock.minute = 15 * 60; }
    },
    {
        name: "16-mine",
        about: "Глубокая шахта",
        setup(g) { g.enterZone("mine", null, true); g.clock.minute = 12 * 60; }
    },
    {
        name: "17-behind-pine",
        about: "Герой за сосной: крона уходит в прозрачность",
        setup(g) {
            g.enterZone("forest", null, true);
            g.clock.minute = 11 * 60;
            const pine = g.zone.objects.find((o) => o.kind === "pine" || o.kind === "spruce");
            if (pine) {
                g.player.x = pine.x; g.player.y = pine.y - 20;
                g.player.dir = "down";
                g.camera.zoom = 3;
                g.camera.snapTo(pine.x, pine.y - 26);
            }
        }
    },
    {
        name: "18-rock-closeup",
        about: "Камни крупно: как они стоят в земле",
        setup(g) {
            g.enterZone("highland", null, true);
            g.clock.minute = 12 * 60;
            const rock = g.zone.objects.find((o) => o.kind === "rock");
            if (rock) {
                g.player.x = rock.x - 40; g.player.y = rock.y + 26;
                g.camera.zoom = 5;
                g.camera.snapTo(rock.x, rock.y - 6);
            }
        }
    },
    {
        name: "08-shore-afternoon",
        about: "Лазурный берег",
        setup(g) {
            g.enterZone("shore", null, true);
            g.clock.minute = 16 * 60;
        }
    },
    {
        name: "19-shore-closeup",
        about: "Вода крупно: волна, блики, пена на углах",
        setup(g) {
            g.enterZone("shore", null, true);
            g.clock.minute = 17 * 60;
            g.camera.zoom = 4;
            g.camera.snapTo(g.player.x, g.player.y - 20);
        }
    },
    {
        name: "20-rain-storm",
        about: "Гроза: три слоя дождя, всплески, вспышка",
        setup(g) {
            g.enterZone("meadow", null, true);
            g.clock.minute = 15 * 60;
            g.weather.current = "storm";
            g.weather.windAngle = 0.4;
            g.renderer.time = 0.04;          // inside a lightning flash
        }
    },
    {
        name: "21-fog-morning",
        about: "Туман лежит в низинах, а не висит вуалью",
        setup(g) {
            g.enterZone("swamp", null, true);
            g.clock.minute = 7 * 60;
            g.weather.current = "fog";
        }
    },
    {
        name: "22-snow-winter",
        about: "Снег тремя слоями с ветром",
        setup(g) {
            g.enterZone("forest", null, true);
            g.clock.minute = 11 * 60;
            g.clock.day = 280;
            g.weather.current = "snow";
            g.weather.windAngle = 2.6;
        }
    }
];

const filter = process.argv[2] || "";
let made = 0;
for (const scene of scenes) {
    if (filter && !scene.name.includes(filter)) continue;
    const game = new Game({ canvas: screen, hudRoot, seed: "ashes-and-grain" });
    game.hud.hideStory();
    game.paused = false;
    scene.setup(game);
    frames(game, 8);                      // settle particles, bake chunks
    game.render();
    const png = encodePNG(screen);
    const file = path.join(OUT, scene.name + ".png");
    fs.writeFileSync(file, png);
    made++;
    console.log(`📸 ${scene.name.padEnd(22)} ${scene.about}  → ${path.relative(process.cwd(), file)}`);
}
console.log(`\nГотово: ${made} кадр(ов) в ${path.relative(process.cwd(), OUT)}/`);
