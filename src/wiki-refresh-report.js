const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

function writeWikiRefreshReport(file, report) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify({ checkedAt: new Date().toISOString(), ...report }, null, 2) + "\n", { flag: "wx" });
    fs.renameSync(temporary, file);
  } finally {
    if (fs.existsSync(temporary)) fs.rmSync(temporary);
  }
}

module.exports = { writeWikiRefreshReport };
