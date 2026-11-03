import type { ReactNode } from "react";

const STOP = new Set([
  "the", "and", "for", "with", "from", "that", "this", "into", "onto", "over",
  "are", "was", "were", "has", "have", "its", "his", "her", "their", "our", "you",
]);

export function terms(q: string): string[] {
  return Array.from(
    new Set(
      q
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter((w) => w.length >= 3 && !STOP.has(w))
        .map(stem),
    ),
  );
}

// Crude suffix trim so "repairing" also marks "repaired" and "repairs".
function stem(w: string): string {
  const m = w.match(/^(.{4,}?)(ing|ed|es|s)$/u);
  return m ? m[1] : w;
}

function escape(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Marks query words (and their prefixes, e.g. "repair" in "repairing"). */
export function highlight(text: string, words: string[]): ReactNode {
  if (words.length === 0) return text;
  const re = new RegExp(`(\\b(?:${words.map(escape).join("|")})\\w*)`, "giu");
  const parts = text.split(re);
  return parts.map((p, i) =>
    i % 2 === 1 ? (
      <strong key={i} className="font-medium text-foreground">
        {p}
      </strong>
    ) : (
      p
    ),
  );
}
