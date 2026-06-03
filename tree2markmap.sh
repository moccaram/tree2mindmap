#!/bin/bash

# tree2markmap.sh - Directory-to-Markmap Pipeline
# Automates the generation of interactive mindmaps from local folder structures.

DIR="${1:-.}"
ROOT=$(basename "$(realpath "$DIR")")
OUT_FILE="${2:-${ROOT}_mindmap.md}"

# Ensure we are using an absolute path for DIR for Python
ABS_DIR=$(realpath "$DIR")

echo "Scanning: $ABS_DIR"

python3 - "$ABS_DIR" "$ROOT" << 'PYEOF' > "$OUT_FILE"
import os
import sys

def walk(path, depth=0):
    try:
        # Get directory contents, skipping hidden files/folders
        items = sorted([f for f in os.listdir(path) if not f.startswith('.')])
    except PermissionError:
        return

    for item in items:
        full_path = os.path.join(path, item)
        indent = '  ' * depth
        print(f"{indent}- {item}")
        
        if os.path.isdir(full_path):
            walk(full_path, depth + 1)

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
    walk(target_dir)
PYEOF

if [ $? -eq 0 ]; then
    echo "Generated: $OUT_FILE"
    if ! markmap "$OUT_FILE"; then
        echo "Error: Failed to generate HTML with markmap."
        exit 1
    fi
else
    echo "Error: Failed to generate Markdown."
    exit 1
fi
