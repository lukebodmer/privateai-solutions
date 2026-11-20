/**
 * OpenRouter — its public model catalog and per-model provider endpoints.
 *
 *   GET /api/v1/models                      every model, with `hugging_face_id`
 *   GET /api/v1/models/<id>/endpoints       every provider serving one model:
 *                                           prices, quantization, context
 *
 * Both answer without a key; with OPENROUTER_API_KEY the endpoints also
 * carry live latency/throughput, which the sync does not store (see
 * `providers` in factSchemas.ts). The key is sent when present.
 */

export const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';
export const OPENROUTER_ATTRIBUTION = 'https://openrouter.ai/';

export const endpointsUrl = id => `https://openrouter.ai/api/v1/models/${id}/endpoints`;
export const modelPageUrl = id => `https://openrouter.ai/${id}`;

/** A catalog id that names the model itself, not a routing variant
 *  (`:batch`, `:free`) or a moving alias (`~vendor/model-latest`). */
export const isBaseId = id => typeof id === 'string' && !id.includes(':') && !id.startsWith('~');

async function get(url, apiKey) {
  const res = await fetch(url, { headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {} });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`OpenRouter returned ${res.status} for ${url}: ${body.slice(0, 200)}`);
  }
  const bytes = Buffer.from(await res.arrayBuffer());
  return { bytes, body: JSON.parse(bytes.toString('utf8')) };
}

/** The catalog. Returns `{ bytes, models }`. Throws on any non-200. */
export async function fetchCatalog(apiKey) {
  const { bytes, body } = await get(OPENROUTER_MODELS_URL, apiKey);
  if (!Array.isArray(body?.data)) throw new Error('OpenRouter catalog missing `data` array');
  return { bytes, models: body.data };
}

/** One model's providers. Returns `{ bytes, endpoints }`. Throws on any non-200. */
export async function fetchEndpoints(id, apiKey) {
  const { bytes, body } = await get(endpointsUrl(id), apiKey);
  if (!Array.isArray(body?.data?.endpoints)) throw new Error(`OpenRouter endpoints for ${id} missing \`data.endpoints\``);
  return { bytes, endpoints: body.data.endpoints };
}
