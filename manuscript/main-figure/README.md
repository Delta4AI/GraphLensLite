# Main figure pipeline

Rebuilds `../Fig/main-figure.png` from the running app, so the figure can be
redone after UI changes without manual screenshots or GIMP.

```bash
node manuscript/main-figure/capture.mjs   # ~3 min: stages the app, writes out/*.png + out/rects.json
node manuscript/main-figure/render.mjs    # lays out compose.html, writes ../Fig/main-figure.png
```

Both run the repo's Electron (full Chromium with WebGL2) offscreen. Inside the
Claude Code sandbox they need the sandbox lifted (dbus/display sockets).

- `capture.mjs` loads the ADPKD model, filters it through the query editor to the
  Wnt signaling pathway plus context (ADPKD literature evidence, tolvaptan
  signature), colours nodes by Wnt role (Okabe-Ito, colour-blind safe; context
  grey), pulls the tolvaptan signature together and groups it as a bubble set,
  selects PKD1 and PKD2, and captures the window and each panel at 3x device pixels.
- `harness.mjs` raises devicePixelRatio over CDP (offscreen windows ignore
  `deviceScaleFactor`) and, before each capture, swaps every canvas for an image
  because offscreen CDP screenshots drop canvases; the graph comes from the
  app's own PNG export at the live pixel ratio.
- `declutter.mjs` separates node labels for print (fit, separate, repeat; the run
  fails if any labels still overlap on screen); `assistant_stub.mjs` answers
  the Graph Assistant's Ollama calls with scripted text (no model runs here),
  with every value read from the loaded graph.
- `FIGURE_ZOOM` in `capture.mjs` enlarges the query text and the metrics list
  (figure-only CSS zoom) so they fill their tiles; `FIG_MAIN_ONLY=1` stops after the
  window capture for quick layout iterations.
- `compose.html` places the tiles and the numbered markers; marker numbers
  match the figure caption in `../body.tex`; their colours group them by workflow
  step (legend in the top margin). Markers on the main window follow
  the element positions recorded in `out/rects.json`.
