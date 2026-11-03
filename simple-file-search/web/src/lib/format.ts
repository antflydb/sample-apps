import type { FileKind, Source, SourceKind } from "../types";

const KIND_WORDS: Record<FileKind, [string, string]> = {
  image: ["image", "images"],
  audio: ["audio file", "audio files"],
  video: ["video", "videos"],
  pdf: ["PDF", "PDFs"],
  text: ["text file", "text files"],
};

export const KIND_ORDER: FileKind[] = ["image", "audio", "video", "pdf", "text"];

export function kindWord(kind: FileKind, n = 1): string {
  const w = KIND_WORDS[kind] ?? [kind, kind];
  return n === 1 ? w[0] : w[1];
}

export function sourceKindLabel(kind: SourceKind): string {
  return kind === "drive" ? "Google Drive" : "S3";
}

export function sourceKindShort(kind: SourceKind): string {
  return kind === "drive" ? "Drive" : "S3";
}

export function count(n: number, one: string, many: string): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

/** "a, b, and c" */
export function list(items: string[]): string {
  if (items.length <= 1) return items.join("");
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

/** "300 images, 112 audio files" */
export function byKind(by: Source["by_kind"]): string {
  return KIND_ORDER.filter((k) => (by[k] ?? 0) > 0)
    .map((k) => `${(by[k] ?? 0).toLocaleString()} ${kindWord(k, by[k])}`)
    .join(", ");
}

/** 2130 -> "0:02", 3_725_000 -> "1:02:05" */
export function clock(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

export function ago(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const s = Math.round((t - now) / 1000);
  const abs = Math.abs(s);
  if (abs < 45) return "just now";
  if (abs < 3600) return rtf.format(Math.round(s / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(s / 3600), "hour");
  if (abs < 86400 * 30) return rtf.format(Math.round(s / 86400), "day");
  return new Date(t).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/** Last path segment of a result id like "nasa-media:images/a.jpg". */
export function basename(id: string): string {
  const afterSource = id.includes(":") ? id.slice(id.indexOf(":") + 1) : id;
  const parts = afterSource.split("/");
  return parts[parts.length - 1] || afterSource;
}
