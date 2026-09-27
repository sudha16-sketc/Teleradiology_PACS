# Axis Desktop (Tauri 2, Windows)

Axis Desktop is a native Windows client for the Axis teleradiology PACS. It is a
[Tauri 2](https://tauri.app) application under `apps/desktop` that opens a real
window against a running Axis deployment.

It is a **foundation**, not a parallel product. Everything clinical — workflows,
authorization, study routing, report versioning, audit logging, AI — stays in the
NestJS API. The Rust code covers only what a browser tab cannot do: a window, an
installer, a single-instance lock, and a navigation policy.

---

## Table of Contents

- [Architecture](#architecture)
- [Why the frontend is not bundled](#why-the-frontend-is-not-bundled)
- [How the deployment URL is configured](#how-the-deployment-url-is-configured)
- [Requirements](#requirements)
- [Development](#development)
- [Building the Windows installer](#building-the-windows-installer)
- [What the shell does](#what-the-shell-does)
- [Phase 3 native features](#phase-3-native-features)
- [Automatic updates](#automatic-updates)
- [Security model](#security-model)
- [Testing](#testing)
- [Known limitations](#known-limitations)
- [Troubleshooting](#troubleshooting)

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                  Axis Desktop (axis-desktop.exe)            │
│                                                              │
│  Rust / Tauri 2                                             │
│   ├── single-instance lock          (focus, never 2 windows)│
│   ├── deployment URL resolution     (env > file > build)    │
│   ├── navigation allow-list         (deployment origin only)│
│   ├── external-link handoff         (→ system browser)      │
│   └── WebView2 window               (1440×900, min 1024×700)│
│                                                              │
│  Bundled splash/index.html  ← shown only when unconfigured   │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  WebView2 loads https://pacs.example.org  (same origin) │  │
│  │    └── Next.js app: worklist, reading room, reports …  │  │
│  │         │  /api/*  same-origin, httpOnly cookie        │  │
│  │         ▼                                              │  │
│  │  session cookie: axis_session (httpOnly, SameSite=Lax) │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────┬───────────────────────────────┘
                               │  REST (JSON), same-origin
┌──────────────────────────────▼───────────────────────────────┐
│                        NestJS API                             │
│  The single source of truth. Unmodified by the desktop work. │
└──────────────────────────────────────────────────────────────┘
```

The web client and the desktop client are **the same frontend**, loaded from the
same deployment. `apps/web/src/lib/platform.ts` is the only place that knows
which one is running.

---

## Why the frontend is not bundled

Tauri normally compiles the web frontend into the executable. **This project
deliberately does not**, and the window loads a remote deployment instead. Two
independent reasons:

### 1. A bundled UI would break login (decisive)

Session state is an httpOnly cookie, `axis_session`, issued by the API with
`sameSite: 'lax'`. The API carries no CSRF token.

Content bundled into a Tauri executable is served from the app's custom
protocol — `http://tauri.localhost` on Windows. That origin is **cross-site**
with any real API host, and browsers refuse to attach a `SameSite=Lax` cookie to
a cross-site request. Every authenticated call would 401, and the login POST
would appear to succeed while silently establishing no session.

The only ways to make a bundled build work are:

- reissue the cookie as `SameSite=None; Secure`, which is a backend change that
  also weakens the browser client, or
- enable a CORS + CSRF surface, which is a larger backend change.

Both degrade the existing deployment to accommodate a packaging preference. Not
done.

### 2. Static export is not currently possible

`next build` emits three dynamic routes that are server-rendered on demand and
have no `generateStaticParams`:

| Route                                    | Rendered |
| ---------------------------------------- | -------- |
| `/(dashboard)/hospitals/reports/[studyUid]` | dynamic  |
| `/(dashboard)/reading/[studyUid]`          | dynamic  |
| `/(dashboard)/reports/[studyUid]`          | dynamic  |

A Tauri `frontendDist` must be a static directory. Making these exportable means
adding `generateStaticParams` to all three — pre-rendering every study at build
time, which is neither feasible nor desirable for a live PACS.

### What this buys

One installer is correct for every site. When the UI ships an update, every
installed client picks it up on next launch — no reinstall, no version pinning,
no per-site build. Clinical viewers are normally deployed this way regardless.

### If you need a bundled build anyway

A frontend-plus-API single-origin deployment is the requirement to satisfy
first, because a static export still cannot talk to a cross-origin API under
`SameSite=Lax`. You would need all of:

1. `generateStaticParams` on the three dynamic routes above.
2. An API reachable on the same origin as the exported files.
3. Websocket and long-polling support — clinical UI expects live worklist
   updates, and those break under a static file host.

Treat that as a separate project, not a packaging tweak.

---

## How the deployment URL is configured

First valid source wins:

| # | Source                                                | Scope                       |
| - | ----------------------------------------------------- | --------------------------- |
| 1 | `AXIS_DESKTOP_SERVER_URL` env var                     | read at launch              |
| 2 | `desktop.json` in the per-user app config directory   | per-machine, IT-manageable  |
| 3 | `AXIS_DESKTOP_SERVER_URL` at compile time            | baked into the binary      |
| 4 | `http://localhost:3000`                               | **debug builds only**       |

A **release** build with none of these set does not guess. It stays on a bundled
splash that explains how to configure itself.

### Accepted value

An origin, optionally with a port:

```text
https://pacs.example.org
https://pacs.example.org:8443
http://localhost:3000 (loopback only; for development)
```

Rejected, with the reason reported on stderr and on the splash screen:

| Rejected                        | Why                                              |
| ------------------------------- | ------------------------------------------------ |
| `ftp://…`, `tauri://…`          | Only `http`/`https` may carry the PACS            |
| `http://10.0.0.5:3000`          | Non-loopback deployments must use HTTPS          |
| `https://host/app`              | A path prefix would silently break every route    |
| `https://host/?x=1`             | Query/fragment is meaningless as a base           |
| `https://user:pass@host`        | Embedded credentials leak into logs and the shell |
| `""`, `   `                    | Empty                                             |
| `example.org` (no scheme)       | Ambiguous                                         |

### Option 1 — environment variable

Best for testing a build before it is packaged.

```powershell
$env:AXIS_DESKTOP_SERVER_URL = "https://staging-pacs.example.org"
& "C:\Program Files\Axis\Axis.exe"
```

### Option 2 — `desktop.json` (recommended for fleets)

Per-user, no reinstall, no rebuild, revertible. This is the one IT should use.

Path on Windows:

```text
%APPDATA%\com.axis.teleradiology.pacs\desktop.json
```

Contents:

```json
{
  "serverUrl": "https://pacs.example.org"
}
```

Missing file is not an error. Malformed JSON or an invalid `serverUrl` is
reported and ignored, falling through to the next source.

### Option 3 — compile time

```powershell
$env:AXIS_DESKTOP_SERVER_URL = "https://pacs.example.org"
pnpm desktop:build:win
```

Suitable for a site-specific build. Baked into the binary, so it cannot be
changed without a rebuild — prefer option 2 when you can.

---

## Requirements

### Building

| Tool             | Version                                                    |
| ---------------- | ---------------------------------------------------------- |
| Node.js          | >= 20 (repo-wide)                                          |
| pnpm             | >= 9 (repo-wide)                                           |
| Rust             | stable, >= 1.77.2                                          |
| Windows SDK      | WebView2 + MSVC build tools                                |

```powershell
# Rust
winget install Rustlang.Rustup
# or: https://rustup.rs/

# Microsoft C++ build tools (MSVC) + Windows SDK
winget install Microsoft.VisualStudio.2022.BuildTools
```

**WebView2 is a runtime requirement, not just a build one.** The installer ships
an offline WebView2 bootstrapper (`webviewInstallMode: offlineInstaller`), so
machines without WebView2 are handled by the installer itself. WebView2 is
present by default on Windows 11 and on supported Windows 10 builds.

### Linux / macOS

The shell is written to compile and the navigation policy is platform-agnostic,
but **only Windows x64 is a supported target**: the bundle is an NSIS installer
and no `.deb`/`.dmg` targets are configured.

---

## Development

```bash
# Install workspace dependencies (includes the Tauri CLI)
pnpm install

# Run the desktop shell. Starts the web dev server automatically.
pnpm desktop:dev
```

`pnpm desktop:dev` runs `tauri dev`, which:

1. starts `pnpm --filter @axis/web dev` (Next.js on `http://localhost:3000`),
2. builds the Rust binary in debug,
3. opens a WebView2 window pointed at that dev server.

Rust changes require a restart; frontend changes hot-reload in the window.

### Regenerating icons

The tracked source of truth is `apps/desktop/src-tauri/icons/source.svg`.

```bash
pnpm desktop:icon
```

This regenerates every platform's icon set. Only the Windows icons referenced by
`tauri.conf.json` are tracked; the Android/iOS/macOS outputs are gitignored so a
regeneration cannot bloat the repository.

---

## Building the Windows installer

```bash
# Release NSIS installer, x86_64-pc-windows-msvc
pnpm desktop:build:win

# Debug build of the same target — faster, with symbols
pnpm desktop:build:win:debug
```

Both require a compile-time `AXIS_DESKTOP_SERVER_URL` if you want a URL baked
in. Leave it unset to ship a universal installer configured per-machine at
install time (see option 2).

Output:

```text
apps/desktop/src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/
  Axis_0.1.0_x64-setup.exe
```

Building a Windows target from Linux or macOS needs a Windows/MSVC toolchain
(cross-compilation is not supported); use Windows or a Windows CI runner.

---

## What the shell does

`apps/desktop/src-tauri/src/` is small and has no clinical logic.

| File           | Responsibility                                                    |
| -------------- | ----------------------------------------------------------------- |
| `main.rs`      | Windows subsystem entry point; calls `axis_desktop_lib::run()`.  |
| `lib.rs`       | Builder, plugins, window creation, navigation policy.             |
| `file_select.rs` | Native DICOM dialogs, scoped file grants, and selection budgets. |
| `server_url.rs`| Deployment URL validation and resolution. Pure, unit-tested.     |

### Single instance

`tauri-plugin-single-instance` takes the lock before any window is created. A
second launch unminimises and focuses the running window instead of opening a
second webview against the same session cookie.

### Navigation policy

The window may display exactly two things: the bundled splash, and the configured
deployment origin.

- **Same-origin navigation** — allowed.
- **Any other origin** — refused. `http`/`https` off-origin links are handed to
  the system browser instead; other schemes (`file:`, `javascript:`, `mailto:`)
  are dropped silently.
- **Popups** (`target="_blank"`) — only same-origin is allowed to open; anything
  else is denied or handed off.

This holds across in-app links, `Location.assign` from a compromised dependency,
and HTTP redirects: the PACS window cannot be turned into a general-purpose
browser, and `file://` cannot be reached even if the deployment is compromised.

---

## Phase 3 native features

### File selection

Study submission uses the Tauri native Windows file and folder dialogs. The
desktop shell permits only `.dcm`, `.dicom`, and `.zip`, enforces per-file,
combined-size, and file-count budgets, skips symlinks during folder walks, and
grants reads only for paths the user selected. The web client checks the same
budgets for early feedback. These are client-side safeguards, not authorization:
the NestJS ingest endpoint still validates every upload.

### Printing

The report print action opens the existing report in a print-optimized route and
uses the WebView2 print pipeline (`window.print()`). The report is rendered by
the existing web components and stylesheet; no temporary report file or second
renderer is created. Users must be authorized to view the report before they
can print it.

### Native notifications

The authenticated `/notifications` feed remains the only event source. On the
first poll, existing notifications seed an in-memory seen set; subsequent new
event types may produce a Windows toast. Toast text comes from a fixed client
allow-list and never includes the server's notification message, patient name,
study identifier, or report text. Windows permission is requested only when a
user selects **Enable** in the notification menu. The in-app notification list
continues to use the authenticated server response.

### Window behavior

The main native frame is resizable, has a 1024×700 minimum client area, and
supports the standard Windows minimize/maximize/restore actions. The app is
single-instance; launching it again focuses the existing window. The reading
room can explicitly open one same-origin viewer window, reusing and focusing it
if it is already open.

### Errors and connectivity

The client is online-only. Transport errors, timeouts, expired sessions,
server errors, and imaging-backend failures have distinct user-facing states;
it never presents cached or offline clinical data. Error reports retain a
reference ID, timestamp, app/OS version, error type, redacted stack frames, and
server correlation ID when available. Free-form exception messages are not
stored or logged, and reports are not sent to an external service. The support
reference is local; the server request ID is the value that locates API logs.

---

## Automatic updates

The updater plugin and frontend state UI are present, but the committed
configuration is intentionally inert: `plugins.updater.active` is `false`, the
public key is empty, and there are no endpoints. The desktop shell performs a
startup check and offers a manual check, but an unconfigured release reports
updates as unavailable and cannot download or install anything.

To enable updates for a release:

1. Publish the Tauri update manifest and signed artifacts on an operator-owned
  HTTPS host.
2. Keep the minisign private key in the CI secret store. Never put it in this
  repository, the installer, or a developer workstation. Configure the
  matching public key and HTTPS manifest endpoint in a CI-only Tauri config
  overlay based on `apps/desktop/src-tauri/tauri.updater.example.json5`.
  Provide the artifact-signing private key and optional password through
  `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` CI
  secrets; these are separate from the public key in the config overlay.
3. Build with that overlay, for example:

  ```powershell
  pnpm --filter @axis/desktop build:win -- --config src-tauri/tauri.updater.conf.json
  ```

  The overlay file is generated by the release pipeline and must not be
  committed with deployment values. The endpoint must retain Tauri's
  `{{target}}`, `{{arch}}`, and `{{current_version}}` substitutions.
4. Publish the new app version and signed artifacts together. Tauri verifies
  the manifest signature against the configured public key before installation.

The user explicitly starts installation and chooses when to restart. The updater
does not restart the application during a reading session. Installer
Authenticode signing is separate from update artifact signing and also requires
operator-provided certificate and timestamp-service configuration.

---

## Security model

### Native access is bounded

`apps/desktop/src-tauri/capabilities/default.json` declares an empty permission
list and no `remote.urls` block. It applies to the bundled splash. The
deployment capability is separately restricted to the `main` window label.

The deployment capability needs wildcard HTTPS/loopback origins because the
deployment URL is operator-configured at runtime. Rust pins navigation and
popups in the main window to that one configured origin; non-loopback HTTP
deployments are rejected. The capability grants only the listed APIs and
commands. File reads are scoped to paths added after a native picker selection.

The secondary viewer is built in Rust from the current deployment origin and is
subject to the same navigation policy. It does not receive the remote deployment
capability, so the OHIF content has no Tauri filesystem, notification, updater,
or custom-command access. JavaScript cannot create arbitrary webview windows.

The opener plugin is invoked from **Rust**, not from JavaScript, so it needs no
permission entry.

### The session cookie is untouched

The cookie stays httpOnly and inside the WebView2 cookie store — DPAPI-encrypted
by the OS on Windows. It is never read by JavaScript, never copied into Rust, and
never written to a new storage backend.

No secure-storage plugin, no token mirroring, no `localStorage` fallback. Login on
the desktop client is the same login as the browser, against the same account,
with the same RBAC, hospital/radiologist isolation and audit trail.

### No clinical data is stored locally

There is no SQLite, no local cache, no offline study store, and no PHI on disk
outside the WebView2 cookie store and normal browser cache. The client is a
window; the server holds the data.

---

## Testing

```bash
# Web unit tests, typecheck, lint and production build
pnpm --filter @axis/web test
pnpm --filter @axis/web typecheck
pnpm --filter @axis/web lint
pnpm --filter @axis/web build

# API typecheck, lint, e2e tests and production build
pnpm --filter @axis/api typecheck
pnpm --filter @axis/api lint
pnpm --filter @axis/api test:e2e
pnpm --filter @axis/api build

# Native Rust tests and formatting
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml -- --check

# Windows installer (requires Windows MSVC/WebView2 build tools)
pnpm desktop:build:win
```

Rust tests cover deployment URL validation, the navigation allow-list, safe
initialization-script escaping, file type and size budgets, duplicate-path
handling, and bounded folder walking. Web unit tests cover same-origin API/OHIF
resolution, online-only failure states, PHI-safe error reports and notification
copy, selection budgets, and updater configuration/failure behavior. API e2e
tests cover assignment and report-return notification creation. Run the API e2e
suite with the test database and services configured as described by the repo.

### Windows acceptance checklist

Run these against a configured Windows staging deployment before release:

- Select valid DICOM/ZIP files and a nested folder; cancel each picker; verify
  unsupported, oversized, and over-budget selections are rejected before upload.
- Open a report print preview and print; confirm layout, page breaks, and that an
  unauthorized account cannot reach the report route.
- Grant and deny Windows notification permission; verify assignment, correction,
  and report-return toasts contain no patient or study details.
- Resize, minimize, maximize, restore, and close the main and viewer windows;
  launch a second process and verify it focuses the existing client; reopen the
  viewer and verify its existing window receives focus.
- With a signed staging feed, check an update, interrupt a download, reject an
  invalid signature, install a valid update, and restart at an appropriate time.
- Trigger a render error and a rejected request; verify retry behavior, the
  support reference, correlation ID, and absence of PHI/tokens in console output.
- Stop the API and Orthanc separately; verify clear PACS/image-unavailable
  states and that no stale or offline clinical data is presented.
- Expire the authenticated session and verify the client requests sign-in again.
- Restart the desktop client and verify it reloads the configured server without
  duplicating old toast notifications.

---

## Known limitations

| Area                      | Limitation                                                                                     |
| ------------------------- | ---------------------------------------------------------------------------------------------- |
| **Frontend not packaged** | The installer ships the shell and a splash, not the UI. Requires a reachable deployment. This is a deliberate trade-off — see [Why the frontend is not bundled](#why-the-frontend-is-not-bundled). |
| **Network required**      | The client cannot start a session with the API unreachable. There is no offline or read-only mode. |
| **Build target**          | Windows x64 (NSIS) only. No arm64, MSI, or `.msix` target is configured.                       |
| **Updates opt-in**        | Update checks/install UI is present, but production updates remain disabled until a signed HTTPS feed and public key are configured. |
| **Code signing**          | No certificate is configured, so the installer is unsigned and SmartScreen will warn. See [Signing](#signing-an-installer). |
| **URL only at first run** | There is no in-app settings screen. Reconfigure via `desktop.json` or the env var.              |
| **Single deployment**     | The shell talks to one deployment per launch. No multi-site switcher.                            |
| **Verification coverage** | The Windows installer has not been built or run end-to-end in this environment — see [Troubleshooting](#troubleshooting). |

### Signing an installer

`tauri.conf.json` sets no `certificateThumbprint` or `timestampUrl`, so the NSIS
output is unsigned. For a real clinical rollout, add a code-signing certificate
and an RFC 3161 timestamp server, and expect SmartScreen "unknown publisher"
prompts until the certificate is trusted.

---

## Troubleshooting

**Window shows the splash and says "not configured"**
No deployment URL was resolved. Set `AXIS_DESKTOP_SERVER_URL` or write
`desktop.json` to `%APPDATA%\com.axis.teleradiology.pacs\`.

**"No deployment configured (source: env)" in the console**
The env var was set but rejected. A trailing path, query string, or a bad scheme
is the usual cause. The value must be a bare origin.

**`AXIS_DESKTOP_SERVER_URL` is ignored in a release build**
A valid earlier source won. The precedence is env > `desktop.json` > compile
time > debug localhost; stderr prints the source that actually won.

**Login succeeds but every page 401s**
The API origin is not the one serving the frontend. Check `NEXT_PUBLIC_API_URL`,
`CORS_ORIGIN`, and that `/api` is proxied by the same origin that loaded the app.

**`error: linker 'cc' not found`**
No C toolchain. Install build-essential / MSVC build tools.

**WebKit or `pkg-config` errors on Linux**
Expected — this target is Windows-only. Use a Windows host or CI runner.

**Second launch does nothing**
Working as intended: the single-instance plugin focuses the existing window. If
no window appears, the first process is running without a window — check stderr.

**`docker compose up` fails with a Podman shim error**
Unrelated to desktop. The repo's infra services need a running container daemon.
