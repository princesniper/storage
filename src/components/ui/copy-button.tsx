"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Copy button with success micro-interaction:
 * Copy icon → brief check animation. Optional external toast via onCopy.
 */
export function CopyButton({
  text,
  label = "Copy",
  size = "sm",
  variant = "ghost",
  className,
  iconOnly = false,
  onCopy,
}: {
  text: string;
  label?: string;
  size?: "sm" | "icon" | "default";
  variant?: "ghost" | "outline" | "secondary";
  className?: string;
  iconOnly?: boolean;
  onCopy?: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const handle = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // clipboard API may be unavailable (non-secure context) — still show feedback
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setCopied(true);
    onCopy?.();
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <Button
      size={size === "icon" ? "icon" : size}
      variant={variant}
      onClick={handle}
      className={cn("transition-colors", copied && "text-status-completed", className)}
      aria-label={copied ? "Copied" : label}
      title={copied ? "Copied" : label}
    >
      <span className="relative inline-flex">
        <Copy
          className={cn("size-3.5 transition-all duration-150", copied && "scale-50 opacity-0")}
          aria-hidden
        />
        <Check
          className={cn(
            "size-3.5 absolute inset-0 transition-all duration-150",
            copied ? "scale-100 opacity-100 animate-success-pop" : "scale-50 opacity-0"
          )}
          aria-hidden
        />
      </span>
      {!iconOnly && <span className="ml-1">{copied ? "Copied" : label}</span>}
    </Button>
  );
}
