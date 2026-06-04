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
    console.error('Could not find asset: ' + path);
    return '';
  }
}

async function render() {
  const markdown = await readFile(inputFile, 'utf8');
  const transformer = new Transformer();
  const { root } = transformer.transform(markdown);

  const d3 = await getAsset('d3/dist/d3.min.js');
  const markmapView = await getAsset('markmap-view/dist/browser/index.js');

  const html = [
    '<!DOCTYPE html>',
    '<html>',
    '<head>',
    '<meta charset="UTF-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
    '<title>tree2markmap</title>',
    '<style>',
    '* { margin: 0; padding: 0; box-sizing: border-box; }',
    'body, html { width: 100%; height: 100%; overflow: hidden; font-family: sans-serif; }',
    '#mindmap { width: 100vw; height: 100vh; transition: opacity 0.3s ease; }',
    '#mindmap.dimmed .markmap-node, #mindmap.dimmed .markmap-link { opacity: 0.1; }',
    '#mindmap.dimmed .markmap-node.highlight, #mindmap.dimmed .markmap-node.highlight-ancestor, #mindmap.dimmed .markmap-link.highlight { opacity: 1; }',
    '#mindmap.dimmed .markmap-node.highlight circle { fill: #ff0 !important; stroke: #f00 !important; stroke-width: 3px; }',
    '#controls { position: fixed; top: 20px; right: 20px; z-index: 1000; display: flex; flex-direction: column; gap: 10px; background: rgba(255, 255, 255, 0.9); padding: 15px; border-radius: 8px; box-shadow: 0 4px 15px rgba(0,0,0,0.2); border: 1px solid #ddd; }',
    'input#search { padding: 8px 12px; border: 1px solid #ccc; border-radius: 4px; width: 250px; font-size: 14px; }',
    '.help { font-size: 12px; color: #444; line-height: 1.4; }',
    '.stats { font-size: 11px; color: #888; margin-top: 5px; }',
    '</style>',
    '</head>',
    '<body>',
    '<div id="controls">',
    '  <input type="text" id="search" placeholder="Search paths (e.g. src/utils)..." autocomplete="off">',
    '  <div id="search-stats" class="stats"></div>',
    '  <div class="help"><b>Ctrl+Click</b>: Multi-select / Toggle focus<br><b>Esc</b>: Clear all<br><b>Enter</b>: Cycle matches</div>',
    '</div>',
    '<svg id="mindmap"></svg>',
    '<script>' + d3 + '</script>',
    '<script>' + markmapView + '</script>',
    '<script>',
    'const { markmap: { Markmap } } = window;',
    'const root = ' + JSON.stringify(root) + ';',
    'const mm = Markmap.create("#mindmap", null, root);',
    'const state = { selectedPaths: new Set(), searchMatches: [], searchIndex: -1 };',
    'const pathMap = new Map();',
    'function walk(node, parentPath = "") {',
    '  const match = node.content && node.content.match(/#path=([^"]+)/);',
    '  const relPath = match ? match[1] : (parentPath ? parentPath + "/" + node.content : node.content);',
    '  node.data = Object.assign({}, node.data, { relPath: relPath });',
    '  pathMap.set(relPath, node);',
    '  if (node.children) node.children.forEach(function(child) { walk(child, relPath); });',
    '}',
    'walk(root);',
    'function updateUI() {',
    '  const svg = document.querySelector("#mindmap");',
    '  const stats = document.querySelector("#search-stats");',
    '  document.querySelectorAll(".highlight, .highlight-ancestor").forEach(function(el) { el.classList.remove("highlight", "highlight-ancestor"); });',
    '  if (state.selectedPaths.size === 0) { svg.classList.remove("dimmed"); stats.textContent = ""; return; }',
    '  svg.classList.add("dimmed");',
    '  if (state.searchMatches.length > 0) { stats.textContent = "Found " + state.searchMatches.length + " matches. " + (state.searchIndex >= 0 ? "Item " + (state.searchIndex + 1) : ""); }',
    '  state.selectedPaths.forEach(function(path) {',
    '    const node = pathMap.get(path);',
    '    if (!node) return;',
    '    const el = mm.findElement(node);',
    '    if (el) el.classList.add("highlight");',
    '    const parts = path.split("/");',
    '    for (let i = 1; i < parts.length; i++) {',
    '      const ancestorPath = parts.slice(0, i).join("/");',
    '      const ancestorNode = pathMap.get(ancestorPath);',
    '      if (ancestorNode) { const ancestorEl = mm.findElement(ancestorNode); if (ancestorEl) ancestorEl.classList.add("highlight-ancestor"); }',
    '    }',
    '  });',
    '}',
    'const params = new URLSearchParams(window.location.search);',
    'const focusParam = params.get("focus");',
    'if (focusParam) {',
    '  const targets = focusParam.split(",");',
    '  const matchedPaths = [];',
    '  pathMap.forEach(function(node, path) { if (targets.some(function(t) { return path.includes(t); })) matchedPaths.push(path); });',
    '  setTimeout(function() {',
    '    const nodes = matchedPaths.map(function(p) { return pathMap.get(p); }).filter(Boolean);',
    '    if (nodes.length > 0) {',
    '      nodes.forEach(function(n) { mm.setHighlight(n); });',
    '      if (nodes.length === 1) mm.ensureVisible(nodes[0]); else mm.fit();',
    '      matchedPaths.forEach(function(p) { state.selectedPaths.add(p); });',
    '      updateUI();',
    '    }',
    '  }, 600);',
    '}',
    'const searchInput = document.querySelector("#search");',
    'searchInput.addEventListener("input", function(e) {',
    '  const val = e.target.value.toLowerCase().trim();',
    '  state.searchMatches = []; state.searchIndex = -1; state.selectedPaths.clear();',
    '  if (!val) { updateUI(); return; }',
    '  pathMap.forEach(function(node, path) { if (path.toLowerCase().includes(val)) { state.searchMatches.push(path); state.selectedPaths.add(path); } });',
    '  updateUI();',
    '});',
    'searchInput.addEventListener("keydown", function(e) {',
    '  if (e.key === "Enter" && state.searchMatches.length > 0) {',
    '    state.searchIndex = (state.searchIndex + 1) % state.searchMatches.length;',
    '    const path = state.searchMatches[state.searchIndex];',
    '    const node = pathMap.get(path);',
    '    if (node) { mm.ensureVisible(node); mm.setHighlight(node); }',
    '    updateUI();',
    '  }',
    '});',
    'mm.svg.on("click", function(e) {',
    '  let target = e.target;',
    '  while (target && !target.__data__) target = target.parentElement;',
    '  const node = target ? target.__data__ : null;',
    '  if (node && node.data && node.data.relPath) {',
    '    const path = node.data.relPath;',
    '    if (!(e.ctrlKey || e.metaKey)) state.selectedPaths.clear();',
    '    if (state.selectedPaths.has(path)) state.selectedPaths.delete(path); else state.selectedPaths.add(path);',
    '    updateUI();',
    '  }',
    '});',
    'window.addEventListener("keydown", function(e) { if (e.key === "Escape") { state.selectedPaths.clear(); state.searchMatches = []; state.searchIndex = -1; searchInput.value = ""; updateUI(); } });',
    '</script>',
    '</body>',
    '</html>'
  ].join('\n');

  await writeFile(outputFile, html);
  console.log('Generated: ' + outputFile);
}

render().catch(function(err) {
  console.error(err);
  process.exit(1);
});
