# village — импорт из пака

Источник: Quaternius «Medieval Village MegaKit» (CC0), glTF-зеркало
github.com/J-Ponzo/gltf-medieval-village-megakit

Скопировано `node tools/pack-import.js --src <распакованный glTF> --size 64`:
7 моделей, текстуры урезаны до 64×64 (только baseColor; normal/ORM
растеризатору не нужны). Итого 288 КБ против 161 МБ архива пака — в Git ездит
только геометрия.

Формат: `.gltf` + `.bin` (не GLB) — `tools/gltf-rig.js#readGltf` читает его как есть.

## Что здесь и зачем

| модель | вид пропа | примечание |
|---|---|---|
| `Wall_Plaster_Straight_L` | `hut_wall` | панель на два тайла: одинарный модуль давал «обелиск» (аспект 1:2.7) |
| `Wall_BottomCover` | `ruin_wall` | низкая лента фундамента — то, что остаётся от дома; `fit:"x"` ряд сливается в стену |
| `Roof_RoundTile_2x1` | `hut_roof` | крыша ровно по размеру хижины; `Roof_RoundTiles_6x6` на тайле выглядел красным зонтом |
| `Prop_Chimney` | `chimney` | печь/труба |
| `Prop_Crate` | `crate` | ящик |
| `Prop_Wagon` | `wagon` | телега |
| `Prop_WoodenFence_Single` | `fence` | секция плетня, `fit:"x"` — дотягивается до соседа |

Список живёт в двух местах и обязан совпадать: `PROP_MODEL` в
`tools/prop-bake.js` (какую модель чему печём) и `PROPS` в
`js/sandbox/gather.js` (чем это кликается). Проверка расхождения —
`npm run props:audit`; лишние файлы пака удаляются тем же
`tools/deadcode.js` (раздел «вне игрового графа»).
