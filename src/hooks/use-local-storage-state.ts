"use client";
import { useCallback } from "react";
import { useSyncExternalStore } from "react";

/**
 * localStorage-backed state that is hydration-safe.
 *
 * The naive pattern — useState(() => localStorage.getItem(...)) — renders
 * different HTML on the server (default) vs the client (stored value),
 * causing React hydration mismatches. useSyncExternalStore instead renders
 * the server snapshot during hydration (matching SSR output exactly), then
 * adopts the stored value immediately after, with no error.
 */

function subscribe(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  window.addEventListener("local-storage-change", onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener("local-storage-change", onChange);
  };
}

export function useLocalStorageState(key: string, fallback: string): [string, (v: string) => void] {
  const getSnapshot = useCallback((): string => {
    try {
      return window.localStorage.getItem(key) ?? fallback;
    } catch {
      return fallback;
    }
  }, [key, fallback]);

  const getServerSnapshot = useCallback((): string => fallback, [fallback]);

  const value = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setValue = useCallback(
    (v: string) => {
      try {
        window.localStorage.setItem(key, v);
      } catch {
        /* storage unavailable (private mode, etc.) — state still updates */
      }
      window.dispatchEvent(new Event("local-storage-change"));
    },
    [key]
  );

  return [value, setValue];
}
