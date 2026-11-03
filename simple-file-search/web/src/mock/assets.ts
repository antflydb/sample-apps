// Generated stand-ins for originals, so mock mode needs no binary fixtures:
// a speech-like WAV (for the player and waveform) and a plain multi-page PDF
// (so #page=N links land somewhere).

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** 8 kHz, 8-bit mono WAV with bursts that read as speech on a waveform. */
export function wav(seconds: number, seed: number): Blob {
  const rate = 8000;
  const n = Math.floor(seconds * rate);
  const buf = new ArrayBuffer(44 + n);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + n, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, rate, true);
  v.setUint32(28, rate, true);
  v.setUint16(32, 1, true);
  v.setUint16(34, 8, true);
  str(36, "data");
  v.setUint32(40, n, true);

  const rand = rng(seed);
  let i = 0;
  while (i < n) {
    // A "word": 120-420 ms of voiced sound, then a 60-500 ms pause.
    const len = Math.floor((0.12 + rand() * 0.3) * rate);
    const gap = Math.floor((0.06 + rand() * (rand() < 0.15 ? 0.9 : 0.35)) * rate);
    const pitch = 110 + rand() * 90;
    const amp = 0.25 + rand() * 0.7;
    for (let k = 0; k < len && i < n; k++, i++) {
      const t = i / rate;
      const env = Math.sin((Math.PI * k) / len) ** 0.6;
      const s =
        Math.sin(2 * Math.PI * pitch * t) * 0.6 +
        Math.sin(2 * Math.PI * pitch * 2.03 * t) * 0.3 +
        (rand() - 0.5) * 0.25;
      v.setUint8(44 + i, 128 + Math.round(s * env * amp * 110));
    }
    for (let k = 0; k < gap && i < n; k++, i++) v.setUint8(44 + i, 128 + Math.round((rand() - 0.5) * 3));
  }
  return new Blob([buf], { type: "audio/wav" });
}

/** A PDF with one line of text per page, plus extra lines where given. */
export function pdf(title: string, pages: number, text: Record<number, string>): Blob {
  const esc = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`).replace(/[^\x20-\x7e]/g, "-");
  const objs: string[] = [];
  const kids: number[] = [];
  // 1 catalog, 2 pages, 3 font, then (page, content) pairs.
  for (let p = 1; p <= pages; p++) {
    const pageId = 2 + p * 2;
    const contentId = pageId + 1;
    kids.push(pageId);
    const lines = [`BT /F1 11 Tf 72 740 Td (${esc(title)}  -  page ${p}) Tj ET`];
    if (text[p]) lines.push(`BT /F1 13 Tf 72 700 Td (${esc(text[p])}) Tj ET`);
    const stream = lines.join("\n");
    objs[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`;
    objs[contentId] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  }
  objs[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objs[2] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${pages} >>`;
  objs[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";

  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let id = 1; id < objs.length; id++) {
    offsets[id] = out.length;
    out += `${id} 0 obj\n${objs[id]}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objs.length; id++) out += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Blob([out], { type: "application/pdf" });
}
