# Graph Lens Lite — Publication

LaTeX source for the Graph Lens Lite journal paper, targeting the OUP
`oup-authoring-template` class (Nucleic Acids Research by default).

The folder is flat: one driver (`main.tex`) plus the prose split into small
`\input` files so each piece can be edited on its own.

- `main.tex` — driver: preamble, frontmatter macros, `\input`s the body
- `body.tex` — the body, Introduction through Conflict of interest
- `abstract.tex` — abstract prose (no heading), fed to `\abstract{}`
- `keywords.tex` — keyword list, fed to `\keywords{}`
- `reference.bib` — bibliography database
- `oup-plain.bst` — numbered citation style
- `Fig/` — figures

The body is in IMRaD order (Introduction → Materials and Methods → Results →
Discussion); headings are unnumbered under the OUP class (`unnumsec`).

## Author conventions

Look for these markers when reviewing the draft:

- `% AI-DRAFTED -- REVIEW` — prose drafted by an AI assistant during the
  manuscript restructure. Treat as a starting point; revise in your own voice
  before submission. Anything not marked is user-original prose preserved
  verbatim from the prior draft.
- `% TODO` — structural placeholder. The heading exists, the body is empty,
  the comment block lists the angles to consider.

## Prerequisites

### Fedora

```bash
sudo dnf install \
  latexmk \
  texlive-scheme-basic \
  texlive-latex \
  texlive-bibtex \
  texlive-natbib \
  texlive-acronym \
  texlive-hyperref \
  texlive-geometry \
  texlive-lineno \
  texlive-preprint \
  texlive-lm \
  texlive-enumitem \
  texlive-collection-fontsrecommended
```

### Ubuntu / Debian

```bash
sudo apt install \
  latexmk \
  texlive-latex-base \
  texlive-latex-recommended \
  texlive-latex-extra \
  texlive-bibtex-extra \
  texlive-fonts-recommended
```

### macOS (Homebrew)

```bash
brew install --cask mactex
```

Or for a smaller footprint:

```bash
brew install --cask basictex
sudo tlmgr install natbib acronym preprint lineno enumitem lm
```

## Building

```bash
latexmk -pdf main
```

Output: `main.pdf`

Uses the OUP `oup-authoring-template` class (`webpdf,contemporary,numbered`,
numbered citations via `oup-plain.bst`). Set `\journaltitle` (and `\appnotes`)
to the target venue at submission time.

**The OUP class must be available.** It ships in recent TeX Live
(`oup-authoring-template`); if `latexmk` reports the class missing, copy
`oup-authoring-template.cls` and the `oup-*.bst` files from the OUP template
(<https://www.overleaf.com/latex/templates/oup-general-template/ybpypwncdxyb>)
into this directory, or build on Overleaf.

Note: the OUP class does not define the `description` environment — use
`itemize` in the body.

### Clean auxiliary files

```bash
latexmk -C
```

## References

Add entries to `reference.bib` (BibTeX). Citations render numbered in order of
appearance via `oup-plain.bst`; NAR style shows the first three authors then
"et al." — append `and others` to an author list to trigger it.
