import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseTrace, describe, headline, maskIp, project, VIEWS, addEntry, historyEntry, drift, historyCsv, validateConfig, ipVersion, cleanHistory } from '../web/model.mjs';

const config = JSON.parse(readFileSync(new URL('../web/config.json', import.meta.url)));
const TRACE = 'fl=123f45\nh=1.1.1.1\nip=24.84.10.20\nts=1764000000.123\nvisit_scheme=https\nuag=Mozilla/5.0\ncolo=SEA\nsliver=none\nhttp=http/3\nloc=CA\ntls=TLSv1.3\nsni=off\nwarp=off\ngateway=off\nrbi=off\nkex=X25519MLKEM768\n';

test('shipped config is valid', () => {
  assert.equal(validateConfig(config), config);
  assert.ok(config.colos.YVR && config.colos.SEA);
});

test('config validation catches mistakes and accepts extra entries', () => {
  assert.throws(() => validateConfig({ ...config, home_country: 'Canada' }));
  assert.throws(() => validateConfig({ ...config, endpoints: [{ id: 'x', url: 'http://1.1.1.1/cdn-cgi/trace' }] }));
  assert.throws(() => validateConfig({ ...config, endpoints: [config.endpoints[0], config.endpoints[0]] }));
  assert.throws(() => validateConfig({ ...config, colos: { yvr: { country: 'CA', lat: 1, lon: 1 } } }));
  const bigger = { ...config, endpoints: [...config.endpoints, { id: 'example', label: 'Example', url: 'https://www.example.com/cdn-cgi/trace' }],
    colos: { ...config.colos, YXX: { city: 'Abbotsford', country: 'CA', lat: 49.03, lon: -122.36 } } };
  assert.equal(validateConfig(bigger).endpoints.length, config.endpoints.length + 1);
});

test('parses a trace', () => {
  const trace = parseTrace(TRACE);
  assert.equal(trace.colo, 'SEA');
  assert.equal(trace.uag, 'Mozilla/5.0');
  assert.equal(trace.kex, 'X25519MLKEM768');
  assert.throws(() => parseTrace('<html>404</html>'), /Cloudflare/);
  assert.throws(() => parseTrace('colo=<b>'), /Cloudflare/);
});

test('flags a Canadian visitor served from the US', () => {
  const d = describe(parseTrace(TRACE), config.colos, 'CA');
  assert.equal(d.city, 'Seattle');
  assert.equal(d.detour, true);
  assert.equal(d.inHome, false);
  assert.equal(d.version, 4);
  const home = describe(parseTrace(TRACE.replace('colo=SEA', 'colo=YVR')), config.colos, 'CA');
  assert.equal(home.detour, false);
  assert.equal(home.inHome, true);
  const unknown = describe(parseTrace(TRACE.replace('colo=SEA', 'colo=ZZZ')), config.colos, 'CA');
  assert.equal(unknown.known, false);
  assert.equal(unknown.detour, false);
});

test('headline summarises endpoints', () => {
  const ep = id => ({ id, label: id });
  const r = (id, colo) => ({ endpoint: ep(id), description: describe(parseTrace(TRACE.replace('colo=SEA', `colo=${colo}`)), config.colos, 'CA') });
  assert.deepEqual(headline([r('v4', 'YVR'), r('v6', 'SEA'), { endpoint: ep('x'), error: 'timed out' }], 'CA'),
    { colos: ['YVR', 'SEA'], allHome: false, detours: ['v6'], mixed: true, home: 'CA' });
  assert.equal(headline([{ endpoint: ep('x'), error: 'x' }], 'CA'), null);
});

test('masks IP addresses', () => {
  assert.equal(maskIp('24.84.10.20'), 'Hidden');
  assert.equal(maskIp('2001:569:7a2b:1::5'), 'Hidden');
  assert.equal(ipVersion('2001:569::1'), 6);
});

test('projection keeps Vancouver inside North America and outside nothing important', () => {
  const p = project(49.19, -123.18, VIEWS['north-america'], 800, 420);
  assert.ok(p.inside);
  assert.ok(!project(-33.9, 151.2, VIEWS['north-america'], 800, 420).inside);
  assert.ok(project(-33.9, 151.2, VIEWS.world, 800, 420).inside);
});

test('history keeps the newest entries and counts changes', () => {
  const ep = { id: 'ipv4', label: 'v4' };
  let history = [];
  for (const [i, colo] of ['YVR', 'YVR', 'SEA', 'YVR', 'SEA'].entries()) {
    const d = describe(parseTrace(TRACE.replace('colo=SEA', `colo=${colo}`)), config.colos, 'CA');
    history = addEntry(history, historyEntry(`2026-11-2${i}T00:00:00Z`, [{ endpoint: ep, description: d }]), 4);
  }
  assert.equal(history.length, 4);
  assert.deepEqual(drift(history, 'ipv4'), { colos: ['YVR', 'SEA'], counts: { YVR: 2, SEA: 2 }, changes: 3, samples: 4 });
  assert.ok(!JSON.stringify(history).includes('24.84'), 'history must not store the IP address');
  const csv = historyCsv(history, [ep, { id: 'ipv6' }]);
  assert.equal(csv.split('\n')[0], 'time_utc,ipv4_colo,ipv6_colo');
  assert.equal(csv.trim().split('\n').length, 5);
  assert.deepEqual(addEntry('garbage', { at: 'x' }, 10), [{ at: 'x' }]);
});

test('rejects protocol-relative endpoints and invalid numerical settings', () => {
  for (const url of ['//evil.example/cdn-cgi/trace','https://u:p@example.com/cdn-cgi/trace'])
    assert.throws(() => validateConfig({...config,endpoints:[{id:'bad',url}]}));
  assert.throws(() => validateConfig({...config,timeout_seconds:NaN}));
  assert.throws(() => validateConfig({...config,colos:{YVR:{country:'CA',lat:NaN,lon:1}}}));
});
test('restored history validates structure and strips IP addresses', () => {
  assert.deepEqual(cleanHistory({bad:true}), []);
  const list=cleanHistory([{at:'2026-11-23T00:00:00Z',ip:'1.2.3.4',results:{ipv4:{colo:'YVR',ip:'1.2.3.4'}}}]);
  assert.equal(list.length,1);assert.ok(!JSON.stringify(list).includes('1.2.3.4'));
});
