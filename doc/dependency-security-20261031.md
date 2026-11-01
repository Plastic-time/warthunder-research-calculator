# Dependency security maintenance (2026-10-31)

## Scope

The unchanged `fee7e8f` dependency baseline reports five affected packages:
one high and four moderate. Three underlying advisories account for those
results; `editorconfig` and `js-beautify` inherit findings from their dependencies.

| Dependency | Before | After | Advisory |
| --- | --- | --- | --- |
| follow-redirects | 1.16.1 | 1.16.2 | [Cross-realm sensitive headers](https://github.com/advisories/GHSA-mrwp-f3q8-3g9p) |
| glob | 13.0.6 | 14.0.2 | [Traversal after cancellation](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4) |
| minimatch | 10.2.6 | 11.0.1 | [Pattern amplification](https://github.com/advisories/GHSA-g3hv-75wg-m249) |

`js-beautify` remains at 2.0.3 and `editorconfig` at 3.0.2. Their published
ranges do not yet admit the reviewed fixes. Overrides are confined to
`js-beautify`'s `glob` and `minimatch` dependency tree, rather than downgrading
the formatter or replacing application behavior. The glob upgrade also requires
`path-scurry` 3.0.0; minimatch adds `@isaacs/nonrecursive-glob-match` 1.0.3.
All other locked versions are unchanged. Remove these overrides only after
upstream ranges admit patched versions and the compatibility tests pass.

No audit exemptions, lower severity thresholds, disabled checks, application
logic, game data or web assets are changed. No installer is built; existing
downloaded installers are not retroactively patched by this source commit.

The follow-redirects advisory describes a conditional library vulnerability,
not evidence that this site's credentials were disclosed. Its published Axios
test did not reproduce the issue. The new regression uses synthetic headers and
two loopback servers, not real credentials or third-party targets.

## Validation

Environment: Windows, Node.js 24.21.0; baseline `fee7e8f`.

- `npm audit --package-lock-only --ignore-scripts --json`: baseline has one high
  and four moderate findings; the updated lockfile reports zero.
- `node --test tools/test-dependency-security.cjs`: baseline **2 passed / 5
  failed**, updated **7/7 passed**. Tests cover every locked copy of the affected
  libraries, cross-realm headers in object and array form, cancellation without
  continued child-directory reads, formatting output, matching and the actual
  formatter CLI with EditorConfig. The CLI assertion reads its output file,
  because glob-selected inputs are formatted in place.
- `npm ci --ignore-scripts` and `npm ls follow-redirects glob minimatch
  editorconfig js-beautify`: clean install and valid scoped resolutions.
- The new tests run under the existing `npm run test:security` CI step.
- `npm run audit:dependencies`: both npm projects report zero findings; vendored
  screenshot assets, .NET packages/runtime, static SVG assets and all registered
  GitHub Actions pass their existing checks. No audit policy is relaxed.
- All 45 Node/npm application-check commands from the existing verification
  workflow pass locally, including the expanded security test command.

The lockfile and behavior regressions supplement the existing full dependency
audit; they do not replace live advisory checks or guarantee absence of unknown
vulnerabilities.
