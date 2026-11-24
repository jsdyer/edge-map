// Pure functions for Edge Map. No DOM or network access here.

const FIELDS = ['fl', 'h', 'ip', 'ts', 'visit_scheme', 'uag', 'colo', 'sliver', 'http', 'loc', 'tls', 'sni', 'warp', 'gateway', 'rbi', 'kex'];

export function parseTrace(text) {
  const result = {};
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const at = line.indexOf('=');
    if (at < 1) continue;
    const key = line.slice(0, at).trim();
    if (FIELDS.includes(key)) result[key] = line.slice(at + 1).trim();
  }
  if (!/^[A-Z]{3}$/.test(result.colo ?? '')) throw new Error('Not a Cloudflare trace response');
  return result;
}

export function ipVersion(ip) {
  if (!ip) return null;
  return ip.includes(':') ? 6 : 4;
}

export function maskIp(ip) {
  if (!ip) return '';
  if (ip.includes(':')) return ip.split(':').slice(0, 3).join(':') + ':…';
  const parts = ip.split('.');
  return parts.length === 4 ? `${parts[0]}.${parts[1]}.x.x` : '…';
}

export function describe(trace, colos, home) {
  const colo = colos?.[trace.colo] ?? null;
  const country = colo?.country ?? null;
  return {
    colo: trace.colo,
    city: colo?.city ?? null,
    country,
    lat: colo?.lat ?? null,
    lon: colo?.lon ?? null,
    known: Boolean(colo),
    visitorCountry: trace.loc ?? null,
    inHome: country === home,
    // You are in the home country, but Cloudflare answered from somewhere else.
    detour: trace.loc === home && country != null && country !== home,
    version: ipVersion(trace.ip),
    http: trace.http ?? null,
    tls: trace.tls ?? null,
    warp: trace.warp ?? null,
    gateway: trace.gateway ?? null,
    kex: trace.kex ?? null,
  };
}

export function headline(results, home) {
  const ok = results.filter(r => r.description);
  if (!ok.length) return null;
  const colos = [...new Set(ok.map(r => r.description.colo))];
  const detours = ok.filter(r => r.description.detour);
  return {
    colos,
    allHome: ok.every(r => r.description.inHome),
    detours: detours.map(r => r.endpoint.label),
    mixed: colos.length > 1,
    home,
  };
}

export function project(lat, lon, view, width, height) {
  const x = ((lon - view.west) / (view.east - view.west)) * width;
  const y = ((view.north - lat) / (view.north - view.south)) * height;
  return { x, y, inside: x >= 0 && x <= width && y >= 0 && y <= height };
}

export const VIEWS = {
  'north-america': { west: -170, east: -50, north: 72, south: 12 },
  world: { west: -180, east: 180, north: 75, south: -60 },
};

export function addEntry(history, entry, limit) {
  const list = Array.isArray(history) ? history.filter(e => e && typeof e.at === 'string') : [];
  list.push(entry);
  return list.slice(-limit);
}

export function historyEntry(at, results) {
  return {
    at,
    results: Object.fromEntries(results.filter(r => r.description).map(r => [r.endpoint.id, {
      colo: r.description.colo, version: r.description.version, loc: r.description.visitorCountry, http: r.description.http,
    }])),
  };
}

export function drift(history, endpointId) {
  const seen = [];
  let changes = 0;
  let last = null;
  const counts = {};
  for (const entry of history) {
    const colo = entry.results?.[endpointId]?.colo;
    if (!colo) continue;
    counts[colo] = (counts[colo] ?? 0) + 1;
    if (last && colo !== last) changes += 1;
    if (!seen.includes(colo)) seen.push(colo);
    last = colo;
  }
  return { colos: seen, counts, changes, samples: Object.values(counts).reduce((a, b) => a + b, 0) };
}

function csvField(value) {
  const text = String(value ?? '');
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function historyCsv(history, endpoints) {
  const lines = [['time_utc', ...endpoints.map(e => `${e.id}_colo`)].join(',')];
  for (const entry of history) {
    lines.push([entry.at, ...endpoints.map(e => entry.results?.[e.id]?.colo ?? '')].map(csvField).join(','));
  }
  return lines.join('\n') + '\n';
}

export function validateConfig(config) {
  if (!config || !/^[A-Z]{2}$/.test(config.home_country ?? '')) throw new Error('home_country must be a two-letter code');
  if (!Array.isArray(config.endpoints) || !config.endpoints.length) throw new Error('List at least one endpoint');
  const ids = new Set();
  for (const endpoint of config.endpoints) {
    if (!/^[a-z0-9-]+$/.test(endpoint.id ?? '') || ids.has(endpoint.id)) throw new Error(`Bad or duplicate endpoint id: ${endpoint.id}`);
    ids.add(endpoint.id);
    if (!/^(\/|https:\/\/)/.test(endpoint.url ?? '') || !endpoint.url.endsWith('/cdn-cgi/trace')) throw new Error(`Endpoint ${endpoint.id} must be an https or root-relative /cdn-cgi/trace URL`);
  }
  for (const [code, colo] of Object.entries(config.colos ?? {})) {
    if (!/^[A-Z]{3}$/.test(code) || !/^[A-Z]{2}$/.test(colo.country) || Math.abs(colo.lat) > 90 || Math.abs(colo.lon) > 180) {
      throw new Error(`Bad colo entry: ${code}`);
    }
  }
  return config;
}
