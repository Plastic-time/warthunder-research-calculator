# Modification Prerequisite Audit

This is a prerequisite-only correction, not a new full game-data snapshot.

Source: game version 2.59.0.17, Datamine commit
`510a793c2bdb01c51475118199c7b66b72935ff1`,
`char.vromfs.bin_u/config/wpcost.blkx`.

The audit examined all 3,225 vehicles and 52,424 visible modifications.
It verified 3,221 vehicles / 52,365 modifications against that fixed source.
The four protected user-confirmed corrections (Ka-29, Do 217 J-2 and both CA-27
variants) are retained in full. They are explicitly excluded from the claim of
full prerequisite verification against the older snapshot.

Across the verified vehicles, 8,649 layout-only edges were removed from 1,521
vehicles. Every removed edge was checked against prevModification; none was a
reqModification. All 5,397 real prerequisite edges were retained.
Previously corrected Rafales and the Golden Eagle remain corrected.

No RP, SL, GE, tiers, tier unlock counts, membership, names, artwork, aliases or
layout positions were changed. A plan may cost less because it no longer includes
an unnecessary modification. For example J-16 / PL-12A keeps the PL-8B -> PL-12
chain but no longer requires a compressor merely to research boosters.

## Countermeasures

305 aircraft countermeasure-modification records were checked for game ID, tier
and research prerequisites. This covers basic dispensers, integrated
countermeasure/warning upgrades, chaff modules and optional pods.
It does not claim to verify every aircraft's stock loadout or flare quantity.

The two BOL IDs, uk_ltc_bol and swd_ltc_bol, occur on 23 aircraft. Ten records have
a real basic-countermeasure prerequisite, which remains intact. For example:

- F-14B: basic countermeasures -> BOL is real.
- F-15C Golden Eagle: the corresponding line is layout-only.
- JA37D: basic countermeasures -> BOL is real.

All these BOL modules participate in the same air-combat filler priority as
boosters and G-suits. The planner only fills missing tier counts; it does not
force every pod upgrade, override manually selected weapons or duplicate charges
for researched / zero-cost unlocked modifications.

## Reproduction

Run `node tools/audit-modification-prerequisites.cjs --datamine <checkout>` for
a read-only data audit. It writes its report under logs, not to production data.
Add `--apply` only after reviewing the differences. The script reads the
recorded Git revision rather than working-tree configuration files.

The checked-in fixture records the source SHA-256, all countermeasure records,
per-chunk prerequisite and non-prerequisite fingerprints, and full-vehicle
fingerprints for the four protected corrections.
`tools/test-prerequisite-audit.cjs` checks those fingerprints, dangling edges,
cycles, real prerequisites, tier gates and budget sums across representative
targets at every available tier of every vehicle.
