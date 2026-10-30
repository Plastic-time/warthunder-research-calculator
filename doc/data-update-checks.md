# Data update checks

Run `node tools/check-datamine-updates.cjs`. The command only writes an ignored
report under `logs/`; it never imports data or advances review checkpoints.

## Release channels

The datamine repository's `master` branch contains both live and development
builds. A newer version or commit does not mean it is on the regular live server.
The checker reads the maintainer's latest version-named changelog among their
30 most recent public Gists, pins its revision, and requires its filename and
explicit channel declarations to match the pinned repository head.

`channels` lists `regular-live` and `dev`, plus `dev-stable` and `wip-live` when
declared. A build can belong to multiple channels. `repositoryHead` describes
the latest datamine commit; it is informational, not automatically the review
target. `upstream`, `changed`, all scope comparisons and `requiresReview` use
**regular live only**. Dev changes never advance the shipped snapshot or checkpoints.

When regular live differs from the head, the checker searches the latest 100
version-file commits reachable from that pinned head. It matches the version
commit message and independently verifies the version file at the selected SHA.
It does not infer release channels from version size, minor-number parity, or WiP.
Missing, stale, ambiguous or truncated declarations, an unclassified head, or an
unresolvable live revision fail closed. There is no fallback to `master` and no
reuse of an earlier successful report. Re-run after the maintainer publishes
matching evidence; otherwise review the source manually.

`channelEvidence` records the immutable Gist revision and URL. These are
**datamine maintainer declarations, not an official game availability guarantee**.
Before importing changes, still confirm release status against official notices.
This command only checks data; it neither updates the website nor builds installers.

## File coverage

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
