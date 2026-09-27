function unslothEndpoint(connection, route) {
  const url = new URL(connection?.baseUrl || 'http://127.0.0.1:8888/v1');
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Unsloth requires an HTTP(S) URL without embedded credentials.');
  }
  url.pathname = `${url.pathname.replace(/\/+$/, '').replace(/\/v1$/, '')}/${route}`;
  url.search = '';
  url.hash = '';
  return url.toString();
}

// Unsloth's own /v1/models sometimes lists the resident model twice: once under its
// fully-qualified "owner/repo" catalog id, and once more under a bare alias (no owner)
// that mirrors the live inference status's short "active_model" name. Both entries report
// the same quant and loaded state. Only the owner-qualified id reliably maps back onto the
// on-disk cache path (see api/inference/status's model_identifier): sending the bare alias
// to api/inference/load as model_path makes Unsloth treat it as an unresolved repo lookup
// and start a fresh download instead of reusing the model that is clearly already resident.
// Prefer the owner-qualified entry whenever both forms of the same model are present.
function dedupeModelEntries(entries) {
  const bestByKey = new Map();
  for (const entry of entries) {
    const shortId = entry.id.includes('/') ? entry.id.slice(entry.id.lastIndexOf('/') + 1) : entry.id;
    const key = `${entry.quant ?? ''}::${shortId}::${entry.loaded}`;
    const existing = bestByKey.get(key);
    if (!existing || (entry.id.includes('/') && !existing.id.includes('/'))) {
      bestByKey.set(key, entry);
    }
  }
  return [...bestByKey.values()];
}

// A model id's "owner/repo:quant" identity collapsed to just "repo::quant", so a
// previously saved bare-alias connection.model (from before dedupeModelEntries existed,
// or from a server that still only lists the alias) can still be matched against the
// current, owner-qualified catalog entry instead of being reported as unknown/downloadable.
function shortModelKey(id) {
  const colon = id.lastIndexOf(':');
  const base = colon > 0 ? id.slice(0, colon) : id;
  const quant = colon > 0 ? id.slice(colon + 1) : '';
  const short = base.includes('/') ? base.slice(base.lastIndexOf('/') + 1) : base;
  return `${short}::${quant}`;
}

function resolveModelEntry(models, selected) {
  return models.find((entry) => entry.id === selected)
    ?? models.find((entry) => shortModelKey(entry.id) === shortModelKey(selected));
}

function createUnslothApi(requestJson) {
  const request = (connection, route, body, abort) => requestJson(
    unslothEndpoint(connection, route), connection, body, abort,
  );
  async function list(connection, abort) {
    const result = await request(connection, 'v1/models', undefined, abort);
    if (!Array.isArray(result?.data)) throw new Error('Unsloth returned an invalid model catalog.');
    const resident = result.data.some((entry) => entry?.loaded === true)
      ? await status(connection, abort) : undefined;
    const candidates = result.data.filter((entry) => typeof entry?.id === 'string' && entry.id.trim());
    return dedupeModelEntries(candidates).map((entry) => ({
      id: entry.quant && !entry.id.includes(':') ? `${entry.id}:${entry.quant}` : entry.id,
      name: entry.display_name || entry.id,
      text: !entry.task || ['text-generation', 'image-text-to-text'].includes(entry.task),
      vision: entry.vision === true || entry.capabilities?.vision === true || (
        resident?.is_vision === true && entry.loaded === true &&
        [entry.id, entry.id.split('/').at(-1), entry.display_name].includes(resident.active_model)
      ),
      status: entry.loaded === true ? 'loaded' : entry.loaded === false ? 'unloaded' : 'unknown',
    })).filter((entry) => entry.text);
  }
  async function status(connection, abort) {
    const result = await request(connection, 'api/inference/status', undefined, abort);
    if (!result || !Array.isArray(result.loaded) || !Array.isArray(result.loading)) {
      throw new Error('Unsloth returned an invalid inference status.');
    }
    return result;
  }
  async function probe(connection, abort) {
    const selected = connection?.model?.trim();
    const models = await list(connection, abort);
    const model = resolveModelEntry(models, selected ?? '');
    return { loaded: model?.status === 'loaded', status: model?.status || 'unknown' };
  }
  async function load(connection, abort) {
    const selected = connection?.model?.trim();
    if (!selected) throw new Error('Choose an Unsloth model before loading.');
    const models = await list(connection, abort);
    const model = resolveModelEntry(models, selected);
    if (!model) throw new Error('The selected model is not in Unsloth\'s local catalog. Download it in Unsloth and refresh the model list.');
    if (model.status === 'loaded') return { loadedModel: model.id };
    // Always resolve model_path from the matched catalog entry's own id, not the raw
    // `selected` string: a stale bare-alias connection.model must still load the real,
    // owner-qualified path, not the alias that Unsloth cannot map back to local cache.
    const colon = model.id.lastIndexOf(':');
    const body = { model_path: colon > 0 ? model.id.slice(0, colon) : model.id };
    if (colon > 0) body.gguf_variant = model.id.slice(colon + 1);
    const result = await request(connection, 'api/inference/load', body, abort);
    if (result?.status === 'error' || result?.error) throw new Error('Unsloth failed to load the selected model.');
    if (!(await probe(connection, abort)).loaded) throw new Error('Unsloth did not confirm the selected model is loaded.');
    return { loadedModel: model.id };
  }
  async function unload(connection, abort) {
    const current = await status(connection, abort);
    if (current.loading.length) throw new Error('Unsloth is loading a model. Wait for loading to finish before unloading.');
    // GGUF status lists a display name, but unload needs the loadable identifier.
    const models = [...new Set(current.loaded.map((id) =>
      id === current.active_model && current.model_identifier ? current.model_identifier : id,
    ))];
    if (models.some((id) => typeof id !== 'string' || !id)) throw new Error('Unsloth returned invalid loaded model identifiers.');
    for (const model_path of models) {
      const result = await request(connection, 'api/inference/unload', { model_path, force_cancel_active: false }, abort);
      if (result?.status === 'error' || result?.error) throw new Error('Unsloth failed to unload a model.');
    }
    if ((await status(connection, abort)).loaded.length) throw new Error('Unsloth still reports a loaded model after unload.');
    return { unloadedCount: models.length, models };
  }
  return { list, load, probe, unload, status };
}

module.exports = { unslothEndpoint, createUnslothApi };
