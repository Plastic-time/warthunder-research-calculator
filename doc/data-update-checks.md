# Data update checks

Run `node tools/check-datamine-updates.cjs`. The command only writes an ignored
report under `logs/`; it never imports data or advances review checkpoints.

`config/data-version.json` describes the shipped snapshot and partial corrections.
`config/data-review-checkpoints.json` separately records the last review of vehicle
costs, vehicle prerequisites, rank gates and modifications, including its limitations.
The initial checkpoints refer to the documented 2026-10-17 review, not a new full
snapshot verification. Advance a scope only after its review and regression tests.

GitHub compare responses contain at most 300 changed files. The report preserves
that warning and independently walks non-recursive Git trees at pinned revisions
to compare the blob IDs of `wpcost.blkx`, `shop.blkx` and `rank.blkx`. This verifies
critical-file coverage, not the meaning or correctness of their changes.
Unchanged critical files do not dismiss other upstream changes. A truncated
general file list remains incomplete, even when all critical files were checked.

Missing files, invalid pins, incomplete metadata and network failures fail closed.
The command replaces any previous success report with a dated failure record and
exits unsuccessfully. Never reuse a stale success report.

Tests: `node --test tools/test-datamine-updates.cjs` (offline synthetic sources).
