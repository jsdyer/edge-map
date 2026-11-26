# Edge Map

See which Cloudflare data centre serves your connection over IPv4 and IPv6,
whether it is in Canada, and how it changes over time. Runs entirely in the
browser. Published at `coolcode.ca/edge-map/`.

## Using the tool

<!-- coolcode:guide -->
The page asks several Cloudflare endpoints for their /cdn-cgi/trace and shows which data centre (an airport code such as YVR or SEA) answered each one, over IPv4 and IPv6. If Cloudflare locates your IP in Canada but an edge outside Canada answered, it is flagged. Turn on "Remember my results in this browser" and come back over days to see whether your ISP's route to Cloudflare moves; the history stores data centre codes only, never your IP, and can be downloaded as CSV.
<!-- /coolcode:guide -->

[Compare response times over IPv4 and IPv6 and save labelled network runs](https://coolcode.ca/colocheck/).

Each endpoint can fail on its own: the IPv6 one fails on networks without IPv6,
and **This page's own domain** only answers when coolcode.ca is proxied through
Cloudflare (on plain GitHub Pages it shows "not served through Cloudflare").
Browsers or extensions can also refuse a cross-site request; the table says so
rather than guessing.

The map plots each data centre at the airport it is named after. Cloudflare's
exact facility locations are not published per city, so treat positions as
approximate.

## Expand or customize

Everything is in `web/config.json`:

| Setting | Meaning |
| --- | --- |
| `home_country` | Two-letter country; an edge outside it is flagged when the trace's `loc` is this country |
| `endpoints` | Trace URLs to check. Each needs a unique `id`, a `label`, and a `url` ending in `/cdn-cgi/trace` (`https://…` or root-relative `/cdn-cgi/trace`). `note` is optional |
| `timeout_seconds` | Per-endpoint timeout |
| `history_limit` | Most checks kept in the browser history |
| `colos` | Airport code → `city`, `country`, `lat`, `lon`. Codes not listed still show, without a city or map point |

Add any Cloudflare-fronted site as another endpoint, for example:

```json
{"id": "cira", "label": "cira.ca", "url": "https://www.cira.ca/cdn-cgi/trace"}
```

Only sites that allow cross-site requests to their trace will answer. Add a
data centre you see that isn't listed:

```json
"YXX": {"city": "Abbotsford", "country": "CA", "lat": 49.03, "lon": -122.36}
```

Commit to `main`; **Browser tool · Check and publish** rebuilds and redeploys.
There is no scheduled refresh: every check is live from the visitor's browser.

A server-side drift logger (scheduled checks from a fixed line, such as your
TELUS connection) is not part of this page, because GitHub Actions runs in
GitHub's data centres, not on your line.

## Development

```sh
node --test tests/*.test.mjs
python3 -m unittest discover -s tests -v
python3 scripts/build.py
python3 -m http.server 8000 --directory dist
```

`tests/browser_smoke.py` mocks the Cloudflare endpoints.

## Files

| Path | Purpose |
| --- | --- |
| `web/config.json` | Endpoints, home country, limits and data centre locations |
| `web/model.mjs` | Trace parsing, detour logic, projection, history |
| `web/app.mjs` | Requests, table, map and history DOM |
| `tool.json` | Catalogue record for coolcode.ca |

## Collection maintenance

The catalogue, imported README guide, repository audit, sitemap, Cloudflare
visitor registry and Linux refresh watchdog are managed in
[jsdyer/jsdyer.github.io](https://github.com/jsdyer/jsdyer.github.io).
Follow its [tool lifecycle checklist](https://github.com/jsdyer/jsdyer.github.io/blob/main/docs/tool-lifecycle.md)
when changing this tool's identity, source, deployment, inputs or refresh schedule.
The independent scheduler must actually be installed on the Linux server; a
GitHub schedule guard alone cannot guarantee refreshes continue.

The `loc` value is Cloudflare's geolocation of your IP, not proof of your
physical location. Airport-code coordinates are approximate serving locations;
a missing trace response does not prove a site is outside Cloudflare. Stored
history is opt-in, contains no IP addresses, and is validated when restored.
If browser storage fails, the page says the check was not saved. No scheduled
collector or watchdog dispatch is needed for these browser-only checks.
