const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const cheerio = require("cheerio");
const { modificationIcon, ammunitionArt } = require("./modification-icons.cjs");
const { correctKa29, correction: ka29Correction } = require("./update-ka29-modifications.cjs");
const { correctDo217, isRemovedDo217Modification, correction: do217Correction } = require("./update-do217-modifications.cjs");
const { correctCa27, vehicleIds: ca27Ids, correction: ca27Correction } = require("./update-ca27-modifications.cjs");
const { gameRequirements } = require("./modification-requirements.cjs");
const { correctRafale, vehicleIds: rafaleIds, correction: rafaleCorrection } = require("./update-rafale-modifications.cjs");
const { correctGoldenEagle, vehicleIds: goldenEagleIds, correction: goldenEagleCorrection } = require("./update-golden-eagle-modifications.cjs");
const { correctF4u7, correction: f4u7Correction } = require("./update-f4u7-modifications.cjs");
const { correctOctober, vehicleIds: octoberIds, correction: octoberCorrection } = require("./update-october-modifications.cjs");

const root = path.resolve(__dirname, "..");
const datamineRoot = path.join(root, "logs", "datamine");
const wikiRoot = path.join(root, "logs", "wiki-refresh", "units");
const treeManifest = JSON.parse(fs.readFileSync(path.join(root, "docs", "database", "manifest.json"), "utf8"));
const vehicleNames = JSON.parse(fs.readFileSync(path.join(root, "docs", "vehicle-names.json"), "utf8")).names;
const wpcost = JSON.parse(fs.readFileSync(path.join(datamineRoot, "char.vromfs.bin_u", "config", "wpcost.blkx"), "utf8"));
const wpcostKeys = new Map(Object.keys(wpcost).map(key => [key.toLowerCase(), key]));
const datamineCommit = fs.readFileSync(path.join(datamineRoot, ".git", "refs", "heads", "master"), "utf8").trim();

const categoryChinese = {
  "Flight performance": "飞行性能",
  Survivability: "生存能力",
  Weaponry: "武器",
  Mobility: "机动性",
  Protection: "防护",
  Firepower: "火力",
  Seakeeping: "适航性",
  Unsinkability: "抗沉性",
};

const cleanText = value => String(value || "")
  .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")
  .replace(/\s+/g, " ")
  .trim();

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"') quoted = true;
    else if (character === ";") { row.push(field); field = ""; }
    else if (character === "\n") {
      row.push(field.replace(/\r$/, ""));
      if (row.some(Boolean)) rows.push(row);
      row = [];
      field = "";
    } else field += character;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function loadModificationNames() {
  const file = path.join(datamineRoot, "lang.vromfs.bin_u", "lang", "units_modifications.csv");
  const names = new Map();
  for (const row of parseCsv(fs.readFileSync(file, "utf8"))) {
    const match = row[0]?.match(/^modification\/(.+)$/);
    if (!match || match[1].includes("/")) continue;
    names.set(match[1], { en: cleanText(row[1]), zh: cleanText(row[10]) || cleanText(row[1]) });
  }
  return names;
}

function collectTreeUnits(tree, chunk, output) {
  for (const rank of tree) {
    for (const section of ["researchable_vehicles", "premium_vehicles"]) {
      for (const column of rank[section] || []) {
        for (const item of column) {
          if (item.type === "multiple") {
            for (const child of item.items || []) {
              if (child.data_unit_id) output.set(child.data_unit_id, { chunk, icon: child.vehicle_icon || "" });
            }
          } else if (item.type === "single" && item.data_unit_id) {
            output.set(item.data_unit_id, { chunk, icon: item.vehicle_icon || "" });
          }
        }
      }
    }
  }
}

function numberNearIcon(popover, alt) {
  const node = popover(`img[alt="${alt}"]`).first().parent();
  const match = node.text().replaceAll(",", "").match(/\d+/);
  return match ? Number(match[0]) : 0;
}

function parseVehicle(vehicleId, meta, modificationNames, report) {
  const wikiPath = path.join(wikiRoot, `${vehicleId}.html`);
  if (!fs.existsSync(wikiPath)) {
    report.missingWiki.push(vehicleId);
    return null;
  }
  const html = fs.readFileSync(wikiPath, "utf8");
  const artwork = ammunitionArt(html, vehicleId);
  const tableMatches = html.match(/<table class="game-unit_mods-table">[\s\S]*?<\/table>/g) || [];
  if (!tableMatches.length) {
    report.withoutTables.push(vehicleId);
    return null;
  }
  const economyKey = wpcostKeys.get(vehicleId.toLowerCase());
  const economy = economyKey ? wpcost[economyKey] : null;
  if (!economy?.modifications) report.missingGameConfig.push(vehicleId);

  const categories = [];
  const wikiMods = [];
  for (const tableHtml of tableMatches) {
    const $ = cheerio.load(tableHtml);
    const categoryEn = cleanText($("th").first().text());
    if (!categoryEn) continue;
    const categoryIndex = categories.length;
    let maxColumn = 0;
    $("tbody tr").each((rowIndex, row) => {
      let logicalColumn = 0;
      $(row).children("td").each((_, cell) => {
        const colspan = Math.max(1, Number($(cell).attr("colspan") || 1));
        const buttons = $(cell).find(".game-unit_mod");
        buttons.each((buttonIndex, buttonNode) => {
          const button = $(buttonNode);
          const id = button.attr("data-mod-id");
          if (!id || isRemovedDo217Modification(vehicleId, id)) return;
          const popover = cheerio.load(button.attr("data-feature-popover") || "");
          const wikiEn = cleanText(popover(".game-unit_popover-header span").first().text()) || cleanText(button.text());
          const localized = modificationNames.get(id) || {};
          wikiMods.push({
            id,
            categoryIndex,
            wikiTier: rowIndex + 1,
            column: logicalColumn + buttonIndex,
            zh: localized.zh || wikiEn,
            en: localized.en || wikiEn,
            icon: modificationIcon(meta.chunk, popover),
            rp: numberNearIcon(popover, "RP"),
            sl: numberNearIcon(popover, "SL"),
            ge: numberNearIcon(popover, "GE"),
          });
          maxColumn = Math.max(maxColumn, logicalColumn + buttonIndex + 1);
        });
        logicalColumn += colspan;
      });
    });
    categories.push([categoryChinese[categoryEn] || categoryEn, categoryEn, maxColumn]);
    if (!categoryChinese[categoryEn]) report.untranslatedCategories.add(categoryEn);
  }

  const visibleIds = new Set(wikiMods.map(mod => mod.id));
  const gameMods = economy?.modifications || {};
  const gameModKeys = new Map(Object.keys(gameMods).map(key => [key.toLowerCase(), key]));
  const mods = [];
  for (let order = 0; order < wikiMods.length; order += 1) {
    const wikiMod = wikiMods[order];
    const gameModKey = gameModKeys.get(wikiMod.id.toLowerCase());
    const gameMod = gameModKey ? gameMods[gameModKey] : null;
    if (!gameMod) {
      report.missingGameMods.push(`${vehicleId}:${wikiMod.id}`);
    }
    const tier = Number(gameMod?.tier || wikiMod.wikiTier);
    if (tier !== wikiMod.wikiTier) report.tierMismatches.push(`${vehicleId}:${wikiMod.id}:${wikiMod.wikiTier}->${tier}`);
    if (Number.isFinite(gameMod?.reqExp) && gameMod.reqExp !== wikiMod.rp) {
      report.costMismatches.push(`${vehicleId}:${wikiMod.id}:RP:${wikiMod.rp}->${gameMod.reqExp}`);
    }
    if (Number.isFinite(gameMod?.value) && gameMod.value !== wikiMod.sl) {
      report.costMismatches.push(`${vehicleId}:${wikiMod.id}:SL:${wikiMod.sl}->${gameMod.value}`);
    }
    const requirements = gameRequirements(gameMod, visibleIds);
    const rp = Number.isFinite(gameMod?.reqExp) ? gameMod.reqExp : wikiMod.rp;
    const sl = Number.isFinite(gameMod?.value) ? gameMod.value : wikiMod.sl;
    mods.push([
      wikiMod.id, wikiMod.categoryIndex, tier, wikiMod.column, wikiMod.zh, wikiMod.en,
      wikiMod.icon, rp, sl, wikiMod.ge, [...new Set(requirements)], order,
    ]);
    if (artwork.has(wikiMod.id)) mods.at(-1).push(artwork.get(wikiMod.id));
  }
  if (!mods.length) return null;

  const names = vehicleNames[vehicleId] || { zh: vehicleId, en: vehicleId };
  const tierRequirements = [1, 2, 3].map(tier => Number(economy?.[`needBuyToOpenNextInTier${tier}`] || 0));
  const totalRp = mods.reduce((sum, mod) => sum + mod[7], 0);
  const totalSl = mods.reduce((sum, mod) => sum + mod[8], 0);
  return {
    i: vehicleId,
    n: [cleanText(names.zh) || cleanText(names.en), cleanText(names.en) || vehicleId],
    v: meta.icon,
    r: tierRequirements,
    c: categories,
    t: [totalRp, totalSl],
    m: mods,
  };
}

function sha256(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

const units = new Map();
for (const entry of treeManifest.files) {
  const match = entry.path.match(/^database\/[^/]+\/(.+)\.json$/);
  if (!match) continue;
  const chunk = match[1];
  const tree = JSON.parse(fs.readFileSync(path.join(root, "docs", entry.path), "utf8"));
  collectTreeUnits(tree, chunk, units);
}
if (units.size !== treeManifest.unit_count) throw new Error(`Tree unit count ${units.size} != ${treeManifest.unit_count}`);

const modificationNames = loadModificationNames();
const report = {
  missingWiki: [], withoutTables: [], missingGameConfig: [], missingGameMods: [],
  tierMismatches: [], costMismatches: [], untranslatedCategories: new Set(),
};
const chunks = new Map();
const catalogVehicles = {};
let modificationCount = 0;

let processed = 0;
for (const [vehicleId, meta] of units) {
  const parsed = parseVehicle(vehicleId, meta, modificationNames, report);
  const vehicle = parsed ? correctOctober(correctF4u7(correctGoldenEagle(correctRafale(correctCa27(correctDo217(correctKa29(parsed))))))) : null;
  processed += 1;
  if (processed % 250 === 0) process.stdout.write(`\rParsed ${processed}/${units.size}`);
  if (!vehicle) continue;
  if (!chunks.has(meta.chunk)) chunks.set(meta.chunk, {});
  chunks.get(meta.chunk)[vehicleId] = vehicle;
  catalogVehicles[vehicleId] = meta.chunk;
  modificationCount += vehicle.m.length;
}
process.stdout.write(`\rParsed ${processed}/${units.size}\n`);

const catalogChunks = {};
for (const outputRoot of ["docs", "public"]) {
  const directory = path.join(root, outputRoot, "database", "modifications");
  fs.mkdirSync(directory, { recursive: true });
  for (const [chunk, vehicles] of chunks) {
    const content = `${JSON.stringify({ s: 2, k: chunk, v: vehicles })}\n`;
    fs.writeFileSync(path.join(directory, `${chunk}.json`), content);
    if (outputRoot === "docs") {
      catalogChunks[chunk] = {
        path: `database/modifications/${chunk}.json`,
        vehicles: Object.keys(vehicles).length,
        modifications: Object.values(vehicles).reduce((sum, vehicle) => sum + vehicle.m.length, 0),
        bytes: Buffer.byteLength(content),
        sha256: sha256(content),
      };
    }
  }
}

const catalog = {
  schema: 2,
  corrections: { 'f4u-7': f4u7Correction, ka_29: ka29Correction, do_217j_2: do217Correction, ...Object.fromEntries(ca27Ids.map(id => [id, ca27Correction])), ...Object.fromEntries(rafaleIds.map(id => [id, rafaleCorrection])), ...Object.fromEntries(goldenEagleIds.map(id => [id, goldenEagleCorrection])), ...Object.fromEntries(octoberIds.map(id => [id, octoberCorrection])) },
  version: "2.59.0.17",
  generatedAt: new Date().toISOString(),
  sources: {
    wikiSnapshot: treeManifest.fetched_to,
    datamineCommit,
    datamine: `https://github.com/gszabi99/War-Thunder-Datamine/tree/${datamineCommit}`,
  },
  stats: {
    treeUnits: units.size,
    vehicles: Object.keys(catalogVehicles).length,
    modifications: modificationCount,
    chunks: Object.keys(catalogChunks).length,
  },
  chunks: catalogChunks,
  vehicles: catalogVehicles,
  audit: {
    missingWiki: report.missingWiki.length,
    withoutTables: report.withoutTables.length,
    missingGameConfig: report.missingGameConfig.length,
    missingGameMods: report.missingGameMods.length,
    tierMismatches: report.tierMismatches.length,
    costMismatches: report.costMismatches.length,
  },
};
const catalogContent = `${JSON.stringify(catalog)}\n`;
for (const outputRoot of ["docs", "public"]) {
  fs.writeFileSync(path.join(root, outputRoot, "database", "modifications", "catalog.json"), catalogContent);
}

const audit = {
  ...catalog.audit,
  untranslatedCategories: [...report.untranslatedCategories].sort(),
  samples: {
    missingWiki: report.missingWiki.slice(0, 30),
    withoutTables: report.withoutTables.slice(0, 30),
    missingGameConfig: report.missingGameConfig.slice(0, 30),
    missingGameMods: report.missingGameMods.slice(0, 50),
    tierMismatches: report.tierMismatches.slice(0, 50),
    costMismatches: report.costMismatches.slice(0, 50),
  },
};
const auditContent = `${JSON.stringify(audit, null, 2)}\n`;
fs.writeFileSync(path.join(root, "logs", "modifications-audit.json"), auditContent);
fs.writeFileSync(path.join(root, "tools", "modifications-audit.json"), auditContent);
console.log(JSON.stringify({ ...catalog.stats, audit: catalog.audit, categories: audit.untranslatedCategories }, null, 2));
