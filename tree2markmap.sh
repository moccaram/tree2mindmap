#!/bin/bash

# tree2markmap.sh - Directory-to-Markmap Pipeline
# Automates the generation of interactive mindmaps from local folder structures.

DIR="${1:-.}"
# Prevent accidental expansion if the user passes a literal $ character
ROOT=$(basename "$(realpath "$DIR")")
OUT_FILE="${2:-${ROOT}_mindmap.md}"

# Flag to start a local server
SERVE=false
for arg in "$@"; do
    if [ "$arg" == "--serve" ]; then
        SERVE=true
    fi
done

# Ensure we are using an absolute path for DIR for Python
ABS_DIR=$(realpath "$DIR")

echo "Scanning: $ABS_DIR"

python3 - "$ABS_DIR" "$ROOT" << 'PYEOF' > "$OUT_FILE"
import os
import sys

def walk(path, root_path, depth=0):
    try:
        # Get directory contents, skipping hidden files/folders
        items = sorted([f for f in os.listdir(path) if not f.startswith('.')])
    except PermissionError:
        return

    for item in items:
        full_path = os.path.join(path, item)
        rel_path = os.path.relpath(full_path, root_path)
        indent = '  ' * depth
        # Escape path for Markdown and HTML
        safe_path = rel_path.replace('"', '&quot;')
        print(f"{indent}- [{item}](#path={safe_path})")
        
        if os.path.isdir(full_path):
            walk(full_path, root_path, depth + 1)

if __name__ == "__main__":
    target_dir = sys.argv[1]
    root_name = sys.argv[2]
    
    # Markmap frontmatter for styling and initial collapse state
    print('---')
    print('markmap:')
    print('  initialExpandLevel: 1')
    print('  colorFreezeLevel: 2')
    print('  spacingHorizontal: 60')
    print('  spacingVertical: 3')
    print('---')
    print('')
    
    print(f"# {root_name}")
    walk(target_dir, target_dir)
PYEOF

if [ $? -eq 0 ]; then
    echo "Generated Markdown: $OUT_FILE"
    HTML_OUT="${OUT_FILE%.md}.html"
    node render.mjs "$OUT_FILE" "$HTML_OUT"
    if [ $? -eq 0 ]; then
        echo "Generated HTML: $HTML_OUT"
        if [ "$SERVE" = true ]; then
            echo "Starting local server at http://localhost:8000/$HTML_OUT"
            python3 -m http.server 8000
        fi
    else
        echo "Error: Failed to generate HTML."
        exit 1
    fi
else
    echo "Error: Failed to generate Markdown."
    exit 1
fi
