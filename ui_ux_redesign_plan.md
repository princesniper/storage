# GrowPlants Media — UI/UX Redesign & Frontend Polish Plan

## Executive Summary & Goal

Transform **GROWPLANTS MEDIA** from a standard admin dashboard into a **world-class, high-density media storage control plane** comparable in quality to Linear, Vercel, Raycast, and Cloudflare. 

Telegram acts as the invisible zero-cost storage backend; GrowPlants Media provides the administrative control, asset organization, and stable public delivery layer (`https://m.media-growplants.com/images/000031.png`).

> [!IMPORTANT]
> **Strict Non-Negotiable Contract**: Zero backend changes. Database schema, Telegram MTProto logic, authentication cookies/JWT, caching tiers, atomic sequential numbers (`MediaSequence`), and the canonical public media origin (`https://m.media-growplants.com`) will remain untouched. The entire redesign is purely visual and frontend architectural polish.

---

## 1. Codebase UI/UX Audit Findings (Phase 1)

Following an exhaustive audit of all routes, components, and services, here is the current state evaluation:

| Area | Current State & Deficiencies | Target State (Redesign) |
| :--- | :--- | :--- |
| **Visual Identity & Theme** | Generic "Storage" wordmark with a hard-drive icon. OKLCH default dark mode with harsh contrast and basic borders. | **GrowPlants Media** brand identity: subtle leaf-glyph + technical wordmark. Near-black charcoal palette (`#09090B`, `#111113`), razor-thin borders (`rgba(255,255,255,0.08)`), disciplined emerald accent (`#22C55E`). |
| **Global Navigation & Layout** | `DashboardShell` with basic collapsing logic (`4.25rem` vs `15rem`). Top bar only has breadcrumb text and theme toggle. | Sleek 240px sidebar with section groups (`OVERVIEW`, `LIBRARY`, `INFRASTRUCTURE`, `SYSTEM`), integrated Telegram live status pill, admin profile widget, and a top bar featuring a **Global Command Palette (`Ctrl + K` / `Cmd + K`)**. |
| **Command Palette** | Missing entirely (though `cmdk` is already installed in `package.json`). | Full Raycast/Linear-style command center supporting fast page navigation, file search by sequence/name, Telegram status checks, and URL copying. |
| **Dashboard (`/dashboard`)** | Generic 4 stat cards + Recharts widgets + plain list of 8 recent files. | **Command Center Hierarchy**: Hero greeting + infrastructure health strip (Telegram, DB, Cache, Public URLs) + high-impact typography metrics + horizontal channel storage allocation bar + visual recent media strip with instant hover actions. |
| **Files Library (`/files`)** | Basic filter bar with native select dropdowns; simple square image grid or list view. Basic alert dialog for deletions. | **Modern Media Library**: High-density responsive grid (2 to 6 columns), refined media cards with sequence pills (`000042`), hover quick-action overlays (Preview, Copy URL, Inspect, Delete), smooth view transitions, and batch operations. |
| **Media Inspection & Lightbox** | `FileDetailModal` has a basic image preview and raw list of fields. | **Cinema Lightbox + Technical Inspector**: Darkroom media viewer (zoom, keyboard arrow navigation between siblings, video scrubber) paired with a slide-over metadata inspector showcasing sequence number, canonical URL with 1-click copy, dimensions, and audit history. |
| **Upload Experience (`/upload`)** | Functional XHR upload with basic dashed box and list of progress bars. | **Tactile Upload Studio**: Responsive drag-and-drop zone with animated green accent ring, visual queue with file thumbnails and live bitrate/percentage indicators, and a celebratory **Media Ready** card showing the prominent public sequential URL. |
| **Storage Channels (`/channels`)** | Card grid with basic switches and buttons. Lacks infrastructure aesthetic. | **Infrastructure Node Console**: Designed like Cloudflare DNS / Vercel projects. Latency badges, connection health indicators, copyable channel IDs, and a multi-step channel registration modal. |
| **Settings (`/settings`)** | Standard stacked cards. Technical IDs and fields feel cluttered. | **Structured Settings Matrix**: Grouped settings rows (Account, Telegram Storage Node, Canonical Public Domain, Cache & Storage Stats, Danger Zone). |
| **Login (`/login`)** | Basic centered white/gray card on dark background. | **Cinematic Portal**: Dark ambient background, clean GrowPlants Media logo, high-contrast inputs with smooth focus rings, and streamlined error alerts. |

---

## 2. Global Design System & Design Tokens (Phase 2)

### 2.1 Color Palette (Dark-First Infrastructure Aesthetic)

```css
/* Core Surfaces */
--bg-canvas: #09090b;       /* Deep near-black background */
--bg-surface: #111113;      /* Elevated cards and panels */
--bg-subtle: #161618;       /* Hover states, inputs, dropdowns */
--bg-overlay: #1c1c1f;      /* Tooltips, floating bars, modals */

/* Borders & Separators */
--border-subtle: rgba(255, 255, 255, 0.07);
--border-active: rgba(255, 255, 255, 0.14);
--border-focus: rgba(34, 197, 94, 0.5);

/* Typography & Content */
--text-primary: #f4f4f5;    /* 95% white for primary headings & values */
--text-secondary: #a1a1aa;  /* Muted metadata and labels */
--text-tertiary: #71717a;   /* Placeholders, disabled text */

/* Brand & Accents (GrowPlants Signature) */
--accent-green: #22c55e;    /* Emerald-500: Primary actions, online status */
--accent-green-subtle: rgba(34, 197, 94, 0.12);
--accent-green-border: rgba(34, 197, 94, 0.25);

/* Semantic States */
--status-success: #22c55e;
--status-warning: #f59e0b;
--status-error: #ef4444;
--status-info: #3b82f6;
```

### 2.2 Typography Hierarchy (Geist Sans & Mono)
- **Brand Title**: 15px / Semi-bold (Tracking -0.01em)
- **Page Hero Heading**: 28–32px / Semi-bold (Tracking -0.025em)
- **Section Heading**: 16–18px / Medium (Tracking -0.015em)
- **Card Titles & Metric Labels**: 12–13px / Medium uppercase (Tracking +0.04em, muted)
- **Statistic Numbers**: 28–36px / Semi-bold tabular-nums (Tracking -0.03em)
- **Body & Controls**: 14px / Regular & Medium
- **Technical Metadata & Public URLs**: 12–13px Geist Mono (`font-mono`)

### 2.3 Motion & Interaction System
- **Fast / Micro (120–160ms)**: Button hover, checkbox toggle, icon morphing (`ease-out`).
- **Normal (180–240ms)**: Card elevation, dropdown menu reveal, active tab line transition (`cubic-bezier(0.16, 1, 0.3, 1)`).
- **Surface / Modal (250–320ms)**: Lightbox backdrop fade, drawer slide, command palette open.
- **Microinteractions**:
  - `CopyButton`: Morph clipboard icon into green checkmark with `scale(1.1) -> scale(1.0)` pop.
  - Media Card: `scale(1.025)` on image with smooth GPU transform, overlay fades in at `opacity: 1`.
  - Dropzone: Radial green glow activates on dragover with `border-color: var(--accent-green)`.
  - `prefers-reduced-motion`: Full fallback disabling non-essential transitions.

---

## 3. Information Architecture & Navigation

```mermaid
graph TD
    App[GrowPlants Media App] --> Login[/login]
    App --> Layout[DashboardShell Layout]
    
    Layout --> Topbar[Minimal Topbar with Cmd+K & Profile]
    Layout --> Sidebar[240px Navigation Sidebar]
    Layout --> CommandPalette[Global Command Palette - cmdk]
    
    Sidebar --> NavDash[Overview / Dashboard]
    Sidebar --> NavFiles[Library / Files]
    Sidebar --> NavUpload[Upload Media]
    Sidebar --> NavChannels[Infrastructure / Channels]
    Sidebar --> NavSettings[Settings & Telegram]
    Sidebar --> NavAudit[System / Audit Log]
    
    NavFiles --> MediaGrid[Responsive Grid / List]
    NavFiles --> Lightbox[Cinema Lightbox & Inspector]
    
    NavUpload --> Dropzone[Upload Studio & Queue]
    NavUpload --> SuccessCard[Permanent Media Ready Card]
    
    NavChannels --> ChannelNodes[Storage Channel Cards]
    NavChannels --> AddWizard[Channel Connect Wizard]
```

### 3.1 Sidebar Redesign
- **Header**: GrowPlants Media leaf icon in subtle emerald pill + `GROWPLANTS MEDIA` wordmark + `MEDIA STORAGE` subtitle badge.
- **Section 1 (OVERVIEW)**: Dashboard
- **Section 2 (LIBRARY)**: Files (with total file badge), Upload (quick upload CTA)
- **Section 3 (INFRASTRUCTURE)**: Storage Channels (with active channel count)
- **Section 4 (MANAGEMENT)**: Audit Log, Settings
- **Footer**:
  - Live Telegram connection status indicator pill (`● Connected` / `● Disconnected`).
  - Admin identity card with avatar initials, email, and quick logout/theme actions.

### 3.2 Global Command Palette (`Ctrl + K` / `Cmd + K`)
Using the installed `cmdk` package:
- Quick navigation to any page (`Dashboard`, `Files`, `Upload`, `Channels`, `Settings`, `Audit`).
- Instant file jump: type sequence number (e.g. `000042` or `42`) or filename to navigate directly to it.
- Infrastructure actions: "Test Telegram Connection", "Upload New Media", "Copy Media Origin".

---

## 4. Page-by-Page Redesign Specifications

### 4.1 Login Page (`/login`)
- Full-screen dark canvas with a subtle emerald radial backlight (opacity 0.03).
- Centered, sharply bordered container (`#111113`, `border: rgba(255,255,255,0.08)`).
- Wordmark with leaf mark, clean single-line inputs with smooth focus rings, eye toggle for password, clear inline error alerts, and animated loading state.

### 4.2 Dashboard (`/dashboard`)
1. **Hero Header**: Greeting (`Good evening, Prince`) + Subtitle (`Your media infrastructure is healthy and operational`).
2. **System Health Strip**:
   - `Telegram`: Connected / Disconnected (with live pulse dot).
   - `Database`: Healthy (SQLite/Prisma).
   - `Cache`: Operational (Redis/LRU key count).
   - `Public Delivery`: Operational (`https://m.media-growplants.com`).
3. **Primary Metrics**:
   - Total Media Files (large 32px number, formatted bytes subtext).
   - Storage Consumed (MB/GB calculation).
   - Active Telegram Channels.
   - Uploads in Last 30 Days.
4. **Storage Allocation Visualization**:
   - Sleek horizontal segmented bar showing file capacity per storage channel.
   - Subtle Recharts breakdown (MIME distribution donut, 30-day activity curve) styled with dark theme tooltips.
5. **Recent Uploads Strip**:
   - Grid of recent uploads with sequence numbers (`000124`), thumbnails, format badges, and instant hover copy URL action.
6. **Live Activity Feed**: Compact audit stream with micro-icons for upload, delete, and channel test operations.

### 4.3 Media Library (`/files`)
1. **Header & Controls**:
   - Title: `Media Library` with count badge (`142 files`).
   - Action bar: Upload button, Grid/List toggle, Select All toggle.
2. **Filter & Search Bar**:
   - Instant search input (by filename, sequence number, or legacy public ID).
   - Filter pills: All, Images, Videos, GIFs.
   - Storage Channel dropdown.
   - Status dropdown (Active, Deleted, All).
   - Sort dropdown (Newest, Oldest, Largest, Smallest, Name).
3. **Responsive Media Grid**:
   - Fluid grid: 6 cols (>=1440px), 5 cols (1200-1439px), 4 cols (900-1199px), 3 cols (640-899px), 2 cols (<640px).
   - **Media Card**:
     - Aspect-square media canvas with subtle zoom on hover (`scale(1.025)`).
     - Sequence pill badge in top-right (`000042`) with monospace font.
     - Video indicator with duration/play icon.
     - Bottom metadata: Original filename (truncated), file size, channel name.
     - Hover overlay: Quick Copy URL button, Open Preview button, Delete button.
4. **Floating Batch Action Bar**:
   - Appears when >=1 files selected.
   - Shows selected count, Delete Selected action (with modal confirmation), and Clear button.
5. **Cinema Lightbox & Inspector**:
   - Large centered media with dark backdrop (`rgba(0,0,0,0.85)`).
   - Arrow keys (`←` / `→`) to step through files in the current view.
   - Right slide-over inspector displaying:
     - Sequence Number (`000042`)
     - Canonical Public URL: `https://m.media-growplants.com/images/000042.jpg` + large Copy URL button with instant feedback.
     - Channel name, dimensions, file size, MIME type, upload timestamp.
     - Action buttons: Open in new tab, Delete file.

### 4.4 Upload Studio (`/upload`)
1. **Hero**: `Upload Media` + `Add assets to your media infrastructure`.
2. **Storage Channel Selector**: Prominent destination selector with active channel badges.
3. **Interactive Dropzone**:
   - Drag & drop zone supporting JPG, PNG, WEBP, GIF, MP4, WEBM, MOV (with backend size caps).
   - Animated drag-over state with green border accent and scale microinteraction.
4. **Upload Queue**:
   - Interactive list of pending/uploading files.
   - Thumbnail preview, file name, size, progress bar with percentage and speed.
   - Rate limit retry indicator (flood wait countdown) if 429 occurs.
5. **Upload Success Card**:
   - High-contrast celebratory card upon completion.
   - **Prominently displays the canonical URL**: `https://m.media-growplants.com/images/000031.png`.
   - Large "Copy URL" button, "Open in New Tab", and "Upload Another" buttons.

### 4.5 Storage Channels (`/channels`)
1. **Header**: `Storage Channels` + `Telegram channels used as storage nodes`.
2. **Infrastructure Cards**:
   - Card styled like a cloud infrastructure node.
   - Channel Name, Purpose, Telegram Channel ID (monospace).
   - Stored file count.
   - Test Connection button with live latency benchmark (`OK · 184ms`).
   - Active/Inactive toggle switch.
   - Edit and Delete dialogs.
3. **Add Channel Modal**:
   - Clear multi-step wizard: Channel ID -> Display Name -> Purpose -> Test -> Confirm.

### 4.6 Settings (`/settings`)
1. **Account Section**: Admin email, password change notice.
2. **Telegram Storage Backend Section**:
   - Connection status card (`Connected` with masked phone number `+*****7890`).
   - If disconnected: 3-step auth wizard (Phone number -> OTP code -> 2FA Cloud Password).
   - Disconnect dialog with confirmation.
3. **Public Media Domain Section**:
   - Displays canonical URL origin: `https://m.media-growplants.com` (fixed, active).
   - Notes explaining the canonical sequential scheme (`/images/000001.jpg`).
4. **Cache & Delivery Section**:
   - Redis/In-memory cache status and key count.

### 4.7 Audit Log (`/audit`)
- High-density data table with filter by operation (`UPLOAD`, `DELETE`, `CHANNEL_*`, `TELEGRAM_*`).
- Status badges (Green for `SUCCESS`, Red for `FAILED`).
- CSV export button, timestamp formatting, and linked file details.

---

## 5. Component Architecture & File Plan

```
src/
├── components/
│   ├── dashboard/
│   │   ├── shell.tsx              [MODIFY: Refined sidebar, topbar, Cmd+K trigger, Telegram pill]
│   │   ├── command-palette.tsx    [NEW: cmdk-powered global search & navigation]
│   │   ├── health-strip.tsx       [NEW: Telegram, DB, Cache, CDN status pill row]
│   │   ├── storage-overview.tsx   [NEW: Horizontal storage capacity & channel bar]
│   │   ├── stat-card.tsx          [MODIFY: Modern typography & metric cards]
│   │   └── analytics-widgets.tsx  [MODIFY: Dark-themed Recharts charts & top files]
│   ├── media/
│   │   ├── media-card.tsx         [NEW: Reusable media card with hover overlay & sequence pill]
│   │   ├── media-grid.tsx         [NEW: Responsive 2-6 column fluid grid]
│   │   ├── media-lightbox.tsx     [NEW: Darkroom lightbox with zoom & sibling keyboard nav]
│   │   └── media-inspector.tsx    [NEW: Slide-over technical detail inspector]
│   ├── files/
│   │   ├── files-client.tsx       [MODIFY: Integrate new media grid, lightbox, and sleek filters]
│   │   └── file-detail-modal.tsx  [MODIFY: Polish to match new inspector specs]
│   ├── upload/
│   │   └── upload-client.tsx      [MODIFY: Modern tactile dropzone, queue, and ready-card]
│   ├── channels/
│   │   └── channels-client.tsx    [MODIFY: Infrastructure node cards & connect wizard]
│   ├── settings/
│   │   └── settings-client.tsx    [MODIFY: Clean grouped settings matrix]
│   ├── audit/
│   │   └── audit-client.tsx       [MODIFY: High-density table & filter polish]
│   └── ui/
│       ├── copy-button.tsx        [MODIFY: Micro-interaction checkmark morph]
│       ├── status-badge.tsx       [MODIFY: Refined dot badges with semantic colors]
│       └── empty-state.tsx        [MODIFY: Clean minimal empty states]
```

---

## 6. Verification & Quality Assurance Plan

### 6.1 Automated & Compilation Verification
- `bun run lint` (or `npx next lint`): Ensure 0 ESLint errors.
- TypeScript compiler (`tsc --noEmit`): Ensure 0 typing errors across all pages and components.
- `next build`: Ensure the production build completes and output remains standalone.

### 6.2 Manual & Visual Verification Matrix
1. **Authentication Flow**: Login via `/login` -> session created -> redirects to `/dashboard`.
2. **Dashboard**: Verify real metrics load (no hardcoded fake values), Telegram status displays accurately, charts render with proper dark tooltips.
3. **Command Palette**: Press `Ctrl+K` (or `Cmd+K` on Mac), verify palette opens, test jumping between pages and searching files.
4. **Media Library (`/files`)**:
   - Test Grid View and List View toggle.
   - Verify sequence numbers (`000001`, `000042`) display on every card.
   - Test search, MIME filter, channel filter, and sorting.
   - Click a card: verify Lightbox opens with keyboard arrow navigation (`←`/`→`) and zoom.
   - Click "Copy URL": verify clipboard receives `https://m.media-growplants.com/images/...` and button displays `✓ Copied`.
   - Test single delete and bulk delete with modal confirmation.
5. **Upload Flow (`/upload`)**:
   - Test drag-and-drop.
   - Verify upload progress bar and cancellation.
   - Verify the success card shows the permanent canonical URL.
6. **Channels (`/channels`)**:
   - Test channel latency test button (`/test`).
   - Test active/inactive switch toggle.
7. **Responsive Breakpoints**:
   - Inspect at 1440px (6 cols), 1280px (5 cols), 1024px (4 cols), 768px (3 cols tablet with drawer), 390px (2 cols mobile).
   - Ensure touch targets are >= 44px on mobile and drawer slides smoothly.

---

## 7. Next Steps & Approval Request

This plan satisfies all non-negotiable requirements:
1. No backend or database schema modifications.
2. Canonical URL structure and Telegram MTProto logic preserved intact.
3. Completely replaces outdated admin templates with a cohesive, world-class design system.

**Awaiting your approval to proceed to Phase 3 (Implementation).**
