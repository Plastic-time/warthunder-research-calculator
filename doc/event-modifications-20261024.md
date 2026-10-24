# Event Modification Trees: 2026-10-24

This review supersedes the modification-tree deferral in the earlier roster
review. It adds only the exact three event variants; it is not a full snapshot
upgrade. The base dataset remains 2.59.0.17.

| Exact game ID | Visible modifications | Total remaining RP / SL |
| --- | ---: | ---: |
| bf-109e-3_tl | 15 | 8,410 / 9,490 |
| germ_panzerjager_panther_g2 | 17 | 0 / 0, already unlocked |
| germ_s_700_s_706 | 18 | 0 / 0, already unlocked |

## Evidence

Game version **2.59.0.86**, Datamine commit
`aa326f10c6ba7d523647572368ead2e4d51ffb4d` is pinned throughout.
`tools/fixtures/event-modifications-20261024.json` records source paths, hashes,
unit-specific economy fields, global presentation fields, language keys and
ammunition associations. Downloaded files were checked against their individual
Git blob hashes; the recursive repository listing is truncated and is not an
exhaustive audit of all game files.

The client reads modification membership/order from each unit's economy block.
Category, icon and visual predecessor use the client's unit/global precedence.
Only `reqModification` creates a research dependency. `prevModification` controls
layout, not arrows or cost expansion. Category packing omits the game's bonus
column and minimum-width padding. Consumable shells, replenishment costs,
talisman and decal unlocks are not research-tree modifications.

The Bf 109 has four verified research edges: belt to new MG, cannon belt to new
cannon, SC50 to SC250, and SC250 to SC500. The other two trees have no explicit
research-prerequisite edges. Existing tier-gate calculation is unchanged.

The [official season 25 announcement](https://warthunder.com/en/news/10265-warbonds-event-battle-pass-season-25-steel-fury-and-its-warbond-shop-en)
identifies Jagdpanther G2 and S-706 as premium vehicles. The
[official store's general premium rule](https://store.gaijin.net/story.php?title=Saab-JA-37DI-Viggen-F21-Pack)
states that premium vehicles include available modifications. Their exact game
economy entries have zero purchase/GE costs and no `reqExp` for the visible
modifications. Missing RP is preserved in the evidence. An explicit, ID-limited
premium policy maps these to **zero remaining research / already unlocked**.
Missing RP on any non-premium entry still fails validation. This does not mark
the vehicles as owned or change vehicle acquisition prices.

Ammo-pack labels follow the client association from `reqModification` to
`additiveBulletMod`, then the exact weapon's projectile name or belt language
key. In particular, S-706's `30mm_mk_103_38_APCR_navy_ammo_pack` is labelled
**30 mm HEI-T**, not guessed from its internal ID. Seven-language names are
scoped to these three trees; existing vehicles' names are untouched. Icons use
the game's configured GUI-skin assets; aircraft belt icons remain belt icons.

## Reproduction

Run `node tools/event-modifications.cjs --verify --source-dir <pinned-files>
--economy-dir <pinned-economy>` to compare extracted evidence with the fixture.
Run `node --test tools/test-event-modifications.cjs` for offline reconstruction,
baseline hashes, costs, localization, prerequisite and layout rejection tests.
`--extract` is a review-time operation against the pre-import snapshot;
`--apply` refuses already-imported vehicles and prepares all mirrored writes
before changing files. It restores original bytes if a write fails.

The existing roster browser suite also opens all three modification trees on
the backend and Pages builds at desktop and two mobile widths, checks real
images and all seven languages, and exercises planning and premium unlocks.
No installer, release tag, planner-algorithm change or full-data migration is
part of this update. BT-7M (TD) remains deferred by its separate event review.
