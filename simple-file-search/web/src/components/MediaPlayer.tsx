import { PauseIcon, PlayIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, PointerEvent } from "react";
import { clock } from "../lib/format";
import { highlight } from "../lib/highlight";
import { peaks } from "../lib/peaks";
import type { Match } from "../types";

type Segment = Extract<Match, { type: "segment" }>;

// Only one result plays at a time.
let playing: HTMLMediaElement | null = null;

function useVisible<T extends Element>() {
  const ref = useRef<T>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || visible) return;
    if (!("IntersectionObserver" in window)) {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setVisible(true);
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);
  return [ref, visible] as const;
}

interface Props {
  src: string;
  kind: "audio" | "video";
  title: string;
  segments: Segment[];
  words: string[];
  /** How many segment rows to show before "Show more". */
  limit: number;
}

export function MediaPlayer({ src, kind, title, segments, words, limit }: Props) {
  const media = useRef<HTMLAudioElement & HTMLVideoElement>(null);
  const [wrapRef, visible] = useVisible<HTMLDivElement>();
  const [isPlaying, setIsPlaying] = useState(false);
  const [now, setNow] = useState(0); // ms
  const [duration, setDuration] = useState(0); // ms
  const [wave, setWave] = useState<number[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (kind !== "audio" || !visible) return;
    let live = true;
    peaks(src)
      .then((p) => live && setWave(p))
      .catch(() => live && setWave(null));
    return () => {
      live = false;
    };
  }, [kind, src, visible]);

  // timeupdate fires ~4x a second; follow the playhead per frame while playing.
  useEffect(() => {
    if (!isPlaying) return;
    let raf = 0;
    const tick = () => {
      if (media.current) setNow(media.current.currentTime * 1000);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying]);

  const play = useCallback(() => {
    const el = media.current;
    if (!el) return;
    if (playing && playing !== el) playing.pause();
    playing = el;
    el.play().catch(() => setFailed(true));
  }, []);

  const toggle = () => {
    const el = media.current;
    if (!el) return;
    if (el.paused) play();
    else el.pause();
  };

  const seek = (ms: number) => {
    const el = media.current;
    if (!el) return;
    const max = duration || Number.MAX_SAFE_INTEGER;
    const t = Math.max(0, Math.min(ms, max));
    el.currentTime = t / 1000;
    setNow(t);
  };

  const playFrom = (ms: number) => {
    seek(ms);
    play();
  };

  // Segments can mark the timeline before metadata loads.
  const span = duration || Math.max(0, ...segments.map((s) => s.end_ms));
  const pct = span > 0 ? Math.min(100, (now / span) * 100) : 0;

  const fromPointer = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    seek(x * span);
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 15000 : 5000;
    if (e.key === "ArrowRight") seek(now + step);
    else if (e.key === "ArrowLeft") seek(now - step);
    else if (e.key === "Home") seek(0);
    else if (e.key === "End") seek(span);
    else if (e.key === " " || e.key === "Enter") toggle();
    else return;
    e.preventDefault();
  };

  const shown = expanded ? segments : segments.slice(0, limit);
  const hidden = segments.length - shown.length;

  return (
    <div ref={wrapRef} className="flex flex-col gap-3">
      {kind === "video" ? (
        <video
          ref={media}
          src={src.includes("#") ? src : `${src}#t=0.001`}
          preload="metadata"
          playsInline
          onClick={toggle}
          aria-label={title}
          className="h-40 w-auto max-w-full cursor-pointer self-start border border-border bg-black object-contain"
          onLoadedMetadata={(e) => setDuration(e.currentTarget.duration * 1000)}
          onTimeUpdate={(e) => setNow(e.currentTarget.currentTime * 1000)}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onEnded={() => setIsPlaying(false)}
          onError={() => setFailed(true)}
        />
      ) : (
        <audio
          ref={media}
          src={src}
          preload="metadata"
          onLoadedMetadata={(e) => setDuration(e.currentTarget.duration * 1000)}
          onTimeUpdate={(e) => setNow(e.currentTarget.currentTime * 1000)}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onEnded={() => setIsPlaying(false)}
          onError={() => setFailed(true)}
        />
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={toggle}
          disabled={failed}
          aria-label={isPlaying ? `Pause ${title}` : `Play ${title}`}
          className="flex size-8 shrink-0 items-center justify-center rounded-md border border-input text-foreground transition-colors outline-none hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-50"
        >
          {isPlaying ? <PauseIcon className="size-3.5" /> : <PlayIcon className="size-3.5" />}
        </button>

        <div
          role="slider"
          tabIndex={failed ? -1 : 0}
          aria-label={`Seek ${title}`}
          aria-valuemin={0}
          aria-valuemax={Math.round(span / 1000)}
          aria-valuenow={Math.round(now / 1000)}
          aria-valuetext={`${clock(now)} of ${clock(span)}`}
          onKeyDown={onKey}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            fromPointer(e);
          }}
          onPointerMove={(e) => {
            if (e.currentTarget.hasPointerCapture(e.pointerId)) fromPointer(e);
          }}
          className="relative h-8 min-w-0 flex-1 cursor-pointer touch-none rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
        >
          {/* Matched segments, shaded on the timeline. */}
          {span > 0 &&
            segments.map((s, i) => (
              <span
                key={i}
                aria-hidden
                className="absolute inset-y-0 bg-foreground/[0.07]"
                style={{
                  left: `${(s.start_ms / span) * 100}%`,
                  width: `${Math.max(0.5, ((s.end_ms - s.start_ms) / span) * 100)}%`,
                }}
              />
            ))}
          {wave ? (
            <>
              <Bars peaks={wave} className="text-muted-foreground/45" />
              <Bars
                peaks={wave}
                className="text-foreground"
                style={{ clipPath: `inset(0 ${100 - pct}% 0 0)` }}
              />
            </>
          ) : (
            <>
              <span aria-hidden className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-border-strong" />
              <span
                aria-hidden
                className="absolute left-0 top-1/2 h-0.5 -translate-y-1/2 bg-foreground"
                style={{ width: `${pct}%` }}
              />
            </>
          )}
          <span
            aria-hidden
            className="absolute inset-y-0 w-px bg-foreground"
            style={{ left: `${pct}%`, opacity: now > 50 ? 1 : 0 }}
          />
        </div>

        <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
          {failed ? "Can't play" : `${clock(now)} / ${duration ? clock(duration) : "-:--"}`}
        </span>
      </div>

      {shown.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {shown.map((s, i) => {
            const active = now >= s.start_ms && now < s.end_ms && (isPlaying || now > 0);
            return (
              <li key={i}>
                <button
                  type="button"
                  onClick={() => playFrom(s.start_ms)}
                  className="group flex w-full gap-3 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                >
                  <span
                    className={`w-12 shrink-0 pt-px font-mono text-xs tabular-nums underline-offset-4 group-hover:underline ${active ? "text-foreground" : "text-muted-foreground"}`}
                  >
                    {clock(s.start_ms)}
                  </span>
                  <span className={`min-w-0 text-sm [overflow-wrap:anywhere] ${active ? "text-foreground" : "text-muted-foreground"}`}>
                    “{highlight(s.text, words)}”
                  </span>
                </button>
              </li>
            );
          })}
          {hidden > 0 && (
            <li>
              <button
                type="button"
                onClick={() => setExpanded(true)}
                className="pl-15 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              >
                {hidden} more
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

function Bars({
  peaks: p,
  className,
  style,
}: {
  peaks: number[];
  className?: string;
  style?: CSSProperties;
}) {
  const n = p.length;
  return (
    <svg
      aria-hidden
      viewBox={`0 0 ${n} 100`}
      preserveAspectRatio="none"
      className={`absolute inset-0 h-full w-full ${className ?? ""}`}
      style={style}
    >
      {p.map((v, i) => {
        const h = Math.max(4, v * 100);
        return <rect key={i} x={i + 0.2} y={(100 - h) / 2} width={0.6} height={h} fill="currentColor" />;
      })}
    </svg>
  );
}
