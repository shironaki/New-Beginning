/**
 * v3 world — tile table.
 *
 * Tiles are numeric ids stored in typed arrays (one byte per tile), so a
 * 96×72 zone costs ~7 KB instead of thousands of objects. Everything a tile
 * "is" lives here: walkability, movement cost, footstep sound, and the colour
 * ramp the renderer paints it with.
 */

export const T = {
    VOID: 0,
    GRASS: 1,
    GRASS_DRY: 2,
    MEADOW: 3,      // flowering grass
    DIRT: 4,
    PATH: 5,
    ASH: 6,         // burnt ground — the prologue zone
    SOOT: 7,        // scorched earth, darkest
    SAND: 8,
    WATER: 9,       // shallow, wadeable
    DEEP: 10,       // deep water, blocks
    STONE: 11,      // walkable rocky floor
    CLIFF: 12,      // solid rock wall
    GRAVEL: 13,
    SNOW: 14,
    MUD: 15,        // swamp, slows you down
    FARM: 16,       // tilled soil
    FARM_WET: 17,
    PLANK: 18,      // wooden floor / bridge
    COBBLE: 19,
    MOSS: 20,
    PINE_FLOOR: 21  // needle-covered forest floor
};

/**
 * speed: movement multiplier. solid: blocks movement.
 * colors: [base, shade, highlight] — the renderer dithers between them.
 */
export const TILES = {
    [T.VOID]:       { key: "void",      name: "Пустота",    solid: true,  speed: 0,    colors: ["#0b0d10", "#070809", "#121419"], step: "none" },
    [T.GRASS]:      { key: "grass",     name: "Трава",      solid: false, speed: 1,    colors: ["#4a7c3f", "#3d6834", "#5d9150"], step: "grass" },
    [T.GRASS_DRY]:  { key: "grassDry",  name: "Сухая трава",solid: false, speed: 1,    colors: ["#7d8a45", "#68753a", "#94a055"], step: "grass" },
    [T.MEADOW]:     { key: "meadow",    name: "Луг",        solid: false, speed: 1,    colors: ["#558a45", "#467439", "#6aa257"], step: "grass" },
    [T.DIRT]:       { key: "dirt",      name: "Земля",      solid: false, speed: 1.02, colors: ["#6b5236", "#5a442c", "#7d6243"], step: "dirt" },
    [T.PATH]:       { key: "path",      name: "Тропа",      solid: false, speed: 1.18, colors: ["#8a7456", "#766248", "#9d8767"], step: "dirt" },
    [T.ASH]:        { key: "ash",       name: "Пепел",      solid: false, speed: 0.96, colors: ["#786d60", "#5c544b", "#9c9183"], step: "ash" },
    [T.SOOT]:       { key: "soot",      name: "Гарь",       solid: false, speed: 0.94, colors: ["#4a423c", "#332c28", "#665a50"], step: "ash" },
    [T.SAND]:       { key: "sand",      name: "Песок",      solid: false, speed: 0.9,  colors: ["#d8c48c", "#c3ae77", "#e8d8a6"], step: "sand" },
    // You cannot swim yet: open water stops you at the shoreline. Shallow
    // water stays visually distinct and is where fish and reeds live.
    // The shallows are WADEABLE: you can walk the waterline, slowly and
    // noisily. Deep water still stops you — there is no swimming.
    [T.WATER]:      { key: "water",     name: "Отмель",     solid: false, speed: 0.58, colors: ["#4f8fa8", "#417a91", "#6fa9bd"], step: "water", liquid: true, shallow: true },
    [T.DEEP]:       { key: "deep",      name: "Глубина",    solid: true,  speed: 0,    colors: ["#2d5f7a", "#244e64", "#3a7390"], step: "water", liquid: true },
    [T.STONE]:      { key: "stone",     name: "Камень",     solid: false, speed: 1.05, colors: ["#7b7a78", "#656462", "#918f8c"], step: "stone" },
    [T.CLIFF]:      { key: "cliff",     name: "Скала",      solid: true,  speed: 0,    colors: ["#56544f", "#413f3b", "#6b6862"], step: "stone" },
    [T.GRAVEL]:     { key: "gravel",    name: "Щебень",     solid: false, speed: 0.95, colors: ["#8c867c", "#756f66", "#a09a8f"], step: "stone" },
    [T.SNOW]:       { key: "snow",      name: "Снег",       solid: false, speed: 0.82, colors: ["#e4ecf2", "#cfd9e2", "#f6fbff"], step: "snow" },
    [T.MUD]:        { key: "mud",       name: "Топь",       solid: false, speed: 0.6,  colors: ["#54492f", "#443b26", "#665839"], step: "mud" },
    [T.FARM]:       { key: "farm",      name: "Грядка",     solid: false, speed: 0.95, colors: ["#6a4e32", "#58412a", "#7d5d3c"], step: "dirt" },
    [T.FARM_WET]:   { key: "farmWet",   name: "Политая грядка", solid: false, speed: 0.95, colors: ["#4e3824", "#3f2d1d", "#5e452c"], step: "dirt" },
    [T.PLANK]:      { key: "plank",     name: "Настил",     solid: false, speed: 1.12, colors: ["#9a6f43", "#845e38", "#b0824f"], step: "wood" },
    [T.COBBLE]:     { key: "cobble",    name: "Мостовая",   solid: false, speed: 1.15, colors: ["#8e8a82", "#76726b", "#a3a098"], step: "stone" },
    [T.MOSS]:       { key: "moss",      name: "Мох",        solid: false, speed: 0.98, colors: ["#4b6b3c", "#3e5a31", "#5c8049"], step: "grass" },
    [T.PINE_FLOOR]: { key: "pineFloor", name: "Хвоя",       solid: false, speed: 1,    colors: ["#5a5433", "#4a452a", "#6d663f"], step: "grass" }
};

export function tileInfo(id) { return TILES[id] || TILES[T.VOID]; }
export function isSolidTile(id) { return tileInfo(id).solid === true; }
export function tileSpeed(id) { return tileInfo(id).speed; }
export function isLiquid(id) { return tileInfo(id).liquid === true; }
/** Water you can stand in: the shallows, not the deep. */
export function isShallow(id) { const t = tileInfo(id); return t.liquid === true && t.solid === false; }

/** World units per tile. Everything positional in v3 is in world units. */
export const TILE_SIZE = 32;
