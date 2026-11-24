# Откуда взята графика героя и предметы в руке

Здесь лежат **исходники**, из которых печатаются спрайты и пропы. Сама игра их не
читает: в рантайме работают запечённые модули `js/render/heroframes.js` (грейд) и
`js/render/herosmooth.js` (гладкий 3D), а они в Git закоммичены. То есть клон
репозитория играет и без этой папки — она нужна только чтобы **перепечь**.

Всё содержимое — **CC0** (см. `../kenney/LICENSE-CC0.txt` и `LICENSE-CC0.txt`),
атрибуция не требуется, но мы её всё равно указываем: авторы отдают работу в
общественное достояние и просят ссылку или Patreon-слово.

## Что откуда качать и куда положить

Клонируем зеркало целиком, но только нужные подпапки (`--filter=blob:none` —
иначе скачается история на сотни мегабайт):

```bash
git clone --depth 1 --filter=blob:none --sparse \
    https://github.com/Dallolz/moorfall-assets.git /tmp/moor
cd /tmp/moor
git sparse-checkout set characters hair outfits weapons animations env
```

Дальше — раскладка ровно такая, как читает `tools/hero-bake.js` и
`tools/prop-bake.js` (каталог `ASSETS = dev/character-style-lab/assets/quaternius`):

| Куда положить (`assets/quaternius/…`) | Что это | Зачем | В Git? |
|---|---|---|---|
| `char/Superhero_Male_FullBody.gltf` + `.bin` | Quaternius **Superhero Characters** (rig Universal: `pelvis`, `spine_01`, `head`, `hand_r`…) | тело героя; из него же меши `Face` (брови) и `Face.001` (глаза) | нет, 1.7 МБ — качается |
| `char/Superhero_Female_FullBody.gltf` + `.bin` | то же, женский вариант | `node tools/hero-bake.js --who Female` | нет |
| `tex/T_Superhero_Male_*.{jpg,png}`, `tex/T_Superhero_Female_*` | базовые цвета/нормали/шероховатость тела | кожа и ткань в запекке | нет, 1.2 МБ |
| `tex/T_Eye_Brown.png`, `tex/T_Eye_Normal.png` | **Universal Base Characters** — глаза | тёмная полоска глаз на лице | нет |
| `tex/T_Hair_1_BaseColor.png`, `tex/T_Hair_2_BaseColor.png` (+ нормали) | волосы `Hair_Buzzed…Long` | прически; в gltf экспортёр потерял текстуру волос — берём по имени отсюда | нет |
| `hair/Hair_Long.glb`, `Hair_Buzzed.glb`, `Hair_BuzzedFemale.glb`, `Hair_SimpleParted.glb`, `Hair_Buns.glb`, `Hair_Beard.glb` | Quaternius **Modular Character Outfits → Hair** | выбор причёски (`--hair Hair_Buns`, …) и борода | **да** |
| `outfits/Male_Peasant.glb`, `outfits/Female_Peasant.glb` | **Modular Character Outfits** | одежда: куртка/штаны/обувь, режется по дорожкам `cloth`/`pants` | **да** (тяжёлые `*_Ranger.glb` — локально) |
| `anims.glb` | Quaternius **Universal Animation Library 1** | походка, бег, стойка, удар | нет, 4.9 МБ |
| `animations/UAL2.glb` | **Universal Animation Library 2** | рубка, копка, сбор, блок щитом | нет, 8 МБ |
| `weapons/*.glb` (Axe, Claymore, Dagger, Hammer, Scythe, Bow, Shield, Arrow) | Quaternius **Modular Weapons** | форма предметов в руке и лист `tools/prop-bake.js` | **да** |
| `enemies/*.glb` | Quaternius **Ultimate Monsters**, KayKit Skeletons | лучшие враги (пока не подключены) | нет |

Если зеркала не будет, первоисточники те же: `https://quaternius.com`
(Universal Base Characters, Universal Animation Library, Modular Character
Outfits, Modular Weapons, Ultimate Monsters), их страницы на itch.io
(`quaternius.itch.io`) и `https://kenney.nl/assets` (Nature Kit, пиксельные иконки).
KayKit — `https://Kay.itch.io/kaykit-character-pack`. Всё CC0/CC-BY 4.0.

## Деревня: `village/` (Medieval Village MegaKit, glTF)

Шесть модулей конструктора — стена с наличником, крыша 6×6, труба, плетень, ящик,
телега. Лежат в Git целиком (408 КБ с текстурами): без них пепелище рисуется
«отрезками». Текстуры урезаны до 64×64 и только baseColor — нормал-мапы
растеризатору не нужны, а весят больше всех.

```bash
# 1) пак берём зеркалом с GitHub (itch.io и Dropbox из песочницы недоступны)
git clone --depth 1 https://github.com/J-Ponzo/gltf-medieval-village-megakit /tmp/mvk
# 2) нужные модели ввозим в репозиторий
node tools/pack-import.js --src /tmp/mvk/glTF --size 64 \
     --out dev/character-style-lab/assets/quaternius/village \
     --models Overhang_Plaster_Long,Roof_RoundTiles_6x6,Prop_Chimney,Prop_WoodenFence_Single,Prop_Crate,Prop_Wagon \
     --note "Quaternius «Medieval Village MegaKit» (CC0), glTF-зеркало github.com/J-Ponzo/gltf-medieval-village-megakit"
# 3) перепечь лист пропов
node tools/prop-bake.js --emit js/render/propsprites.js --ppu 1 --colors 10
```

## Где брать паки и как донести их до песочницы

Архивы владельца лежат в Dropbox и Google Drive (`new beginning/Pack`, 24 пака:
Ultimate Nature, Medieval Village MegaKit, Downtown City MegaKit, Bestiary,
Universal Base Characters, Universal Animation Library 1 и 2, PSX-персонажи,
Farm Animals/Buildings, KayKit Forest Nature и Resource Bits, GandalfHardcore).
Напрямую стянуть их нельзя: исходящий трафик песочницы открыт только на
`github.com`, `registry.npmjs.org` и PyPI — к `*.dropboxusercontent.com`
соединение рвётся на TLS-рукопожатии. Что работает:

- **зеркало на GitHub** (как Village MegaKit выше): `git clone` → `tools/pack-import.js`;
- **файлы в Git коммитить `git`-ом, а не веб-формой**: веб-форма GitHub не пускает
  файл тяжелее 25 МБ, hard limit на файл — 100 МБ;
- **паки тяжелее 100 МБ** (Village 161 МБ, Downtown 234 МБ, Modular Outfits 294 МБ,
  Base Characters 129 МБ) резать: `zip -s 0 pack.zip --out pack-split.zip`, либо
  выкладывать только GLB/gltf+bin+BaseColor, что и нужно запекке.

В Git из паков кладём только геометрию и baseColor: `village/` — 408 КБ,
`kenney/` — 250 КБ. `char/`, `anims.glb`, `animations/`, `*_Ranger.glb` остаются
внешними: их размер ломает и GitHub, и превью-патчсет.

## Как перепечь после того, как файлы легли

```bash
node tools/hero-bake.js --holes          # только диагностика: дырки в силуэте
node tools/hero-bake.js --preview        # .artifacts/hero-bake-preview.png, 4 ракурса × 3 позы
node tools/hero-bake.js --emit           # → js/render/heroframes.js (грейд, играет по умолчанию)
node tools/hero-bake.js --smooth --emit-smooth js/render/herosmooth.js   # гладкий 3D для ?hero3d=smooth
node tools/prop-bake.js --emit js/render/propsprites.js --ppu 1 --colors 10  # 3D-пропы мира (рисует js/render/props3d.js)
node tools/sprite-view.js --all --zoom 4 --out .artifacts/sprite-all.png  # что реально в модуле, на шахматном фоне
node tests/visual-world.test.js && node tools/playtest.js 70
```

Флаги запекки, которые меняют внешний вид, а не только отладку:
`--hair Hair_Buns`, `--who Female`, `--outfit Male_Peasant`, `--ss 4`
(супер-сэмплинг), `--dither 0.14` (решётка дизеринга), `--outline 2`
(обводка), `--shrink 0.97 --inset 0.02` (утяжка тела-подкладки под одежду),
`--hairwidth 1.06 --hairlift 0.012` (посадка причёски) и `--no-facecut`,
если не вырезать пряди, падающие на лицо.
