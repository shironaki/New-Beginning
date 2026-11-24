# village — импорт из пака

Источник: Quaternius «Medieval Village MegaKit» (CC0), glTF-зеркало github.com/J-Ponzo/gltf-medieval-village-megakit

Скопировано `node tools/pack-import.js`: 6 моделей, текстуры урезаны до 64×64 (baseColor; normal/ORM не нужны растеризатору).

Формат: `.gltf` + `.bin` (не GLB) — `tools/gltf-rig.js#readGltf` читает его как есть.
