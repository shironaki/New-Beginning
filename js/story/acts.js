/**
 * story — the campaign spine.
 *
 * A step is a small piece of narrative plus an objective and the event that
 * completes it. The story never blocks the sandbox: steps watch what the
 * player does anyway (gather, light, cook, sleep) and move on when it happens.
 * Act I is the prologue — alone on the ashes of your own house.
 */

export const ACTS = [
    { id: 1, name: "Один",          hint: "Пережить первые дни на пепелище" },
    { id: 2, name: "Второй голос",  hint: "В долине ты не один" },
    { id: 3, name: "Очаг",          hint: "Поселение начинает дышать" },
    { id: 4, name: "Соседи",        hint: "Долина перестаёт быть ничьей" },
    { id: 5, name: "Зима спросит",  hint: "То, что сожгло долину, возвращается" }
];

/**
 * Prologue steps. `on` is an event name; `when` an optional predicate over the
 * payload and the game state. `objective` is what the HUD shows.
 */
export const STORY_STEPS = [
    {
        id: "wake",
        act: 1,
        title: "Пепел",
        text: "Ты вернулся домой через неделю после пожара. От дома остались печь, " +
              "обугленные балки и запах гари, который не выветривается. Кто-то поставил " +
              "у пожарища палатку — может быть, ты сам, прежде чем заснуть.",
        objective: "Осмотреть обгоревшую печь",
        on: "story:flag",
        when: (p) => p.flag === "home_hearth"
    },
    {
        id: "diary",
        act: 1,
        title: "Свой почерк",
        text: "Под обломками уцелел твой дневник. Последняя запись сделана за день до " +
              "пожара и обрывается на половине слова: «на гряде снова видели…»",
        objective: "Найти и прочитать обгоревший дневник",
        on: "story:flag",
        when: (p) => p.flag === "own_diary"
    },
    {
        id: "firewood",
        act: 1,
        title: "Первое дело",
        text: "Ночь будет холодной. Всё остальное подождёт — сначала огонь.",
        objective: "Собрать 5 хвороста",
        on: "inv:add",
        when: (p, game) => game.inventory.count("firewood") >= 5
    },
    {
        id: "light_fire",
        act: 1,
        title: "Огонь",
        text: "Пламя берётся неохотно, но берётся. Пока костёр горит — ты жив.",
        objective: "Разжечь костёр в лагере",
        on: "fire:lit"
    },
    {
        id: "cook",
        act: 1,
        title: "Первая горячая еда",
        text: "Горячая еда греет изнутри дольше, чем костёр снаружи.",
        objective: "Приготовить что-нибудь на костре",
        on: "cook:take",
        when: (p) => p.state === "done"
    },
    {
        id: "eat",
        act: 1,
        title: "Сытость",
        text: "Впервые за неделю ты поел досыта.",
        objective: "Съесть приготовленную еду",
        on: "needs:consume",
        when: (p) => p.food >= 10
    },
    {
        id: "survive_night",
        act: 1,
        title: "Первая ночь",
        text: "Ты пережил ночь на пепелище. Утром над низиной на севере стоял дым — " +
              "тонкий, ровный. Так горит не пожар. Так горит чей-то костёр.",
        objective: "Переждать ночь в палатке",
        on: "player:slept"
    },
    {
        id: "find_smoke",
        act: 2,
        title: "Второй голос",
        text: "Кто-то ещё выжил. Нужно идти на север, в Тихую низину.",
        objective: "Дойти до Тихой низины",
        on: "zone:enter",
        when: (p) => p.zone === "meadow"
    }
];

export class StoryEngine {
    constructor({ bus, game = null }) {
        this.bus = bus;
        this.game = game;
        this.index = 0;
        this.completed = [];
        this.flags = new Set();
        this.entries = [];       // journal entries, newest last
        this.act = 1;
        this._bind();
    }

    get current() { return STORY_STEPS[this.index] || null; }
    get objective() { return this.current ? this.current.objective : "Живи, как знаешь"; }
    get done() { return this.index >= STORY_STEPS.length; }

    _bind() {
        this.bus.on("*", (payload, type) => this._onEvent(type, payload));
    }

    _onEvent(type, payload) {
        const step = this.current;
        if (!step || step.on !== type) return;
        if (step.when && !step.when(payload || {}, this.game)) return;
        this.complete(step);
    }

    complete(step) {
        this.completed.push(step.id);
        this.entries.push({ id: step.id, title: step.title, text: step.text, act: step.act });
        this.index++;
        // The act is defined by what you are doing *next*, not what you just did.
        const nextAct = this.current ? this.current.act : step.act;
        if (nextAct !== this.act) {
            this.act = nextAct;
            this.bus.emit("story:act", { act: this.act, name: (ACTS[this.act - 1] || {}).name });
        }
        this.bus.emit("story:step", {
            id: step.id, title: step.title, text: step.text,
            next: this.current ? this.current.objective : null
        });
        if (this.done) this.bus.emit("story:chapter_end", { act: this.act });
        return this;
    }

    setFlag(flag) {
        if (this.flags.has(flag)) return false;
        this.flags.add(flag);
        this.bus.emit("story:flag", { flag });
        return true;
    }

    hasFlag(flag) { return this.flags.has(flag); }

    toJSON() { return { index: this.index, completed: this.completed, flags: Array.from(this.flags), entries: this.entries, act: this.act }; }
    load(d) {
        if (!d) return this;
        this.index = d.index || 0;
        this.completed = d.completed || [];
        this.flags = new Set(d.flags || []);
        this.entries = d.entries || [];
        this.act = d.act || 1;
        return this;
    }
}
