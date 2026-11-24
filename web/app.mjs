import { parseTrace, describe, headline, maskIp, project, VIEWS, addEntry, historyEntry, drift, historyCsv, validateConfig } from './model.mjs';

const $ = selector => document.querySelector(selector);
const SVG = 'http://www.w3.org/2000/svg';
const KEYS = { history: 'coolcode:edge-map:history', remember: 'coolcode:edge-map:remember' };
let config = null;
let results = [];
let csvUrl = null;

function el(tag, text, attrs = {}) {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
}

function svg(tag, attrs = {}) {
  const node = document.createElementNS(SVG, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}

const storage = {
  get(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ } },
  remove(key) { try { localStorage.removeItem(key); } catch { /* storage unavailable */ } },
};

async function fetchTrace(endpoint) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeout_seconds * 1000);
  try {
    const response = await fetch(endpoint.url, { cache: 'no-store', signal: controller.signal, credentials: 'omit' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const trace = parseTrace(await response.text());
    return { endpoint, trace, description: describe(trace, config.colos, config.home_country) };
  } catch (error) {
    const reason = error.name === 'AbortError' ? 'timed out'
      : /Cloudflare trace|HTTP 404/.test(error.message) ? 'not served through Cloudflare'
        : /HTTP/.test(error.message) ? error.message
          : 'blocked or unreachable (no IPv6, a firewall, or the browser refused the cross-site request)';
    return { endpoint, error: reason };
  } finally {
    clearTimeout(timer);
  }
}

const countryName = code => {
  try { return new Intl.DisplayNames(['en-CA'], { type: 'region' }).of(code); } catch { return code; }
};

function renderResults() {
  const body = $('#results tbody');
  body.replaceChildren();
  const showIp = $('#show-ip').checked;
  for (const result of results) {
    const tr = el('tr');
    const name = el('td');
    name.append(el('strong', result.endpoint.label));
    if (result.endpoint.note) name.append(el('br'), el('span', result.endpoint.note, { class: 'muted small' }));
    tr.append(name);
    if (result.error) {
      tr.append(el('td', `No answer: ${result.error}`, { colspan: '3', class: 'muted' }));
    } else {
      const d = result.description;
      const where = el('td');
      where.append(el('span', d.colo, { class: `code ${d.inHome ? 'home' : 'away'}` }), ` ${d.city ?? 'Unlisted location'}${d.country ? `, ${countryName(d.country)}` : ''}`);
      if (d.detour) where.append(el('br'), el('span', `You are in ${countryName(config.home_country)}, but this edge is not.`, { class: 'warn small' }));
      const ip = result.trace.ip ?? '';
      tr.append(where, el('td', `${showIp ? ip : maskIp(ip)} (IPv${d.version ?? '?'}, ${d.visitorCountry ?? '??'})`, { class: 'mono' }),
        el('td', [d.http, d.tls, d.warp === 'on' ? 'WARP' : null, d.gateway === 'on' ? 'Gateway' : null, d.kex].filter(Boolean).join(' · ')));
    }
    body.append(tr);
  }
  const head = headline(results, config.home_country);
  const text = $('#headline');
  if (!head) {
    text.textContent = 'No Cloudflare endpoint answered. Check your connection or browser extensions, then check again.';
  } else if (head.detours.length) {
    text.textContent = `Not in ${countryName(config.home_country)}: ${head.detours.join(', ')} answered from outside the country (${head.colos.join(', ')}).`;
  } else if (head.allHome) {
    text.textContent = `Served from ${countryName(config.home_country)}: ${head.colos.join(', ')}${head.mixed ? ' (different endpoints use different data centres)' : ''}.`;
  } else {
    text.textContent = `Served from ${head.colos.join(', ')}.`;
  }
}

function renderMap() {
  const width = 800, height = 420;
  const view = VIEWS[$('#view').value];
  const root = svg('svg', { viewBox: `0 0 ${width} ${height}` });
  root.append(svg('rect', { x: 0, y: 0, width, height, class: 'sea' }));
  for (let lon = Math.ceil(view.west / 30) * 30; lon <= view.east; lon += 30) {
    const { x } = project(0, lon, view, width, height);
    root.append(svg('line', { x1: x, y1: 0, x2: x, y2: height, class: 'grid' }));
  }
  for (let lat = Math.ceil(view.south / 15) * 15; lat <= view.north; lat += 15) {
    const { y } = project(lat, 0, view, width, height);
    root.append(svg('line', { x1: 0, y1: y, x2: width, y2: y, class: 'grid' }));
  }
  const active = new Set(results.filter(r => r.description).map(r => r.description.colo));
  const entries = Object.entries(config.colos).sort(([a], [b]) => active.has(a) - active.has(b));
  for (const [code, colo] of entries) {
    const point = project(colo.lat, colo.lon, view, width, height);
    if (!point.inside) continue;
    const on = active.has(code);
    const dot = svg('circle', { cx: point.x, cy: point.y, r: on ? 7 : 3, class: `colo ${colo.country === config.home_country ? 'home' : 'away'}${on ? ' active' : ''}` });
    const title = document.createElementNS(SVG, 'title');
    title.textContent = `${code} ${colo.city}, ${colo.country}`;
    dot.append(title);
    root.append(dot);
    if (on) {
      const label = svg('text', { x: point.x + 10, y: point.y + 4, class: 'label' });
      label.textContent = code;
      root.append(label);
    }
  }
  $('#map').replaceChildren(root);
}

function renderHistory() {
  const remember = $('#remember').checked;
  const history = remember ? storage.get(KEYS.history, []) : [];
  const body = $('#history tbody');
  body.replaceChildren();
  for (const endpoint of config.endpoints) {
    const d = drift(history, endpoint.id);
    if (!d.samples) continue;
    const tr = el('tr');
    tr.append(el('td', endpoint.label), el('td', d.colos.map(c => `${c} ×${d.counts[c]}`).join(', ')), el('td', String(d.changes)));
    body.append(tr);
  }
  $('#history').hidden = !body.children.length;
  $('#history-clear').hidden = !history.length;
  $('#history-csv').hidden = !history.length;
  $('#history-summary').textContent = remember
    ? `${history.length} ${history.length === 1 ? 'check' : 'checks'} saved in this browser${history.length ? `, from ${history[0].at.slice(0, 16).replace('T', ' ')} to ${history.at(-1).at.slice(0, 16).replace('T', ' ')} UTC` : ''}.`
    : 'Off. Turn it on and revisit over days to see whether your edge moves.';
  if (csvUrl) URL.revokeObjectURL(csvUrl);
  csvUrl = null;
  if (history.length) {
    csvUrl = URL.createObjectURL(new Blob([historyCsv(history, config.endpoints)], { type: 'text/csv' }));
    $('#history-csv').setAttribute('href', csvUrl);
  }
}

async function check() {
  $('#rerun').disabled = true;
  $('#headline').textContent = 'Asking Cloudflare…';
  results = await Promise.all(config.endpoints.map(fetchTrace));
  renderResults();
  renderMap();
  if ($('#remember').checked && results.some(r => r.description)) {
    const entry = historyEntry(new Date().toISOString(), results);
    storage.set(KEYS.history, addEntry(storage.get(KEYS.history, []), entry, config.history_limit));
  }
  renderHistory();
  $('#rerun').disabled = false;
}

$('#rerun').addEventListener('click', check);
$('#show-ip').addEventListener('change', renderResults);
$('#view').addEventListener('change', renderMap);
$('#remember').addEventListener('change', () => {
  if ($('#remember').checked) storage.set(KEYS.remember, true);
  else { storage.remove(KEYS.remember); storage.remove(KEYS.history); }
  renderHistory();
});
$('#history-clear').addEventListener('click', () => { storage.remove(KEYS.history); renderHistory(); });

try {
  const response = await fetch('./config.json');
  if (!response.ok) throw new Error(String(response.status));
  config = validateConfig(await response.json());
  $('#remember').checked = storage.get(KEYS.remember, false) === true;
  await check();
} catch {
  $('#headline').textContent = 'The tool settings could not be loaded. Reload the page.';
}
