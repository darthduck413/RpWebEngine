import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { XMarkIcon } from './icons/XMarkIcon';

// Janitor-AI-style floating image windows: draggable by any part of the image,
// freely resizable (aspect-locked to the image), can be dragged mostly off-screen
// (a sliver is always kept grabbable), and any number can be open at once.
//
// Geometry (x / y / width) is driven imperatively via direct `transform` / `width`
// writes during a gesture instead of React state, so a drag is a single style
// mutation per pointer event with no re-render or layout thrash — smooth at the
// display's refresh rate. State is only touched for lifecycle (open/close) and
// z-order, which are rare.

const KEEP_VISIBLE = 56; // px of the window always kept on-screen
const MIN_WIDTH = 140;

const clampX = (x: number, w: number) =>
  Math.min(Math.max(x, KEEP_VISIBLE - w), window.innerWidth - KEEP_VISIBLE);
const clampY = (y: number, h: number) =>
  Math.min(Math.max(y, KEEP_VISIBLE - h), window.innerHeight - KEEP_VISIBLE);

interface OpenImage { id: string; url: string; z: number }

export interface ImageViewerHandle {
  open: (url: string) => void;
}

interface FloatingImageWindowProps {
  url: string;
  zIndex: number;
  offsetIndex: number;
  onClose: () => void;
  onFocus: () => void;
}

const FloatingImageWindow: React.FC<FloatingImageWindowProps> = ({ url, zIndex, offsetIndex, onClose, onFocus }) => {
  const elRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const aspectRef = useRef(1); // width / height

  // Live geometry — the source of truth during drag/resize. Mutated directly and
  // pushed to the DOM without a React render.
  const base = 40 + (offsetIndex % 6) * 28;
  const geom = useRef({ x: base, y: base, w: 320 });
  const gesture = useRef<
    { mode: 'drag' | 'resize'; sx: number; sy: number; ox: number; oy: number; ow: number } | null
  >(null);
  const [cursorGrabbing, setCursorGrabbing] = useState(false);

  const applyStyle = useCallback(() => {
    const el = elRef.current;
    if (!el) return;
    const { x, y, w } = geom.current;
    el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    el.style.width = `${w}px`;
  }, []);

  // Apply on mount. `transform`/`width` are never part of the JSX style prop, so
  // React's re-renders (e.g. a z-order bump) leave our imperative writes intact.
  useLayoutEffect(() => { applyStyle(); }, [applyStyle]);

  const onPointerMove = useCallback((e: PointerEvent) => {
    const g = gesture.current;
    if (!g) return;
    if (g.mode === 'drag') {
      const w = geom.current.w;
      const h = w / (aspectRef.current || 1);
      geom.current.x = clampX(g.ox + (e.clientX - g.sx), w);
      geom.current.y = clampY(g.oy + (e.clientY - g.sy), h);
    } else {
      const w = Math.max(MIN_WIDTH, Math.min(window.innerWidth * 1.4, g.ow + (e.clientX - g.sx)));
      geom.current.w = w;
      geom.current.x = clampX(geom.current.x, w);
      geom.current.y = clampY(geom.current.y, w / (aspectRef.current || 1));
    }
    applyStyle();
  }, [applyStyle]);

  const endGesture = useCallback(() => {
    gesture.current = null;
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', endGesture);
    window.removeEventListener('pointercancel', endGesture);
    setCursorGrabbing(false);
  }, [onPointerMove]);

  const beginGesture = (mode: 'drag' | 'resize', e: React.PointerEvent) => {
    onFocus();
    gesture.current = {
      mode,
      sx: e.clientX,
      sy: e.clientY,
      ox: geom.current.x,
      oy: geom.current.y,
      ow: geom.current.w,
    };
    // Listeners attached synchronously so the very first move is captured — no
    // dropped frames at the start of a drag.
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', endGesture);
    window.addEventListener('pointercancel', endGesture);
    if (mode === 'drag') setCursorGrabbing(true);
  };

  useEffect(() => endGesture, [endGesture]);

  const handleLoad = () => {
    const img = imgRef.current;
    if (!img) return;
    const aspect = img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 1;
    aspectRef.current = aspect;
    const maxW = Math.min(window.innerWidth * 0.9, 440);
    const maxH = window.innerHeight * 0.82;
    let w = Math.min(maxW, img.naturalWidth || maxW);
    if (w / aspect > maxH) w = maxH * aspect;
    geom.current.w = Math.max(MIN_WIDTH, w);
    geom.current.x = clampX(geom.current.x, geom.current.w);
    geom.current.y = clampY(geom.current.y, geom.current.w / aspect);
    applyStyle();
  };

  return (
    <div
      ref={elRef}
      className="fixed left-0 top-0 rounded-xl overflow-hidden shadow-2xl ring-1 ring-black/50 bg-gray-900 select-none touch-none will-change-transform animate-in fade-in zoom-in-95 duration-150"
      style={{ zIndex, cursor: cursorGrabbing ? 'grabbing' : 'grab' }}
      onPointerDown={(e) => beginGesture('drag', e)}
    >
      <img
        ref={imgRef}
        src={url}
        alt="Story image"
        draggable={false}
        onLoad={handleLoad}
        className="block w-full h-auto pointer-events-none"
      />

      <button
        onPointerDown={(e) => e.stopPropagation()}
        onClick={onClose}
        className="absolute top-2 right-2 p-1 rounded-full bg-black/55 text-gray-200 hover:bg-red-600 hover:text-white backdrop-blur-sm transition-colors"
        title="Close image"
        aria-label="Close image"
      >
        <XMarkIcon className="w-4 h-4" />
      </button>

      <div
        onPointerDown={(e) => { e.stopPropagation(); beginGesture('resize', e); }}
        className="absolute bottom-0 right-0 w-7 h-7 flex items-end justify-end p-1 cursor-nwse-resize text-gray-200/80 hover:text-primary-400"
        title="Drag to resize"
      >
        <span className="absolute bottom-0 right-0 w-6 h-6 bg-black/40 rounded-tl-lg pointer-events-none" />
        <svg viewBox="0 0 16 16" className="relative w-3.5 h-3.5 stroke-current pointer-events-none" fill="none" strokeWidth={1.5} strokeLinecap="round">
          <path d="M14 5 L5 14 M14 10 L10 14" />
        </svg>
      </div>
    </div>
  );
};

const ImageViewer = forwardRef<ImageViewerHandle>((_props, ref) => {
  const [images, setImages] = useState<OpenImage[]>([]);
  const zRef = useRef(1);

  const open = useCallback((url: string) => {
    setImages(prev => {
      const z = ++zRef.current;
      const existing = prev.find(i => i.url === url);
      // Re-opening an image already on screen just lifts it to the front rather
      // than stacking a duplicate.
      if (existing) return prev.map(i => (i.url === url ? { ...i, z } : i));
      const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
      return [...prev, { id, url, z }];
    });
  }, []);

  const close = useCallback((id: string) => {
    setImages(prev => prev.filter(i => i.id !== id));
  }, []);

  const focus = useCallback((id: string) => {
    setImages(prev => prev.map(i => (i.id === id ? { ...i, z: ++zRef.current } : i)));
  }, []);

  useImperativeHandle(ref, () => ({ open }), [open]);

  // Esc closes the front-most (highest z) window.
  useEffect(() => {
    if (images.length === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setImages(prev => {
        if (prev.length === 0) return prev;
        const top = prev.reduce((a, b) => (b.z > a.z ? b : a));
        return prev.filter(i => i.id !== top.id);
      });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [images.length]);

  return (
    <>
      {images.map((img, idx) => (
        <FloatingImageWindow
          key={img.id}
          url={img.url}
          zIndex={100 + img.z}
          offsetIndex={idx}
          onClose={() => close(img.id)}
          onFocus={() => focus(img.id)}
        />
      ))}
    </>
  );
});

ImageViewer.displayName = 'ImageViewer';

export default ImageViewer;
