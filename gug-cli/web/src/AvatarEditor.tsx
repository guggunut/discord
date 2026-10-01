// Pick a picture, choose an on-brand look, preview it, save.
import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import { useApp } from "./App";
import { processImage, setAvatar, useAvatar, type Look } from "./avatars";
import { play } from "./sfx";
import { Icon, P, Seg, Sigil } from "./ui";

const LOOKS: [Look, string][] = [["original", "Original"], ["mono", "Mono"], ["red", "Red tint"], ["duotone", "Duotone"]];

export function AvatarEditor({ id, name }: { id: string; name: string }) {
  const { toast } = useApp();
  const current = useAvatar(id);
  const [file, setFile] = useState<File | null>(null);
  const [look, setLook] = useState<Look>(() => (localStorage.getItem("gug-avatar-look") as Look) || "duotone");
  const [zoom, setZoom] = useState(1);
  const [preview, setPreview] = useState("");
  const [saving, setSaving] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setFile(null);
    setPreview("");
  }, [id]);
  useEffect(() => {
    if (!file) return;
    let live = true;
    void processImage(file, look, zoom)
      .then((d) => live && setPreview(d))
      .catch(() => toast("Couldn’t read that image.", "err"));
    return () => {
      live = false;
    };
  }, [file, look, zoom]);

  const save = async () => {
    setSaving(true);
    try {
      const r = await api<{ v: number }>(`/api/agents/${id}/avatar`, { method: "PUT", body: { image: preview } });
      setAvatar(id, r.v);
      localStorage.setItem("gug-avatar-look", look);
      setFile(null);
      setPreview("");
      play("success");
      toast(`${name} has a new look.`);
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setSaving(false);
    }
  };
  const reset = async () => {
    await api(`/api/agents/${id}/avatar`, { method: "DELETE" });
    setAvatar(id, null);
    toast(id === "you" ? "Back to your initial." : `${name} is back to its sigil.`);
  };

  return (
    <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
      <div style={{ position: "relative" }}>
        {preview ? (
          <img src={preview} alt="Preview" width={88} height={88} style={{ borderRadius: 26, border: "1px solid rgba(255,43,58,0.6)", boxShadow: "0 0 30px -10px #FF2B3A", display: "block" }} />
        ) : (
          <Sigil id={id} size={88} />
        )}
      </div>
      <div style={{ flex: "1 1 240px", display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
        <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(e) => e.target.files?.[0] && (setFile(e.target.files[0]), setZoom(1))} />
        {!file ? (
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <button type="button" className="btn" onClick={() => input.current?.click()}>
              <Icon d={P.plus} size={14} /> {current ? "Change picture" : "Upload a picture"}
            </button>
            {current && (
              <button type="button" className="chip" onClick={() => void reset()}>
                <Icon d={P.x} size={11} /> {id === "you" ? "Use my initial" : "Use the sigil"}
              </button>
            )}
          </div>
        ) : (
          <>
            <Seg label="Look" value={look} width={360} options={LOOKS} onChange={setLook} />
            <label className="row" style={{ gap: 10, fontSize: 12 }}>
              <span className="eyebrow" style={{ fontSize: 10, width: 44 }}>Zoom</span>
              <input type="range" className="scrub" min={1} max={2.5} step={0.05} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} style={{ ["--p" as string]: `${((zoom - 1) / 1.5) * 100}%` }} />
            </label>
            <div className="row" style={{ gap: 8 }}>
              <button type="button" className="btn" onClick={() => (setFile(null), setPreview(""))}>Cancel</button>
              <button type="button" className="btn btn-red" disabled={!preview || saving} onClick={() => void save()}>{saving ? "Saving…" : "Save picture"}</button>
            </div>
          </>
        )}
        <p className="muted" style={{ margin: 0, fontSize: 11 }}>Cropped to a square and kept on this computer. Duotone and Red tint match the app’s black, red and white.</p>
      </div>
    </div>
  );
}
