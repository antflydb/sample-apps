// Draws a waveform from the file itself: fetch, decode with WebAudio, and keep
// the loudest sample in each of N buckets. Results are cached per URL and at
// most two decodes run at once, so a page of audio results stays responsive.

const MAX_BYTES = 25 * 1024 * 1024;
const cache = new Map<string, Promise<number[]>>();
let running = 0;
const queue: Array<() => void> = [];

function slot(): Promise<() => void> {
  return new Promise((resolve) => {
    const go = () => {
      running++;
      resolve(() => {
        running--;
        queue.shift()?.();
      });
    };
    if (running < 2) go();
    else queue.push(go);
  });
}

async function decode(url: string, buckets: number): Promise<number[]> {
  const release = await slot();
  try {
    const ctrl = new AbortController();
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const len = Number(res.headers.get("content-length") ?? 0);
    if (len > MAX_BYTES) {
      ctrl.abort();
      throw new Error("too large to draw");
    }
    const buf = await res.arrayBuffer();
    const Offline =
      window.OfflineAudioContext ??
      (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext })
        .webkitOfflineAudioContext;
    if (!Offline) throw new Error("no WebAudio");
    const ctx = new Offline(1, 1, 44100);
    const audio = await ctx.decodeAudioData(buf);
    const data = audio.getChannelData(0);
    const size = Math.max(1, Math.floor(data.length / buckets));
    const out: number[] = [];
    let top = 0;
    for (let b = 0; b < buckets; b++) {
      let m = 0;
      const end = Math.min(data.length, (b + 1) * size);
      // Stride through long buckets; the peak shape survives sampling.
      const step = Math.max(1, Math.floor(size / 2000));
      for (let i = b * size; i < end; i += step) {
        const v = Math.abs(data[i]);
        if (v > m) m = v;
      }
      out.push(m);
      if (m > top) top = m;
    }
    return out.map((v) => (top > 0 ? Math.sqrt(v / top) : 0));
  } finally {
    release();
  }
}

export function peaks(url: string, buckets = 96): Promise<number[]> {
  const key = `${buckets}:${url}`;
  let p = cache.get(key);
  if (!p) {
    p = decode(url, buckets);
    cache.set(key, p);
  }
  return p;
}
