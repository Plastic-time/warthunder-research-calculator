(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PlanStorage = api.create(() => root.localStorage, code => {
    document.dispatchEvent(new CustomEvent('wt-storage-warning', { detail: code }));
  });
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const MAX_BYTES = 5 * 1024 * 1024;
  const FORMAT = 'war-thunder-research-plans';
  const countries = 'usa|germany|ussr|britain|japan|china|italy|france|sweden|israel';
  const treeKey = new RegExp(`^wt-research:(${countries}):(ground|aviation|helicopters|ships|boats)$`);
  const modKey = /^wt-research:modifications:([a-zA-Z0-9_-]{1,160})$/;
  const fail = code => { throw Object.assign(new Error(code), { code }); };
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const id = value => typeof value === 'string' && value.length > 0 && value.length <= 256
    && !/[\u0000-\u001f\u007f]/.test(value) && !['__proto__', 'prototype', 'constructor'].includes(value);
  function kind(key) { return treeKey.test(key) ? 'tree' : modKey.test(key) ? 'mods' : null; }
  function ids(value = []) {
    if (!Array.isArray(value) || value.length > 10000 || !value.every(id)) fail('invalid');
    return [...new Set(value)];
  }
  function progress(value = {}) {
    if (!object(value) || Object.keys(value).length > 10000) fail('invalid');
    const result = Object.create(null);
    for (const [key, amount] of Object.entries(value)) {
      if (!id(key) || !Number.isSafeInteger(amount) || amount < 0) fail('invalid');
      if (amount) result[key] = amount;
    }
    return result;
  }
  function boolean(value, fallback) {
    if (value === undefined) return fallback;
    if (typeof value !== 'boolean') fail('invalid');
    return value;
  }
  function normalize(key, value) {
    const type = kind(key);
    if (!type || !object(value)) fail('invalid');
    if (type === 'mods') return {
      selected: ids(value.selected), researched: ids(value.researched),
      progressRp: progress(value.progressRp), airCombat: boolean(value.airCombat, true),
    };
    const mode = value.dependencyMode ?? 'selected';
    if (!['selected', 'required'].includes(mode)) fail('invalid');
    let route = null;
    if (value.route != null) {
      if (!object(value.route)) fail('invalid');
      const roles = value.route.removedAutoRoles ?? {};
      if (!object(roles) || Object.keys(roles).length > 10000) fail('invalid');
      const removedAutoRoles = Object.create(null);
      for (const [key, role] of Object.entries(roles)) {
        if (!id(key) || !['filler', 'route'].includes(role)) fail('invalid');
        removedAutoRoles[key] = role;
      }
      route = { selectedIds: ids(value.route.selectedIds), fillerIds: ids(value.route.fillerIds), removedAutoRoles };
    }
    return { planned: ids(value.planned), owned: ids(value.owned), waypoints: ids(value.waypoints),
      progressRp: progress(value.progressRp), avoidFolded: boolean(value.avoidFolded, false), dependencyMode: mode, route };
  }
  function parse(text) {
    if (typeof text !== 'string' || new TextEncoder().encode(text).length > MAX_BYTES) fail('invalid');
    let data;
    try { data = JSON.parse(text); } catch { fail('invalid'); }
    if (!object(data) || data.format !== FORMAT) fail('invalid');
    if (data.version !== 1) fail('version');
    if (!Array.isArray(data.records) || !data.records.length || data.records.length > 10000) fail('invalid');
    if (typeof data.createdAt !== 'string' || !Number.isFinite(Date.parse(data.createdAt))) fail('invalid');
    const seen = new Set();
    const records = data.records.map(entry => {
      if (!object(entry) || typeof entry.key !== 'string' || seen.has(entry.key)) fail('invalid');
      seen.add(entry.key);
      return { key: entry.key, value: normalize(entry.key, entry.value) };
    });
    return { format: FORMAT, version: 1, createdAt: data.createdAt, records };
  }
  function create(getStorage, warn = () => {}) {
    const pending = new Map();
    function read(key) {
      if (pending.has(key)) return normalize(key, pending.get(key));
      try {
        const raw = getStorage().getItem(key);
        return raw === null ? normalize(key, {}) : normalize(key, JSON.parse(raw));
      } catch { warn('read'); return normalize(key, {}); }
    }
    function write(key, value) {
      const clean = normalize(key, value);
      pending.set(key, clean);
      try {
        const storage = getStorage();
        const old = storage.getItem(key);
        // Keep damaged source records intact until an explicit restore replaces them.
        if (old !== null) normalize(key, JSON.parse(old));
        storage.setItem(key, JSON.stringify(clean));
        pending.delete(key);
        return true;
      } catch { warn('write'); return false; }
    }
    function capture() {
      let storage;
      const keys = new Set(pending.keys());
      try {
        storage = getStorage();
        for (let i = 0; i < storage.length; i++) {
          const key = storage.key(i);
          if (kind(key)) keys.add(key);
        }
      } catch { fail('storage'); }
      const records = [...keys].sort().map(key => {
        try { return { key, value: normalize(key, pending.has(key) ? pending.get(key) : JSON.parse(storage.getItem(key))) }; }
        catch { fail('corrupt'); }
      });
      if (!records.length) fail('empty');
      const data = { format: FORMAT, version: 1, createdAt: new Date().toISOString(), records };
      parse(JSON.stringify(data, null, 2));
      return data;
    }
    function preview(data) {
      const clean = parse(JSON.stringify(data));
      const before = new Map();
      const memory = new Map();
      let overwritten = 0;
      try {
        const storage = getStorage();
        for (const record of clean.records) {
          const raw = storage.getItem(record.key);
          before.set(record.key, raw);
          memory.set(record.key, JSON.stringify(pending.get(record.key)));
          if (raw !== null || pending.has(record.key)) overwritten++;
        }
      } catch { fail('storage'); }
      return { data: clean, before, memory, overwritten };
    }
    function restore(ticket) {
      const clean = parse(JSON.stringify(ticket.data));
      let storage;
      try { storage = getStorage(); } catch { fail('storage'); }
      for (const {key} of clean.records) {
        let current;
        try { current = storage.getItem(key); } catch { fail('storage'); }
        if (!ticket.before.has(key) || current !== ticket.before.get(key)
          || JSON.stringify(pending.get(key)) !== ticket.memory.get(key)) fail('changed');
      }
      const written = [];
      try {
        for (const {key, value} of clean.records) {
          storage.setItem(key, JSON.stringify(value));
          written.push(key);
        }
      } catch {
        let rollbackFailed = false;
        for (const key of written.reverse()) {
          try {
            const old = ticket.before.get(key);
            if (old === null) storage.removeItem(key); else storage.setItem(key, old);
          } catch { rollbackFailed = true; }
        }
        fail(rollbackFailed ? 'rollback' : 'storage');
      }
      for (const {key} of clean.records) pending.delete(key);
      return clean.records.length;
    }
    return { read, write, capture, preview, restore, parse, kind, MAX_BYTES };
  }
  return { create, normalize, parse, kind, MAX_BYTES };
});
