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
| `npm start` | Electron app (injects version automatically; the first run after a fresh `npm install` downloads the ~110 MB Electron runtime, since Electron 43 no longer fetches it at install time) |
| `npm run bundle` | One-off bundle (no minify) |
| `npm run bundle:prod` | Production bundle (minified) |
| `npm test` | Run the vitest unit test suite |
| `npm run test:watch` | vitest in watch mode |
| `npm run vendor-libs` | Copy `marked` / `dompurify` into `src/lib/` and regenerate `src/managers/assistant/system_prompt.js` from its `.md` source |
| `npm run dist-linux` | Build Linux packages (AppImage, deb, snap) |
| `npm run dist-windows` | Build Windows packages (nsis, portable) |
| `npm run dist-mac` | Build macOS packages (dmg, zip) |
| `npm run inject-version` | Sync version from `package.json` into `src/config.js` |

## Version Management

The app version is defined in `package.json` and displayed in the UI via `src/config.js`.
The `inject-version` script keeps them in sync — `package.json` is the source of truth.

### Bumping a version

The `version` npm hook automatically syncs `src/config.js` and stages it,
so a single command creates the commit + tag:

```bash
npm version patch   # or: minor, major
git push --follow-tags
```

This bumps `package.json`, injects the version into `src/config.js`,
commits both files, creates a `vX.Y.Z` tag, and the push triggers
the CI release workflow.

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

Takes screenshots of the running app via a Chromium instance. Three quality presets:

| Preset | Resolution | Scale | Use case |
|---|---|---|---|
| `normal` | ~1920×1080 | 1× | Quick captures |
| `hq` | ~5760×3240 | 3× | Default, good for docs |
| `ultrahq` | ~7680×4320 | 4× | Print / high-DPI assets |

1. Start the dev server:
   ```bash
   npm run bundle:serve   # or npm run serve
   ```
2. Run the tool with a quality preset:
   ```bash
   uv run python scripts/screenshot_tool.py           # defaults to hq
   uv run python scripts/screenshot_tool.py normal     # quick low-res
   uv run python scripts/screenshot_tool.py ultrahq    # maximum quality
   ```
3. A Chromium window opens. Navigate to the desired view, then press **Enter**
   to capture. Type `quit` to exit.

Screenshots are saved to `static/screenshots/`.

## Testing

Unit tests run under [vitest](https://vitest.dev/). A few use jsdom — opt in per-file with `// @vitest-environment jsdom` at the top.

```bash
npm test            # run the full suite once
npm run test:watch  # re-run on file changes
```

Tests live in `tests/` as `*.test.js`. Assistant-specific tests (`tests/assistant-*.test.js`) cover settings/endpoint validation, the context snapshot, markdown rendering + sanitization, and the query-warning linter. Ingest-service tests (`tests/api-*.test.js`) cover config resolution, the graph store, request handling/routing, payload validation, and the browser client.

## Code Style

- Follow the style of the file you're editing
- No docstrings or type annotations unless already present
- Comments only where logic is non-obvious
- No unnecessary abstractions

## Commits

- Lowercase start, under 30 words, imperative mood
- One logical change per commit
- Examples from the log:
  - `fix query editor cursor jumping, bracket processing, caret flicker and overlay alignment`
  - `add guided tour with sample dataset and step-by-step UI walkthrough`

## Pull Requests

- One feature or fix per PR
- Read relevant source files before modifying — understand existing patterns
- Test in both browser (`npm run bundle:serve`) and Electron (`npm start`)
