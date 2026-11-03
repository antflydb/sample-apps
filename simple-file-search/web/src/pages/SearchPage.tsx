import { Button } from "@antfly/design-system/primitives";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { ResultRow } from "../components/ResultRow";
import { SearchBar } from "../components/SearchBar";
import type { Attached, Like } from "../components/SearchBar";
import { EXAMPLES } from "../examples";
import { useData } from "../lib/data";
import { basename, list, sourceKindLabel } from "../lib/format";
import { terms } from "../lib/highlight";
import { firstImage, toDataURL } from "../lib/image";
import type { FileKind, Result, SearchResponse } from "../types";

interface Query {
  text: string;
  image: Attached | null;
  like: Like | null;
}

interface Run {
  query: Query;
  state: "loading" | "done" | "error";
  data: SearchResponse | null;
  error: string;
}

function urlFor(q: Query): string {
  if (q.like) return `/?like=${encodeURIComponent(q.like.id)}${q.text ? `&q=${encodeURIComponent(q.text)}` : ""}`;
  // An image cannot live in a URL, so image searches stay at "/".
  if (q.image) return "/";
  if (q.text) return `/?q=${encodeURIComponent(q.text)}`;
  return "/";
}

function fromURL(): Query | null {
  const p = new URLSearchParams(window.location.search);
  const like = p.get("like");
  const q = p.get("q")?.trim();
  if (like) return { text: q ?? "", image: null, like: { id: like, title: basename(like) } };
  if (q) return { text: q, image: null, like: null };
  return null;
}

function sameQuery(a: Query, b: Query) {
  return a.text === b.text && a.image?.dataURL === b.image?.dataURL && a.like?.id === b.like?.id;
}

export function SearchPage({ active }: { active: boolean }) {
  const { config, sources } = useData();
  const [text, setText] = useState("");
  const [image, setImage] = useState<Attached | null>(null);
  const [like, setLike] = useState<Like | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [notice, setNotice] = useState("");
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);
  const runRef = useRef<Run | null>(null);
  runRef.current = run;

  const execute = useCallback((q: Query, push: boolean) => {
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setNotice("");
    if (push) history.pushState({ q }, "", urlFor(q));
    setRun((prev) => ({ query: q, state: "loading", data: prev?.data ?? null, error: "" }));
    api
      .search(
        q.like
          ? { like: q.like.id, text: q.text || undefined, limit: 12 }
          : { text: q.text || undefined, image: q.image?.dataURL, limit: 12 },
        ctrl.signal,
      )
      .then((data) => {
        if (ctrl.signal.aborted) return;
        // A search loaded from a URL knows only the file's id; fill in its name.
        const lf = data?.like;
        if (lf && q.like?.id === lf.id) {
          const full: Like = { id: lf.id, title: lf.title || q.like.title, thumb: lf.kind === "image" ? lf.file_url : undefined };
          q = { ...q, like: full };
          setLike((cur) => (cur?.id === lf.id ? full : cur));
        }
        setRun({ query: q, state: "done", data: { ...data, results: data?.results ?? [] }, error: "" });
      })
      .catch((e: unknown) => {
        if (ctrl.signal.aborted) return;
        setRun({ query: q, state: "error", data: null, error: e instanceof Error ? e.message : String(e) });
      });
  }, []);

  const load = useCallback(
    (q: Query | null) => {
      setText(q?.text ?? "");
      setImage(q?.image ?? null);
      setLike(q?.like ?? null);
      if (!q) {
        abort.current?.abort();
        setRun(null);
        return;
      }
      const cur = runRef.current;
      if (cur && cur.state !== "error" && sameQuery(cur.query, q)) return;
      execute(q, false);
    },
    [execute],
  );

  // First load and back/forward.
  useEffect(() => {
    const initial = fromURL();
    if (initial) {
      history.replaceState({ q: initial }, "", window.location.href);
      load(initial);
    }
    const onPop = (e: PopStateEvent) => {
      if (window.location.hash === "#/sources") return;
      const cur = runRef.current;
      // Coming back from Sources lands on the same URL; keep what is on screen.
      if (!e.state?.q && cur && urlFor(cur.query) === window.location.pathname + window.location.search) return;
      load((e.state?.q as Query | undefined) ?? fromURL());
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [load]);

  const attach = useCallback(
    async (file: File) => {
      try {
        const att = { dataURL: await toDataURL(file), name: file.name || "Pasted image" };
        setImage(att);
        setLike(null);
        execute({ text: text.trim(), image: att, like: null }, true);
        input.current?.focus({ preventScroll: true });
      } catch (e) {
        setNotice(e instanceof Error ? e.message : "That image could not be read.");
      }
    },
    [execute, text],
  );

  const submit = () => {
    const t = text.trim();
    // Words refine the file or image already in the bar; they don't replace it.
    const q: Query = like ? { text: t, image: null, like } : { text: t, image, like: null };
    if (!like && !t && !image) return;
    const cur = runRef.current;
    execute(q, !(cur && sameQuery(cur.query, q)));
    if (window.matchMedia("(pointer: coarse)").matches) input.current?.blur();
  };

  const moreLikeThis = (r: Result) => {
    const l: Like = { id: r.id, title: r.title, thumb: r.kind === "image" ? r.file_url : undefined };
    setText("");
    setImage(null);
    setLike(l);
    execute({ text: "", image: null, like: l }, true);
    window.scrollTo({ top: 0 });
  };

  const clearLike = () => {
    setLike(null);
    abort.current?.abort();
    setRun(null);
    history.pushState({}, "", "/");
    input.current?.focus();
  };

  const example = (q: string) => {
    setText(q);
    setImage(null);
    setLike(null);
    execute({ text: q, image: null, like: null }, true);
  };

  // Drop an image anywhere, paste one, or press "/" to focus the bar.
  useEffect(() => {
    if (!active) return;
    let depth = 0;
    const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes("Files") ?? false;
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      setDragging(true);
    };
    const over = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      const f = firstImage(e.dataTransfer?.files);
      if (f) void attach(f);
      else setNotice("Only images can be used as a query.");
    };
    const paste = (e: ClipboardEvent) => {
      const f = firstImage(e.clipboardData?.items);
      if (!f) return;
      e.preventDefault();
      void attach(f);
    };
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      e.preventDefault();
      input.current?.focus();
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    window.addEventListener("paste", paste);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
      window.removeEventListener("paste", paste);
      window.removeEventListener("keydown", key);
    };
  }, [active, attach]);

  // Focus on desktop only; on phones it would open the keyboard over the page.
  useEffect(() => {
    if (active && !runRef.current && window.matchMedia("(pointer: fine)").matches) input.current?.focus();
  }, [active]);

  const hasRun = run !== null;
  const words = run ? terms(run.query.text) : [];

  return (
    <div hidden={!active}>
      <div
        className={
          hasRun ? "pb-16" : "flex min-h-[calc(100dvh-3.5rem)] flex-col justify-center pt-6 pb-[22vh]"
        }
      >
        {!hasRun && <Intro demo={config?.demo ?? false} sources={sources} />}
        <div className={hasRun ? "sticky top-0 z-10 -mx-4 bg-background px-4 pt-2 pb-3" : ""}>
          <SearchBar
            ref={input}
            text={text}
            image={image}
            like={like}
            loading={run?.state === "loading"}
            onText={setText}
            onPickFile={(f) => void attach(f)}
            onClearImage={() => setImage(null)}
            onClearLike={clearLike}
            onSubmit={submit}
          />
          {notice && (
            <p role="status" className="mt-2 text-sm text-muted-foreground">
              {notice}
            </p>
          )}
        </div>
        {!hasRun && (
          <p className="mt-4 text-sm text-muted-foreground">
            Try{" "}
            {EXAMPLES.map((q, i) => (
              <Fragment key={q}>
                {i > 0 && (i === EXAMPLES.length - 1 ? (EXAMPLES.length > 2 ? ", or " : " or ") : ", ")}
                <button
                  type="button"
                  onClick={() => example(q)}
                  className="rounded-sm text-foreground underline decoration-border-strong underline-offset-4 outline-none hover:decoration-foreground focus-visible:ring-2 focus-visible:ring-ring/30"
                >
                  {q}
                </button>
              </Fragment>
            ))}
            .
          </p>
        )}
        {run && <Results run={run} words={words} onMoreLikeThis={moreLikeThis} onRetry={() => execute(run.query, false)} />}
      </div>

      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-background/90 p-4">
          <div className="flex h-full w-full items-center justify-center border-2 border-dashed border-border-strong">
            <p className="text-base">Drop an image to search with it</p>
          </div>
        </div>
      )}
    </div>
  );
}

function Intro({ demo, sources }: { demo: boolean; sources: ReturnType<typeof useData>["sources"] }) {
  let line = "Search images, recordings, and documents from S3 and Google Drive.";
  let add = false;
  if (sources && sources.length === 0) {
    line = "Nothing to search yet.";
    add = !demo;
  } else if (sources) {
    const total = sources.reduce((n, s) => n + s.files, 0);
    const has = (...ks: FileKind[]) => sources.some((s) => ks.some((k) => (s.by_kind[k] ?? 0) > 0));
    const groups = [
      has("image") && "images",
      has("audio", "video") && "recordings",
      has("pdf", "text") && "documents",
    ].filter((g): g is string => Boolean(g));
    const from = list(Array.from(new Set(sources.map((s) => sourceKindLabel(s.kind)))));
    line =
      total > 0 && groups.length > 0
        ? `Search ${total.toLocaleString()} ${list(groups)} from ${from}.`
        : `Nothing indexed yet. Files from ${from} show up here as they sync.`;
  }
  return (
    <p className="mb-4 text-lg leading-snug text-foreground">
      {line}
      {add && (
        <>
          {" "}
          <a href="#/sources" className="underline decoration-border-strong underline-offset-4 hover:decoration-foreground">
            Add a source
          </a>
        </>
      )}
    </p>
  );
}

function Results({
  run,
  words,
  onMoreLikeThis,
  onRetry,
}: {
  run: Run;
  words: string[];
  onMoreLikeThis: (r: Result) => void;
  onRetry: () => void;
}) {
  if (run.state === "error") {
    return (
      <div className="flex flex-wrap items-center gap-3 py-6 text-sm">
        <p>Search failed: {run.error}</p>
        <Button variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
      </div>
    );
  }
  const data = run.data;
  if (!data) return null;
  const n = data.results.length;
  return (
    <div className={`transition-opacity ${run.state === "loading" ? "opacity-50" : ""}`} aria-busy={run.state === "loading"}>
      <p className="pt-1 pb-3 text-xs text-muted-foreground">
        {n === 0
          ? run.query.like
            ? "Nothing similar found."
            : "Nothing matched. Try other words or another image."
          : `${n.toLocaleString()} ${n === 1 ? "result" : "results"} in ${data.took_ms.toLocaleString()} ms`}
      </p>
      {n > 0 && (
        <ol className="divide-y divide-border border-y border-border">
          {data.results.map((r) => (
            <ResultRow key={r.id} result={r} words={words} onMoreLikeThis={onMoreLikeThis} />
          ))}
        </ol>
      )}
    </div>
  );
}
