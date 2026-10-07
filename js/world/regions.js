/**
 * world — the valley: 12 zones, their biomes and how they connect.
 *
 * The valley below is ~41 000 tiles
 * plus interiors — roughly 85× the walkable area, and, more importantly, it is
 * connected by *transition* zones (a broken road, a forest ride, a mountain
 * pass) instead of teleporting at the screen edge.
 *
 *     [11 Роща]   [3 Бор]     [4 Гряда] — [12 Перевал]
 *         |          |            |
 *     [6 Болото] — [2 Низина] — [7 Тракт] — [10 Монастырь]
 *         |          |            |
 *     [9 Берег]  — [1 Пепелище] — [8 Руины]
 *                     |
 *                 [5 Шахта]
 */

export const BIOMES = {
    ashfall: {
        name: "Пепелище",
        ground: "ash", water: 0.14, trees: 0.03, rocks: 0.05, bushes: 0.02,
        palette: "ash", temp: -1, ambient: "#6a5f58"
    },
    meadow: {
        name: "Низина",
        ground: "meadow", water: 0.2, trees: 0.06, rocks: 0.02, bushes: 0.07,
        palette: "green", temp: 1, ambient: "#79a86a"
    },
    forest: {
        name: "Бор",
        ground: "pine", water: 0.12, trees: 0.38, rocks: 0.05, bushes: 0.09,
        palette: "pine", temp: -1, ambient: "#3f5c3a"
    },
    highland: {
        name: "Гряда",
        ground: "stone", water: 0.06, trees: 0.07, rocks: 0.26, bushes: 0.02,
        palette: "stone", temp: -4, ambient: "#6f6b63"
    },
    swamp: {
        name: "Болото",
        ground: "mud", water: 0.42, trees: 0.14, rocks: 0.02, bushes: 0.12,
        palette: "swamp", temp: 0, ambient: "#4c5436"
    },
    road: {
        name: "Тракт",
        ground: "dry", water: 0.08, trees: 0.08, rocks: 0.04, bushes: 0.05,
        palette: "road", temp: 0, ambient: "#8a8257"
    },
    ruins: {
        name: "Руины",
        ground: "soot", water: 0.05, trees: 0.04, rocks: 0.12, bushes: 0.03,
        palette: "ash", temp: -2, ambient: "#5b544e"
    },
    shore: {
        name: "Берег",
        ground: "sand", water: 0.46, trees: 0.05, rocks: 0.05, bushes: 0.03,
        palette: "shore", temp: 2, ambient: "#cdbd8e"
    },
    sacred: {
        name: "Роща",
        ground: "moss", water: 0.14, trees: 0.3, rocks: 0.05, bushes: 0.14,
        palette: "sacred", temp: 1, ambient: "#4a6b4a"
    },
    cave: {
        name: "Шахта",
        ground: "stone", water: 0, trees: 0, rocks: 0.5, bushes: 0.03,
        palette: "stone", temp: -3, ambient: "#2b2a28", cave: true
    },
    pass: {
        name: "Перевал",
        ground: "snow", water: 0.04, trees: 0.05, rocks: 0.3, bushes: 0.01,
        palette: "snow", temp: -12, ambient: "#cfd9e2"
    }
};

/**
 * Zones. `links` describe doorways between zones: an edge, the tile span on
 * that edge, and the destination. Transition zones are small and corridor-like
 * on purpose — they hide loading and give journeys a rhythm.
 */
export const ZONES = {
    ashfall: {
        id: "ashfall", name: "Пепелище у дома", biome: "ashfall", w: 72, h: 56,
        act: 1, danger: 0, unlocked: true,
        story: "Здесь стоял твой дом. Теперь — угли и палатка.",
        links: [
            { edge: "north", from: 30, to: 40, target: "meadow", label: "Тихая низина" },
            { edge: "east",  from: 22, to: 32, target: "ruins",  label: "Старое пепелище" },
            { edge: "west",  from: 24, to: 34, target: "shore",  label: "Лазурный берег" }
        ]
    },
    meadow: {
        id: "meadow", name: "Тихая низина", biome: "meadow", w: 88, h: 64,
        act: 1, danger: 1, unlocked: true,
        story: "Ровная земля у ручья. Здесь можно построить что-то новое.",
        links: [
            { edge: "south", from: 30, to: 40, target: "ashfall", label: "Пепелище" },
            { edge: "north", from: 36, to: 46, target: "forest",  label: "Старый бор" },
            { edge: "east",  from: 26, to: 36, target: "road",    label: "Разбитый тракт" },
            { edge: "west",  from: 28, to: 38, target: "swamp",   label: "Торфяное болото" }
        ]
    },
    forest: {
        id: "forest", name: "Старый бор", biome: "forest", w: 80, h: 64,
        act: 1, danger: 2, unlocked: true,
        story: "Высокие сосны, смола и волчьи следы.",
        links: [
            { edge: "south", from: 34, to: 44, target: "meadow",   label: "Низина" },
            { edge: "east",  from: 24, to: 34, target: "highland", label: "Каменная гряда" },
            { edge: "west",  from: 26, to: 36, target: "sacred",   label: "Священная роща" }
        ]
    },
    highland: {
        id: "highland", name: "Каменная гряда", biome: "highland", w: 72, h: 56,
        act: 2, danger: 3, unlocked: true,
        story: "Голый камень, медь в жилах и вход в старую шахту.",
        links: [
            { edge: "west",  from: 22, to: 32, target: "forest", label: "Бор" },
            { edge: "north", from: 30, to: 38, target: "pass",   label: "Перевал" }
        ]
    },
    swamp: {
        id: "swamp", name: "Торфяное болото", biome: "swamp", w: 72, h: 56,
        act: 2, danger: 3, unlocked: true,
        story: "Туман по колено и травы, которых нет больше нигде.",
        links: [{ edge: "east", from: 24, to: 34, target: "meadow", label: "Низина" }]
    },
    road: {
        id: "road", name: "Разбитый тракт", biome: "road", w: 96, h: 40,
        act: 2, danger: 2, unlocked: true,
        story: "Дорога, по которой когда-то шли обозы. Теперь — редкие путники.",
        links: [
            { edge: "west", from: 14, to: 24, target: "meadow",    label: "Низина" },
            { edge: "east", from: 14, to: 24, target: "monastery", label: "Монастырь" }
        ]
    },
    ruins: {
        id: "ruins", name: "Сгоревшее село", biome: "ruins", w: 64, h: 52,
        act: 1, danger: 2, unlocked: true,
        story: "То, что осталось от соседей. Здесь начался пожар.",
        links: [{ edge: "west", from: 20, to: 30, target: "ashfall", label: "Пепелище" }]
    },
    shore: {
        id: "shore", name: "Лазурный берег", biome: "shore", w: 80, h: 56,
        act: 2, danger: 1, unlocked: true,
        story: "Солёный ветер, выброшенный лес и обломки чужих лодок.",
        links: [{ edge: "east", from: 24, to: 34, target: "ashfall", label: "Пепелище" }]
    },
    sacred: {
        id: "sacred", name: "Священная роща", biome: "sacred", w: 64, h: 56,
        act: 3, danger: 2, unlocked: true,
        story: "Лес, который старше любого села в долине.",
        links: [{ edge: "east", from: 26, to: 36, target: "forest", label: "Бор" }]
    },
    monastery: {
        id: "monastery", name: "Монастырь на холме", biome: "highland", w: 64, h: 48,
        act: 3, danger: 1, unlocked: true,
        story: "Форпост Старого ордена. Здесь говорят о законе и десятине.",
        links: [{ edge: "west", from: 18, to: 28, target: "road", label: "Тракт" }]
    },
    pass: {
        id: "pass", name: "Перевал", biome: "pass", w: 56, h: 64,
        act: 4, danger: 4, unlocked: true,
        story: "Снег круглый год и ветер, который не стихает.",
        links: [{ edge: "south", from: 24, to: 32, target: "highland", label: "Гряда" }]
    },
    mine: {
        id: "mine", name: "Глубокая шахта", biome: "cave", w: 56, h: 48,
        act: 2, danger: 4, unlocked: true, underground: true,
        story: "Штольня, которую закрыли не зря.",
        links: []
    }
};

export const START_ZONE = "ashfall";

export function zoneDef(id) { return ZONES[id] || null; }
export function biomeDef(key) { return BIOMES[key] || BIOMES.meadow; }
export function allZoneIds() { return Object.keys(ZONES); }

/** Total walkable tiles authored in the valley — used in docs and tests. */
export function valleyTileCount() {
    return Object.values(ZONES).reduce((sum, z) => sum + z.w * z.h, 0);
}

/** The opposite edge, for placing the player when arriving through a link. */
export function oppositeEdge(edge) {
    return { north: "south", south: "north", east: "west", west: "east" }[edge] || "south";
}
