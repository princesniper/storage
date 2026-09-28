"use client";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { Moon, Sun } from "lucide-react";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  return (
    <Button
      size="icon"
      variant="ghost"
      className="h-9 px-3 gap-2 border border-border hover:bg-accent"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
    >
      <span className="relative inline-flex">
        <Sun
          className={`size-4 transition-all duration-200 ${isDark ? "scale-100 opacity-100 rotate-0" : "scale-50 opacity-0 rotate-90 absolute inset-0"}`}
          aria-hidden
        />
        <Moon
          className={`size-4 transition-all duration-200 ${isDark ? "scale-50 opacity-0 -rotate-90 absolute inset-0" : "scale-100 opacity-100 rotate-0"}`}
          aria-hidden
        />
      </span>
      <span className="hidden sm:inline text-xs font-medium">{isDark ? "Light" : "Dark"}</span>
    </Button>
  );
}
