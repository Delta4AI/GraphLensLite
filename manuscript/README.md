# Graph Lens Lite — Publication

LaTeX setup for the Graph Lens Lite paper. The body content lives in
`shared/content.tex` and is rendered by two venue-specific drivers that share
the same section structure (Cell Press *Patterns* Resource Article style):

| Directory   | Target venue                                  |
|-------------|-----------------------------------------------|
| `biorxiv/`  | bioRxiv preprint                              |
| `patterns/` | Cell Press *Patterns* (Resource Article)      |

Drivers differ only in preamble (document class, citation style, fonts, line
numbering). The shared body uses `\section*{UPPERCASE}` headings and works
identically in both.

## Author conventions in `shared/content.tex`

Look for these markers when reviewing the draft:

- `% AI-DRAFTED -- REVIEW` — prose drafted by the AI assistant during the
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

### bioRxiv

```bash
cd biorxiv/
latexmk -pdf main
```

Output: `biorxiv/main.pdf`

### Cell Press Patterns (Resource Article)

```bash
cd patterns/
latexmk -pdf main
```

Output: `patterns/main.pdf`

Uses the generic Cell Press LaTeX template (v1.10) with the bundled
`numbered.bst` (AMA-style numbered citations) and `numcompress.sty`.

### Build both flavors at once

From the `manuscript/` directory:

```bash
for dir in biorxiv patterns; do (cd "$dir" && latexmk -pdf main); done
```

### Clean auxiliary files

```bash
cd biorxiv/   # or patterns/
latexmk -C
```

## Adding references

`scripts/add_reference_to_manuscript.py` (in the repo root) fetches a PubMed
citation by PMID and appends it to `shared/reference.bib`. It requires only
Python 3 (no extra packages).

```bash
scripts/add_reference_to_manuscript.py <PMID>
```

The tool shows the generated BibTeX entry and asks for confirmation before
writing. Duplicate cite keys are rejected automatically.

## Repository structure

```
shared/
  content.tex              Body sections (SUMMARY through SUPPLEMENTAL INFO)
  reference.bib            Bibliography database
  Fig/                     Figures

biorxiv/
  main.tex                 Preprint driver (article class, natbib author-year)

patterns/
  main.tex                 Cell Press Patterns driver (Resource Article)
  numbered.bst             AMA-style numbered bibliography
  numcompress.sty          Range-compression for numeric citations

../scripts/
  add_reference_to_manuscript.py   Fetch PubMed citation → BibTeX (Python 3)
```

Both drivers `\input{../shared/content}` — edit the shared body once, both
flavors pick up the changes.

> **Note on word counts.** Cell Press *Patterns* Resource Articles are
> typically 5,000–7,000 words (vs. ~2,500 in the prior bioRxiv draft).
> The METHODS section and the Limitations subsection are intentionally
> scaffolded with TODO placeholders so they can absorb the expansion before
> submission.
