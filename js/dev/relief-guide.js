/** Guided acceptance route. Pure state, shared by UI and headless tests.
 * Progress comes from the walker/collision/pickup, not an animation timer. */
import { RELIEF_PROPS } from "../world/relief.js";
export const RELIEF_STEPS = [
    { title: "Подняться", hint: "Держи W / ↑ и иди по светлому подъёму к метке 1. Высота должна вырасти с 0 до 44.", point: [408, 260], route: [[408, 410], [408, 260]] },
    { title: "Взять хворост", hint: "Иди вправо к метке 2. Рядом с хворостом нажми E — предмет исчезнет и появится отметка о подборе.", point: [464, 250], route: [[464, 250]] },
    { title: "Спуститься", hint: "Вернись влево к светлому подъёму, затем иди вниз к метке 3. Высота должна снова стать 0.", point: [408, 410], route: [[408, 250], [408, 410]] },
    { title: "Проверить уступ", hint: "Внизу обойди влево к метке 4 и иди вверх прямо в стенку. Герой должен остановиться, а не взлететь на террасу.", point: [310, 290], route: [[310, 410], [310, 282]] },
    { title: "Взойти на холм", hint: "Иди влево к метке 5, на вершину холма. Здесь подъём плавный, без непроходимой стенки.", point: [123, 230], route: [[123, 355], [123, 230]] }
];
export class ReliefGuide {
    constructor() { this.reset(); }
    reset(active = true) {
        this.active = active; this.step = 0; this.routeIndex = 0;
        this.collected = false; this.demo = false; this.demonstrated = false;
    }
    get complete() { return this.active && this.step === RELIEF_STEPS.length; }
    collect(walker) {
        if (this.collected || !walker.patch.canReach(walker, RELIEF_PROPS.find((o) => o.pickup))) return false;
        this.collected = true; return true;
    }
    observe(w) {
        if (!this.active || this.complete) return;
        const z = w.patch.heightAt(w.x, w.y);
        const passed = [
            z === 44 && w.y < 274,
            this.collected,
            z < 1 && w.y >= 400,
            w.blocked && w.x > 260 && w.x < 350 && w.y > 280 && w.y < 304 && z === 0,
            z > 24 && Math.hypot(w.x - 123, w.y - 230) < 20
        ][this.step];
        if (passed) { this.step++; this.routeIndex = 0; }
        if (this.complete) this.demo = false;
    }
    /** Same keyboard-like inputs as the player; no teleport or scripted checks. */
    demoInput(w) {
        if (!this.demo || !this.active || this.complete) return { x: 0, y: 0 };
        if (this.step === 1 && this.collect(w)) return { x: 0, y: 0 };
        const route = RELIEF_STEPS[this.step].route;
        let target = route[this.routeIndex];
        if (Math.hypot(target[0] - w.x, target[1] - w.y) < 4 && this.routeIndex < route.length - 1)
            target = route[++this.routeIndex];
        const dx = target[0] - w.x, dy = target[1] - w.y, d = Math.hypot(dx, dy);
        return d < 1 ? { x: 0, y: 0 } : { x: dx / d, y: dy / d };
    }
}
