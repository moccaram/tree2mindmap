import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Transformer } from 'markmap-lib';

const [, , inputFile, outputFile] = process.argv;

if (!inputFile || !outputFile) {
  console.error('Usage: node render.mjs <input.md> <output.html>');
  process.exit(1);
}

async function getAsset(path) {
  const fullPath = resolve(process.cwd(), 'node_modules', path);
  try {
    return await readFile(fullPath, 'utf8');
  } catch (err) {
    console.error(`Could not find asset: ${path}`);
    return '';
  }
}

async function render() {
  const markdown = await readFile(inputFile, 'utf8');
  const transformer = new Transformer();
  const { root } = transformer.transform(markdown);

  const d3 = await getAsset('d3/dist/d3.min.js');
  const markmapView = await getAsset('markmap-view/dist/browser/index.js');

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>tree2mindmap</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body, html { width: 100%; height: 100%; overflow: hidden; font-family: sans-serif; }
#mindmap { width: 100vw; height: 100vh; transition: opacity 0.3s ease; }
#mindmap.dimmed .markmap-node, #mindmap.dimmed .markmap-link { opacity: 0.15; }
#mindmap.dimmed .markmap-node.highlight, #mindmap.dimmed .markmap-node.highlight-ancestor, #mindmap.dimmed .markmap-link.highlight { opacity: 1; }
#controls { position: fixed; top: 20px; right: 20px; z-index: 1000; display: flex; flex-direction: column; gap: 10px; background: rgba(255, 255, 255, 0.8); padding: 10px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
input#search { padding: 8px 12px; border: 1px solid #ccc; border-radius: 4px; width: 200px; }
.help { font-size: 12px; color: #666; }
</style>
</head>
<body>
<div id="controls">
  <input type="text" id="search" placeholder="Search (Contains match)..." autocomplete="off">
  <div class="help"><b>Ctrl+Click</b>: Multi-select<br><b>Esc</b>: Clear selection<br><b>Enter</b>: Next match</div>
</div>
<svg id="mindmap"></svg>
<script>${d3}</script>
<script>${markmapView}</script>
<script>
const { markmap: { Markmap } } = window;
const root = ${JSON.stringify(root)};
const mm = Markmap.create('#mindmap', null, root);

const state = { selectedPaths: new Set(), searchMatches: [], searchIndex: -1 };
const pathMap = new Map();

function walk(node, parentPath = '') {
  const match = node.v && node.v.match(/#path=([^)]+)/);
  const relPath = match ? match[1] : (parentPath ? \`\${parentPath}/\${node.v}\` : node.v);
  node.data = { ...node.data, relPath };
  pathMap.set(relPath, node);
  if (node.c) node.c.forEach(child => walk(child, relPath));
}
walk(root);

function updateHighlights() {
  const svg = document.querySelector('#mindmap');
  document.querySelectorAll('.highlight, .highlight-ancestor').forEach(el => el.classList.remove('highlight', 'highlight-ancestor'));
  if (state.selectedPaths.size === 0) { svg.classList.remove('dimmed'); return; }
  svg.classList.add('dimmed');
  state.selectedPaths.forEach(path => {
    const node = pathMap.get(path);
    if (!node) return;
    const el = mm.findElement(node);
    if (el) {
      el.classList.add('highlight');
      const link = el.previousSibling;
      if (link && link.tagName === 'path') link.classList.add('highlight');
    }
    const parts = path.split('/');
    for (let i = 1; i < parts.length; i++) {
      const ancestorPath = parts.slice(0, i).join('/');
      const ancestorNode = pathMap.get(ancestorPath);
      if (ancestorNode) {
        const ancestorEl = mm.findElement(ancestorNode);
        if (ancestorEl) ancestorEl.classList.add('highlight-ancestor');
      }
    }
  });
}

const params = new URLSearchParams(window.location.search);
const focusParam = params.get('focus');
if (focusParam) {
  const targets = focusParam.split(',');
  const matchedPaths = [];
  pathMap.forEach((node, path) => { if (targets.some(t => path.includes(t))) matchedPaths.push(path); });
  setTimeout(() => {
    const nodes = matchedPaths.map(p => pathMap.get(p)).filter(Boolean);
    if (nodes.length > 0) {
      nodes.forEach(n => mm.setHighlight(n));
      if (nodes.length === 1) mm.ensureVisible(nodes[0]); else mm.fit();
      matchedPaths.forEach(p => state.selectedPaths.add(p));
      updateHighlights();
    }
  }, 500);
}

const searchInput = document.querySelector('#search');
searchInput.addEventListener('input', (e) => {
  const val = e.target.value.toLowerCase();
  state.searchMatches = []; state.searchIndex = -1;
  if (!val) { state.selectedPaths.clear(); updateHighlights(); return; }
  pathMap.forEach((node, path) => { if (path.toLowerCase().includes(val) || (node.v && node.v.toLowerCase().includes(val))) state.searchMatches.push(path); });
  if (state.searchMatches.length > 0) { state.selectedPaths.clear(); state.searchMatches.forEach(p => state.selectedPaths.add(p)); updateHighlights(); }
});

searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && state.searchMatches.length > 0) {
    state.searchIndex = (state.searchIndex + 1) % state.searchMatches.length;
    const path = state.searchMatches[state.searchIndex];
    const node = pathMap.get(path);
    if (node) mm.ensureVisible(node);
  }
});

mm.svg.on('click', (e) => {
  const node = e.target.__data__;
  if (node && node.data && node.data.relPath) {
    const path = node.data.relPath;
    if (!(e.ctrlKey || e.metaKey)) state.selectedPaths.clear();
    if (state.selectedPaths.has(path)) state.selectedPaths.delete(path); else state.selectedPaths.add(path);
    updateHighlights();
  }
});

window.addEventListener('keydown', (e) => { if (e.key === 'Escape') { state.selectedPaths.clear(); searchInput.value = ''; updateHighlights(); } });
</script>
</body>
</html>`;

  await writeFile(outputFile, html);
  console.log(`Generated: ${outputFile}`);
}

render().catch(err => {
  console.error(err);
  process.exit(1);
});
