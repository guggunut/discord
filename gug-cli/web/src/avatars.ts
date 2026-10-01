// Which agents have a custom picture (id → version), shared by every Sigil.
import { useEffect, useState } from "react";

let versions: Record<string, number> = {};
const listeners = new Set<() => void>();
export function setAvatars(v: Record<string, number> | undefined) {
  versions = { ...(v ?? {}) };
  listeners.forEach((l) => l());
}
export function setAvatar(id: string, v: number | null) {
  const next = { ...versions };
  if (v) next[id] = v;
  else delete next[id];
  setAvatars(next);
}
export function useAvatar(id: string): string | null {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
  const v = versions[id];
  return v ? `/api/agents/${id}/avatar?v=${v}` : null;
}

export type Look = "original" | "mono" | "red" | "duotone";

/** Crops to a centred square, resizes to 256px and applies an on-brand look. */
export async function processImage(file: File, look: Look, zoom = 1): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const size = 256;
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const ctx = c.getContext("2d")!;
    const side = Math.min(img.naturalWidth, img.naturalHeight) / zoom;
    ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, size, size);
    if (look !== "original") {
      const d = ctx.getImageData(0, 0, size, size);
      const p = d.data;
      for (let i = 0; i < p.length; i += 4) {
        const l = (0.2126 * p[i] + 0.7152 * p[i + 1] + 0.0722 * p[i + 2]) / 255;
        let r: number, g: number, b: number;
        if (look === "mono") r = g = b = l * 255;
        else if (look === "red") [r, g, b] = [Math.min(255, l * 300), l * 52, l * 66];
        else {
          // black → signal red → white
          const t = l < 0.55 ? l / 0.55 : (l - 0.55) / 0.45;
          [r, g, b] = l < 0.55 ? [3 + t * 252, 3 + t * 40, 3 + t * 55] : [255, 43 + t * 201, 58 + t * 187];
        }
        p[i] = r;
        p[i + 1] = g;
        p[i + 2] = b;
      }
      ctx.putImageData(d, 0, 0);
    }
    const webp = c.toDataURL("image/webp", 0.88);
    return webp.startsWith("data:image/webp") ? webp : c.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(url);
  }
}
