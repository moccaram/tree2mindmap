# tree2markmap

A lightweight directory-to-mindmap pipeline for **inspecting large folder trees**.

`tree2markmap` is a local-first alternative to heavy desktop mind-mapping applications. It scans a local folder structure and renders an interactive, hierarchical mindmap as a **single HTML file** you can open in any browser. Rendering is done by a repo-owned Node script ([render.mjs](render.mjs)) built on [`markmap-lib`](https://www.npmjs.com/package/markmap-lib) + [`markmap-view`](https://www.npmjs.com/package/markmap-view) — not `markmap-cli` — so the focus / dimming / search behaviour below is fully under our control.

## Features
- **Interactive SVG:** Pan, zoom, and collapse/expand nodes.
- **Auto-traversal:** Walks your directory tree (skipping dotfiles) and opens **collapsed** so huge trees stay responsive.
- **Stable node identity:** Every node carries its **full relative path**, so duplicate folder names (e.g. two `common/` folders) are addressed independently.
- **Focus on open:** `?focus=` highlights nodes, **auto-expands** their ancestors, centers them, and (optionally) dims everything else.
- **Multi-select dimming:** `Ctrl/Cmd + Click` to keep several nodes lit while the rest dim.
- **Search / jump:** Real-time "contains" search; `Enter` cycles + jumps through matches.
- **Online _and_ offline:** Default output inlines all libraries (works with no internet); `--online` emits a tiny CDN-linked file.
- **Light / dark:** Built-in dark-mode toggle (☾ Dark) in the controls.

This is an **inspection UI only** — it never moves, renames, or deletes any files.

## Prerequisites
- **Node.js:** Required for the rendering pipeline.
- **Python 3:** Typically pre-installed on Linux/macOS.

## Installation
1. Clone this repository or copy the files to your path.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Ensure the script is executable:
   ```bash
   chmod +x tree2markmap.sh
   ```

## Usage
Run the script and pass the target folder path:

```bash
./tree2markmap.sh /path/to/your/project
```

By default it generates `<folder_name>_mindmap.md` and a self-contained
`<folder_name>_mindmap.html` in the current directory. Open the `.html` file in
a browser.

Flags:
- `--online` — emit a small CDN-linked HTML instead of inlining the libraries (needs internet to open).
- `--serve` — start a local `http://localhost:8000` server (avoids `file://` browser security blocks).

### Try the example
```bash
npm install
node render.mjs fixtures/sample.md /tmp/sample.html
# then open the file, e.g.:
#   file:///tmp/sample.html
```
The fixture intentionally contains two different `common/` folders (`a/common`
and `b/common`) so you can see path-based identity in action.

### Focus on open (URL parameters)
Append parameters to the file URL:

| Parameter | Example | Effect |
|-----------|---------|--------|
| `focus`   | `?focus=01_ACTIVE/Redo_2026-03-02` | Highlight + expand + center the node(s) matching the path. Matching is case-insensitive **"contains"**, not exact. |
| `focus` (multi) | `?focus=a/common,b/common` | Comma-separated list focuses several nodes at once. |
| `dim`     | `?dim=1` / `?dim=0` | `1` (default) dims everything except the focus; `0` highlights without dimming. |
| `opacity` | `?opacity=0.3` | Opacity (0–1) used for dimmed nodes. Default `0.15`. |

Example, combined:
```
file:///path/to/project_mindmap.html?focus=a/common&dim=1&opacity=0.2
```

### Interactive controls
- **Search:** Type in the top-right box (or press `/` to jump to it). Matches stay lit while the rest dim; press `Enter` to cycle through and center each match.
- **Multi-select:** `Ctrl/Cmd + Click` nodes to keep several focused at once; click without the modifier to focus just one.
- **Dark mode:** Click **☾ Dark** in the controls.
- **Shortcuts:**
  - `/` — focus the search box.
  - `Enter` (in search) — jump to the next match.
  - `Ctrl/Cmd + Click` — toggle a node in the multi-selection.
  - `Esc` — clear all selection, search, and dimming.

### Large-tree performance
For very large repositories, exclude noisy/generated directories before scanning
(e.g. `.git`, `node_modules`, `.venv`, `__pycache__`, `dist`, `build`). The
walker already skips dotfiles, so `.git` and `.venv` are excluded automatically;
prune the rest from the folder you point at. The map opens **collapsed**
(`initialExpandLevel` from the markdown frontmatter), and `?focus=` / search
expand only the branches you need — keeping thousands of nodes responsive.

## License
MIT
