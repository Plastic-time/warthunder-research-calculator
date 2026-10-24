# Game-only roster additions, 2026-10-24

This follow-up supersedes the blanket Wiki-based deferral in
[the earlier candidate review](roster-candidate-review-20261024.md).
Missing Wiki presentation is not a prerequisite for including a verified vehicle.

## Included

| Exact game ID | Tree / rank | RB | Acquisition |
| --- | --- | --- | --- |
| bf-109e-3_tl | Germany aviation / II | 2.3 | Twitch Drops; campaign opened October 23 |
| germ_panzerjager_panther_g2 | Germany ground / IV | 6.3 | Season 25 Battle Pass, level 75, paid pass |
| germ_s_700_s_706 | Germany coastal / III | 2.7 | Season 25 Battle Pass, level 51, free reward |

These are special rewards, not ordinary research nodes or direct GE sales.
The game-only nodes have an explicit reward cost policy. Their zero ordinary
budget contribution is an exclusion, not a claim that the vehicles are free.
Cards show the reward channel instead of RP / SL prices. Ownership remains
user-controlled; campaign availability does not mean a reward has been earned.

BT-7M (TD), ID `ussr_bt_7_m_816`, remains deferred because its campaign opens
October 30 at 14:50 UTC, not because its Wiki page is missing.

## Evidence and Limits

- Game version: **2.59.0.86**.
- Fixed Datamine commit: **aa326f10c6ba7d523647572368ead2e4d51ffb4d**.
- [Reviewed fields, source hashes, localized names and availability](../config/game-roster-additions.json).
- [Official Twitch announcement](https://warthunder.com/en/news/10275-esports-watch-the-2026-grand-finals-and-earn-tricolor-smoke-more-twitch-drops-en).
- [Official Battle Pass announcement](https://forum.warthunder.com/t/topic/359427).
- [Battle Pass reward levels](https://wiki.warthunder.com/battlepass/bp_25_season).

Ranks, vehicle classes and mode-specific economic ranks come from the exact
variant's wpcost entry; shop membership is independently checked. BR conversion
follows the pinned game's `ranks_common_shared.nut`, not a copied donor vehicle.
All seven localized names come from the pinned game's `units.csv`; some game
translations intentionally equal English. Existing names remain unchanged.

Real variant images use the already validated official encyclopedia CDN.
Cards open the official event source, not a nonexistent Wiki vehicle page.
No fake Wiki provenance, dependencies, NEW badges or ordinary research columns
are introduced. The extra special column is calculator presentation, not a
claim about exact in-game column placement.

**Modification trees are not included in this change.** Exact definitions were
located, but the game layout conversion and missing premium research-cost
semantics still require separate validation. No donor tree or zero-filled
modification snapshot is shipped.

The full base snapshot remains **2.59.0.17**. Only these three vehicle records
are added; 50 trees now contain 3,238 vehicles. Both runtime mirrors, manifest
hashes, roster counts, partial localization provenance and seven-language
changelog are updated. Existing cost, prerequisite and unlock rules are unchanged.

## Reproduction

The scoped importer defaults to a dry run. It refuses duplicate IDs, overwriting
existing names, future rewards, invalid mode ranks and untrusted announcement URLs.
`--apply` requires verified pinned source files:

```text
node tools/apply-game-roster-additions.cjs --verify --source-dir <presentation-sources> --review-dir <economy-sources>
```

The presentation directory contains `units.csv` and `ranks_common_shared.nut`;
the economy directory contains `current-wpcost.json` and `current-shop.json`.
Every file must match the recorded byte count and SHA-256. This verifies the
existing import without rewriting it. Initial application uses `--apply`
instead of `--verify`.

Tests cover source identity, seven-language names, both tree copies, BR,
reward budget exclusion, future-event rejection and preservation of previous
data. Browser checks exercise both website versions at desktop, 390px and
320px widths with real images and seven languages.

## Local Verification

- Pinned source verification: four files passed byte-count and SHA-256 checks;
  all three exact variants and their seven-language names matched.
- Application tests: 160/160 passed; dependencies reported zero vulnerabilities.
- Complete browser suite passed, including cache revalidation, retry, planning,
  modifications, screenshot export, backups and cross-tab conflicts.
- New-vehicle browser checks: 18 scenarios, 126 language checks passed with real
  images. Mobile checks use Chromium viewport/touch simulation, not physical phones.
- Existing port-3020 preview returned all three new game-sourced records.
- No installer, tag or Release is created by this change.
