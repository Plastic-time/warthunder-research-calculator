# Web Cache Checks

## Scope

The October 17 review found unchanged script URLs after updates to
`app-translations.js`, `research-progress.js`, and `press-feedback.js`.
`roster.js` also fetched classification data without explicit revalidation.
The rank-rule cache omission was fixed separately before this review.

Both entrypoints now use content-derived revisions for every local script,
stylesheet, favicon and HTML image. CSS font and icon URLs are versioned too.
The generated `asset-urls.js` resolves dynamic navigation, Wiki, empty-state
and ammunition image URLs. It does not rewrite third-party URLs.

The backend sends `Cache-Control: no-cache` for static responses, allowing
conditional requests without trusting a fresh obsolete response. Existing API
responses remain `no-store`; authentication and origin checks are unchanged.

## Data Requests

| Resource | Policy |
| --- | --- |
| Static tree manifest | Revalidate on page initialization |
| Tree JSON | Hash-versioned URL, revalidation and SHA-256 verification |
| Modification catalog | Revalidate on first access in the page |
| Modification chunks | Hash-versioned URL, revalidation and SHA-256 verification |
| Vehicle and modification translations | Revalidate on load |
| Vehicle classification | Revalidate on load in both versions |
| Online count and backend API | No-store |

The existing in-page caches for tree state and modification chunks remain.
They are not persistent browser-cache replacements. Reloading the page starts
a new session with current indexes. Saved plans and RP progress are not cleared.

## Updating Assets

After editing scripts, styles, icons, fonts or local images, run:

```sh
npm run sync:web-assets
npm run check:web-assets
npm run test:web-assets
```

Commit the generated files and URL changes with the source edits. The sync
command preserves HTML formatting and only updates cache-related references;
it does not change styles, game data or the planning algorithm. Text hashes
normalize Git line endings so Windows and Linux produce the same revisions.

Application Checks and the Pages deployment both reject stale revisions.
Pages checks run before artifact upload, rather than relying on a separate
workflow to finish first. Missing local assets also block these checks.

With Playwright and Chrome available, the additional browser check is:

```sh
node tools/check-web-cache.cjs
node tools/check-planning-rule-cache.cjs
```

These use isolated browser contexts and loopback test servers. They prime a
real HTTP cache with old scripts, styles and data, prove cache reuse, then
serve the new entrypoint without clearing cache or localStorage. Coverage
includes both versions at desktop and mobile sizes, seven languages, local
images/fonts, modification selection, saved targets, ownership and RP progress.

## Limits

Already-open pages do not hot-swap running code or interrupt an active edit.
Reload after a deployment to load the new entrypoint. GitHub Pages controls
its own HTML/CDN cache headers; repository settings cannot override them.
A versioned page link can bypass a previously cached HTML response.

Third-party Wiki images are controlled by their host. This policy versions
local assets, not remote image bytes. Mobile browser emulation is not a
physical-device or Safari compatibility claim.
