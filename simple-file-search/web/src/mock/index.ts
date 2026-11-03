// Mock backend for `VITE_MOCK=1 pnpm dev` (or `pnpm mock`). Intercepts fetch
// calls to /api and answers from fixtures with the shapes in docs/API.md.
//
// Handy queries: "error" fails the search; "nothing" returns no results.
// Sources sync on a timer so the live indicator and progress line move.

import type { NewSource, Result, SearchRequest, Source, Status } from "../types";
import { pdf, wav } from "./assets";
import { fixtures, initialSources } from "./fixtures";
import type { Fixture } from "./fixtures";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function installMock(demo: boolean) {
  const url = (b: Blob) => URL.createObjectURL(b);
  const files = fixtures({
    smallStep: url(wav(14, 11)),
    eva: url(wav(158, 61)),
    report: url(
      pdf("STS-61 Mission Report", 64, {
        12: "The crew repaired the telescope over five spacewalks.",
        47: "EVA 3 replaced the Wide Field and Planetary Camera.",
        52: "Corrective optics installed and the aperture door closed.",
        58: "Night passes slowed the work on the solar arrays.",
      }),
    ),
    debrief: url(
      pdf("Apollo 11 Technical Crew Debriefing", 30, {
        9: "The first step off the footpad felt solid underfoot.",
        21: "Launch was smooth through staging.",
      }),
    ),
  });

  let sources: Source[] = initialSources();
  const status: Status = { files: 452, indexed: 430, pending: 22, failed: 0 };

  // Each status poll indexes a few more files; a source finishes when its
  // share of the backlog is done.
  const advance = () => {
    if (status.pending > 0) {
      const step = Math.min(status.pending, 3);
      status.pending -= step;
      status.indexed += step;
    }
    if (status.pending === 0) {
      sources = sources.map((s) =>
        s.status === "syncing" ? { ...s, status: "idle", last_synced_at: new Date().toISOString() } : s,
      );
    }
  };

  const search = (req: SearchRequest): Response => {
    const text = (req.text ?? "").toLowerCase().trim();
    if (text.includes("error")) return json({ error: "embedding model is not loaded yet" }, 500);
    if (text === "nothing") return json({ took_ms: 41, results: [] });

    let ranked: Array<[Fixture, number]>;
    if (req.like) {
      const from = files.find((f) => f.id === req.like);
      if (!from) return json({ error: `no file with id ${req.like}` }, 404);
      const fromTags = new Set(from.tags.split(" "));
      ranked = files
        .filter((f) => f.id !== from.id)
        .map((f) => {
          const shared = f.tags.split(" ").filter((t) => fromTags.has(t)).length;
          return [f, 0.4 + shared * 0.06 + (f.kind === from.kind ? 0.12 : 0)] as [Fixture, number];
        });
    } else {
      const words = text.split(/\W+/).filter((w) => w.length > 2);
      ranked = files.map((f) => {
        const hay = `${f.title} ${f.tags} ${(f.matches ?? []).map((m) => m.text).join(" ")}`.toLowerCase();
        const hits = words.filter((w) => hay.includes(w.slice(0, Math.max(4, w.length - 3)))).length;
        let s = 0.3 + hits * 0.12;
        if (req.image) s += f.kind === "image" ? 0.25 : f.kind === "video" ? 0.12 : 0;
        return [f, s] as [Fixture, number];
      });
    }
    const results: Result[] = ranked
      .map(([f, s], i) => [f, Math.min(0.93, s + ((i * 37) % 10) / 400)] as const)
      .sort((a, b) => b[1] - a[1])
      .slice(0, req.limit ?? 20)
      .filter(([, s], i) => s > 0.42 || i < 5)
      .map(([f, s]) => {
        const { tags: _tags, ...r } = f;
        return { ...r, score: Math.round(s * 100) / 100 };
      });
    return json({ took_ms: 120 + Math.round(Math.random() * 140), results });
  };

  const add = (body: NewSource): Response => {
    if (body.kind === "s3" && !body.s3?.bucket) return json({ error: "bucket is required" }, 400);
    if (body.kind === "drive") {
      if (!/drive\.google\.com\/.*folders\//.test(body.drive?.folder ?? ""))
        return json({ error: "folder must be a Google Drive folder URL" }, 400);
      if (body.drive.credentials_json) {
        try {
          JSON.parse(body.drive.credentials_json);
        } catch {
          return json({ error: "credentials_json is not valid JSON" }, 400);
        }
      }
    }
    const id = `${body.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now().toString(36)}`;
    const s: Source = {
      id,
      kind: body.kind,
      name: body.name,
      location:
        body.kind === "s3"
          ? `s3://${body.s3.bucket}/${body.s3.prefix}`
          : "Google Drive folder",
      status: "syncing",
      last_synced_at: null,
      error: "",
      files: 0,
      by_kind: {},
    };
    sources = [...sources, s];
    status.files += 24;
    status.pending += 24;
    // Pretend the listing finds files shortly after.
    setTimeout(() => {
      sources = sources.map((x) => (x.id === id ? { ...x, files: 24, by_kind: { image: 20, pdf: 4 } } : x));
    }, 2500);
    return json(s, 201);
  };

  const real = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
    if (u.origin !== location.origin || !u.pathname.startsWith("/api/")) return real(input, init);
    const method = (init?.method ?? "GET").toUpperCase();
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const path = u.pathname;
    await sleep(path === "/api/search" ? 280 + Math.random() * 200 : 120);
    if (init?.signal?.aborted) throw new DOMException("Aborted", "AbortError");

    if (path === "/api/config") return json({ demo, repo_url: "https://github.com/antflydb/sample-apps/tree/main/simple-file-search" });
    if (path === "/api/sources" && method === "GET") return json(sources);
    if (path === "/api/status") {
      advance();
      return json(status);
    }
    if (path === "/api/search" && method === "POST") return search(body);

    if (demo && method !== "GET") return json({ error: "this demo is read-only" }, 403);
    if (path === "/api/sources" && method === "POST") return add(body);
    const m = path.match(/^\/api\/sources\/([^/]+)(\/sync)?$/);
    if (m) {
      const id = decodeURIComponent(m[1]);
      const src = sources.find((s) => s.id === id);
      if (!src) return json({ error: `no source ${id}` }, 404);
      if (m[2] && method === "POST") {
        sources = sources.map((s) => (s.id === id ? { ...s, status: "syncing", error: "" } : s));
        status.pending += 9;
        status.files += 9;
        return new Response(null, { status: 202 });
      }
      if (!m[2] && method === "DELETE") {
        sources = sources.filter((s) => s.id !== id);
        status.files = Math.max(0, status.files - src.files);
        status.indexed = Math.min(status.indexed, status.files);
        return new Response(null, { status: 204 });
      }
    }
    return json({ error: `mock has no route for ${method} ${path}` }, 404);
  };
}
