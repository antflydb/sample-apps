#!/usr/bin/env python3
"""Install the real add-on in a disposable Firefox profile and measure a matched browsing run."""
import argparse
import json
import math
import os
from pathlib import Path
import socket
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


CSS = "body{font:20px/1.5 Georgia,serif;margin:48px auto;max-width:660px}"
METER = """<script>
window.frameTimes = [];
let last;
requestAnimationFrame(function tick(now) {
  if (last !== undefined) frameTimes.push(now-last);
  last = now;
  requestAnimationFrame(tick);
});
</script>"""
PAGES = {
    "/cheese": """<main><h1>Cheese</h1>
<p id="cheese">Cheese is a food made by coagulating milk. Aging changes its flavor and texture.</p>
<p id=\"stock\">To make a cheese soup, add the vegetables to a pot of broth and simmer gently.</p>
<p>Fresh ricotta has a soft, slightly grainy texture. Mature cheddar is firmer.</p></main>""",
    "/outbreak": """<main><h1 id="outbreak">The DRC’s Ebola outbreak remains out of control</h1>
<p id="outbreak-detail">A lack of treatments has made the outbreak <a id="source" href="/cheese">more fatal than ever</a>: Around half of those infected die.</p>
<p id="drama">My sister has stopped talking to me and is trying to turn the whole family against me.</p>
<p id="missing-dog">When I woke up, my dog was gone and the front door was wide open.</p>
<p id="reunited">Police have found the missing child safe and reunited her with her family.</p>
<p id="bread">The bread came out so well that the neighbors asked for the recipe.</p></main>""",
    "/tariffs": """<main><h1 id="tariffs">President announces new tariffs as trade dispute escalates</h1>
<p id="markets">Stocks tumbled as investors braced for a recession and widespread layoffs.</p>
<p id="plain">The newspaper is printed in several sizes for different editions.</p>
<p><a id="link" href="/cheese">President denounces opposition in parliament</a></p>
<input id="editor" value="Stock market crash"></main>
<script>setTimeout(() => {
 const div = document.createElement('div'); div.id = 'late';
 div.textContent = 'Missiles hit a crowded neighborhood as the war intensified and civilian casualties mounted.';
 document.querySelector('main').append(div);
 const neutral = document.createElement('p'); neutral.id = 'neutral';
 neutral.textContent = 'The cheesemonger stocks cheddar and brie on the shelves nearest the door.';
 document.querySelector('main').append(neutral);
}, 2500);</script>""",
}


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path not in PAGES:
            self.send_error(404)
            return
        body = (f'<!doctype html><meta charset="utf-8"><style>{CSS}</style>'
                f'{METER}{PAGES[self.path]}').encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_):
        pass


def webdriver(base, method, route, data=None):
    payload = None if data is None else json.dumps(data).encode()
    req = Request(base + route, data=payload, method=method,
                  headers={"Content-Type": "application/json"})
    try:
        with urlopen(req, timeout=60) as response:
            return json.load(response)["value"]
    except HTTPError as error:
        raise RuntimeError(f"{method} {route}: {error.read().decode()}") from error


def process_totals(root):
    lines = subprocess.check_output(["ps", "-axo", "pid=,ppid=,rss=,time="], text=True).splitlines()
    rows = [line.split() for line in lines]
    pids = {root}
    while True:
        children = {int(pid) for pid, parent, _, _ in rows if int(parent) in pids}
        if children <= pids:
            break
        pids |= children
    cpu, rss = 0, 0
    for pid, _, kb, clock in rows:
        if int(pid) in pids:
            rss += int(kb) / 1024
            clock = clock.replace("-", ":")
            factors = (1, 60, 3600, 86400)
            cpu += sum(float(x) * factor for x, factor in zip(reversed(clock.split(":")), factors))
    return cpu, rss


def percentile(values, quantile):
    return sorted(values)[math.ceil(len(values) * quantile) - 1] if values else None


def browse(base, site, dist, firefox, seconds, enabled):
    def call(method, route, data=None):
        return webdriver(base, method, session + route, data)

    options = {"args": ["-headless"], "prefs": {
        "extensions.getAddons.cache.enabled": False,
        "devtools.console.stdout.content": True,
        "browser.dom.window.dump.enabled": True,
    }}
    if firefox:
        options["binary"] = firefox
    created = webdriver(base, "POST", "/session", {"capabilities": {"alwaysMatch": {
        "browserName": "firefox", "moz:firefoxOptions": options,
    }}})
    session = "/session/" + created["sessionId"]
    root = created["capabilities"]["moz:processID"]
    try:
        if enabled:
            call("POST", "/moz/addon/install", {"path": str(dist), "temporary": True})
        start_cpu, start_rss = process_totals(root)
        peak_rss = start_rss
        out = {"firefox": created["capabilities"]["browserVersion"], "pages": {}}
        start = time.monotonic()
        for name in ("cheese", "tariffs", "outbreak", "cheese"):
            page_cpu, page_rss = process_totals(root)
            page_peak = page_rss
            call("POST", "/url", {"url": site + "/" + name})
            end = time.monotonic() + seconds
            while time.monotonic() < end:
                _, rss = process_totals(root)
                peak_rss = max(peak_rss, rss)
                page_peak = max(page_peak, rss)
                time.sleep(min(0.25, max(0, end-time.monotonic())))
            data = call("POST", "/execute/sync", {"args": [], "script": """
                return {
                  spoilers: [...document.querySelectorAll('[data-ck-spoiler]')].map(el => el.id),
                  kitten: document.querySelector('[data-ck-kitten]')?.dataset.ckKitten ?? null,
                  decisions: performance.getEntriesByName('Censor Kitten: local decision')
                      .map(x => ({...x.detail, atMs: Math.round(x.startTime+x.duration)})),
                  frames: window.frameTimes,
                  intact: [...document.querySelectorAll('#cheese,#stock,#plain,#link,#editor,#neutral,#source,#bread,#reunited')]
                      .map(el => el.value ?? el.textContent.trim()),
                };"""})
            frames = data.pop("frames")
            data["frame_p95_ms"] = percentile(frames, 0.95)
            data["frames_over_50_ms"] = sum(value > 50 for value in frames)
            data["cpu_seconds"] = round(process_totals(root)[0] - page_cpu, 2)
            data["peak_rss_mib"] = round(page_peak)
            print(f"{'addon' if enabled else 'baseline'} /{name}: {json.dumps(data)}", flush=True)
            out["pages"].setdefault(name, []).append(data)
        end_cpu, end_rss = process_totals(root)
        out.update(seconds=round(time.monotonic() - start, 2), cpu_seconds=round(end_cpu-start_cpu, 2),
                   start_rss_mib=round(start_rss), peak_rss_mib=round(peak_rss), final_rss_mib=round(end_rss))
        return out
    finally:
        call("DELETE", "")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--geckodriver", default="geckodriver")
    parser.add_argument("--firefox", default=os.environ.get("FIREFOX"))
    parser.add_argument("--driver-log", choices=["fatal", "error", "warn", "info", "debug", "trace"], default="warn")
    parser.add_argument("--seconds", type=float, default=60, help="measurement window per page")
    parser.add_argument("--dist", type=Path, default=Path(__file__).resolve().parent / "dist")
    parser.add_argument("--serve", action="store_true", help="serve the fixtures without starting Firefox")
    args = parser.parse_args()
    if args.serve:
        with ThreadingHTTPServer(("127.0.0.1", 8765), Handler) as site:
            print("Open http://127.0.0.1:8765/tariffs, /outbreak, or /cheese", flush=True)
            try:
                site.serve_forever()
            except KeyboardInterrupt:
                pass
        return
    dist = args.dist.resolve()
    if not (dist / "manifest.json").is_file():
        parser.error("Run node build.mjs first")
    with socket.socket() as reservation:
        reservation.bind(("127.0.0.1", 0))
        port = reservation.getsockname()[1]
    with ThreadingHTTPServer(("127.0.0.1", 0), Handler) as site:
        threading.Thread(target=site.serve_forever, daemon=True).start()
        proc = subprocess.Popen([args.geckodriver, "--port", str(port), "--log", args.driver_log])
        try:
            base = f"http://127.0.0.1:{port}"
            for _ in range(50):
                try:
                    webdriver(base, "GET", "/status")
                    break
                except URLError:
                    time.sleep(0.1)
            url = f"http://127.0.0.1:{site.server_port}"
            # Keep the pages and measurement windows identical with and without the add-on.
            enabled = browse(base, url, dist, args.firefox, args.seconds, True)
            print(json.dumps({"enabled": enabled}, indent=2), flush=True)
            baseline = browse(base, url, dist, args.firefox, args.seconds, False)
            print(json.dumps({"baseline": baseline}, indent=2), flush=True)
            cheese = enabled["pages"]["cheese"]
            news = enabled["pages"]["tariffs"][0]
            assert all(not row["spoilers"] and row["kitten"] == "resting" and len(row["decisions"]) == 4
                       for row in cheese), cheese
            assert all(row["intact"] == reference["intact"] for row, reference in
                       zip(cheese, baseline["pages"]["cheese"])), cheese
            assert news["intact"] == baseline["pages"]["tariffs"][0]["intact"], news
            assert len(news["decisions"]) == 5, news
            assert set(news["spoilers"]) == {"tariffs", "markets", "late"} and news["kitten"] == "alert", news
            outbreak = enabled["pages"]["outbreak"][0]
            assert outbreak["intact"] == baseline["pages"]["outbreak"][0]["intact"], outbreak
            assert set(outbreak["spoilers"]) == {"outbreak", "outbreak-detail", "drama", "missing-dog"} and outbreak["kitten"] == "alert", outbreak
            print("PASS: distressing prose covered; neutral prose and controls stayed intact.")
        finally:
            proc.terminate()
            proc.wait(timeout=10)


if __name__ == "__main__":
    main()
