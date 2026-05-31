# tree2mindmap

A lightweight, zero-dependency directory-to-mindmap pipeline. 

`tree2mindmap` is a local-first alternative to heavy desktop mind-mapping applications. It scans your local folder structures and automatically generates interactive, hierarchical mindmaps using [markmap-cli](https://markmap.js.org/).

## Features
- **Interactive SVG:** Pan, zoom, and collapse/expand nodes.
- **Auto-traversal:** Automatically walks your directory tree (skipping hidden files).
- **Fast & Lightweight:** Replaces heavy Java-based tools with a simple Bash/Python/Node.js toolchain.
- **Scalable:** Efficiently handles hundreds of directories and files.

## Prerequisites
- **Node.js:** Required for the `markmap-cli`.
- **markmap-cli:** Install it globally via npm:
  ```bash
  npm install -g markmap-cli
  ```
- **Python 3:** Typically pre-installed on Linux/macOS.

## Installation
1. Clone this repository or copy `tree2mindmap.sh` to your path.
2. Ensure it is executable:
   ```bash
   chmod +x tree2mindmap.sh
   ```

## Usage
Simply run the script and pass the target folder path:

```bash
./tree2mindmap.sh /path/to/your/project
```

By default, it generates `<folder_name>_mindmap.md` in the current directory and opens the interactive HTML map in your default browser.

To specify a custom output filename:
```bash
./tree2mindmap.sh /path/to/project my_custom_map.md
```

## License
MIT
