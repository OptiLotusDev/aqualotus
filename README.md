# Aqualotus

**Aqualotus is the visual programming environment for the Optilotus language.**

Think of it like this: **Optilotus** is the engine (written in Rust) that understands
and runs programs, and **Aqualotus** is the visual app (written in React) where people
see and build those programs. The app talks to the engine through a bridge called
**WASM**, which lets Rust code run directly inside a browser or a native app window.

One shared app runs everywhere:

- **Web** — in the browser (works today)
- **Desktop** — as a native window via Tauri (Windows / macOS / Linux)
- **Mobile** — as a native app via Capacitor (Android / iOS)

Phone and desktop look different, but that is handled with **layouts inside one app** —
there is deliberately only one codebase to maintain.

---

## How everything fits together

```text
┌─────────────────────────┐
│  crates/optilotus (Rust)│  ← the engine: language + runtime, no UI
└────────────┬────────────┘
             │  wasm-pack build  →  src/wasm/  (generated bridge files)
             ▼
┌─────────────────────────┐
│  apps/aqualotus-ui      │  ← the ONE shared React app
│  ├─ DesktopLayout       │  ← big screens (web + desktop window)
│  └─ MobileLayout        │  ← phones (narrow screen / native app)
└────────────┬────────────┘
             │  same UI loaded by…
             ▼
   Web (Vite) · Desktop (Tauri) · Mobile (Capacitor)
```

Key idea: **all smart behavior lives in the Rust engine**. The UI only displays things
and sends user actions to the engine. The UI never re-implements language logic.

---

## Repository map — what to edit, what to leave alone

### `crates/optilotus/` — the Rust engine 🔧 edit when changing behavior

| Path                | What it is                                   | Touch it?                          |
|---------------------|----------------------------------------------|------------------------------------|
| `src/lib.rs`        | The engine API (version, health, program Run, …) | ✅ Yes — this is where language/runtime logic lives |
| `Cargo.toml`        | Rust dependencies and build settings         | ✅ Yes, when you need a new crate dependency |
| `target/`           | Build output                                 | 🚫 Never — generated, git-ignored  |

Rules: no UI code here, no dependency on Tauri/React/the browser.
Everything here must keep working headlessly (`cargo test` proves it).

### `apps/aqualotus-ui/src/` — the app 🔧 edit for UI work

| Path                     | What it is                                              | Touch it? |
|--------------------------|---------------------------------------------------------|-----------|
| `layouts/`               | `DesktopLayout` (big screens) and `MobileLayout` (phones) | ✅ Yes — this is where screen differences go |
| `components/`            | Shared building blocks (e.g. `OptilotusPanel`)          | ✅ Yes — reusable UI pieces live here |
| `hooks/`                 | Shared state logic (e.g. `useOptilotus`, `useIsMobile`) | ✅ Yes — data fetching and shared state |
| `lib/optilotus.ts`       | **The** bridge to the engine. Single entry point.       | ✅ Yes, but carefully — it must stay a thin wrapper (see below) |
| `App.tsx`, `main.tsx`    | App entry and layout switcher                           | ✅ Yes, for app-level changes |
| `assets/`, `App.css`, `index.css`, `public/`, `index.html` | Images, styles, page shell | ✅ Yes |
| `wasm/`                  | Generated bridge files (`.js`, `.wasm`, `.d.ts`)        | 🚫 Never by hand — rebuilt with `npm run build:wasm` which automatically runs upon running the frontend |

**Bridge rule:** functions in the UI that come from the Optilotus API carry the
`optilotus_` prefix with a camelCase remainder — e.g. `optilotus_emptyProgram`,
`optilotus_runEmpty`, `optilotus_version`. If you expose a new engine function to
the UI, name it this way. UI-only helpers (hooks, components) keep normal names
(`useIsMobile`, `OptilotusPanel`, …).

### Shells — native wrappers (usually leave alone)

| Path            | What it is                                              | Touch it? |
|-----------------|---------------------------------------------------------|-----------|
| `src-tauri/`    | Tauri desktop shell config (window, bundle, permissions) | 🔧 Only when changing desktop packaging/window settings |
| `capacitor.config.ts` | Capacitor mobile config (app id, `webDir`)        | 🔧 Only when changing app id or web assets folder |
| `android/`, `ios/` | Generated native projects                            | 🚫 Never by hand — regenerated with `npx cap sync` |
| `dist/`         | Production web build                                    | 🚫 Never — generated with `npm run build` |

### `docs/` — project knowledge 📖 read before building

| File                    | What it is — read in this order |
|-------------------------|---------------------------------|
| `index.md`              | Map of the docs folder (start here) |
| `roadmap.md`            | **Source of truth** for what to build and in what order |
| `design-principles.md`  | **Rules all code must follow** (honesty, ownership, naming, …) |
| `api.md`                | The UI ↔ engine interface reference |
| `proposal.md`           | Background and motivation (context only, not a build spec) |

If the roadmap and another note disagree, **follow the roadmap**.
If a shortcut violates a design principle, **do not take it**.

### Root files

| File                    | Touch it? |
|-------------------------|-----------|
| `package.json` (root)   | ✅ For adding/changing team-wide shortcut scripts |
| `Cargo.toml` (root)     | ✅ For workspace membership (rare) |
| `Cargo.lock`            | 🚫 Managed by Cargo — do not hand-edit |
| `package-lock.json` files | 🚫 Managed by npm — do not hand-edit |
| `.gitignore`            | ✅ If a new tool produces files that should not be committed |

---

## Prerequisites — install once

| Tool | Why you need it | Get it |
|------|-----------------|--------|
| Rust (stable) | Builds and tests the Optilotus engine | [rustup.rs](https://rustup.rs/) |
| Node.js 22+ | Runs the UI tooling (Vite, tests, builds) | [nodejs.org](https://nodejs.org/) |
| `wasm-pack` | Compiles Rust → WASM for the browser | `cargo install wasm-pack` |
| A browser | To see the web UI | Any modern browser |
| Tauri OS libraries | **Desktop only** — native window support | [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) — e.g. Ubuntu: `sudo apt install libwebkit2gtk-4.1-dev librsvg2-dev` |
| Android Studio + SDK | **Mobile/Android only** — emulator and device builds | [developer.android.com/studio](https://developer.android.com/studio) |
| Xcode (macOS only) | **Mobile/iOS only** — iOS builds require a Mac | App Store |

You do **not** need Android Studio, Xcode, or Tauri libraries just to work on the
web UI or the Rust engine.

---

## First-time setup

```bash
# 1. Clone and enter the repo
git clone <repo-url>
cd aqualotus

# 2. Check the Rust engine builds and passes tests
cargo test --workspace

# 3. Install the UI dependencies (takes a minute the first time)
cd apps/aqualotus-ui
npm install

# 4. Start the app (rebuilds WASM, then opens the dev server)
npm run dev
```

Open the URL shown in the terminal (usually <http://localhost:5173>).
You should see the app **plus an “Optilotus (WASM)” panel** showing version,
health, and a test run — that panel proves the UI is really talking to the
Rust engine. If it says `failed`, see Troubleshooting below.

---

## Everyday commands

All of these work **from the repo root**. (`cd apps/aqualotus-ui` first also works —
then drop nothing; the command names are the same.)

| Command | What it does | When to use it |
|---------|--------------|----------------|
| `npm run dev` | Rebuilds WASM, then starts the web UI | ⭐ **Default.** After any Rust change, or when in doubt |
| `npm run dev:ui` | Starts the web UI **without** rebuilding WASM | UI-only changes (faster startup) |
| `npm run build` | Production web build (`dist/`) | Before deploying or syncing to mobile |
| `npm run build:wasm` | Rebuilds the WASM bridge only | After changing the engine API |
| `npm run test:rust` | Runs all Rust tests (`cargo test`) | After any engine change |
| `npm run test:ui` | Runs all UI unit tests (vitest) | After changing hooks/utils |
| `npm run lint` | Checks code style | Before committing |
| `npm run preview` | Serves the production build locally | To check what deploy will look like |
| `npm run tauri:dev` | Opens the **desktop** window (rebuilds WASM first) | Desktop work (needs Tauri OS libraries) |
| `npm run tauri:build` | Builds the desktop installer/bundle | Releasing the desktop app |
| `npm run mobile:sync` | Builds web assets and syncs them into `android/` + `ios/` | After UI changes, before opening native IDEs |
| `npm run mobile:android` | Syncs, then opens **Android Studio** | Android work (needs Android Studio) |
| `npm run mobile:ios` | Syncs, then opens **Xcode** | iOS work (**macOS only**) |

---

## Which command when? (the 10-second version)

- Changed **Rust code** (`crates/optilotus`) → `npm run dev` (or `build:wasm` + `dev:ui`)
- Changed **only UI code** → `npm run dev:ui` is enough
- Changed **the engine API the UI calls** → `npm run dev`, then check the WASM panel
- Want to run on **desktop** → `npm run tauri:dev`
- Want to run on a **phone/emulator** → `npm run build`, then `npm run mobile:android`
- About to **commit** → `npm run lint`, `npm run test:rust`, `npm run test:ui`

---

## How to contribute

1. **Read the docs first** — `docs/index.md` → `roadmap.md` → `design-principles.md`.
   The roadmap tells you *what* to build next; the principles tell you *how*.
2. **Keep changes small.** One behavior per change; one responsibility per function
   (`design-principles.md`, Principle 1).
3. **Respect the layers.** Language/runtime logic goes in `crates/optilotus` only.
   The UI calls it through `src/lib/optilotus.ts` — never copy engine logic into React.
4. **Follow the naming rules.**
   - Engine functions used by the UI: `optilotus_` prefix + camelCase rest
     (`optilotus_emptyProgram`, `optilotus_runEmpty`).
   - Everything else: `camelCase` functions/variables, `PascalCase` types/components,
     `SCREAMING_SNAKE_CASE` constants. No `any` in TypeScript. Details in
     `design-principles.md` (Principle 9) and `docs/api.md`.
5. **Test what you touch.**
   - Rust: add/extend unit tests in `src/lib.rs`, run `npm run test:rust`.
   - UI logic (hooks, utils): add a `.test.ts` next to it, run `npm run test:ui`.
   - Run `npm run lint` before pushing.
6. **Never hand-edit generated files**: `src/wasm/`, `android/`, `ios/`, `dist/`,
   `target/`, lockfiles. Regenerate with the commands above.
7. **Document new interfaces**: if you add a UI ↔ engine function, update
   `docs/api.md`. If you add a new top-level doc, register it in `docs/index.md`.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| WASM panel says `failed: …` | WASM not built, or dev server serving stale files | Run `npm run build:wasm`, then restart with `npm run dev` |
| `vite` errors about `.wasm` / MIME type | Old generated glue | `npm run build:wasm` and retry |
| Port `5173 is in use` | Another dev server is running | Either stop the other one, or just open the new URL Vite prints (e.g. `:5174`) |
| `tauri dev` fails on missing `webkit2gtk` / `rsvg2` | Tauri OS libraries not installed | Install per [prerequisites](https://v2.tauri.app/start/prerequisites/) (see table above) |
| `cap open android` does nothing / Studio missing | No Android Studio or SDK not on `PATH` | Install Android Studio; set `ANDROID_HOME` to your SDK |
| iOS build fails on Linux/Windows | Expected — Apple requires macOS + Xcode | Use Android/emulator, or a Mac for iOS |
| `npm install` errors | Wrong Node version or partial install | Check `node --version` (need 22+), delete `node_modules`, reinstall |
| `cargo` errors after pulling | New Rust dependency | Run `cargo test --workspace` once to fetch and compile it |

Still stuck? Check `docs/roadmap.md` for context on the area you are working in,
and look at `docs/api.md` if the problem sits at the UI ↔ engine boundary.

---

## Quick glossary

- **Optilotus** — our programming language and the engine that runs it (Rust).
- **Aqualotus** — the visual app people use (React). One app, three targets.
- **WASM (WebAssembly)** — a format that lets the Rust engine run inside browsers
  and app windows. Rebuilt automatically by `npm run dev`.
- **Tauri** — packs the web app into a desktop window app.
- **Capacitor** — packs the web app into a phone app.
- **Vite** — the tool that serves the app while you develop (with instant refresh).
