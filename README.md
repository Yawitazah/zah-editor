# Zah Editor (package)

Zah's on-page click-to-edit editor and element builder, served from one
installed engine instead of a copy pasted into each site. Monochrome by
design: never restyle it with site colours.

The paste-in version for static pages (GitHub Pages proposals) still lives in
the `zah-editor` skill's `template.html`. This package is for sites with an
Express server, which is every ZAH client site.

```bash
npm i github:Yawitazah/zah-editor
```

```js
const zahEditor = require('zah-editor');
zahEditor.mount(app);   // serves /zah-editor/zah-editor.js and .css
```

On each page:

```html
<head> ... <link rel="stylesheet" href="/zah-editor/zah-editor.css"> </head>
<body>
  <main> ...the page... </main>
  <script>
    window.ZAH_EDITOR_CFG = {
      root: "main",
      storageKey: "new-vision-home-v1",            // unique per page
      adminHash: "<sha256 of email.lower():password>",
      editSelector: ["h1","h2","h3","h4","p","li","blockquote","figcaption","b","strong"],   // optional
      widgetSelector: ["img","video",".ed-video","a.btn","button",".card","section"],       // optional
    };
  </script>
  <script src="/zah-editor/zah-editor.js"></script>
  <script src="/zah-site/publish.js"></script>   <!-- ZAH Site MCP: Save publishes -->
</body>
```

No editor markup on the page: the engine injects its own pencil, bar and
bubbles. Hash a login with
`python -c "import hashlib;print(hashlib.sha256('email:password'.encode()).hexdigest())"`.

## What it does

Pencil (bottom right) → admin login → click any text to edit it, click any
image, button, card or section to move, duplicate, delete, resize (% only),
reshape, recolour, align, replace, relink. Undo/redo, Ctrl+Z/Y/S, Delete/Esc.
Save writes to localStorage; with ZAH Site MCP's bridge loaded after it, Save
also publishes to the server for every visitor and Reset clears the server copy.

## Pages with dark sections

The dashed edit outlines are near-black. Add class `dark` to a dark section
(or use `.hero` / `.site-foot`) and the css lifts them to white.

## Test

`npm test`: engine served with no-cache, reads `ZAH_EDITOR_CFG`, injects its
toolbar, parses, css is monochrome.
