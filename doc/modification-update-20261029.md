# Modification update: 2.59.0.92 to 2.59.0.93

This is the third independent web update after BR and vehicle RP/SL costs.
No planner algorithms, acquisition rules, saved-plan formats, vehicle costs or BR values change.
No package, tag or release is created. Existing v1.0.29 downloads do not contain this update.
The overall historical snapshot remains 2.59.0.17, not a full 2.59.0.93 import.

## Sources and scope

- Previous commit: `af0cce561a73704e30c1df66eff06209bcc3f035`.
- Current commit: `501af3e34af2cb82d65140297e1b994b444c4b88`.
- [Pinned economy configuration](https://github.com/gszabi99/War-Thunder-Datamine/blob/501af3e34af2cb82d65140297e1b994b444c4b88/char.vromfs.bin_u/config/wpcost.blkx).
- [Pinned modification definitions](https://github.com/gszabi99/War-Thunder-Datamine/blob/501af3e34af2cb82d65140297e1b994b444c4b88/char.vromfs.bin_u/config/modifications.blkx).
- Seven-language names come from the same commit's `units_modifications.csv` and `units_weaponry.csv`. The gun name uses the game's 7.62 mm template.
- `tools/fixtures/modification-update-20261029.json` records source URLs, byte counts, SHA-256 hashes, all six old/new economy blocks, previous vehicle snapshots and chunk hashes.

Comparison of modification blocks and all four tier-gate fields across every supported modification vehicle finds exactly six affected vehicles. Tier-zero ammunition/loadout entries and paid talismans are not research nodes.

| Vehicle | Previous RP / SL | Updated RP / SL |
| --- | ---: | ---: |
| F-102A, USA | 114,300 / 179,000 | 112,500 / 176,500 |
| F-102A, Greece | 114,300 / 179,000 | 112,500 / 176,500 |
| Challenger Mk.2 | 207,300 / 350,000 | 210,300 / 351,000 |
| P1Y1 | 19,560 / 32,100 | 24,600 / 44,800 |
| B7A2 | 24,500 / 44,300 | 30,000 / 58,500 |
| Ki-93-I Ko | 30,000 / 58,500 | 34,600 / 67,400 |

These totals assume no completed research. Explicit GE unlock costs are synchronized too.

## Trees and real prerequisites

- Both F-102s gain tier-I `M163_Minigun_new_gun` (4,600 RP / 7,300 SL) and tier-IV `us_aim_26b` (12,000 RP / 19,000 SL).
- The gun upgrade has no prerequisite. AIM-26B requires AIM-4F, which requires AIM-4G.
- F-102 flight modules have layout predecessors, not research prerequisites. No false flight-performance arrows are added.
- Challenger loses `120mm_britain_L23A1_APDSFS_ammo_pack`; the tier-zero ammo entry is not imported. Remaining tier-IV research modules cost 15,000 RP / 23,000 SL each.
- Challenger's `needBuyToOpenNextInTier4` changes from 3 to 2. It is not the III-to-IV gate. The three displayed gates remain `[1,2,2]`.
- Ki-93's 57 mm belt stays independent of the 20 mm gun upgrade; `prevModification` does not create an arrow.
- All six trees' edges are checked against their own `reqModification` fields. Every unrelated vehicle, historical correction and icon is retained. New F-102 nodes reuse verified existing icon assets.

Existing cell positions remain stable; the F-102 weapon category gains a third column for the independent gun. Challenger retains its other cells after the ammo node is removed.

## Validation

The data regression tests first reproduced three genuine outdated-data failures on baseline `c240548`: old Japanese costs, missing F-102 nodes, and obsolete Challenger ammo. The independent Ki-93 edge check already passed. Two additional tests initially required the new updater module and are not counted as reproduced data defects.

Run pinned-source verification with:

```powershell
node tools/apply-modification-update.cjs logs/review-20261029
node --test tools/test-modification-update.cjs
```

Earlier BR, vehicle-cost and prerequisite audits retain their historical hash assertions by reversing only this explicitly recorded update. The new regression verifies every untouched vehicle and chunk byte-for-byte, mirror hashes, totals, membership, real edges and rejection of changed baselines or missing prices.

Browser regression covers local/static modes, desktop/mobile, warm-cache replacement, all six budgets, new-node translations, saved research and removed-node behavior. Phone checks are Chromium emulation, not physical-device or Safari validation.

Local validation on Windows with Node 24.21.0:

- Pinned-source verification: all six supported deltas matched.
- `node --test tools/test-modification-update.cjs`: 6/6 passed.
- All 43 application regression commands listed by `.github/workflows/security.yml` passed.
- `node tools/check-modification-update.cjs`: 24/24 vehicle/view scenarios, four warm-cache migrations and 56 new-node locale checks passed. Real images loaded; desktop/mobile screenshots inspected.
- `node tools/check-vehicle-cost-update.cjs`: all four existing cost/cache scenarios passed, each with seven locales. Vehicle costs and invested RP remain correct.
- `node tools/check-commit-privacy.cjs --all` and `git diff --check` passed. Staged privacy checks run again before commit.

The first browser test run exposed a test setup issue: its initialization script tried to seed storage on `about:blank`. Restricting the test seed to HTTP documents fixed it. No application logic changed. New vehicle-local names are now explicitly checked alongside the unchanged historical global-name catalog.
