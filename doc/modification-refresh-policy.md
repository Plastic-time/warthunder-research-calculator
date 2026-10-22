# Modification refresh protection

The old full rebuild could fall back to Wiki costs or lose a vehicle when a Wiki
page was absent. The build command now starts from the shipped, checksum-verified
catalog. It does not recreate membership from Wiki pages.

Dry-run review (no production data writes):

```sh
npm run build:modifications -- --source-dir logs/game-data-review-20261017
```

The source directory must contain a pinned `sources.json` and `current-wpcost.json`
with matching revision, source URL, size and SHA-256. `--wiki-dir` can select an
existing local Wiki HTML snapshot. No network fetch or moving-branch import occurs.

Review `logs/modifications-refresh-review.json`. Missing values are unverified,
not zero and not replaced with Wiki numbers. Cost, tier, prerequisite, membership
and tier-gate differences are review items, never automatic gameplay edits.
`prevModification` remains an ordering hint, not a prerequisite.

After inspecting the report, `--apply` can refresh English names and safe icon
filenames for conflict-free vehicles. Incomplete/conflicting vehicles and every
vehicle in `catalog.corrections` remain unchanged. Missing pages never delete
vehicles. Current layout, localized names, ammunition artwork, unknown costs,
full-snapshot version and existing correction provenance are retained.

New game entries and real gameplay changes require a separate reviewed data patch
and focused regressions. This tool is not an automatic game-data upgrade.
Both public/docs copies are validated before writes. Changes use atomic file
replacement and rollback on I/O failure; an incomplete rollback is an error.

Tests: `node --test tools/test-modification-refresh-guard.cjs` and
`node tools/test-modifications.cjs`.
