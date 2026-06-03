#!/bin/bash

# tree2mindmap.sh - Directory-to-Markmap Pipeline
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

    OUT_HTML="${OUT_FILE%.*}.html"
    if [ "$OUT_HTML" = "$OUT_FILE" ]; then
        OUT_HTML="${OUT_FILE}.html"
    fi

    if [ -f "$OUT_HTML" ]; then
        python3 - "$OUT_HTML" << 'PYEOF'
import pathlib
import sys

html_path = pathlib.Path(sys.argv[1])
html = html_path.read_text(encoding="utf-8")

if "tree2mindmap-controls" not in html:
    controls_script = """
<script id="tree2mindmap-controls">
(() => {
  if (!window.mm || window.__tree2mindmapControlsLoaded) return;
  window.__tree2mindmapControlsLoaded = true;

  const style = document.createElement("style");
  style.textContent = `
    #t2m-controls {
      position: fixed;
      top: 16px;
      right: 16px;
      z-index: 9999;
      width: 310px;
      background: rgba(255, 255, 255, 0.96);
      border: 1px solid #d4d4d8;
      border-radius: 8px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16);
      padding: 12px;
      font-family: ui-sans-serif, system-ui, sans-serif;
      color: #111827;
    }
    #t2m-controls h3 {
      margin: 0 0 8px;
      font-size: 14px;
      line-height: 1.2;
    }
    #t2m-controls label {
      display: block;
      margin: 8px 0 4px;
      font-size: 12px;
      font-weight: 600;
    }
    #t2m-controls input[type="text"] {
      width: 100%;
      box-sizing: border-box;
      border: 1px solid #9ca3af;
      border-radius: 6px;
      padding: 6px 8px;
      font-size: 12px;
    }
    #t2m-controls .t2m-actions {
      margin-top: 8px;
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    #t2m-controls button {
      border: 1px solid #9ca3af;
      background: #f8fafc;
      border-radius: 6px;
      padding: 4px 8px;
      font-size: 12px;
      cursor: pointer;
    }
    #t2m-controls .t2m-tip {
      margin-top: 8px;
      font-size: 11px;
      color: #374151;
      line-height: 1.3;
    }
    #t2m-controls .t2m-checkbox {
      margin-top: 8px;
      font-size: 12px;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    svg#mindmap g.markmap-node.t2m-highlight circle {
      stroke: #f59e0b !important;
      stroke-width: 3px !important;
    }
    svg#mindmap g.markmap-node.t2m-focus circle {
      stroke: #2563eb !important;
      stroke-width: 3px !important;
      fill: #dbeafe !important;
    }
    svg#mindmap g.markmap-node.t2m-dim,
    svg#mindmap g.markmap-node.t2m-dim text,
    svg#mindmap g.markmap-node.t2m-dim circle {
      opacity: 0.2 !important;
    }
    svg#mindmap path.t2m-dim-link {
      opacity: 0.1 !important;
    }
  `;
  document.head.appendChild(style);

  const panel = document.createElement("div");
  panel.id = "t2m-controls";
  panel.innerHTML = `
    <h3>tree2mindmap controls</h3>
    <label for="t2m-highlight-input">Highlight nodes (comma-separated)</label>
    <input id="t2m-highlight-input" type="text" placeholder="e.g. src, README.md" />
    <label for="t2m-focus-input">Focus nodes (comma-separated)</label>
    <input id="t2m-focus-input" type="text" placeholder="Only these stay fully visible" />
    <label class="t2m-checkbox"><input id="t2m-dim-toggle" type="checkbox" checked /> Dim non-focused nodes</label>
    <div class="t2m-actions">
      <button id="t2m-apply-btn" type="button">Apply</button>
      <button id="t2m-clear-btn" type="button">Clear</button>
    </div>
    <div class="t2m-tip">Tip: click a node to focus it. Use Ctrl/Cmd+click to add/remove multiple focus nodes.</div>
  `;
  document.body.appendChild(panel);

  const highlightInput = panel.querySelector("#t2m-highlight-input");
  const focusInput = panel.querySelector("#t2m-focus-input");
  const dimToggle = panel.querySelector("#t2m-dim-toggle");
  const applyBtn = panel.querySelector("#t2m-apply-btn");
  const clearBtn = panel.querySelector("#t2m-clear-btn");
  const svg = document.querySelector("svg#mindmap");

  const state = { highlightTerms: [], focusTerms: [] };

  const splitTerms = (value) =>
    value
      .split(",")
      .map((term) => term.trim())
      .filter(Boolean);

  const lowerSet = (terms) => new Set(terms.map((term) => term.toLowerCase()));

  const getNodeLabel = (node) => {
    const data = node?.__data__;
    const content = data?.data?.content ?? data?.content ?? node?.textContent ?? "";
    return String(content).replace(/\\s+/g, " ").trim();
  };

  const getNodes = () => Array.from(document.querySelectorAll("svg#mindmap g.markmap-node"));
  const getLinks = () => Array.from(document.querySelectorAll("svg#mindmap path"));

  const isMatch = (label, lowerTerms) => {
    if (!label || !lowerTerms.size) return false;
    const lower = label.toLowerCase();
    for (const term of lowerTerms) {
      if (lower.includes(term)) return true;
    }
    return false;
  };

  const applyStyles = () => {
    const highlightTerms = lowerSet(state.highlightTerms);
    const focusTerms = lowerSet(state.focusTerms);
    const shouldDim = dimToggle.checked && focusTerms.size > 0;

    getNodes().forEach((node) => {
      const label = getNodeLabel(node);
      const highlighted = isMatch(label, highlightTerms);
      const focused = isMatch(label, focusTerms);
      node.classList.toggle("t2m-highlight", highlighted);
      node.classList.toggle("t2m-focus", focused);
      node.classList.toggle("t2m-dim", shouldDim && !focused);
    });

    getLinks().forEach((link) => {
      const data = link?.__data__;
      const src = String(data?.source?.data?.content ?? data?.source?.content ?? "").toLowerCase();
      const dst = String(data?.target?.data?.content ?? data?.target?.content ?? "").toLowerCase();
      let connectedToFocus = false;
      for (const term of focusTerms) {
        if (src.includes(term) || dst.includes(term)) {
          connectedToFocus = true;
          break;
        }
      }
      link.classList.toggle("t2m-dim-link", shouldDim && !connectedToFocus);
    });
  };

  const syncStateFromInputs = () => {
    state.highlightTerms = splitTerms(highlightInput.value);
    state.focusTerms = splitTerms(focusInput.value);
    applyStyles();
  };

  const refreshNodeBindings = () => {
    getNodes().forEach((node) => {
      node.style.cursor = "pointer";
      if (node.dataset.t2mBound === "1") return;
      node.dataset.t2mBound = "1";
      node.addEventListener("click", (event) => {
        event.stopPropagation();
        const label = getNodeLabel(node);
        if (!label) return;
        const focusTerms = splitTerms(focusInput.value);
        const index = focusTerms.findIndex((term) => term.toLowerCase() === label.toLowerCase());

        if (event.ctrlKey || event.metaKey) {
          if (index >= 0) focusTerms.splice(index, 1);
          else focusTerms.push(label);
        } else {
          focusTerms.length = 0;
          focusTerms.push(label);
        }

        focusInput.value = focusTerms.join(", ");
        syncStateFromInputs();
      });
    });
  };

  applyBtn.addEventListener("click", syncStateFromInputs);
  clearBtn.addEventListener("click", () => {
    highlightInput.value = "";
    focusInput.value = "";
    state.highlightTerms = [];
    state.focusTerms = [];
    applyStyles();
  });
  highlightInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") syncStateFromInputs();
  });
  focusInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") syncStateFromInputs();
  });
  dimToggle.addEventListener("change", applyStyles);

  refreshNodeBindings();
  syncStateFromInputs();

  let refreshScheduled = false;
  new MutationObserver(() => {
    if (refreshScheduled) return;
    refreshScheduled = true;
    requestAnimationFrame(() => {
      refreshScheduled = false;
      refreshNodeBindings();
      applyStyles();
    });
  }).observe(svg, { childList: true, subtree: true });
})();
</script>
"""
    html = html.replace("</body>", f"{controls_script}\n</body>")
    html_path.write_text(html, encoding="utf-8")
PYEOF
        echo "Enhanced: $OUT_HTML"
    fi
else
    echo "Error: Failed to generate Markdown."
    exit 1
fi
