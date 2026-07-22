#!/usr/bin/env python3
"""Package a flat, submission-ready zip from the multi-venue LaTeX setup."""

import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
MANUSCRIPT = REPO_ROOT / "manuscript"
SHARED = MANUSCRIPT / "shared"

VENUES = {
    "oxford": {
        "support_globs": ["*.cls", "*.bst"],
    },
    "biorxiv": {
        "support_globs": ["*.cls", "*.bst", "*.sty"],
    },
}

# Paths in main.tex that reference the shared directory
SHARED_PATH_PATTERNS = [
    (re.compile(r"\{\.\.\/shared\/Fig\/\}"), "{./}"),
    (re.compile(r"\{\.\.\/shared\/([^}]+)\}"), r"{\1}"),
    (re.compile(r"\\input\{\.\.\/shared\/([^}]+)\}"), r"\\input{\1}"),
]


# ── helpers ──────────────────────────────────────────────────────────────────

def die(msg: str) -> None:
    print(f"Error: {msg}", file=sys.stderr)
    sys.exit(1)


def pick_venue() -> str:
    """Let the user choose a venue or accept a CLI argument."""
    available = [v for v in VENUES if (MANUSCRIPT / v).is_dir()]
    if not available:
        die("No venue directories found in manuscript/.")

    if len(sys.argv) > 1:
        venue = sys.argv[1].strip().lower()
        if venue not in available:
            die(f"Unknown venue '{venue}'. Available: {', '.join(available)}")
        return venue

    if len(available) == 1:
        return available[0]

    print("Available venues:")
    for i, v in enumerate(available, 1):
        print(f"  {i}) {v}")
    choice = input(f"Select venue [1-{len(available)}]: ").strip()
    try:
        return available[int(choice) - 1]
    except (ValueError, IndexError):
        die("Invalid selection.")
        return ""  # unreachable


def collect_files(venue: str) -> list[tuple[Path, str]]:
    """Return (source_path, flat_name) pairs for all files to include."""
    venue_dir = MANUSCRIPT / venue
    files: list[tuple[Path, str]] = []

    # main.tex and pre-compiled bibliography
    files.append((venue_dir / "main.tex", "main.tex"))
    bbl = venue_dir / "main.bbl"
    if bbl.exists():
        files.append((bbl, "main.bbl"))

    # venue-specific support files (cls, bst, sty)
    for glob in VENUES[venue]["support_globs"]:
        for p in sorted(venue_dir.glob(glob)):
            files.append((p, p.name))

    # shared content and bibliography
    for name in ["content.tex", "abbreviations.tex", "reference.bib"]:
        p = SHARED / name
        if p.exists():
            files.append((p, name))

    # figures
    fig_dir = SHARED / "Fig"
    if fig_dir.is_dir():
        for p in sorted(fig_dir.iterdir()):
            if p.is_file():
                files.append((p, p.name))

    return files


def flatten_main_tex(path: Path) -> None:
    """Rewrite main.tex so all paths point to the flat directory."""
    text = path.read_text()
    for pattern, replacement in SHARED_PATH_PATTERNS:
        text = pattern.sub(replacement, text)
    path.write_text(text)


def compile_pdf(work_dir: Path) -> Path:
    """Run pdflatex and return the path to the resulting PDF."""
    pdf = work_dir / "main.pdf"
    cmd = ["pdflatex", "-interaction=nonstopmode", "main.tex"]
    result = subprocess.run(cmd, cwd=work_dir, capture_output=True)
    if not pdf.exists():
        output = result.stdout.decode("utf-8", errors="replace")
        print(output[-2000:] if len(output) > 2000 else output)
        die("pdflatex failed — see output above.")
    return pdf


def open_pdf(pdf: Path) -> None:
    """Open the PDF with the system viewer."""
    opener = shutil.which("xdg-open") or shutil.which("open")
    if opener:
        subprocess.Popen([opener, str(pdf)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    else:
        print(f"  Open manually: {pdf}")


def clean_build_artifacts(work_dir: Path) -> None:
    """Remove LaTeX build artifacts, keeping only source files."""
    extensions = {".aux", ".log", ".out", ".fls", ".fdb_latexmk", ".blg", ".pdf", ".synctex.gz"}
    for p in work_dir.iterdir():
        if p.suffix in extensions:
            p.unlink()


# ── main ─────────────────────────────────────────────────────────────────────

def main() -> None:
    venue = pick_venue()
    print(f"Packaging '{venue}' submission …\n")

    files = collect_files(venue)
    missing = [src for src, _ in files if not src.exists()]
    if missing:
        die("Missing files:\n  " + "\n  ".join(str(p) for p in missing))

    # 1. Create temp directory and copy files
    tmp = Path(tempfile.mkdtemp(prefix="gll-submission-"))
    print(f"Working in {tmp}\n")
    for src, name in files:
        shutil.copy2(src, tmp / name)
        print(f"  {name:<40s} ← {src.relative_to(MANUSCRIPT)}")

    # 2. Flatten paths in main.tex
    flatten_main_tex(tmp / "main.tex")
    print("\n  Flattened paths in main.tex")

    # 3. Compile test PDF
    print("\n  Compiling test PDF …")
    pdf = compile_pdf(tmp)
    print(f"  OK — {pdf.stat().st_size / 1024:.0f} KB\n")

    # 4. Let user verify
    open_pdf(pdf)
    answer = input("Verify the PDF. Package into zip? [Y/n] ").strip().lower()
    if answer not in ("", "y", "yes"):
        shutil.rmtree(tmp)
        print("Aborted — temp directory removed.")
        return

    # 5. Clean build artifacts
    clean_build_artifacts(tmp)

    # 6. Create zip
    zip_name = f"{venue}-latex-submission"
    zip_path = MANUSCRIPT / zip_name
    shutil.make_archive(str(zip_path), "zip", tmp)
    final_zip = zip_path.with_suffix(".zip")
    size_mb = final_zip.stat().st_size / (1024 * 1024)

    # 7. Clean up temp directory
    shutil.rmtree(tmp)

    print(f"\n  Created {final_zip.relative_to(REPO_ROOT)} ({size_mb:.1f} MB)")
    print("  Temp directory removed.")


if __name__ == "__main__":
    main()
