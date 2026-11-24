"""Exercise the built page at a project subpath in Chromium with mocked Cloudflare trace endpoints."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import os
from pathlib import Path
import shutil
import tempfile
import threading
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]


def trace(colo, ip):
    return f"fl=1\nh=x\nip={ip}\nts=1\nvisit_scheme=https\nuag=test\ncolo={colo}\nhttp=http/2\nloc=CA\ntls=TLSv1.3\nsni=plaintext\nwarp=off\ngateway=off\nkex=X25519\n"


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def main():
    screenshots = ROOT / "browser-checks"
    screenshots.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory() as temporary:
        shutil.copytree(ROOT / "dist", Path(temporary) / "edge-map")
        server = ThreadingHTTPServer(("127.0.0.1", 0), partial(Handler, directory=temporary))
        threading.Thread(target=server.serve_forever, daemon=True).start()
        colos = {"ipv4": "YVR", "ipv6": "SEA"}

        def respond(route):
            url = route.request.url
            if "1.1.1.1" in url:
                body = trace(colos["ipv4"], "24.84.10.20")
            elif "2606:4700" in url:
                body = trace(colos["ipv6"], "2001:569:7a2b:1::5")
            else:
                route.abort()
                return
            route.fulfill(status=200, content_type="text/plain", body=body, headers={"Access-Control-Allow-Origin": "*"})

        try:
            with sync_playwright() as p:
                executable = os.environ.get("CHROMIUM_EXECUTABLE")
                browser = p.chromium.launch(executable_path=executable) if executable else p.chromium.launch()
                page = browser.new_page(viewport={"width": 1280, "height": 1000})
                errors = []
                page.on("pageerror", lambda error: errors.append(str(error)))
                page.route("https://1.1.1.1/**", respond)
                page.route("https://[2606:4700:4700::1111]/**", respond)
                page.route("https://one.one.one.one/**", respond)
                page.goto(f"http://127.0.0.1:{server.server_port}/edge-map/")
                page.wait_for_function("!document.querySelector('#headline').textContent.startsWith('Asking')")
                headline = page.locator("#headline").inner_text()
                assert "Not in Canada" in headline and "SEA" in headline, headline
                table = page.locator("#results").inner_text()
                assert "Vancouver" in table and "Seattle" in table, table
                assert "trace unavailable at this URL" in table  # the local test server has no trace
                assert "Hidden" in table and "24.84.10.20" not in table
                page.locator("#show-ip").check()
                assert "24.84.10.20" in page.locator("#results").inner_text()
                assert page.locator("#map circle.active").count() == 2
                page.locator("#remember").check()
                page.locator("#rerun").click()
                page.wait_for_selector("#history:not([hidden])")
                colos["ipv6"] = "YVR"
                page.locator("#rerun").click()
                page.wait_for_function("document.querySelector('#history-summary').textContent.startsWith('2 checks')")
                assert "SEA ×1, YVR ×1" in page.locator("#history").inner_text()
                stored = page.evaluate("localStorage.getItem('coolcode:edge-map:history')")
                assert "24.84" not in stored and "2001:569" not in stored
                page.locator("#view").select_option("world")
                page.screenshot(path=str(screenshots / "desktop.png"), full_page=True)
                page.locator("#remember").uncheck()
                assert page.evaluate("localStorage.getItem('coolcode:edge-map:history')") is None
                page.set_viewport_size({"width": 390, "height": 844})
                assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")
                page.screenshot(path=str(screenshots / "mobile.png"), full_page=True)
                assert not errors, errors
                browser.close()
            print("Browser checks passed: traces, detour headline, IP masking, map, history, mobile layout")
        finally:
            server.shutdown()


if __name__ == "__main__":
    main()
