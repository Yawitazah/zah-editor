const express = require('express');
const { mount } = require('..');
const assert = (c, m) => { if (!c) { console.error('FAIL:', m); process.exit(1); } console.log('ok  ', m); };
(async () => {
  const app = express();
  mount(app);
  const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}`;
  let r = await fetch(base + '/zah-editor/zah-editor.js'); const js = await r.text();
  assert(r.ok && r.headers.get('content-type').includes('javascript') && r.headers.get('cache-control') === 'no-cache', 'engine js served, no-cache');
  assert(js.includes('window.ZAH_EDITOR_CFG') && js.includes('edToggle') && js.includes('ensureToolbar'), 'engine reads the page CFG and injects its toolbar');
  try { new Function(js); } catch (e) { assert(false, 'engine parses: ' + e.message); }
  assert(true, 'engine parses');
  r = await fetch(base + '/zah-editor/zah-editor.css'); const css = await r.text();
  assert(r.ok && css.includes('#edToggle') && !/#[0-9a-f]{6}/i.test(css.replace(/#(111827|4b5563|6b7280|9ca3af|fff|000)\b/gi, '')), 'css served, monochrome only');
  srv.close();
  console.log('\nALL PASSED');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
