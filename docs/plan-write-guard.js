(() => {
  'use strict';
  let database;
  const error = code => Object.assign(new Error(code), { code });
  function open() {
    if (!database) {
      database = new Promise((resolve, reject) => {
        const request = indexedDB.open('wt-research-save-guard', 1);
        let finished = false;
        const fail = () => { if (!finished) { finished = true; clearTimeout(timer); reject(error('storage')); } };
        const timer = setTimeout(fail, 5000);
        request.onupgradeneeded = () => request.result.createObjectStore('revisions');
        request.onerror = request.onblocked = fail;
        request.onsuccess = () => {
          if (finished) { request.result.close(); return; }
          finished = true; clearTimeout(timer);
          const db = request.result;
          db.onversionchange = () => { db.close(); database = null; };
          resolve(db);
        };
      }).catch(reason => { database = null; throw reason; });
    }
    return database;
  }
  async function digest(raw) {
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw === null ? 'missing:' : 'record:' + raw));
    return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  }
  async function run(action, options) {
    if (!navigator.locks || !globalThis.indexedDB || !crypto.subtle) throw error('storage');
    return navigator.locks.request('wt-research-plan-write', { signal: AbortSignal.timeout(5000) }, async () => {
      const before = options.before();
      const rows = [];
      for (const [key, raw] of options.after) rows.push({ key, before: await digest(before.get(key)), after: await digest(raw) });
      const db = await open();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction('revisions', 'readwrite');
        const store = transaction.objectStore('revisions');
        const rollback = new Map();
        let remaining = rows.length, result, reason;
        function abort(code) { if (!reason) { reason = error(code); transaction.abort(); } }
        function commit() {
          try {
            for (const { key } of rows) rollback.set(key, localStorage.getItem(key));
            result = action();
            if (result === false) { rollback.clear(); return; }
            for (const row of rows) store.put(row.after, row.key);
          } catch (failure) { reason = failure; transaction.abort(); }
        }
        for (const row of rows) {
          const request = store.get(row.key);
          request.onsuccess = () => {
            if (reason) return;
            // A transaction sees the latest committed revision even when a tab's localStorage is stale.
            const changed = options.restore
              ? !options.revisions?.has(row.key) || (request.result ?? null) !== options.revisions.get(row.key)
              : request.result !== undefined && request.result !== row.before;
            if (changed) { abort('changed'); return; }
            if (--remaining === 0) commit();
          };
        }
        transaction.oncomplete = () => resolve(result);
        transaction.onabort = () => {
          let rollbackFailed = false;
          for (const [key, raw] of rollback) {
            try {
              const current = localStorage.getItem(key);
              if (current === raw) continue;
              if (current !== options.after.get(key)) { rollbackFailed = true; continue; }
              if (raw === null) localStorage.removeItem(key); else localStorage.setItem(key, raw);
            } catch { rollbackFailed = true; }
          }
          reject(rollbackFailed ? error('rollback') : reason || error('storage'));
        };
      });
    });
  }
  async function preview(build) {
    if (!navigator.locks) throw error('storage');
    return navigator.locks.request('wt-research-plan-write', { signal: AbortSignal.timeout(5000) }, async () => {
      const ticket = build();
      const db = await open();
      ticket.revisions = await new Promise((resolve, reject) => {
        const transaction = db.transaction('revisions', 'readonly');
        const result = new Map();
        for (const key of ticket.before.keys()) {
          const request = transaction.objectStore('revisions').get(key);
          request.onsuccess = () => result.set(key, request.result ?? null);
        }
        transaction.oncomplete = () => resolve(result);
        transaction.onabort = () => reject(error('storage'));
      });
      return ticket;
    });
  }
  window.PlanWriteGuard = { run, preview };
})();
