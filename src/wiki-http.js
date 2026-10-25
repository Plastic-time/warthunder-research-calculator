const axios = require('axios');

const WIKI_ORIGIN = 'https://wiki.warthunder.com';
const REDIRECTS = new Set([301, 302, 303, 307, 308]);

function wikiUrl(value, base) {
  const url = new URL(value, base);
  if (url.origin !== WIKI_ORIGIN || url.username || url.password || url.hash) {
    throw new Error('Wiki redirect destination is not allowed');
  }
  return url;
}

async function fetchWikiPage(value, options = {}) {
  let url = wikiUrl(value);
  // One deadline covers the whole redirect chain, including response bodies.
  const deadline = AbortSignal.timeout(30000);
  const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
  for (let hop = 0; hop <= 3; hop++) {
    signal.throwIfAborted();
    const response = await axios.get(url.href, {
      adapter: 'http',
      maxRedirects: 0,
      timeout: 30000,
      signal,
      responseType: 'text',
      maxContentLength: 12 * 1024 * 1024,
      validateStatus: status => (status >= 200 && status < 300) || REDIRECTS.has(status),
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
    });
    if (!REDIRECTS.has(response.status)) return response.data;
    if (hop === 3) throw new Error('Too many Wiki redirects');
    const location = response.headers.location;
    if (typeof location !== 'string' || !location.trim()) throw new Error('Missing Wiki redirect destination');
    url = wikiUrl(location, url);
  }
}

module.exports = { fetchWikiPage };
