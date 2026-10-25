const { fetchWikiPage } = require('./wiki-http');
const cheerio = require("cheerio");
const beautify = require("js-beautify").html;
require("module-alias/register");
const { country_code, vehicle_type } = require('../dict/country_code');

async function fetchTreeHTML(t_c, type = "ground", options = {}) {
  if (!country_code.includes(t_c) || !vehicle_type.includes(type)) throw new Error('Invalid Wiki tree arguments');
  const url = `https://wiki.warthunder.com/${type}?v=t&t_c=${t_c}`;
  console.log(`Requesting Wiki tree: ${url}`);

  try {
    const data = await fetchWikiPage(url, { signal: options.signal });

    const $ = cheerio.load(data);
    const $div = $(`div.unit-tree[data-tree-id="${t_c}"]`);

    if (!$div.length) {
      console.error(`Cannot find div.unit-tree[data-tree-id="${t_c}"]`);
      return null;
    }

    return beautify($.html($div), {
      indent_size: 2,
      preserve_newlines: true,
      max_preserve_newlines: 1,
      end_with_newline: true,
    });
  } catch (err) {
    if (options.signal?.aborted) throw err;
    console.error("Wiki tree request failed:", err.message);
    return null;
  }
}

module.exports = { fetchTreeHTML };
