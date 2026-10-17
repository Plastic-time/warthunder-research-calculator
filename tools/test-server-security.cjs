const assert = require("node:assert/strict");
const { test } = require("node:test");
const { once } = require("node:events");
const express = require("express");
const http = require("node:http");
// Native HTTP preserves intentionally forged Host/Fetch-Metadata test headers.
function fetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, options, res => {
      const chunks = [];
      res.on("data", chunk => chunks.push(chunk));
      res.on("end", () => resolve(new Response(Buffer.concat(chunks), { status: res.statusCode, headers: res.headers })));
    });
    req.on("error", reject);
    req.end(options.body);
  });
}
const { createSecurity } = require("../src/server-security");
const updatePath = require.resolve("../src/4-fill_tree_details");
const original = require(updatePath);
let calls = 0;
require.cache[updatePath].exports = { ...original, updateTree: async (country, type, options) => {
  calls++;
  options.onReview({ policy: 'wiki-presentation-only', requiresReview: true,
    conflicts: [{}], added: [], missing: [], updated: [{}] });
  return [];
} };
const detailsPath = require.resolve("../src/3-request_details");
require.cache[detailsPath] = { id: detailsPath, filename: detailsPath, loaded: true,
  exports: { request_details: async () => { throw new Error("PRIVATE_PATH_AND_SECRET"); } } };
delete process.env.WT_HOST;
delete process.env.WT_ADMIN_TOKEN;
const app = require("../main");

test("local server security boundaries (no external requests or database writes)", async t => {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (url, options) => fetch(base + url, options);
  const update = (token, body = {}) => request("/api/update/usa/ground", { method: "POST",
    headers: { "Content-Type": "application/json", "X-WT-Update-Token": token || "" }, body: JSON.stringify(body) });

  await t.test("normal reads still work", async () => {
    const response = await request("/api/meta");
    assert.equal(response.status, 200);
    assert.equal((await response.json()).countries.length, 10);
    assert.equal(response.headers.get("access-control-allow-origin"), null);
    assert.equal(response.headers.get("x-powered-by"), null);
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  });
  await t.test("cross-origin, opaque origin, and rebinding hosts are blocked", async () => {
    for (const headers of [{ Origin: "https://untrusted.invalid" }, { Origin: "null" },
      { Host: "rebind.invalid" }, { "Sec-Fetch-Site": "cross-site" }]) {
      assert.equal((await request("/api/session", { headers })).status, 403);
    }
    assert.equal((await request("/api/update/usa/ground", { method: "OPTIONS", headers: {
      Origin: "https://untrusted.invalid", "Access-Control-Request-Method": "POST"
    } })).status, 403);
  });
  await t.test("unauthorized updates cannot execute", async () => {
    assert.equal((await update()).status, 403);
    assert.equal((await update("incorrect-token")).status, 403);
    assert.equal(calls, 0);
  });
  await t.test("error bodies never include internal details", async () => {
    const response = await request("/api/update/usa/ground", { method: "POST",
      headers: { "Content-Type": "application/json" }, body: "{" });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { success: false, error: "Invalid request" });
    const detail = await request("/api/unit/test_unit");
    assert.equal(detail.status, 500);
    assert.equal((await detail.text()).includes("PRIVATE_PATH_AND_SECRET"), false);
    assert.equal((await request("/api/unit/%2e%2e%2fsecret")).status, 400);
  });
  const sessionResponse = await request("/api/session", { headers: { Origin: base } });
  assert.equal(sessionResponse.headers.get("cache-control"), "no-store");
  const { token } = await sessionResponse.json();
  assert.match(token, /^[0-9a-f]{64}$/);
  await t.test("invalid limits do not execute or consume update slot", async () => {
    for (const limit of [-1, 0, 1.5, "invalid", 100000, null, true, [], {}]) {
      assert.equal((await update(token, { limit })).status, 400);
    }
    assert.equal(calls, 0);
  });
  await t.test("authorized update succeeds once, repeated work is throttled", async () => {
    const response = await update(token, { limit: 4 });
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).review, { policy: 'wiki-presentation-only', requiresReview: true,
      conflicts: 1, added: 0, missing: 0, presentationChanges: 1 });
    assert.equal((await update(token, { limit: 4 })).status, 429);
    assert.equal(calls, 1);
  });
  await t.test("upstream requests have a bounded rate", async () => {
    for (let i = 0; i < 20; i++) await request("/api/unit/test_unit");
    assert.equal((await request("/api/unit/test_unit")).status, 429);
  });
});

test("hosted mode never exposes administrator token", async t => {
  assert.throws(() => createSecurity({ WT_HOST: "0.0.0.0" }));
  assert.throws(() => createSecurity({ WT_ADMIN_TOKEN: "short" }));
  const config = { WT_HOST: "0.0.0.0", WT_PUBLIC_ORIGIN: "https://calculator.example",
    WT_ENABLE_UPDATES: "1", WT_ADMIN_TOKEN: "x".repeat(40) };
  const security = createSecurity(config);
  const hosted = express();
  hosted.use(security.guard);
  hosted.get("/api/session", security.session);
  hosted.post("/api/update", security.authorizeUpdate, (req, res) => res.json({ success: true }));
  const server = hosted.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = { Host: "calculator.example", Origin: config.WT_PUBLIC_ORIGIN, "Content-Type": "application/json" };
  const response = await fetch(base + "/api/session", { headers });
  assert.equal(response.status, 403);
  assert.equal((await response.text()).includes(config.WT_ADMIN_TOKEN), false);
  assert.equal((await fetch(base + "/api/update", { method: "POST", headers })).status, 403);
  assert.equal((await fetch(base + "/api/update", { method: "POST", headers: {
    ...headers, "X-WT-Update-Token": config.WT_ADMIN_TOKEN
  } })).status, 200);
});
