require("module-alias/register");
const fs = require("fs");
const path = require("path");
const { randomUUID } = require("node:crypto");
const { setTimeout: delay } = require("node:timers/promises");
const { vehicle_type, country_code } = require("@/dict/country_code");
const { fetchTreeHTML } = require("./1-extract_tree_div");
const { extract_rank_tb } = require("./2-extract_rank_tb");
const { request_details } = require("./3-request_details");
const { protectWikiTree } = require("./wiki-refresh-guard");
const { writeWikiRefreshReport } = require("./wiki-refresh-report");

const activeTrees = new Set();

function validateLimit(value = process.env.WT_WIKI_LIMIT || 5) {
  if (!((typeof value === "number") || (typeof value === "string" && /^[1-8]$/.test(value))) ||
      !Number.isInteger(Number(value)) || Number(value) < 1 || Number(value) > 8) {
    throw Object.assign(new Error("Concurrency must be an integer from 1 to 8"), { statusCode: 400 });
  }
  return Number(value);
}

async function get_tree_data(t_c, type, options) {
  const html = await fetchTreeHTML(t_c, type, options);
  if (!html) throw new Error("Wiki tree request failed");
  return extract_rank_tb(html, t_c, type);
}

function collectSingleItems(tree_data) {
  const singles = [];
  const seen = new Set();

  for (const rank of tree_data) {
    const cols = [...(rank.researchable_vehicles || []), ...(rank.premium_vehicles || [])];
    for (const col of cols) {
      for (const item of col) {
        if (item.type === "single" && !seen.has(item.data_unit_id)) {
          seen.add(item.data_unit_id);
          singles.push(item);
        } else if (item.type === "multiple" && Array.isArray(item.items)) {
          for (const subItem of item.items) {
            if (subItem.type === "single" && !seen.has(subItem.data_unit_id)) {
              seen.add(subItem.data_unit_id);
              singles.push(subItem);
            }
          }
        }
      }
    }
  }

  return singles;
}

function processMultipleItems(tree_data) {
  for (const rank of tree_data) {
    const cols = [...(rank.researchable_vehicles || []), ...(rank.premium_vehicles || [])];
    for (const col of cols) {
      for (const item of col) {
        if (item.type !== "multiple" || !Array.isArray(item.items)) continue;

        const brs = item.items.map((sub) => parseFloat(sub.br)).filter((b) => !Number.isNaN(b));
        if (brs.length > 0) {
          const min = Math.min(...brs);
          const max = Math.max(...brs);
          item.br = min === max ? `${min.toFixed(1)}` : `${min.toFixed(1)}-${max.toFixed(1)}`;
        }
        const isSquadronGroup = String(item.class_name || "").toLowerCase() === "squad";
        if (isSquadronGroup) {
          item.items.forEach((subItem) => {
            subItem.class_name = subItem.class_name || "squad";
            subItem.is_squadron = true;
            subItem.rp = 0;
            subItem.sp = 0;
          });
        }
        item.rp = isSquadronGroup ? 0 : item.items.reduce((sum, sub) => sum + parseNumber(sub.rp), 0);
        item.sp = isSquadronGroup ? 0 : item.items.reduce((sum, sub) => sum + parseNumber(sub.sp), 0);
        item.details = true;
      }
    }
  }
}

function parseNumber(value) {
  if (typeof value === "number") return value;
  if (!value) return 0;
  const number = Number(String(value).replace(/[^\d.-]/g, ""));
  return Number.isFinite(number) ? number : 0;
}

async function asyncQueue(items, handler, limit, showProgress = true) {
  const results = [];
  let index = 0;
  let active = 0;
  let completed = 0;
  const total = items.length;
  const startTime = Date.now();

  const printProgress = () => {
    if (!showProgress || total === 0) return;
    const percent = ((completed / total) * 100).toFixed(1);
    const barLength = 30;
    const filledLength = Math.round((barLength * completed) / total);
    const bar = "#".repeat(filledLength) + "-".repeat(barLength - filledLength);
    process.stdout.write(`\rProgress [${bar}] ${percent}% (${completed}/${total})`);
  };

  return new Promise((resolve, reject) => {
    let failure;
    const next = () => {
      if (failure) {
        if (active === 0) reject(failure);
        return;
      }
      if (index >= total && active === 0) {
        const time = ((Date.now() - startTime) / 1000).toFixed(1);
        if (showProgress) console.log(`\nCompleted ${total} items in ${time}s`);
        return resolve(results);
      }

      while (active < limit && index < total) {
        const current = index++;
        active++;
        handler(items[current])
          .then((res) => results.push(res))
          .catch((err) => { failure = err; })
          .finally(() => {
            active--;
            completed++;
            printProgress();
            next();
          });
      }
    };
    next();
  });
}

async function retry(fn, args, signal, attempts = 3, retryDelay = 700) {
  let lastError;
  for (let i = 0; i < attempts; i++) {
    try {
      signal.throwIfAborted();
      return await fn(...args);
    } catch (err) {
      lastError = err;
      signal.throwIfAborted();
      if (i < attempts - 1) await delay(retryDelay, undefined, { signal });
    }
  }
  throw lastError;
}

function getOutputPath(t_c, type) {
  const dir = path.join(__dirname, "..", "database", t_c);
  return {
    dir,
    file: path.join(dir, `${t_c}_${type}.json`),
  };
}

async function updateTree(t_c, type, options = {}) {
  const limit = validateLimit(options.limit);
  if (!country_code.includes(t_c) || !vehicle_type.includes(type)) {
    throw Object.assign(new Error("Invalid tree"), { statusCode: 400 });
  }
  const key = `${t_c}/${type}`;
  if (activeTrees.has(key)) throw Object.assign(new Error("Update in progress"), { statusCode: 409 });
  activeTrees.add(key);
  const timeout = AbortSignal.timeout(5 * 60 * 1000);
  const signal = options.signal ? AbortSignal.any([timeout, options.signal]) : timeout;
  let temporary;
  try {
  signal.throwIfAborted();
  const { dir, file } = getOutputPath(t_c, type);
  // Wiki cannot bootstrap reviewed prices, prerequisites or vehicle membership.
  const previousBytes = fs.readFileSync(file, "utf8");
  const previous = JSON.parse(previousBytes);
  const tree_data = await get_tree_data(t_c, type, { signal });
  const singleItems = collectSingleItems(tree_data);
  if (!singleItems.length) throw new Error("Refusing to replace tree with empty data");

  console.log(`Found ${singleItems.length} unit detail pages for ${t_c}-${type}`);

  await asyncQueue(
    singleItems,
    async (item) => {
      const res = await retry(request_details, [item.data_unit_id, { signal }], signal, options.attempts || 3);
      const isSquadron = String(item.class_name || "").toLowerCase() === "squad";
      Object.assign(item, res, {
        details: true,
        is_squadron: isSquadron,
        rp: isSquadron ? 0 : res.rp,
        sp: isSquadron ? 0 : res.sp,
      });
    },
    limit,
    options.showProgress !== false
  );

  processMultipleItems(tree_data);

  const { tree, report } = protectWikiTree(previous, tree_data);
  const reportFile = path.join(__dirname, "..", "logs", "wiki-update-review", `${t_c}_${type}.json`);
  writeWikiRefreshReport(reportFile, { country: t_c, type, protectedChangesApplied: false, ...report });
  signal.throwIfAborted();
  if (fs.readFileSync(file, "utf8") !== previousBytes) throw new Error("Tree changed during Wiki refresh; reviewed data was not replaced");
  fs.mkdirSync(dir, { recursive: true });
  temporary = `${file}.${randomUUID()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(tree, null, 2), { encoding: "utf-8", flag: "wx" });
  fs.renameSync(temporary, file);
  temporary = undefined;
  console.log(`Refreshed Wiki presentation for ${t_c}/${type}; protected data unchanged. Review: logs/wiki-update-review/${t_c}_${type}.json`);
  if (report.requiresReview) console.warn(`Wiki differences retained for review: ${report.conflicts.length} field conflicts, ${report.added.length} added and ${report.missing.length} missing nodes`);
  if (options.onReview) options.onReview(report);

  return tree;
  } catch (error) {
    if (timeout.aborted) throw Object.assign(new Error("Update timed out"), { statusCode: 504 });
    throw error;
  } finally {
    if (temporary) fs.rmSync(temporary, { force: true });
    activeTrees.delete(key);
  }
}

async function updateMany(countries = country_code, types = vehicle_type, options = {}) {
  const totalStart = Date.now();

  for (const t_c of countries) {
    for (const type of types) {
      const taskStart = Date.now();
      console.log(`\nUpdating ${t_c}-${type}`);
      await updateTree(t_c, type, options);
      const elapsed = ((Date.now() - taskStart) / 1000).toFixed(1);
      console.log(`Finished ${t_c}-${type} in ${elapsed}s`);
    }
  }

  const totalElapsed = ((Date.now() - totalStart) / 1000 / 60).toFixed(2);
  console.log(`\nAll requested trees updated in ${totalElapsed} minutes`);
}

function parseCliArgs(argv) {
  const [countryArg, typeArg] = argv;
  const countries = countryArg && countryArg !== "all" ? countryArg.split(",") : country_code;
  const types = typeArg && typeArg !== "all" ? typeArg.split(",") : vehicle_type;

  const invalidCountries = countries.filter((country) => !country_code.includes(country));
  const invalidTypes = types.filter((type) => !vehicle_type.includes(type));
  if (invalidCountries.length || invalidTypes.length) {
    throw new Error(
      `Invalid arguments. Countries: ${invalidCountries.join(", ") || "ok"}; types: ${invalidTypes.join(", ") || "ok"}`
    );
  }

  return { countries, types };
}

if (require.main === module) {
  const { countries, types } = parseCliArgs(process.argv.slice(2));
  updateMany(countries, types).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = {
  validateLimit,
  updateTree,
  updateMany,
  collectSingleItems,
  processMultipleItems,
};
