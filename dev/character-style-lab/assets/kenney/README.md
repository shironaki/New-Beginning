# Kenney «Nature Kit» — 3D-модели пропов (CC0)

Файлы — low-poly модели природы из набора Kenney (CC0 1.0), в GLB-виде из
репозитория `Dallolz/moorfall-assets` (его `LICENSE.md` лежит рядом как
`LICENSE-CC0.txt`). Ничего кроме геометрии здесь не нужно: свет, палитру и
сетку кадра даёт `tools/prop-bake.js`.

Материалы пака намеренно «сырые» (`grass` бирюзовый, `woodBarkDark`
лососевый): пак рассчитан на перекраску рантаймом, поэтому запекка подставляет
цвета мира по имени материала — см. `MATERIAL_TINT` в `tools/prop-bake.js`.

Как перепечь:

```
node tools/prop-bake.js --sheet --ppu 3      # лист current | 3D в .artifacts/prop-bake.png
node tools/prop-bake.js --emit js/render/propsprites.js --ppu 4.8
```

В git попадают только GLB (по 5–30 КБ) и лицензия: запечь проп заново должен
быть возможным без внешней загрузки.
