/**
 * Artificial Analysis — the documented V2 language-models catalog.
 *
 * The Free route is the one this site's key reaches; the Pro route
 * (`/api/v2/language/models`) answers 403 without a subscription. The
 * site takes the Intelligence Index and the speed medians from the Free
 * record (see AA_FACT_MAP in sync-aa.mjs).
 *
 * Attribution: this data is copyright Artificial Analysis. The site must
 * display a link to https://artificialanalysis.ai/ wherever these values
 * are shown.
 */

export const AA_CATALOG_URL = 'https://artificialanalysis.ai/api/v2/language/models/free';
export const AA_ATTRIBUTION = 'https://artificialanalysis.ai/';

/** True for a URL that needs the API key to fetch. The checker uses this
 *  to fetch an `aa_id` claim's source with the key attached. */
export function isAaApiUrl(url) {
  return typeof url === 'string' && url.startsWith('https://artificialanalysis.ai/api/');
}

/** Page through the Free catalog. Returns `{ meta, data }`, where `meta`
 *  is the first page's envelope minus `data`/`pagination` (it carries
 *  `tier` and `intelligence_index_version`). Throws on any non-200: the
 *  caller decides whether that is fatal. */
export async function fetchCatalog(apiKey) {
  const data = [];
  let meta = null;
  for (let page = 1; ; page++) {
    const res = await fetch(`${AA_CATALOG_URL}?page=${page}`, { headers: { 'x-api-key': apiKey } });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`AA returned ${res.status} on page ${page}: ${body.slice(0, 200)}`);
    }
    const body = await res.json();
    if (!Array.isArray(body?.data)) throw new Error(`AA page ${page} missing \`data\` array`);
    if (!meta) {
      const { data: _d, pagination: _p, ...rest } = body;
      meta = rest;
    }
    data.push(...body.data);
    if (!body.pagination?.has_more) break;
  }
  return { meta, data };
}
