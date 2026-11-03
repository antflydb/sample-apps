import { Button, Dialog, DialogContent, DialogDescription, DialogTitle } from "@antfly/design-system/primitives";
import { AudioLinesIcon, FileTextIcon, FileIcon, FilmIcon, ImageIcon } from "lucide-react";
import { useState } from "react";
import { kindWord, sourceKindShort } from "../lib/format";
import { highlight } from "../lib/highlight";
import type { FileKind, Match, Result } from "../types";
import { MediaPlayer } from "./MediaPlayer";

const ICONS: Record<FileKind, typeof FileIcon> = {
  image: ImageIcon,
  audio: AudioLinesIcon,
  video: FilmIcon,
  pdf: FileTextIcon,
  text: FileIcon,
};

const LIMIT = 3;

interface Props {
  result: Result;
  words: string[];
  onMoreLikeThis: (r: Result) => void;
}

export function ResultRow({ result: r, words, onMoreLikeThis }: Props) {
  const Icon = ICONS[r.kind] ?? FileIcon;
  const matches = r.matches ?? [];
  const segments = matches.filter((m): m is Extract<Match, { type: "segment" }> => m.type === "segment");
  const rest = matches.filter((m) => m.type !== "segment");
  const isMedia = r.kind === "audio" || r.kind === "video";

  return (
    <li className="grid grid-cols-[1rem_minmax(0,1fr)] gap-x-3 py-6">
      <Icon aria-hidden className="mt-0.5 size-4 text-muted-foreground" />
      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
          <a
            href={r.file_url}
            target="_blank"
            rel="noreferrer"
            className="min-w-0 font-medium [overflow-wrap:anywhere] underline-offset-4 hover:underline"
          >
            {r.title}
          </a>
          <span className="text-xs text-muted-foreground">
            {sourceKindShort(r.source.kind)} · {r.source.name}
          </span>
        </div>

        {r.kind === "image" && <ImagePreview result={r} />}
        {isMedia && (
          <MediaPlayer
            src={r.file_url}
            kind={r.kind as "audio" | "video"}
            title={r.title}
            segments={segments}
            words={words}
            limit={LIMIT}
          />
        )}
        {rest.length > 0 && <Evidence result={r} matches={rest} words={words} />}

        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {/* Results are ranked by fusing several indexes, so per-index
              similarity scores would read as out of order; show none. */}
          <span>{kindWord(r.kind)}</span>
          <span className="-mr-3 flex items-center gap-1">
            {r.web_url && (
              <a
                href={r.web_url}
                target="_blank"
                rel="noreferrer"
                className="rounded-sm px-2 py-1.5 underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring/30"
              >
                {r.source.kind === "drive" ? "Open in Drive" : "Open in source"}
              </a>
            )}
            <Button variant="ghost" size="sm" onClick={() => onMoreLikeThis(r)}>
              More like this
            </Button>
          </span>
        </div>
      </div>
    </li>
  );
}

function Evidence({ result: r, matches, words }: { result: Result; matches: Match[]; words: string[] }) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? matches : matches.slice(0, LIMIT);
  const hidden = matches.length - shown.length;
  return (
    <ul className="flex flex-col gap-1.5">
      {shown.map((m, i) => (
        <li key={i} className="flex min-w-0 gap-3 text-sm">
          {m.type === "page" ? (
            <a
              href={`${r.file_url}#page=${m.page}`}
              target="_blank"
              rel="noreferrer"
              className="group flex w-full gap-3 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
            >
              <span className="w-12 shrink-0 pt-px font-mono text-xs tabular-nums text-muted-foreground underline-offset-4 group-hover:text-foreground group-hover:underline">
                p.{m.page}
              </span>
              <span className="min-w-0 text-muted-foreground [overflow-wrap:anywhere]">“{highlight(m.text, words)}”</span>
            </a>
          ) : (
            <span className="min-w-0 text-muted-foreground [overflow-wrap:anywhere]">“{highlight(m.text, words)}”</span>
          )}
        </li>
      ))}
      {hidden > 0 && (
        <li>
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className={`${matches[0]?.type === "page" ? "pl-15" : ""} text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline`}
          >
            {hidden} more
          </button>
        </li>
      )}
    </ul>
  );
}

function ImagePreview({ result: r }: { result: Result }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");

  if (state === "error") {
    return (
      <p className="flex h-40 w-40 items-center justify-center border border-border text-xs text-muted-foreground">
        No preview
      </p>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`View ${r.title} larger`}
        className="self-start outline-none focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <img
          src={r.file_url}
          alt={r.title}
          loading="lazy"
          decoding="async"
          onLoad={() => setState("ok")}
          onError={() => setState("error")}
          className={`block h-40 w-auto max-w-full border border-border object-contain object-left ${state === "loading" ? "min-w-40 bg-muted" : ""}`}
        />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="xl" className="gap-4 p-4 sm:p-5">
          <DialogTitle className="pr-8 text-base [overflow-wrap:anywhere]">{r.title}</DialogTitle>
          <DialogDescription className="sr-only">
            {r.source.name}, {r.path}
          </DialogDescription>
          <img
            src={r.file_url}
            alt={r.title}
            className="max-h-[75dvh] w-full border border-border object-contain"
          />
          <div className="flex justify-end gap-4 text-sm">
            {r.web_url && (
              <a href={r.web_url} target="_blank" rel="noreferrer" className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
                {r.source.kind === "drive" ? "Open in Drive" : "Open in source"}
              </a>
            )}
            <a href={r.file_url} target="_blank" rel="noreferrer" className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
              Open original
            </a>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
