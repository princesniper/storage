"use client";

import { useEffect, useState, type ReactNode } from "react";

const cache = new Map<string, string>();

interface VideoThumbnailProps {
  src: string;
  alt: string;
  className?: string;
  fallback: ReactNode;
}

export function VideoThumbnail({ src, alt, className, fallback }: VideoThumbnailProps) {
  const [thumbnail, setThumbnail] = useState<string | null>(() => cache.get(src) ?? null);
  const [mounted, setMounted] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (thumbnail || error || !mounted) return;
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "metadata";
    video.crossOrigin = "anonymous";

    const cleanup = () => {
      video.removeAttribute("src");
      video.load();
      video.remove();
    };
    const fail = () => { setError(true); cleanup(); };
    const capture = () => {
      try {
        const width = video.videoWidth;
        const height = video.videoHeight;
        if (!width || !height) return fail();
        const canvas = document.createElement("canvas");
        const max = 720;
        const scale = Math.min(1, max / Math.max(width, height));
        canvas.width = Math.max(1, Math.round(width * scale));
        canvas.height = Math.max(1, Math.round(height * scale));
        const ctx = canvas.getContext("2d");
        if (!ctx) return fail();
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const data = canvas.toDataURL("image/jpeg", 0.82);
        cache.set(src, data);
        setThumbnail(data);
        cleanup();
      } catch {
        fail();
      }
    };

    video.addEventListener("loadeddata", () => {
      if (video.currentTime === 0) capture();
      else {
        try { video.currentTime = 0; } catch { capture(); }
      }
    }, { once: true });
    video.addEventListener("seeked", capture, { once: true });
    video.addEventListener("error", fail, { once: true });
    video.src = src;
    video.load();
    document.body.appendChild(video);
    video.style.position = "fixed";
    video.style.width = "1px";
    video.style.height = "1px";
    video.style.opacity = "0";
    video.style.pointerEvents = "none";
    video.style.left = "-10000px";
    video.style.top = "-10000px";

    return cleanup;
  }, [src, thumbnail, error, mounted]);

  return <>
    {thumbnail ? <img src={thumbnail} alt={alt} loading="lazy" className={className} /> : fallback}
    {mounted && null}
  </>;
}
