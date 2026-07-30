'use client';

/**
 * SignaturePad — HTML5 canvas e-signature capture.
 *
 * Shared between the in-person mobile intake wizard and the remote AOB
 * signing page, so both execution paths capture a signature identically.
 */
import { useRef } from 'react';

export interface SignaturePadProps {
  onChange: (dataUrl: string | null) => void;
}

export function SignaturePad({ onChange }: SignaturePadProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const dirty = useRef(false);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = ref.current;
    if (!c) return { x: 0, y: 0 };
    const r = c.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) * (c.width / r.width),
      y: (e.clientY - r.top) * (c.height / r.height),
    };
  };

  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = ref.current;
    if (!c) return;
    c.setPointerCapture(e.pointerId);
    drawing.current = true;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const { x, y } = point(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const c = ref.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    const { x, y } = point(e);
    ctx.lineTo(x, y);
    ctx.strokeStyle = '#e4e4e7';
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
    dirty.current = true;
  };

  const end = () => {
    if (!drawing.current) return;
    drawing.current = false;
    if (dirty.current && ref.current) onChange(ref.current.toDataURL('image/png'));
  };

  const clear = () => {
    const c = ref.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    dirty.current = false;
    onChange(null);
  };

  return (
    <div className="space-y-1.5">
      <canvas
        ref={ref}
        width={560}
        height={180}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
        className="h-40 w-full touch-none rounded-md border border-zinc-600 bg-zinc-950"
      />
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-zinc-500">Sign above with finger or stylus</span>
        <button
          type="button"
          onClick={clear}
          className="rounded border border-zinc-700 px-2 py-0.5 text-[11px] text-zinc-300 hover:bg-zinc-800"
        >
          Clear
        </button>
      </div>
    </div>
  );
}
