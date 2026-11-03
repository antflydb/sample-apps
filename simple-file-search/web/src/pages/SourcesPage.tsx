import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  buttonVariants,
  Spinner,
} from "@antfly/design-system/primitives";
import { useEffect, useState } from "react";
import { api } from "../api";
import { AddSourceDialog } from "../components/AddSourceDialog";
import { useData } from "../lib/data";
import { ago, byKind, count, sourceKindLabel } from "../lib/format";
import type { Source } from "../types";

export function SourcesPage() {
  const { config, sources, status, error, refresh, watch } = useData();
  const [adding, setAdding] = useState(false);
  const [now, setNow] = useState(Date.now());
  const demo = config?.demo ?? true; // hide controls until we know

  useEffect(() => watch(), [watch]);
  useEffect(() => {
    void refresh();
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, [refresh]);

  return (
    <div className="pt-6 pb-16 sm:pt-10">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-[-0.015em]">Sources</h1>
        {config && !demo && <Button onClick={() => setAdding(true)}>Add source</Button>}
      </div>

      {config && demo && (
        <p className="mt-3 text-sm text-muted-foreground">
          This demo is read-only, so sources can't be added or changed here.
          {config.repo_url && (
            <>
              {" "}
              <a
                href={config.repo_url}
                target="_blank"
                rel="noreferrer"
                className="text-foreground underline decoration-border-strong underline-offset-4 hover:decoration-foreground"
              >
                Run it yourself
              </a>{" "}
              to search your own S3 bucket or Drive folder.
            </>
          )}
        </p>
      )}

      {status && status.pending > 0 && <Progress indexed={status.indexed} files={status.files} />}
      {status && status.failed > 0 && (
        <p className="mt-2 text-sm text-destructive">{count(status.failed, "file", "files")} failed to index.</p>
      )}

      {error && !sources && <p className="mt-8 text-sm">Couldn't load sources: {error}</p>}
      {!sources && !error && (
        <div className="mt-8 text-muted-foreground">
          <Spinner />
        </div>
      )}
      {sources && sources.length === 0 && (
        <p className="mt-8 text-sm text-muted-foreground">
          No sources yet.{!demo && " Add an S3 bucket or a Google Drive folder to start."}
        </p>
      )}
      {sources && sources.length > 0 && (
        <ul className="mt-6 divide-y divide-border border-y border-border">
          {sources.map((s) => (
            <SourceRow key={s.id} source={s} demo={demo} now={now} onChange={refresh} />
          ))}
        </ul>
      )}

      {!demo && <AddSourceDialog open={adding} onOpenChange={setAdding} onAdded={refresh} serverKey={config?.google_api_key ?? false} />}
    </div>
  );
}

function Progress({ indexed, files }: { indexed: number; files: number }) {
  const pct = files > 0 ? Math.min(100, (indexed / files) * 100) : 0;
  return (
    <div className="mt-6">
      <p className="text-sm">
        Indexing: <span className="font-mono tabular-nums">{indexed.toLocaleString()}</span> of{" "}
        <span className="font-mono tabular-nums">{files.toLocaleString()}</span> files
      </p>
      <div
        role="progressbar"
        aria-label="Indexing progress"
        aria-valuemin={0}
        aria-valuemax={files}
        aria-valuenow={indexed}
        className="mt-2 h-0.5 w-full bg-border"
      >
        <div className="h-full bg-foreground transition-[width] duration-500" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function SourceRow({
  source: s,
  demo,
  now,
  onChange,
}: {
  source: Source;
  demo: boolean;
  now: number;
  onChange: () => Promise<void>;
}) {
  const [busy, setBusy] = useState<"" | "sync" | "remove">("");
  const [confirm, setConfirm] = useState(false);
  const [err, setErr] = useState("");

  const act = async (kind: "sync" | "remove") => {
    setBusy(kind);
    setErr("");
    try {
      if (kind === "sync") await api.syncSource(s.id);
      else await api.removeSource(s.id);
      await onChange();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  };

  const kinds = byKind(s.by_kind);

  return (
    <li className="flex flex-col gap-3 py-5 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
      <div className="flex min-w-0 flex-col gap-1">
        <p className="font-medium">{s.name}</p>
        <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
          {sourceKindLabel(s.kind)}
          {/* Skip a location that only restates the kind, e.g. "Google Drive folder". */}
          {s.location && !s.location.toLowerCase().startsWith(`${sourceKindLabel(s.kind).toLowerCase()} `) && (
            <>
              {" · "}
              <span className="font-mono text-[13px]">{s.location}</span>
            </>
          )}
        </p>
        <p className="text-sm text-muted-foreground">
          {count(s.files, "file", "files")}
          {kinds && `: ${kinds}`}
        </p>
        <p className="text-sm">
          <SyncState source={s} now={now} />
        </p>
        {err && (
          <p role="alert" className="text-sm text-destructive">
            {err}
          </p>
        )}
      </div>

      {!demo && (
        <div className="flex shrink-0 gap-2 sm:-mr-3">
          <Button
            variant="outline"
            size="sm"
            disabled={busy !== "" || s.status === "syncing"}
            onClick={() => void act("sync")}
          >
            {busy === "sync" && <Spinner />}
            Sync now
          </Button>
          <Button variant="ghost" size="sm" disabled={busy !== ""} onClick={() => setConfirm(true)}>
            Remove
          </Button>
          <AlertDialog open={confirm} onOpenChange={setConfirm}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Remove {s.name}?</AlertDialogTitle>
                <AlertDialogDescription>
                  Its {count(s.files, "file", "files")} leave the search index. The originals in{" "}
                  {sourceKindLabel(s.kind)} are not touched.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  className={buttonVariants({ variant: "destructive" })}
                  onClick={() => void act("remove")}
                >
                  Remove
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      )}
    </li>
  );
}

function SyncState({ source: s, now }: { source: Source; now: number }) {
  if (s.status === "syncing") {
    return (
      <span className="inline-flex items-center gap-2">
        <span aria-hidden className="size-1.5 animate-live rounded-full bg-foreground" />
        Syncing
        {s.last_synced_at && (
          <span className="text-muted-foreground">· last synced {ago(s.last_synced_at, now)}</span>
        )}
      </span>
    );
  }
  if (s.status === "error") {
    return <span className="text-destructive">Sync failed: {s.error || "unknown error"}</span>;
  }
  return (
    <span className="text-muted-foreground">
      {s.last_synced_at ? `Synced ${ago(s.last_synced_at, now)}` : "Not synced yet"}
    </span>
  );
}
