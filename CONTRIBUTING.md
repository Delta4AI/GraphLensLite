# Contributing to Graph Lens Lite

## Setup

```bash
git clone https://github.com/Delta4AI/GraphLensLite.git
cd GraphLensLite
npm install
```

Build dependencies (Fedora/RHEL):
```bash
dnf install libxcrypt-compat wine   # only needed for cross-platform builds
```

## npm Scripts

| Command | Purpose |
|---|---|
| `npm run bundle:serve` | Dev server with watch + sourcemaps (recommended for development) |
| `npm run serve` | Static http-server on :8000 |
| `npm run serve:api` | Standalone HTTP ingest service with live SSE viewer (see [SERVICE.md](SERVICE.md)) |
| `npm start` | Electron app (injects version automatically; the first run after a fresh `npm install` downloads the ~110 MB Electron runtime, which Electron 43 does not fetch at install time) |
| `npm run bundle` | One-off bundle (no minify) |
| `npm run bundle:prod` | Production bundle (minified) |
| `npm test` | Run the vitest unit test suite |
| `npm run test:watch` | vitest in watch mode |
| `npm run lint` | ESLint over `src`, `server`, `scripts`, `tests` |
| `npm run perf` / `npm run perf:sweep` | Renderer benchmark gates / size × styling sweep (see [bench/render/README.md](bench/render/README.md)) |
| `npm run vendor-libs` | Copy `marked` / `dompurify` and bundle the sigma, graphology and layout-worker libraries into `src/lib/`; regenerate the assistant prompt modules from their `.md` sources |
| `npm run dist-linux` | Build Linux packages (AppImage, deb, snap) |
| `npm run dist-windows` | Build Windows packages (nsis, portable) |
| `npm run dist-mac` | Build macOS packages (dmg, zip) |
| `npm run inject-version` | Sync version from `package.json` into `src/config.js` |

## Version Management

The app version is defined in `package.json` and displayed in the UI via `src/config.js`.
The `inject-version` script keeps them in sync — `package.json` is the source of truth.

### Bumping a version

The `version` npm hook syncs `src/config.js` and stages it. On the release
branch, bump without a tag (the tag goes on main, see below):

```bash
npm version minor --no-git-tag-version   # or: patch, major
npm run inject-version && git add src/config.js
```

### Releasing

Releases are cut from a `release/X.Y.Z` branch and tagged on main.

1. On the release branch: `package.json` and `src/config.js` carry the new
   version, and `CHANGELOG.md` has a `## X.Y.Z — YYYY-MM-DD` section dated
   the day you tag (the release notes are cut from it; a leftover
   `## Unreleased` heading would be picked up instead if it came first).
2. If the UI changed, refresh the README screenshots
   (`node scripts/readme_screenshots.mjs`, see below).
3. Open a pull request into `main`. CI (tests, lint, vendored files, container
   build) must be green. Merge it with a merge commit.
4. Tag the merge commit on main and push the tag:
   ```bash
   git switch main && git pull
   git tag -a vX.Y.Z -m "vX.Y.Z"
   git push origin vX.Y.Z
   ```
5. The tag starts the *Build and Release* workflow: it builds Windows, Linux
   and macOS packages and the single-file HTML, creates the GitHub release with
   the CHANGELOG section as its notes, and deploys the HTML as the live demo
   on GitHub Pages.

## Python Scripts (uv)

The repository includes Python helper scripts in `scripts/` (e.g. the screenshot tool).
These are **not** part of the main app — they are side utilities for development.

Dependencies are managed with [uv](https://docs.astral.sh/uv/) and tracked in
`pyproject.toml` / `uv.lock`.

### First-time setup

```bash
uv sync
uv run playwright install chromium
```

### Screenshot Tool

Takes screenshots of the running app in a Chromium window you drive by hand.

1. Start the dev server:
   ```bash
   npm run bundle:serve   # or npm run serve
   ```
2. Run the tool (`--scale 1x`…`15x` sets the pixel density, `--portrait`
   captures 1080×1920, `--browser-size` shrinks the window):
   ```bash
   uv run python scripts/screenshot_tool.py --scale 2x
   ```
3. Navigate to the view you want, then press **Enter** in the terminal to
   capture. Type `quit` to exit.

Screenshots are saved to `static/screenshots/` with a timestamped name.

### README screenshots

`node scripts/readme_screenshots.mjs` regenerates the README images
(`static/screenshots/*.png`, overwritten) from the live app: it stages the
ADPKD case study used for the manuscript figure, opens each panel and captures
the window. It needs a display and a dbus session (Electron with WebGL2, so not
a headless sandbox) and `pngquant` on the PATH, and takes about three minutes.

## Testing

Unit tests run under [vitest](https://vitest.dev/). A few use jsdom — opt in per-file with `// @vitest-environment jsdom` at the top. jsdom has no `CSS.escape`, drops CSS `max()` from inline styles, ignores the `contentEditable` property (use `setAttribute`), and rejects `readFileSync(new URL(..., import.meta.url))`; read fixtures by a repo-root path as `tests/landing-webgl-gating.test.js` does.

```bash
npm test            # run the full suite once
npm run test:watch  # re-run on file changes
```

Tests live in `tests/` as `*.test.js`. Assistant-specific tests (`tests/assistant-*.test.js`) cover settings/endpoint validation, the context snapshot, markdown rendering + sanitization, and the query-warning linter. Ingest-service tests (`tests/api-*.test.js`) cover config resolution, the graph store, request handling/routing, payload validation, and the browser client.

### End-to-end (Electron)

`tests/*.e2e.test.js` drive the real app in the repo's Electron (full Chromium with WebGL2), rendered offscreen by `tests/e2e/electron_main.cjs`. `npm test` counts them as skipped, so run them before calling a UI change done:

```bash
GLL_E2E=1 npx vitest run --dir tests e2e                         # with a GPU
GLL_E2E=1 GLL_E2E_SWIFTSHADER=1 npx vitest run --dir tests e2e   # software WebGL: CI, sandboxes, no GPU
```

For a one-off live check or screenshot, start from `tests/e2e/electron_main.cjs` (offscreen window, ready check in any e2e test) or `manuscript/main-figure/harness.mjs` (crisp captures with canvases, see its README) rather than a new harness. A hidden non-offscreen window stalls animation frames and crashes on the second capture.

## Code Style

- Follow the style of the file you're editing
- No docstrings or type annotations unless already present
- Comments only where logic is non-obvious
- No unnecessary abstractions

## Commits

- [Conventional Commits](https://www.conventionalcommits.org/): `<type>(<scope>): <summary>`,
  summary in imperative mood, lowercase, under 72 characters
- One logical change per commit
- Examples from the log:
  - `fix(dialog): validate the workspace name without window.alert`
  - `refactor(notes): measure the note box once, paint it twice`

## Pull Requests

- One feature or fix per PR
- Read relevant source files before modifying — understand existing patterns
- Test in both browser (`npm run bundle:serve`) and Electron (`npm start`)
