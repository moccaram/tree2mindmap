# tree2mindmap

A lightweight, zero-dependency directory-to-mindmap pipeline. 

`tree2mindmap` is a local-first alternative to heavy desktop mind-mapping applications. It scans your local folder structures and automatically generates interactive, hierarchical mindmaps using [markmap-cli](https://markmap.js.org/).

## Features
- **Interactive SVG:** Pan, zoom, and collapse/expand nodes.
- **Auto-traversal:** Automatically walks your directory tree (skipping hidden files).
- **Fast & Lightweight:** Replaces heavy Java-based tools with a simple Bash/Python/Node.js toolchain.
- **Scalable:** Efficiently handles hundreds of directories and files.
- **Enhanced UI (New):**
  - **Search:** Real-time search with "contains" matching. Use `Enter` to cycle through matches.
  - **Focus Mode:** Highlight specific nodes and dim the rest of the map.
  - **URL-based Focus:** Open maps with pre-defined focus using `?focus=path/to/dir`.
  - **Multi-select:** `Ctrl/Cmd + Click` to select multiple nodes for comparison or focus.
  - **Offline Support:** Generated HTML files are self-contained and work without an internet connection.

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
   chmod +x tree2mindmap.sh
   ```

## Usage
Simply run the script and pass the target folder path:

```bash
./tree2mindmap.sh /path/to/your/project
```

By default, it generates `<folder_name>_mindmap.md` and `<folder_name>_mindmap.html` in the current directory.

### UI Features
- **Search:** Use the search box in the top-right to find nodes.
- **Focus:** Use the URL parameter `?focus=my_folder` to automatically highlight and zoom to a folder on load. You can focus multiple folders with `?focus=folder1,folder2`.
- **Dimming:** Selecting any node (or searching) will dim all other nodes to reduce cognitive load.
- **Shortcuts:**
  - `Ctrl + Click`: Toggle multi-select.
  - `Esc`: Clear all selections and reset view.
  - `Enter` (in search): Jump to next search result.

## License
MIT
