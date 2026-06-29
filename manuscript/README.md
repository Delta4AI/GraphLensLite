# Graph Lens Lite — Publication

LaTeX setup for the Graph Lens Lite paper. The body is a single source under
`shared/`, rendered by venue-specific drivers:

| Directory   | Output                                        |
|-------------|-----------------------------------------------|
| `biorxiv/`  | bioRxiv preprint (article class)              |
| `journal/`  | Journal submission (OUP authoring class)      |

Shared body, split so it can feed both the article-class preprint driver and
the OUP template (which takes the abstract and keywords as frontmatter macros,
not sections):

- `shared/body.tex` — the body, Introduction through Conflict of interest
- `shared/abstract.tex` — abstract prose (no heading)
- `shared/keywords.tex` — keyword list
- `shared/content.tex` — thin wrapper: emits abstract + keywords as sections,
  then `\input`s the body. Used by the `biorxiv` driver.

The `journal` driver does **not** use `content.tex`; it injects `abstract.tex`
and `keywords.tex` into the OUP `\abstract{}` / `\keywords{}` macros and
`\input`s `body.tex` directly. Edit prose once in `body.tex`/`abstract.tex` —
both flavors pick it up.

The body is in IMRaD order (Introduction → Materials and Methods → Results →
Discussion); section headings are unstarred so they render unnumbered under the
article class (`secnumdepth=-2`) and styled under the OUP class (`unnumsec`).

## Author conventions in `shared/content.tex`

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

### bioRxiv

```bash
cd biorxiv/
latexmk -pdf main
```

Output: `biorxiv/main.pdf`

### Journal

```bash
cd journal/
latexmk -pdf main
```

Output: `journal/main.pdf`

Uses the OUP `oup-authoring-template` class (`webpdf,contemporary,numbered`,
numbered citations via `oup-plain.bst`). Set `\journaltitle` (and `\appnotes`)
to the target venue at submission time.

**The OUP class must be available.** It ships in recent TeX Live
(`oup-authoring-template`); if `latexmk` reports the class missing, copy
`oup-authoring-template.cls` and the `oup-*.bst` files from the OUP template
(<https://www.overleaf.com/latex/templates/oup-general-template/ybpypwncdxyb>)
into `journal/`, or build on Overleaf.

Note: the OUP class does not define the `description` environment — use
`itemize` in the shared body.

### Build both flavors at once

From the `manuscript/` directory:

```bash
for dir in biorxiv journal; do (cd "$dir" && latexmk -pdf main); done
```

### Clean auxiliary files

```bash
cd biorxiv/   # or journal/
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
  body.tex                 Body, Introduction through Conflict of interest
  abstract.tex             Abstract prose (no heading)
  keywords.tex             Keyword list
  content.tex              Wrapper: abstract + keywords as sections, then body
  reference.bib            Bibliography database
  Fig/                     Figures

biorxiv/
  main.tex                 Preprint driver (article class, natbib author-year)

journal/
  main.tex                 Journal driver (OUP oup-authoring-template, numbered)

../scripts/
  add_reference_to_manuscript.py   Fetch PubMed citation → BibTeX (Python 3)
```

`biorxiv` `\input`s `../shared/content`; `journal` injects the frontmatter
macros and `\input`s `body.tex`. Edit the shared body once — both flavors pick
up the changes.
