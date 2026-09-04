/* =========================================================
   ZAH EDITOR, the package

   Zah's on-page click-to-edit editor and element builder, served from one
   installed engine instead of a copy pasted into each site. The engine is
   the zah-editor skill's template with CFG read from window.ZAH_EDITOR_CFG,
   plus one addition: it injects its own toolbar markup, so a page needs no
   HTML at all. Zero brand colours by design; never restyle it.

   ONE ENTRY POINT:

     const zahEditor = require('zah-editor');
     zahEditor.mount(app);            // serves /zah-editor/zah-editor.js and .css

   On each page, in <head>:
     <link rel="stylesheet" href="/zah-editor/zah-editor.css">
   and at the end of <body>, after the content and before ZAH Site MCP's bridge:
     <script>
       window.ZAH_EDITOR_CFG = {
         root: "main",
         storageKey: "new-vision-home-v1",           // unique per page
         adminHash: "<sha256 of email.lower():password>",
         editSelector: [...], widgetSelector: [...] // optional
       };
     </script>
     <script src="/zah-editor/zah-editor.js"></script>
     <script src="/zah-site/publish.js"></script>   // Site MCP makes Save publish

   Saves go to localStorage; ZAH Site MCP's publish bridge is what makes a
   Save reach every visitor. Without it the editor still works, in one
   browser only, exactly as the skill describes.
   ========================================================= */
const path = require('path');

const PREFIX = '/zah-editor';

function mount(app, cfg = {}) {
  if (!app || typeof app.get !== 'function') throw new Error('zah-editor: mount(app) needs an Express app');
  const prefix = cfg.prefix || PREFIX;
  const send = (file, type) => (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.type(type).sendFile(path.join(__dirname, 'public', file));
  };
  app.get(`${prefix}/zah-editor.js`, send('zah-editor.js', 'application/javascript'));
  app.get(`${prefix}/zah-editor.css`, send('zah-editor.css', 'text/css'));
  console.log(`[zah-editor] serving ${prefix}/zah-editor.js and .css`);
  return { prefix };
}

module.exports = { mount, PREFIX };
