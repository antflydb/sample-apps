// Turns an image File/Blob into a JPEG data URL, scaled so the long edge is at
// most `max` pixels. Phone photos are 4-12 MB; the embedder does not need that.
export async function toDataURL(file: Blob, max = 1024): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("That file could not be read as an image."));
      el.src = url;
    });
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("This browser cannot resize images.");
    ctx.fillStyle = "#fff"; // transparent PNGs flatten onto white, not black
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL("image/jpeg", 0.88);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function firstImage(items: DataTransferItemList | FileList | null | undefined): File | null {
  if (!items) return null;
  for (const it of Array.from(items as ArrayLike<DataTransferItem | File>)) {
    if (it instanceof File) {
      if (it.type.startsWith("image/")) return it;
    } else if (it.kind === "file" && it.type.startsWith("image/")) {
      const f = it.getAsFile();
      if (f) return f;
    }
  }
  return null;
}
