"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { useState, useEffect, useCallback } from "react";
import {
  LayoutDashboard,
  Image as ImageIcon,
  Upload,
  FolderTree,
  ScrollText,
  Settings,
  LogOut,
  Leaf,
  PanelLeftClose,
  PanelLeftOpen,
  Menu,
  Search,
  Wifi,
  WifiOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useLocalStorageState } from "@/hooks/use-local-storage-state";
import { cn } from "@/lib/utils";
import { CommandPalette } from "@/components/dashboard/command-palette";
import { ThemeToggle } from "@/components/layout/theme-toggle";

const NAV_GROUPS = [
  {
    group: "OVERVIEW",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    ],
  },
  {
    group: "LIBRARY",
    items: [
      { href: "/files", label: "Files", icon: ImageIcon },
      { href: "/folders", label: "Folders", icon: FolderTree },
      { href: "/upload", label: "Upload", icon: Upload },
    ],
  },
  {
    group: "INFRASTRUCTURE",
    items: [
      { href: "/channels", label: "Storage Channels", icon: FolderTree },
    ],
  },
  {
    group: "MANAGEMENT",
    items: [
      { href: "/audit", label: "Audit Log", icon: ScrollText },
      { href: "/settings", label: "Settings", icon: Settings },
    ],
  },
];

const NAV_FLAT = NAV_GROUPS.flatMap((g) => g.items);

function isActive(pathname: string | null, href: string) {
  return pathname === href || pathname?.startsWith(href + "/");
}

function useStorageStatus() {
  const [status, setStatus] = useState<string>("unknown");

  useEffect(() => {
    let active = true;
    const check = async () => {
      try {
        const r = await fetch("/api/telegram/status", { cache: "no-store" });
        if (!r.ok) { if (active) setStatus("disconnected"); return; }
        const j = await r.json();
        if (active) setStatus(j.status ?? "unknown");
      } catch {
        if (active) setStatus("disconnected");
      }
    };
    check();
    const interval = setInterval(check, 30_000);
    return () => { active = false; clearInterval(interval); };
  }, []);

  return status;
}

export function DashboardShell({ children, sidebarExtra }: { children: React.ReactNode; sidebarExtra?: React.ReactNode }) {
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);
  const { data: session } = useSession();
  const [collapsedRaw, setCollapsedRaw] = useLocalStorageState("sidebar-collapsed", "0");
  const collapsed = collapsedRaw === "1";
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const storageStatus = useStorageStatus();

  const toggleCollapsed = () => setCollapsedRaw(collapsed ? "0" : "1");
  const adminEmail = (session?.user as { email?: string } | undefined)?.email ?? "";
  const adminInitial = adminEmail ? adminEmail[0].toUpperCase() : "A";
  const handleSignOut = () => signOut({ callbackUrl: "https://growplants-media.up.railway.app/login" });

  // Cmd+K / Ctrl+K global shortcut
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "k") {
      e.preventDefault();
      setPaletteOpen((v) => !v);
    }
  }, []);

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  useEffect(() => {
    // Keep the first client render identical to SSR. Path-dependent active
    // navigation styling is applied only after hydration to avoid mismatches
    // when Next.js/router state changes during hydration.
    setMounted(true);
  }, []);

  const storageConnected = storageStatus === "connected";

  return (
    <div className="min-h-screen flex bg-background text-foreground">
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />

      {/* ─── Desktop sidebar ─── */}
      <aside
        className={cn(
          "hidden md:flex flex-col border-r border-border transition-[width] duration-250 ease-out overflow-hidden shrink-0",
          "bg-sidebar",
          collapsed ? "w-[4.25rem]" : "w-60"
        )}
        aria-label="Primary navigation"
      >
        {/* Logo / brand */}
        <div className={cn("flex items-center gap-2.5 px-4 py-4 mb-1", collapsed && "justify-center px-2")}>
          <div className="size-9 rounded-xl bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center shrink-0">
            <Leaf className="size-4 text-emerald-400" aria-hidden />
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <div className="text-[13px] font-semibold tracking-[-0.01em] leading-tight text-foreground">
                GrowPlants<span className="text-emerald-400"> Media</span>
              </div>
              <div className="text-[10px] text-muted-foreground leading-tight tracking-[0.04em] uppercase font-medium mt-0.5">
                Media Storage
              </div>
            </div>
          )}
        </div>

        {/* Nav groups */}
        <nav className="flex flex-col flex-1 px-2 overflow-y-auto" aria-label="Sections">
          {NAV_GROUPS.map((group) => (
            <div key={group.group} className="mb-3">
              {!collapsed && (
                <div className="px-3 py-1.5 text-[10px] font-semibold tracking-[0.06em] text-muted-foreground/60 uppercase select-none">
                  {group.group}
                </div>
              )}
              <div className="flex flex-col gap-0.5">
                {group.items.map((n) => {
                  const active = mounted && isActive(pathname, n.href);
                  const item = (
                    <Link
                      key={n.href}
                      href={n.href}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "relative flex items-center gap-2.5 rounded-lg text-sm font-medium transition-all duration-150",
                        collapsed ? "justify-center px-0 py-2.5" : "px-3 py-2",
                        active
                          ? "bg-emerald-500/10 text-emerald-400"
                          : "text-muted-foreground hover:bg-accent hover:text-foreground active:scale-[0.98]"
                      )}
                    >
                      {active && (
                        <span
                          className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-full bg-emerald-400 transition-all duration-200"
                          aria-hidden
                        />
                      )}
                      <n.icon
                        className={cn("size-4 shrink-0 transition-transform duration-150", active && "scale-110")}
                        aria-hidden
                      />
                      {!collapsed && <span className="truncate">{n.label}</span>}
                    </Link>
                  );
                  if (collapsed) {
                    return (
                      <Tooltip key={n.href}>
                        <TooltipTrigger asChild>{item}</TooltipTrigger>
                        <TooltipContent side="right">{n.label}</TooltipContent>
                      </Tooltip>
                    );
                  }
                  return item;
                })}
              </div>
            </div>
          ))}
        </nav>

        {sidebarExtra && !collapsed && <div className="px-2.5 pb-2">{sidebarExtra}</div>}

        {/* Footer: storage status + admin widget */}
        <div className={cn("border-t border-border p-2.5 space-y-2", collapsed && "flex flex-col items-center")}>
          {/* Storage status pill */}
          {!collapsed ? (
            <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-muted/40 border border-border">
              <span className={cn(
                "size-2 rounded-full shrink-0 transition-colors",
                storageConnected ? "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]" : "bg-red-400"
              )} aria-hidden />
              <span className="text-xs font-medium text-muted-foreground flex-1 truncate">
                Storage
              </span>
              <span className={cn(
                "text-[10px] font-medium tracking-wide",
                storageConnected ? "text-emerald-400" : "text-red-400"
              )}>
                {storageConnected ? "Connected" : storageStatus === "unknown" ? "Checking…" : "Offline"}
              </span>
            </div>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <div className={cn(
                  "size-9 rounded-lg flex items-center justify-center cursor-default border",
                  storageConnected ? "bg-emerald-500/10 border-emerald-500/20" : "bg-red-500/10 border-red-500/20"
                )}>
                  {storageConnected
                    ? <Wifi className="size-3.5 text-emerald-400" aria-hidden />
                    : <WifiOff className="size-3.5 text-red-400" aria-hidden />
                  }
                </div>
              </TooltipTrigger>
              <TooltipContent side="right">
                Storage: {storageConnected ? "Connected" : "Offline"}
              </TooltipContent>
            </Tooltip>
          )}

          {/* Admin identity */}
          {!collapsed && (
            <div className="flex items-center gap-2.5 px-2 py-1.5">
              <div
                className="size-8 rounded-full bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center text-xs font-semibold shrink-0 text-emerald-400"
                aria-hidden
              >
                {adminInitial}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-medium truncate" title={adminEmail}>
                  {adminEmail || "Admin"}
                </div>
                <div className="text-[11px] text-muted-foreground">Administrator</div>
              </div>
            </div>
          )}

          <div className={cn("flex gap-1", collapsed ? "flex-col" : "flex-row")}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-9 text-muted-foreground hover:text-foreground hover:bg-accent"
                  onClick={toggleCollapsed}
                  aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                >
                  {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">{collapsed ? "Expand" : "Collapse"}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-9 text-muted-foreground hover:text-foreground hover:bg-accent"
                  onClick={handleSignOut}
                  aria-label="Sign out"
                >
                  <LogOut className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">Sign out</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </aside>

      {/* ─── Content column ─── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top header */}
        <header className="sticky top-0 z-30 flex items-center justify-between gap-2 px-4 py-2.5 border-b border-border bg-background/85 backdrop-blur-md">
          <div className="flex items-center gap-2 min-w-0">
            <Button
              size="icon"
              variant="ghost"
              className="size-10 md:hidden"
              onClick={() => setDrawerOpen(true)}
              aria-label="Open navigation menu"
              aria-expanded={drawerOpen}
            >
              <Menu className="size-4" aria-hidden />
            </Button>
            <div className="flex items-center gap-2 md:hidden">
              <div className="size-7 rounded-md bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center">
                <Leaf className="size-3.5 text-emerald-400" aria-hidden />
              </div>
              <span className="font-semibold text-sm">GrowPlants</span>
            </div>
            <SectionLabel pathname={pathname} />
          </div>
          <div className="flex items-center gap-2">
            {/* Command palette trigger */}
            <button
              onClick={() => setPaletteOpen(true)}
              className="hidden md:flex items-center gap-2 h-8 px-3 rounded-lg border border-border bg-muted/40 hover:bg-accent hover:border-border transition-all duration-150 text-muted-foreground text-sm"
              aria-label="Open command palette (Ctrl+K)"
            >
              <Search className="size-3.5" aria-hidden />
              <span className="text-xs">Search…</span>
              <kbd className="hidden lg:inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded bg-muted border border-border leading-none">
                ⌘K
              </kbd>
            </button>
            <ThemeToggle />
            <Button
              size="icon"
              variant="ghost"
              onClick={handleSignOut}
              className="size-9 text-muted-foreground hover:text-foreground"
              aria-label="Sign out"
              title="Sign out"
            >
              <LogOut className="size-4" />
            </Button>
          </div>
        </header>

        <main className="flex-1 p-4 md:p-8 w-full">
          <div key={pathname} className="animate-page-enter max-w-7xl mx-auto w-full">
            {children}
          </div>
        </main>
      </div>

      {/* ─── Mobile drawer ─── */}
      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent side="left" className="w-72 p-0 flex flex-col bg-sidebar">
          <SheetHeader className="px-4 py-4 border-b border-border text-left">
            <div className="flex items-center gap-2.5">
              <div className="size-9 rounded-xl bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center">
                <Leaf className="size-4 text-emerald-400" aria-hidden />
              </div>
              <div>
                <SheetTitle className="text-sm">
                  GrowPlants<span className="text-emerald-400"> Media</span>
                </SheetTitle>
                <div className="text-[10px] text-muted-foreground tracking-[0.04em] uppercase font-medium mt-0.5">
                  Media Storage
                </div>
              </div>
            </div>
          </SheetHeader>
          <nav className="flex flex-col flex-1 p-3 overflow-y-auto" aria-label="Sections">
            {NAV_GROUPS.map((group) => (
              <div key={group.group} className="mb-3">
                <div className="px-3 py-1.5 text-[10px] font-semibold tracking-[0.06em] text-muted-foreground/60 uppercase select-none">
                  {group.group}
                </div>
                <div className="flex flex-col gap-0.5">
                  {group.items.map((n) => {
                    const active = isActive(pathname, n.href);
                    return (
                      <Link
                        key={n.href}
                        href={n.href}
                        onClick={() => setDrawerOpen(false)}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors min-h-11",
                          active
                            ? "bg-emerald-500/10 text-emerald-400"
                            : "text-muted-foreground hover:bg-accent hover:text-foreground"
                        )}
                      >
                        <n.icon className="size-4 shrink-0" aria-hidden />
                        {n.label}
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>
          <div className="border-t border-border p-3 space-y-2">
            {/* Storage status */}
            <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-muted/40 border border-border">
              <span className={cn(
                "size-2 rounded-full shrink-0",
                storageConnected ? "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]" : "bg-red-400"
              )} aria-hidden />
              <span className="text-xs text-muted-foreground flex-1">Storage</span>
              <span className={cn("text-[10px] font-medium", storageConnected ? "text-emerald-400" : "text-red-400")}>
                {storageConnected ? "Connected" : "Offline"}
              </span>
            </div>
            {/* Admin */}
            <div className="flex items-center gap-2.5 px-2 py-1.5">
              <div className="size-8 rounded-full bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center text-xs font-semibold text-emerald-400" aria-hidden>
                {adminInitial}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-medium truncate">{adminEmail || "Admin"}</div>
                <div className="text-[11px] text-muted-foreground">Administrator</div>
              </div>
              <Button size="icon" variant="ghost" className="size-9" onClick={handleSignOut} aria-label="Sign out">
                <LogOut className="size-4" />
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function SectionLabel({ pathname }: { pathname: string | null }) {
  const current = NAV_FLAT.find((n) => isActive(pathname, n.href));
  if (!current) return null;
  return (
    <span className="hidden md:inline text-sm text-muted-foreground">
      <span className="text-muted-foreground/60">GrowPlants</span>
      <span className="mx-1.5 text-muted-foreground/40">/</span>
      <span className="text-foreground font-medium">{current.label}</span>
    </span>
  );
}
