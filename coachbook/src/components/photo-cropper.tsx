"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

const VIEW = 240; // size of the square crop window on screen (px)
const OUT = 600; // size of the saved photo (px)

/**
 * Lets the coach cut a square profile photo out of a picture (e.g. the round profile
 * picture inside an Instagram screenshot). Drag to move, slider to zoom, arrow keys too.
 * Calls onChange with a JPEG (base64, no prefix) whenever the crop changes.
 */
export type CropBox = { left: number; top: number; width: number; height: number };

/** Zoom and position that make a box (fractions of the picture) fill the crop square. */
export function framingFor(naturalW: number, naturalH: number, box: CropBox) {
  const base = VIEW / Math.min(naturalW, naturalH);
  const side = Math.max(box.width * naturalW, box.height * naturalH) * 1.15; // a little margin
  const zoom = Math.min(6, Math.max(1, Math.min(naturalW, naturalH) / Math.max(side, 1)));
  const scale = base * zoom;
  const cx = (box.left + box.width / 2) * naturalW;
  const cy = (box.top + box.height / 2) * naturalH;
  const x = Math.min(0, Math.max(VIEW - naturalW * scale, VIEW / 2 - cx * scale));
  const y = Math.min(0, Math.max(VIEW - naturalH * scale, VIEW / 2 - cy * scale));
  return { zoom, x, y };
}

export function PhotoCropper({ src, onChange, initialBox }: { src: string; onChange: (jpegBase64: string) => void; initialBox?: CropBox | null }) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const drag = useRef<{ px: number; py: number; x: number; y: number } | null>(null);

  useEffect(() => {
    const el = new Image();
    el.onload = () => {
      if (initialBox) {
        // Start framed on the profile picture Claude found.
        const f = framingFor(el.naturalWidth, el.naturalHeight, initialBox);
        setZoom(f.zoom);
        setPos({ x: f.x, y: f.y });
      } else {
        // Start with the picture centred in the square.
        const b = VIEW / Math.min(el.naturalWidth, el.naturalHeight);
        setPos({ x: (VIEW - el.naturalWidth * b) / 2, y: (VIEW - el.naturalHeight * b) / 2 });
        setZoom(1);
      }
      setImg(el);
    };
    el.src = src;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only reframe when the picture changes
  }, [src]);

  const base = img ? VIEW / Math.min(img.naturalWidth, img.naturalHeight) : 1;
  const scale = base * zoom;
  const w = img ? img.naturalWidth * scale : VIEW;
  const h = img ? img.naturalHeight * scale : VIEW;
  const clamp = (p: { x: number; y: number }) => ({ x: Math.min(0, Math.max(VIEW - w, p.x)), y: Math.min(0, Math.max(VIEW - h, p.y)) });

  // Keep the crop inside the image when zooming.
  const shown = clamp(pos);

  // Export the crop.
  useEffect(() => {
    if (!img) return;
    const canvas = document.createElement("canvas");
    canvas.width = OUT;
    canvas.height = OUT;
    const size = VIEW / scale;
    canvas.getContext("2d")!.drawImage(img, -shown.x / scale, -shown.y / scale, size, size, 0, 0, OUT, OUT);
    onChange(canvas.toDataURL("image/jpeg", 0.88).split(",")[1]);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onChange is a setter from the parent
  }, [img, scale, shown.x, shown.y]);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { px: e.clientX, py: e.clientY, x: shown.x, y: shown.y };
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    setPos(clamp({ x: drag.current.x + e.clientX - drag.current.px, y: drag.current.y + e.clientY - drag.current.py }));
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 30 : 8;
    const moves: Record<string, [number, number]> = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    const m = moves[e.key];
    if (!m) return;
    e.preventDefault();
    setPos(clamp({ x: shown.x + m[0], y: shown.y + m[1] }));
  };

  return (
    <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
      <div
        role="img"
        aria-label="Photo crop area – drag or use arrow keys to move"
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => (drag.current = null)}
        onKeyDown={onKey}
        className="relative shrink-0 cursor-grab touch-none overflow-hidden rounded-2xl border border-sage-line bg-ink/10 active:cursor-grabbing"
        style={{ width: VIEW, height: VIEW }}
      >
        {img && (
          // eslint-disable-next-line @next/next/no-img-element -- local, unsaved picture
          <img src={src} alt="" draggable={false} className="pointer-events-none absolute max-w-none select-none" style={{ left: shown.x, top: shown.y, width: w, height: h }} />
        )}
        <div aria-hidden className="pointer-events-none absolute inset-0 rounded-2xl ring-2 ring-inset ring-white/70" />
      </div>
      <div className="w-full max-w-60 space-y-2">
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Zoom</span>
          <input type="range" min={1} max={6} step={0.05} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} className="w-full accent-ink" aria-label="Zoom" />
        </label>
        <p className="text-xs text-ink-soft">Drag the picture so your face fills the square. Zoom in to use just your profile picture from a screenshot.</p>
      </div>
    </div>
  );
}
