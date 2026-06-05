import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Transformer } from 'markmap-lib';

// ---------------------------------------------------------------------------
// CLI parsing: node render.mjs <input.md> <output.html> [--online]
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);
const ONLINE = argv.includes('--online');
const positional = argv.filter((a) => !a.startsWith('--'));
const [inputFile, outputFile] = positional;

if (!inputFile || !outputFile) {
  console.error('Usage: node render.mjs <input.md> <output.html> [--online]');
  process.exit(1);
}

// Pinned CDN URLs for --online mode. Must match the installed versions so the
// generated HTML behaves identically online and offline.
const CDN = {
  d3: 'https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js',
  markmapView: 'https://cdn.jsdelivr.net/npm/markmap-view@0.18.12/dist/browser/index.js',
};

// Serialize data for inlining inside a <script> tag. Escaping "<" prevents a
// "</script>" sequence in any node content from terminating the tag early.
function safeJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
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

// The browser-side controller. Kept as a plain function so we can stringify it
// into the page; it runs after d3 + markmap-view have loaded.
function clientScript() {
  // -- Centralized class names ---------------------------------------------
  // markmap-view renders nodes as <g class="markmap-node"> and links as
  // <path class="markmap-link"> (see the CSS block, the single place those
  // markmap class names are referenced). Our own focus classes below are
  // namespaced so they never collide with markmap's internal "markmap-highlight".
  var CLS = { focus: 'mm-focus', ancestor: 'mm-focus-ancestor', linkFocus: 'mm-focus-link' };

  var Markmap = window.markmap.Markmap;
  var root = window.__MM_ROOT__;
  // Frontmatter markmap options (initialExpandLevel, colorFreezeLevel, spacing,
  // ...) are passed through so large trees open collapsed and reveal on focus.
  var opts = Object.assign({ autoFit: true }, window.__MM_OPTS__ || {});
  var mm = Markmap.create('#mindmap', opts, root);

  var mindmapEl = document.getElementById('mindmap');
  var searchInput = document.getElementById('search');
  var statsEl = document.getElementById('search-stats');
  var pathBox = document.getElementById('path-box');
  var pathDisplay = document.getElementById('path-display');
  var copyBtn = document.getElementById('copy-path');
  var diag = document.getElementById('diagnostics');

  var state = {
    selectedPaths: new Set(),
    searchMatches: [],
    searchIndex: -1,
    dimEnabled: false,  // off by default; toggled via Dim button or ?dim=1
  };

  // -- Path <-> node map (stable identity by full relative path) -----------
  // markmap clones child nodes during initialization, so we must walk AFTER
  // Markmap.create(); the objects we capture here are the same ones bound to
  // the DOM (findElement matches by object identity).
  var pathMap = new Map();
  function walk(node, parentPath) {
    var relPath = '';
    var match = node.content && node.content.match(/#path=([^"\)]+)/);
    if (match) {
      relPath = match[1];
    } else {
      var plain = (node.content || '').replace(/<[^>]*>/g, '').trim();
      relPath = parentPath ? parentPath + '/' + plain : plain;
    }
    node.data = Object.assign({}, node.data, { relPath: relPath });
    pathMap.set(relPath, node);
    if (node.children) node.children.forEach(function (c) { walk(c, relPath); });
  }
  walk(root, '');
  if (diag) diag.textContent = 'Nodes: ' + pathMap.size;

  // -- Expand ancestor folders so a deep node is actually in the DOM -------
  // markmap stores fold state on node.payload.fold (1 = folded). We clear it
  // along the ancestor chain, then re-render once.
  function ancestorPaths(path) {
    var parts = path.split('/');
    var acc = [];
    var out = [];
    for (var i = 0; i < parts.length - 1; i++) {
      acc.push(parts[i]);
      out.push(acc.join('/'));
    }
    return out;
  }

  // Clear the fold flag on every ancestor of each target so the targets are
  // present in the rendered DOM. We fire renderData() but do NOT await it:
  // markmap updates the DOM/layout synchronously and only the enter/exit
  // *animation* is async (gated on requestAnimationFrame). Awaiting it is both
  // unnecessary and fragile. Returns true if anything was expanded.
  function revealPaths(paths) {
    var changed = false;
    function unfold(node) {
      if (node && node.payload && node.payload.fold) {
        node.payload.fold = 0;
        changed = true;
      }
    }
    // The root must be open for any descendant to be shown. Relative paths
    // never include the root segment, so unfold it explicitly.
    unfold(root);
    paths.forEach(function (p) {
      ancestorPaths(p).forEach(function (ap) { unfold(pathMap.get(ap)); });
    });
    if (changed) mm.renderData();
    return changed;
  }

  // -- Apply / clear visual focus on the SVG -------------------------------
  function clearFocusClasses() {
    var sel = '.' + CLS.focus + ', .' + CLS.ancestor + ', .' + CLS.linkFocus;
    mindmapEl.querySelectorAll(sel).forEach(function (el) {
      el.classList.remove(CLS.focus, CLS.ancestor, CLS.linkFocus);
    });
  }

  function markNode(path, cls) {
    var node = pathMap.get(path);
    if (!node) return;
    var hit = mm.findElement(node); // -> { data, g } | undefined
    if (!hit || !hit.g) return;
    hit.g.classList.add(cls);
    // The incoming link is a sibling <path> rendered just before the node <g>.
    var link = hit.g.previousSibling;
    while (link && link.tagName !== 'path') link = link.previousSibling;
    if (link) link.classList.add(CLS.linkFocus);
  }

  // Idempotent: reflect current state onto the DOM. Safe to call any time,
  // including repeatedly after markmap re-renders (which wipe node classes).
  function applyFocusVisuals() {
    clearFocusClasses();

    if (state.selectedPaths.size === 0) {
      mindmapEl.classList.remove('dimmed');
      if (statsEl) statsEl.textContent = '';
      if (pathBox) pathBox.classList.remove('visible');
      return;
    }

    if (state.dimEnabled) mindmapEl.classList.add('dimmed');
    else mindmapEl.classList.remove('dimmed');

    if (statsEl && state.searchMatches.length > 0) {
      statsEl.textContent = 'Match ' + (state.searchIndex + 1) + ' / ' + state.searchMatches.length;
    }

    state.selectedPaths.forEach(function (path) {
      markNode(path, CLS.focus);
      ancestorPaths(path).forEach(function (ap) { markNode(ap, CLS.ancestor); });
    });

    // Update path display in controls
    if (pathBox && pathDisplay) {
      pathDisplay.textContent = Array.from(state.selectedPaths).join('\n');
      pathBox.classList.add('visible');
    }
  }

  // markmap rebuilds node <g> elements on every render (expand/collapse/zoom),
  // discarding our focus classes. Re-apply them whenever the node group's
  // children change. We only watch childList (not attributes) so our own
  // class edits don't retrigger the observer.
  var reapplyTimer = null;
  function scheduleReapply() {
    if (reapplyTimer || state.selectedPaths.size === 0) return;
    reapplyTimer = setTimeout(function () {
      reapplyTimer = null;
      applyFocusVisuals();
    }, 30);
  }
  try {
    new MutationObserver(scheduleReapply).observe(mm.g.node(), {
      childList: true,
      subtree: true,
    });
  } catch (_) {}

  // -- Focus a set of paths: dim immediately, then reveal + zoom -----------
  // Dimming is applied synchronously up front so it never depends on the
  // timing of markmap's async re-render; the observer fills in node
  // highlights once expanded nodes appear in the DOM.
  function focusPaths(paths, opts) {
    opts = opts || {};
    var known = paths.filter(function (p) { return pathMap.has(p); });
    if (known.length === 0) return;
    known.forEach(function (p) { state.selectedPaths.add(p); });
    applyFocusVisuals();        // dim + mark already-visible nodes immediately
    revealPaths(known);         // expand ancestors (fires async render)
    applyFocusVisuals();        // mark newly-appended (entering) nodes
    var first = pathMap.get(known[0]);
    if (first) mm.setHighlight(first);
    if (opts.zoom !== false) {
      // Defer zoom so layout for freshly-revealed nodes has settled.
      setTimeout(function () {
        if (known.length === 1 && first) mm.ensureVisible(first);
        else mm.fit();
        setTimeout(applyFocusVisuals, 60);
      }, 0);
    }
  }

  // -- URL parameters: ?focus=a,b,c  ?dim=1  ?opacity=0.3 ------------------
  function applyUrlParams() {
    var query = window.location.search.substring(1);
    if (!query) return;
    var targets = [];
    var dimParam = null;
    var opacityParam = null;
    query.split('&').forEach(function (pair) {
      var idx = pair.indexOf('=');
      var key = idx === -1 ? pair : pair.substring(0, idx);
      var val = idx === -1 ? '' : pair.substring(idx + 1);
      if (key === 'focus' && val) {
        val.split(',').forEach(function (t) {
          var d = decodeURIComponent(t.replace(/\+/g, ' ')).trim();
          if (d) targets.push(d.toLowerCase());
        });
      } else if (key === 'dim') {
        dimParam = val;
      } else if (key === 'opacity') {
        opacityParam = parseFloat(decodeURIComponent(val));
      }
    });

    if (dimParam !== null) {
      // dim=0 / dim=false / dim=no -> highlight only, no dimming
      state.dimEnabled = !/^(0|false|no|off)$/i.test(dimParam);
      applyDimBtn();
    }
    if (opacityParam !== null && !isNaN(opacityParam)) {
      mindmapEl.style.setProperty('--dim-opacity', String(opacityParam));
    }

    if (targets.length === 0) return;
    var matched = [];
    pathMap.forEach(function (node, path) {
      var lp = path.toLowerCase();
      if (targets.some(function (t) { return lp.indexOf(t) !== -1; })) matched.push(path);
    });
    if (matched.length > 0) {
      // Defer one tick so the initial render has laid out the tree.
      setTimeout(function () { focusPaths(matched); }, 300);
    }
  }

  // -- Search box ----------------------------------------------------------
  function runSearch(val) {
    state.searchMatches = [];
    state.searchIndex = -1;
    state.selectedPaths.clear();
    if (!val) { applyFocusVisuals(); return; }
    pathMap.forEach(function (node, path) {
      if (path.toLowerCase().indexOf(val) !== -1) {
        state.searchMatches.push(path);
        state.selectedPaths.add(path);
      }
    });
    if (state.searchMatches.length > 0) state.searchIndex = 0;
    applyFocusVisuals();
  }

  if (searchInput) {
    searchInput.addEventListener('input', function (e) {
      runSearch(e.target.value.toLowerCase().trim());
    });
    searchInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && state.searchMatches.length > 0) {
        state.searchIndex = (state.searchIndex + 1) % state.searchMatches.length;
        var path = state.searchMatches[state.searchIndex];
        focusPaths([path], { zoom: true });
      } else if (e.key === 'Escape') {
        e.target.blur();
      }
    });
  }

  // markmap nodes are rendered as <a href="#path=..."> elements. Any modifier
  // key click (Ctrl/Cmd → new tab, Shift → new window) or plain anchor click
  // would navigate away. Block ALL anchor defaults inside the SVG in the
  // capture phase so our selection logic is the only thing that fires.
  mindmapEl.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a') : null;
    if (a || e.ctrlKey || e.metaKey || e.shiftKey) e.preventDefault();
  }, true);

  // -- Click selection (Ctrl/Cmd+Click = multi-select; plain click = single) --
  mm.svg.on('click', function (e) {
    var target = e.target;
    while (target && !target.__data__) target = target.parentElement;
    var node = target ? target.__data__ : null;
    if (!node || !node.data || !node.data.relPath) return;
    var path = node.data.relPath;
    if (!(e.ctrlKey || e.metaKey)) state.selectedPaths.clear();
    if (state.selectedPaths.has(path)) state.selectedPaths.delete(path);
    else state.selectedPaths.add(path);
    applyFocusVisuals();
  });

  // -- Global keyboard shortcuts ------------------------------------------
  function clearAll() {
    state.selectedPaths.clear();
    state.searchMatches = [];
    state.searchIndex = -1;
    if (searchInput) searchInput.value = '';
    mm.setHighlight(null);
    applyFocusVisuals();
  }

  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      clearAll();
    } else if (e.key === '/' && document.activeElement !== searchInput) {
      e.preventDefault();
      if (searchInput) searchInput.focus();
    }
  });

  // -- Copy-path button ---------------------------------------------------
  if (copyBtn) {
    copyBtn.addEventListener('click', function () {
      var text = pathDisplay ? pathDisplay.textContent : '';
      if (!text) return;
      try {
        navigator.clipboard.writeText(text).then(function () {
          copyBtn.textContent = 'Copied!';
          copyBtn.classList.add('copied');
          setTimeout(function () {
            copyBtn.textContent = 'Copy path';
            copyBtn.classList.remove('copied');
          }, 1500);
        });
      } catch (_) {
        // Fallback for browsers without clipboard API (e.g. file:// in some configs)
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;opacity:0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        copyBtn.textContent = 'Copied!';
        copyBtn.classList.add('copied');
        setTimeout(function () {
          copyBtn.textContent = 'Copy path';
          copyBtn.classList.remove('copied');
        }, 1500);
      }
    });
  }

  // -- Dim toggle ----------------------------------------------------------
  var dimBtn = document.getElementById('dim-toggle');
  function applyDimBtn() {
    if (dimBtn) dimBtn.classList.toggle('active', state.dimEnabled);
  }
  if (dimBtn) {
    dimBtn.addEventListener('click', function () {
      state.dimEnabled = !state.dimEnabled;
      applyDimBtn();
      applyFocusVisuals();
    });
  }

  // -- Dark mode toggle (persisted) ---------------------------------------
  var darkBtn = document.getElementById('dark-toggle');
  function applyTheme(dark) {
    document.documentElement.classList.toggle('dark', dark);
    if (darkBtn) darkBtn.textContent = dark ? '☀ Light' : '☾ Dark';
  }
  var saved = null;
  try { saved = window.localStorage.getItem('t2m-dark'); } catch (_) {}
  applyTheme(saved === '1');
  if (darkBtn) {
    darkBtn.addEventListener('click', function () {
      var dark = !document.documentElement.classList.contains('dark');
      applyTheme(dark);
      try { window.localStorage.setItem('t2m-dark', dark ? '1' : '0'); } catch (_) {}
    });
  }

  applyUrlParams();
}

async function render() {
  const markdown = await readFile(inputFile, 'utf8');
  const transformer = new Transformer();
  const { root, frontmatter } = transformer.transform(markdown);
  const mmOpts = (frontmatter && frontmatter.markmap) || {};

  let d3Tag, viewTag;
  if (ONLINE) {
    d3Tag = '<script src="' + CDN.d3 + '"></script>';
    viewTag = '<script src="' + CDN.markmapView + '"></script>';
  } else {
    const d3 = await getAsset('d3/dist/d3.min.js');
    const markmapView = await getAsset('markmap-view/dist/browser/index.js');
    d3Tag = '<script>' + d3 + '</script>';
    viewTag = '<script>' + markmapView + '</script>';
  }

  const css = [
    '* { margin: 0; padding: 0; box-sizing: border-box; }',
    'body, html { width: 100%; height: 100%; overflow: hidden; font-family: sans-serif; }',
    '#mindmap { --dim-opacity: 0.35; width: 100vw; height: 100vh; transition: opacity 0.3s ease; }',
    '#mindmap.dimmed .markmap-node, #mindmap.dimmed .markmap-link { opacity: var(--dim-opacity) !important; transition: opacity 0.25s ease; }',
    '#mindmap.dimmed .markmap-node.mm-focus, #mindmap.dimmed .markmap-node.mm-focus-ancestor, #mindmap.dimmed .markmap-link.mm-focus-link { opacity: 1 !important; }',
    '#mindmap .markmap-node.mm-focus > circle { fill: #ff0 !important; stroke: #f00 !important; stroke-width: 3px; }',
    // Controls panel (light default)
    '#controls { position: fixed; top: 20px; right: 20px; z-index: 1000; display: flex; flex-direction: column; gap: 8px; background: rgba(255,255,255,0.96); padding: 14px; border-radius: 8px; box-shadow: 0 4px 15px rgba(0,0,0,0.3); border: 1px solid #bbb; }',
    'input#search { padding: 8px 12px; border: 2px solid #007bff; border-radius: 4px; width: 280px; font-size: 14px; outline: none; background: #fff; color: #111; }',
    '#dark-toggle, #dim-toggle { cursor: pointer; font-size: 12px; padding: 4px 10px; border: 1px solid #888; border-radius: 4px; background: #f3f3f3; color: #222; }',
    '#dim-toggle.active { background: #007bff; color: #fff; border-color: #0056b3; }',
    '.help { font-size: 12px; color: #333; line-height: 1.5; }',
    '.stats { font-size: 11px; color: #007bff; font-weight: bold; min-height: 14px; }',
    '#path-box { display: none; flex-direction: column; gap: 4px; }',
    '#path-box.visible { display: flex; }',
    '#path-display { font-size: 11px; font-family: monospace; color: #333; background: #f5f5f5; border: 1px solid #ccc; border-radius: 3px; padding: 5px 7px; max-width: 280px; max-height: 80px; overflow-y: auto; word-break: break-all; white-space: pre-wrap; line-height: 1.45; }',
    '#copy-path { align-self: flex-start; cursor: pointer; font-size: 11px; padding: 3px 10px; border: 1px solid #888; border-radius: 4px; background: #f3f3f3; color: #222; }',
    '#copy-path.copied { border-color: #22a83a; color: #22a83a; }',
    '#diagnostics { position: fixed; bottom: 10px; left: 10px; font-size: 10px; color: #888; background: rgba(255,255,255,0.7); padding: 5px; pointer-events: none; }',
    // Dark theme overrides
    'html.dark { background: #27272a; }',
    'html.dark #controls { background: rgba(40,40,44,0.96); border-color: #555; box-shadow: 0 4px 15px rgba(0,0,0,0.6); }',
    'html.dark input#search { background: #1e1e22; color: #eee; border-color: #4ea1ff; }',
    'html.dark #dark-toggle, html.dark #dim-toggle, html.dark #copy-path { background: #3a3a40; color: #eee; border-color: #666; }',
    'html.dark #dim-toggle.active { background: #4ea1ff; color: #111; border-color: #4ea1ff; }',
    'html.dark #copy-path.copied { border-color: #4ade80; color: #4ade80; }',
    'html.dark #path-display { background: #1e1e22; color: #ccc; border-color: #555; }',
    'html.dark .help { color: #ccc; }',
    'html.dark #diagnostics { background: rgba(40,40,44,0.7); color: #aaa; }',
    'html.dark #mindmap { background: #27272a; }',
    'html.dark .markmap-node text { fill: #eee; }',
  ].join('\n');

  const controllerSrc = '(' + clientScript.toString() + ')();';

  const html = [
    '<!DOCTYPE html>',
    '<html>',
    '<head>',
    '<meta charset="UTF-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
    '<title>tree2markmap</title>',
    '<style>',
    css,
    '</style>',
    '</head>',
    '<body>',
    '<div id="controls">',
    '  <input type="text" id="search" placeholder="Search paths... ( / )" autocomplete="off">',
    '  <div id="search-stats" class="stats"></div>',
    '  <div id="path-box">',
    '    <div id="path-display"></div>',
    '    <button id="copy-path" type="button">Copy path</button>',
    '  </div>',
    '  <div style="display:flex;gap:6px;">',
    '    <button id="dim-toggle" type="button">Dim</button>',
    '    <button id="dark-toggle" type="button">☾ Dark</button>',
    '  </div>',
    '  <div class="help"><b>Click</b>: select &middot; <b>Ctrl+Click</b>: multi-select &middot; <b>/</b>: search &middot; <b>Enter</b>: cycle &middot; <b>Esc</b>: clear</div>',
    '</div>',
    '<div id="diagnostics"></div>',
    '<svg id="mindmap"></svg>',
    d3Tag,
    viewTag,
    '<script>window.__MM_ROOT__ = ' + safeJson(root) + ';</script>',
    '<script>window.__MM_OPTS__ = ' + safeJson(mmOpts) + ';</script>',
    '<script>' + controllerSrc + '</script>',
    '</body>',
    '</html>',
  ].join('\n');

  await writeFile(outputFile, html);
  console.log('Generated: ' + outputFile + (ONLINE ? ' (online/CDN)' : ' (self-contained)'));
}

render().catch(function (err) {
  console.error(err);
  process.exit(1);
});
