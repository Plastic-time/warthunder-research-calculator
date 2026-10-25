# Server Security

The default host is 127.0.0.1. The normal desktop update button uses a temporary
per-process token. Tokens are not written to files or browser localStorage.
Do not disable the request-host or origin checks.

For explicit hosted deployment, set WT_HOST=0.0.0.0 and WT_PUBLIC_ORIGIN to the
canonical external origin (scheme and host, no trailing slash). Render's
RENDER_EXTERNAL_URL can supply the origin instead. Set NODE_ENV=production.
Bind only behind a trusted HTTPS reverse proxy and network access controls.

Hosted updates are disabled by default. Administrators can set WT_ENABLE_UPDATES=1
and provide a random WT_ADMIN_TOKEN of at least 32 bytes through private host
environment settings. Send it in the X-WT-Update-Token header when calling the
JSON update API. The hosted browser cannot retrieve this token; its ordinary
update button is intentionally unavailable. Never put the token in source,
URLs, screenshots, release notes, logs, or a static frontend.

Concurrency is 1-8 (default 5), one HTTP update at a time with a 60-second
cooldown and a five-minute task deadline. Wiki proxy endpoints allow at most two
simultaneous requests and 20 requests per minute per server process. These
limits are process-local, not a distributed rate limiter.

Saved plans and modification selections remain in local browser storage.
Clear this site's browser data after using a shared computer. Third-party
vehicle images still require network requests. The app sends no-referrer from
its local server; the static site's matching meta policy covers Pages.

Git hooks and CI inspect common secrets, personal directories and email
addresses before publication. They supplement, not replace, GitHub account
email privacy settings and human review. Public-source code is not encrypted.

## Wiki Network Boundary

The two runtime Wiki readers share `src/wiki-http.js`. Initial destinations
and every redirect must remain on `https://wiki.warthunder.com`, without URL
credentials, alternate ports or fragments. Up to three same-origin redirects
are permitted. Axios uses its HTTP adapter with automatic redirects disabled;
the application validates each Location before issuing the next request.
The complete chain shares a 30-second cancellation deadline. Responses retain
the 12 MiB size limit, and tree arguments are validated before network access.
TLS validation and configured network proxies remain intact. This prevents
redirect-based destination changes; it is not protection against compromised
upstream content, a compromised trusted proxy/CA or arbitrary DNS manipulation.
Run `npm run test:wiki-http` to check the boundary without external requests.

## Desktop Launcher Boundary

The launcher finds the app only beside itself, not in the working directory or
parent folders. It prefers the bundled `node.exe`, then an explicitly absolute
PATH entry; relative entries are ignored. The installation directory and the
user's absolute PATH remain trusted inputs, not authenticated binaries.
The script argument is an absolute path and no command shell is used.

The desktop child process explicitly binds to `127.0.0.1:3000`. Hosted update
settings and administrator tokens are not inherited, nor are `NODE_OPTIONS`
and `NODE_PATH` preload settings. This applies to the launcher only; explicit
hosted deployments using `node main.js` retain their existing configuration.
The health probe uses literal loopback, no proxy, no redirect, a two-second
timeout and a 4 KiB body limit. Only an HTTP 200 JSON response with the expected
service name and `success: true` is accepted, not any successful web page.
This identifies accidental port conflicts, not a malicious local process
deliberately imitating the response. Existing processes are never killed.

The browser still opens `http://localhost:3000`, preserving its saved plans.
`npm run test:launcher-security` needs .NET 10 SDK and compiles the production
policy with a package-free, temporary test harness. Fixture executables are
never run. Application Checks also builds the real Windows launcher after
the locked restore/audit; Release runs the same security tests before packaging.
Source archives include `LaunchPolicy.cs`. A source-only push does not patch
previously downloaded installers; these changes take effect in the next build.
