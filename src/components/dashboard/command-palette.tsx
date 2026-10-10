"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  LayoutDashboard,
  Image as ImageIcon,
  Upload,
  FolderTree,
  ScrollText,
  Settings,
  Copy,
  Leaf,
  Zap,
  ExternalLink,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const MEDIA_ORIGIN = "https://m.media-growplants.com";

const PAGES = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, desc: "Overview & health" },
  { href: "/files", label: "Files", icon: ImageIcon, desc: "Browse media library" },
  { href: "/upload", label: "Upload Media", icon: Upload, desc: "Add assets to infrastructure" },
  { href: "/channels", label: "Storage Channels", icon: FolderTree, desc: "Telegram storage nodes" },
  { href: "/audit", label: "Audit Log", icon: ScrollText, desc: "Operation history" },
  { href: "/settings", label: "Settings", icon: Settings, desc: "Account & Telegram config" },
];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CommandPalette({ open, onOpenChange }: Props) {
  const router = useRouter();
  const { toast } = useToast();
  const [input, setInput] = useState("");
  const handleOpenChange = useCallback(
    (newOpen: boolean) => {
      if (!newOpen) setInput("");
      onOpenChange(newOpen);
    },
    [onOpenChange]
  );

  const close = useCallback(() => {
    setInput("");
    onOpenChange(false);
  }, [onOpenChange]);

  const navigate = useCallback(
    (href: string) => {
      close();
      router.push(href);
    },
    [close, router]
  );

  const copyOrigin = async () => {
    try {
      await navigator.clipboard.writeText(MEDIA_ORIGIN);
      toast({ title: "Copied", description: `${MEDIA_ORIGIN} copied to clipboard.` });
    } catch {
      toast({ title: "Couldn't copy", description: "Select and copy the URL manually.", variant: "destructive" });
    }
    close();
  };

  const testTelegram = async () => {
    close();
    router.push("/settings");
    toast({ title: "Redirected to Settings", description: "Check Telegram connection status there." });
  };

  // Detect if user is typing a sequence number (numeric, possibly padded)
  const trimmed = input.trim();
  const sequenceNum = /^\d+$/.test(trimmed) ? trimmed.padStart(6, "0") : null;

  return (
    <CommandDialog open={open} onOpenChange={handleOpenChange}>
      <Command
        className="rounded-xl border border-border bg-popover shadow-[var(--clay-shadow-floating)]"
        shouldFilter={!sequenceNum}
      >
        <CommandInput
          placeholder="Search pages, files, actions…"
          value={input}
          onValueChange={setInput}
          className="border-b border-border h-12 text-sm"
        />
        <CommandList className="max-h-[400px]">
          <CommandEmpty>
            <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
              <Leaf className="size-6 text-primary/40" />
              <span className="text-sm">No results found</span>
            </div>
          </CommandEmpty>

          {/* Navigation */}
          <CommandGroup heading="Navigation">
            {PAGES.map((p) => (
              <CommandItem
                key={p.href}
                value={`${p.label} ${p.desc}`}
                onSelect={() => navigate(p.href)}
                className="flex items-center gap-3 px-4 py-2.5 cursor-pointer aria-selected:bg-accent rounded-lg mx-1"
              >
                <span className="size-7 rounded-md bg-muted border border-border flex items-center justify-center shrink-0">
                  <p.icon className="size-3.5 text-muted-foreground" aria-hidden />
                </span>
                <span className="flex flex-col min-w-0">
                  <span className="text-sm font-medium text-foreground">{p.label}</span>
                  <span className="text-xs text-muted-foreground truncate">{p.desc}</span>
                </span>
              </CommandItem>
            ))}
          </CommandGroup>

          <CommandSeparator className="my-1 bg-border" />

          {/* Sequence number jump */}
          {sequenceNum && (
            <CommandGroup heading="Jump to Sequence">
              <CommandItem
                value={`seq-${sequenceNum}`}
                onSelect={() => navigate(`/files?search=${sequenceNum}`)}
                className="flex items-center gap-3 px-4 py-2.5 cursor-pointer aria-selected:bg-accent rounded-lg mx-1"
              >
                <span className="size-7 rounded-md bg-primary/12 border border-primary/25 flex items-center justify-center shrink-0">
                  <ImageIcon className="size-3.5 text-primary" aria-hidden />
                </span>
                <span className="flex flex-col min-w-0">
                  <span className="text-sm font-medium font-mono text-primary">{sequenceNum}</span>
                  <span className="text-xs text-muted-foreground">Search for file with this sequence</span>
                </span>
              </CommandItem>
            </CommandGroup>
          )}

          <CommandGroup heading="Actions">
            <CommandItem
              value="upload new media"
              onSelect={() => navigate("/upload")}
              className="flex items-center gap-3 px-4 py-2.5 cursor-pointer aria-selected:bg-accent rounded-lg mx-1"
            >
              <span className="size-7 rounded-md bg-muted border border-border flex items-center justify-center shrink-0">
                <Upload className="size-3.5 text-muted-foreground" aria-hidden />
              </span>
              <span className="text-sm font-medium text-foreground">Upload New Media</span>
            </CommandItem>
            <CommandItem
              value="copy media origin url"
              onSelect={copyOrigin}
              className="flex items-center gap-3 px-4 py-2.5 cursor-pointer aria-selected:bg-accent rounded-lg mx-1"
            >
              <span className="size-7 rounded-md bg-muted border border-border flex items-center justify-center shrink-0">
                <Copy className="size-3.5 text-muted-foreground" aria-hidden />
              </span>
              <span className="flex flex-col min-w-0">
                <span className="text-sm font-medium text-foreground">Copy Media Origin</span>
                <span className="text-xs text-muted-foreground font-mono">{MEDIA_ORIGIN}</span>
              </span>
            </CommandItem>
            <CommandItem
              value="test telegram connection"
              onSelect={testTelegram}
              className="flex items-center gap-3 px-4 py-2.5 cursor-pointer aria-selected:bg-accent rounded-lg mx-1"
            >
              <span className="size-7 rounded-md bg-muted border border-border flex items-center justify-center shrink-0">
                <Zap className="size-3.5 text-muted-foreground" aria-hidden />
              </span>
              <span className="text-sm font-medium text-foreground">Test Telegram Connection</span>
            </CommandItem>
            <CommandItem
              value="open media delivery url"
              onSelect={() => { window.open(MEDIA_ORIGIN, "_blank", "noreferrer"); close(); }}
              className="flex items-center gap-3 px-4 py-2.5 cursor-pointer aria-selected:bg-accent rounded-lg mx-1"
            >
              <span className="size-7 rounded-md bg-muted border border-border flex items-center justify-center shrink-0">
                <ExternalLink className="size-3.5 text-muted-foreground" aria-hidden />
              </span>
              <span className="text-sm font-medium text-foreground">Open Media Delivery CDN</span>
            </CommandItem>
          </CommandGroup>
        </CommandList>

        <div className="px-4 py-2 border-t border-border flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Leaf className="size-3 text-primary/60" />
            <span className="text-[11px] text-muted-foreground/50 font-medium">GrowPlants Media</span>
          </div>
          <div className="flex items-center gap-3 text-[10px] text-muted-foreground/50">
            <span className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 rounded bg-muted border border-border font-mono">↑↓</kbd>
              navigate
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 rounded bg-muted border border-border font-mono">↵</kbd>
              select
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 rounded bg-muted border border-border font-mono">esc</kbd>
              close
            </span>
          </div>
        </div>
      </Command>
    </CommandDialog>
  );
}
