"use client";

import { useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { Moon, Sun } from "lucide-react";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);

  const isDark = mounted && resolvedTheme === "dark";

  return (
    <Button
      size="icon"
      variant="ghost"
      className="h-9 px-3 gap-2 border border-border hover:bg-accent"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      aria-label={
        mounted
          ? isDark
            ? "Switch to light mode"
            : "Switch to dark mode"
          : "Change theme"
      }
      title={
        mounted
          ? isDark
            ? "Switch to light mode"
            : "Switch to dark mode"
          : "Change theme"
      }
    >
      <span className="relative inline-flex">
        <Sun
          className={"size-4 transition-all duration-200 " + (
            mounted && isDark
              ? "scale-100 opacity-100 rotate-0"
              : "scale-50 opacity-0 absolute inset-0"
          )}
          aria-hidden
        />
        <Moon
          className={"size-4 transition-all duration-200 " + (
            mounted && !isDark
              ? "scale-100 opacity-100 rotate-0"
              : "scale-50 opacity-0 absolute inset-0"
          )}
          aria-hidden
        />
      </span>
      <span className="hidden sm:inline text-xs font-medium">
        {mounted ? (isDark ? "Light" : "Dark") : "Theme"}
      </span>
    </Button>
  );
}
