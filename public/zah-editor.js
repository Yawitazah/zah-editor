/* ===== Zah Editor, engine (package build) =====
   The skill template with CFG read from window.ZAH_EDITOR_CFG, plus toolbar
   self-injection so a page needs no editor markup. Monochrome by design. */
(function ensureToolbar() {
  if (document.getElementById("edToggle")) return;
  var wrap = document.createElement("div");
  wrap.innerHTML =
    '<button type="button" id="edToggle" title="Edit this page">✎</button>' +
    '<div id="edBar" role="toolbar" aria-label="Editor actions">' +
    '<button type="button" class="ic" id="edUndo" title="Undo (Ctrl+Z)">↶</button>' +
    '<button type="button" class="ic" id="edRedo" title="Redo (Ctrl+Y)">↷</button>' +
    '<span class="sep"></span><span class="status" id="edStatus">Editing</span><span class="sep"></span>' +
    '<button type="button" class="primary" id="edSave">Save</button>' +
    '<button type="button" id="edReset">Reset</button>' +
    '<button type="button" id="edDone">Done</button></div>' +
    '<div id="edBubble" class="edbub" role="toolbar" aria-label="Formatting"></div>' +
    '<div id="edEl" class="edbub" role="toolbar" aria-label="Element controls"></div>';
  while (wrap.firstChild) document.body.appendChild(wrap.firstChild);
})();
(function () {
  "use strict";

  const CFG = Object.assign({
    root: "main",
    storageKey: "zah-page-edits-v1",
    adminHash: "",
    // A server that says yes or no to a login. ZAH Site MCP serves exactly
    // this path on every ZAH client site; when nothing answers there, the
    // page's own adminHash is used instead, so this default is safe anywhere.
    verifyUrl: "/zah-site/login",
    who: "ZAH Account",       // what the login prompt calls it
    editSelector: ["h1","h2","h3","h4","p","li","blockquote","figcaption","span.chip","b","strong"],
    widgetSelector: ["img","video",".ed-video","a.button","a.btn","button",".card",".panel",".widget","section"]
  }, window.ZAH_EDITOR_CFG || {});

  const root = document.querySelector(CFG.root);
  if (!root) return;
  const EDIT_SEL = CFG.editSelector.map(s => CFG.root + " " + s).join(", ");
  const WIDGET_SEL = CFG.widgetSelector.map(s => CFG.root + " " + s).join(", ");

  // Apply saved edits FIRST so later DOM reads see the edited page.
  try { const saved = localStorage.getItem(CFG.storageKey); if (saved) root.innerHTML = saved; } catch (e) {}

  let editing = false;
  let undoStack = [], redoStack = [], current = null, savedRange = null, dirty = false, typingTimer = null;
  const bubble = document.getElementById("edBubble");
  const statusEl = document.getElementById("edStatus");

  async function hashCreds(email, pw) {
    const bytes = new TextEncoder().encode(email.trim().toLowerCase() + ":" + pw);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
  }
  function editables() {
    const arr = [...root.querySelectorAll(EDIT_SEL)];
    return arr.filter(el => !arr.some(o => o !== el && o.contains(el)));
  }
  function setContentEditable(on) {
    editables().forEach(el => {
      if (on) { el.setAttribute("contenteditable", "true"); el.dataset.ed = "1"; }
      else { el.removeAttribute("contenteditable"); delete el.dataset.ed; }
    });
  }
  function snapshot() {
    const clone = root.cloneNode(true);
    clone.querySelectorAll("[contenteditable]").forEach(e => { if (e.getAttribute("contenteditable") !== "false") e.removeAttribute("contenteditable"); });
    clone.querySelectorAll("[data-ed]").forEach(e => e.removeAttribute("data-ed"));
    clone.querySelectorAll(".ed-sel, .ed-hov").forEach(e => e.classList.remove("ed-sel", "ed-hov"));
    return clone.innerHTML;
  }
  function applyHTML(html) { root.innerHTML = html; if (editing) setContentEditable(true); }
  function setStatus(t) { statusEl.textContent = t; }
  function refreshBar() {
    document.getElementById("edUndo").disabled = undoStack.length === 0;
    document.getElementById("edRedo").disabled = redoStack.length === 0;
    setStatus(dirty ? "Unsaved" : "Saved");
  }
  function record() {
    const now = snapshot();
    if (now === current) return;
    if (current !== null) { undoStack.push(current); if (undoStack.length > 120) undoStack.shift(); redoStack.length = 0; }
    current = now; dirty = true; refreshBar();
  }
  function undo() { if (!undoStack.length) return; redoStack.push(current); current = undoStack.pop(); hideEl(); applyHTML(current); dirty = true; refreshBar(); }
  function redo() { if (!redoStack.length) return; undoStack.push(current); current = redoStack.pop(); hideEl(); applyHTML(current); dirty = true; refreshBar(); }

  /* selection + bubble */
  function selInEditable() {
    const s = window.getSelection();
    if (!s.rangeCount) return null;
    let n = s.anchorNode; n = n && n.nodeType === 3 ? n.parentElement : n;
    const host = n && n.closest ? n.closest("[contenteditable='true']") : null;
    return host ? s.getRangeAt(0) : null;
  }
  function positionBubble() {
    if (!editing || !savedRange) { bubble.classList.remove("show"); return; }
    let rect = savedRange.getBoundingClientRect();
    if (!rect.width && !rect.height) {
      let n = savedRange.startContainer; n = n.nodeType === 3 ? n.parentElement : n;
      if (n) rect = n.getBoundingClientRect();
    }
    bubble.classList.add("show");
    const bw = bubble.offsetWidth, bh = bubble.offsetHeight;
    let left = rect.left + rect.width / 2 - bw / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - bw - 8));
    let top = rect.top - bh - 10;
    if (top < 8) top = rect.bottom + 10;
    bubble.style.left = left + "px";
    bubble.style.top = top + "px";
  }
  function syncActive() {
    if (!editing) return;
    [["b","bold"],["i","italic"],["u","underline"],["s","strikeThrough"],["ul","insertUnorderedList"],["ol","insertOrderedList"]]
      .forEach(([k, cmd]) => { const el = bubble.querySelector('[data-cmd="' + k + '"]'); if (el) { try { el.classList.toggle("on", document.queryCommandState(cmd)); } catch (e) {} } });
  }
  document.addEventListener("selectionchange", () => {
    if (!editing) return;
    const r = selInEditable();
    if (!r) return;
    const collapsed = window.getSelection().isCollapsed;
    if (elSel && collapsed) return;              // element mode owns collapsed clicks
    if (!collapsed) hideEl();                    // real text selection wins
    savedRange = r.cloneRange(); positionBubble(); syncActive();
  });
  window.addEventListener("scroll", () => { if (editing) { positionBubble(); positionElBub(); } }, { passive: true });
  bubble.addEventListener("mousedown", e => { if (e.target.closest("button")) e.preventDefault(); });
  document.addEventListener("mousedown", e => {
    if (!editing) return;
    if (e.target.closest(".edbub") || e.target.closest("#edBar")) return;
    if (!e.target.closest("[contenteditable='true']")) bubble.classList.remove("show");
    if (!e.target.closest(CFG.root)) hideEl();
  });
  function restore() { if (savedRange) { const s = window.getSelection(); s.removeAllRanges(); s.addRange(savedRange); } }
  function exec(cmd, val) { restore(); document.execCommand("styleWithCSS", false, true); document.execCommand(cmd, false, val || null); record(); syncActive(); positionBubble(); }

  /* bubble UI */
  function icon(p) { return '<svg viewBox="0 0 24 24">' + p + '</svg>'; }
  function mkBtn(html, title, fn, cmdKey) {
    const b = document.createElement("button");
    b.type = "button"; b.innerHTML = html; b.title = title; if (cmdKey) b.dataset.cmd = cmdKey;
    b.addEventListener("click", fn);
    return b;
  }
  function sep() { const s = document.createElement("span"); s.className = "sep"; return s; }
  function buildBubble() {
    const row1 = document.createElement("div"); row1.className = "ed-row";
    const row2 = document.createElement("div"); row2.className = "ed-row extra";
    bubble.appendChild(row1); bubble.appendChild(row2);

    row1.appendChild(mkBtn("B", "Bold", () => exec("bold"), "b"));
    row1.appendChild(mkBtn("<i>I</i>", "Italic", () => exec("italic"), "i"));
    row1.appendChild(mkBtn("<u>U</u>", "Underline", () => exec("underline"), "u"));
    row1.appendChild(mkBtn("<s>S</s>", "Strikethrough", () => exec("strikeThrough"), "s"));
    row1.appendChild(sep());
    row1.appendChild(mkBtn(icon('<path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/>'), "Add link", addLink));
    const sw = document.createElement("label"); sw.className = "swatch"; sw.title = "Text colour";
    const col = document.createElement("input"); col.type = "color"; col.value = "#111827";
    col.addEventListener("input", () => { sw.style.setProperty("--sw", col.value); exec("foreColor", col.value); });
    sw.appendChild(col); row1.appendChild(sw);
    row1.appendChild(sep());
    const more = mkBtn(icon('<path d="M6 9l6 6 6-6"/>'), "More options", () => { bubble.classList.toggle("more"); positionBubble(); });
    more.classList.add("chev");
    row1.appendChild(more);

    const font = document.createElement("select"); font.title = "Font";
    [["", "Font"], ["Inter, sans-serif", "Inter"], ["Georgia, serif", "Serif"], ["Arial, sans-serif", "Arial"], ["'Trebuchet MS', sans-serif", "Trebuchet"], ["'Courier New', monospace", "Mono"], ["Impact, sans-serif", "Impact"]]
      .forEach(([v, l]) => { const o = document.createElement("option"); o.value = v; o.textContent = l; font.appendChild(o); });
    font.addEventListener("mousedown", () => restore());
    font.addEventListener("change", () => { if (font.value) exec("fontName", font.value); font.selectedIndex = 0; });
    row2.appendChild(font);
    const size = document.createElement("select"); size.title = "Size";
    [["", "Size"], ["13px", "13"], ["15px", "15"], ["17px", "17"], ["20px", "20"], ["24px", "24"], ["30px", "30"], ["40px", "40"], ["56px", "56"], ["72px", "72"]]
      .forEach(([v, l]) => { const o = document.createElement("option"); o.value = v; o.textContent = l; size.appendChild(o); });
    size.addEventListener("mousedown", () => restore());
    size.addEventListener("change", () => { if (size.value) setSize(size.value); size.selectedIndex = 0; });
    row2.appendChild(size);
    row2.appendChild(sep());
    row2.appendChild(mkBtn(icon('<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="3.5" cy="6" r="1"/><circle cx="3.5" cy="12" r="1"/><circle cx="3.5" cy="18" r="1"/>'), "Bulleted list", () => exec("insertUnorderedList"), "ul"));
    row2.appendChild(mkBtn(icon('<line x1="10" y1="6" x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="10" y1="18" x2="21" y2="18"/><path d="M4 6h1v4M4 10h2M6 14H4v-1l2-2v-1H4"/>'), "Numbered list", () => exec("insertOrderedList"), "ol"));
    row2.appendChild(mkBtn(icon('<line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="14" y2="12"/><line x1="4" y1="18" x2="18" y2="18"/>'), "Align left", () => exec("justifyLeft")));
    row2.appendChild(mkBtn(icon('<line x1="4" y1="6" x2="20" y2="6"/><line x1="7" y1="12" x2="17" y2="12"/><line x1="5" y1="18" x2="19" y2="18"/>'), "Align centre", () => exec("justifyCenter")));
    row2.appendChild(sep());
    row2.appendChild(mkBtn(icon('<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="1.6"/><path d="M21 15l-5-5L5 21"/>'), "Insert image", insertImage));
    row2.appendChild(mkBtn(icon('<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M10 9l5 3-5 3z"/>'), "Insert video", insertVideo));
    row2.appendChild(sep());
    row2.appendChild(mkBtn(icon('<path d="M6 6l12 12M18 6L6 18"/>'), "Clear formatting", () => { exec("removeFormat"); exec("unlink"); }));
  }
  function setSize(px) {
    restore();
    const s = window.getSelection();
    if (!s.rangeCount || s.isCollapsed) return;
    const r = s.getRangeAt(0);
    const span = document.createElement("span"); span.style.fontSize = px;
    try { r.surroundContents(span); }
    catch (e) {
      document.execCommand("fontSize", false, "4");
      root.querySelectorAll('font[size="4"]').forEach(f => { const sp = document.createElement("span"); sp.style.fontSize = px; sp.innerHTML = f.innerHTML; f.replaceWith(sp); });
    }
    record(); positionBubble();
  }
  function addLink() {
    restore();
    const url = prompt("Link URL (https://...)"); if (!url) return;
    exec("createLink", url);
    const s = window.getSelection();
    let n = s.anchorNode; n = n && n.nodeType === 3 ? n.parentElement : n;
    const a = n && n.closest ? n.closest("a") : null;
    if (a) { a.target = "_blank"; a.rel = "noopener"; }
    record();
  }
  function insertHTMLAtCaret(html) { restore(); document.execCommand("insertHTML", false, html); record(); positionBubble(); }
  function insertImage() {
    const url = prompt("Paste an image URL, or leave blank to upload from your computer:");
    if (url === null) return;
    if (url.trim()) { insertHTMLAtCaret('<img class="ed-img" src="' + url.trim().replace(/"/g, "&quot;") + '" alt="">'); return; }
    const inp = document.createElement("input"); inp.type = "file"; inp.accept = "image/*";
    inp.addEventListener("change", () => {
      const f = inp.files[0]; if (!f) return;
      const rd = new FileReader();
      rd.onload = () => insertHTMLAtCaret('<img class="ed-img" src="' + rd.result + '" alt="">');
      rd.readAsDataURL(f);
    });
    inp.click();
  }
  function insertVideo() {
    const url = prompt("Paste a video link (YouTube, Vimeo, or a direct .mp4):");
    if (!url) return;
    const u = url.trim(); let embed = "";
    let m = u.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([\w-]{11})/);
    if (m) embed = '<iframe src="https://www.youtube.com/embed/' + m[1] + '" allowfullscreen></iframe>';
    else if ((m = u.match(/vimeo\.com\/(\d+)/))) embed = '<iframe src="https://player.vimeo.com/video/' + m[1] + '" allowfullscreen></iframe>';
    else if (/\.(mp4|webm|ogg)(\?|$)/i.test(u)) embed = '<video controls src="' + u.replace(/"/g, "&quot;") + '"></video>';
    else embed = '<iframe src="' + u.replace(/"/g, "&quot;") + '" allowfullscreen></iframe>';
    insertHTMLAtCaret('<div class="ed-video" contenteditable="false">' + embed + "</div><p><br></p>");
  }

  /* element (widget) builder */
  const elBub = document.getElementById("edEl");
  let elSel = null;
  function labelFor(el) {
    if (el.tagName === "IMG") return "Image";
    if (el.tagName === "VIDEO" || el.classList.contains("ed-video")) return "Video";
    if (el.tagName === "A" || el.tagName === "BUTTON") return "Button";
    if (el.tagName === "SECTION" || el.classList.contains("section")) return "Section";
    return "Block";
  }
  function hideEl() {
    if (elSel) elSel.classList.remove("ed-sel");
    elSel = null;
    elBub.classList.remove("show", "more");
  }
  function positionElBub() {
    if (!editing || !elSel) { elBub.classList.remove("show"); return; }
    const rect = elSel.getBoundingClientRect();
    elBub.classList.add("show");
    const bw = elBub.offsetWidth, bh = elBub.offsetHeight;
    let left = rect.left + rect.width / 2 - bw / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - bw - 8));
    let top = rect.top - bh - 10;
    if (top < 8) top = Math.min(rect.top + 10, window.innerHeight - bh - 8);
    elBub.style.left = left + "px";
    elBub.style.top = top + "px";
  }
  function selectEl(el) {
    bubble.classList.remove("show");
    if (elSel) elSel.classList.remove("ed-sel");
    el.classList.remove("ed-hov");
    elSel = el; el.classList.add("ed-sel");
    buildElBub(); positionElBub();
  }
  function elRecord() { record(); positionElBub(); }
  function moveEl(dir) {
    if (!elSel) return;
    const sib = dir < 0 ? elSel.previousElementSibling : elSel.nextElementSibling;
    if (!sib) return;
    if (dir < 0) sib.before(elSel); else sib.after(elSel);
    elSel.scrollIntoView({ block: "nearest", behavior: "smooth" });
    elRecord();
  }
  function dupEl() {
    if (!elSel) return;
    const c = elSel.cloneNode(true);
    c.classList.remove("ed-sel");
    elSel.after(c); elRecord();
  }
  function delEl() {
    if (!elSel) return;
    const t = elSel; hideEl(); t.remove(); record();
  }
  function alignEl(mode) {
    if (!elSel) return;
    if (elSel.tagName === "IMG" || elSel.classList.contains("ed-video")) elSel.style.display = "block";
    elSel.style.marginLeft = mode === "l" ? "0" : "auto";
    elSel.style.marginRight = mode === "r" ? "0" : "auto";
    if (mode === "l") elSel.style.marginRight = "auto";
    if (mode === "r") elSel.style.marginLeft = "auto";
    elRecord();
  }
  function replaceImg() {
    if (!elSel || elSel.tagName !== "IMG") return;
    const url = prompt("Paste the new image URL, or leave blank to upload:");
    if (url === null) return;
    if (url.trim()) { elSel.src = url.trim(); elRecord(); return; }
    const inp = document.createElement("input"); inp.type = "file"; inp.accept = "image/*";
    inp.addEventListener("change", () => {
      const f = inp.files[0]; if (!f) return;
      const rd = new FileReader();
      rd.onload = () => { elSel.src = rd.result; elRecord(); };
      rd.readAsDataURL(f);
    });
    inp.click();
  }
  function buildElBub() {
    elBub.innerHTML = "";
    const row1 = document.createElement("div"); row1.className = "ed-row";
    const row2 = document.createElement("div"); row2.className = "ed-row extra";
    elBub.appendChild(row1); elBub.appendChild(row2);

    const lab = document.createElement("span"); lab.className = "lab"; lab.textContent = labelFor(elSel);
    row1.appendChild(lab);
    row1.appendChild(sep());
    row1.appendChild(mkBtn(icon('<path d="M12 19V5M5 12l7-7 7 7"/>'), "Move up", () => moveEl(-1)));
    row1.appendChild(mkBtn(icon('<path d="M12 5v14M19 12l-7 7-7-7"/>'), "Move down", () => moveEl(1)));
    row1.appendChild(mkBtn(icon('<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>'), "Duplicate", dupEl));
    row1.appendChild(mkBtn(icon('<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6"/>'), "Delete", () => { if (confirm("Delete this " + labelFor(elSel).toLowerCase() + "?")) delEl(); }));
    row1.appendChild(sep());
    const more = mkBtn(icon('<path d="M6 9l6 6 6-6"/>'), "More options", () => { elBub.classList.toggle("more"); positionElBub(); });
    more.classList.add("chev");
    row1.appendChild(more);

    // width (responsive %, never fixed px)
    const wLab = document.createElement("span"); wLab.className = "lab"; wLab.textContent = "W";
    row2.appendChild(wLab);
    const w = document.createElement("input"); w.type = "range"; w.min = "15"; w.max = "100"; w.title = "Width (%)";
    w.value = parseInt(elSel.style.width) || 100;
    w.addEventListener("input", () => {
      elSel.style.width = w.value + "%"; elSel.style.maxWidth = "100%";
      if (elSel.tagName === "IMG") elSel.style.height = "auto";
      positionElBub();
    });
    w.addEventListener("change", elRecord);
    row2.appendChild(w);
    const auto = mkBtn("A", "Auto width", () => { elSel.style.width = ""; elSel.style.maxWidth = ""; w.value = 100; elRecord(); });
    auto.classList.add("txt"); row2.appendChild(auto);
    row2.appendChild(sep());
    // radius (reshape)
    const rad = document.createElement("select"); rad.title = "Corner shape";
    [["", "Shape"], ["0px", "Square"], ["8px", "Soft"], ["16px", "Round"], ["28px", "Rounder"], ["999px", "Pill"], ["50%", "Circle"]]
      .forEach(([v, l]) => { const o = document.createElement("option"); o.value = v; o.textContent = l; rad.appendChild(o); });
    rad.addEventListener("change", () => { if (rad.value !== "") { elSel.style.borderRadius = rad.value; if (rad.value === "50%" && elSel.tagName === "IMG") elSel.style.objectFit = "cover"; elRecord(); } rad.selectedIndex = 0; });
    row2.appendChild(rad);
    // background colour
    const sw = document.createElement("label"); sw.className = "swatch"; sw.title = "Background colour"; sw.style.setProperty("--swch", '"◧"');
    const col = document.createElement("input"); col.type = "color"; col.value = "#ffffff";
    col.addEventListener("input", () => { sw.style.setProperty("--sw", col.value); elSel.style.background = col.value; });
    col.addEventListener("change", elRecord);
    sw.appendChild(col); row2.appendChild(sw);
    const noFill = mkBtn(icon('<circle cx="12" cy="12" r="9"/><path d="M5.5 5.5l13 13"/>'), "Remove background", () => { elSel.style.background = ""; elRecord(); });
    row2.appendChild(noFill);
    row2.appendChild(sep());
    row2.appendChild(mkBtn(icon('<line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="14" y2="12"/><line x1="4" y1="18" x2="18" y2="18"/>'), "Align left", () => alignEl("l")));
    row2.appendChild(mkBtn(icon('<line x1="4" y1="6" x2="20" y2="6"/><line x1="7" y1="12" x2="17" y2="12"/><line x1="5" y1="18" x2="19" y2="18"/>'), "Align centre", () => alignEl("c")));
    row2.appendChild(mkBtn(icon('<line x1="4" y1="6" x2="20" y2="6"/><line x1="10" y1="12" x2="20" y2="12"/><line x1="6" y1="18" x2="20" y2="18"/>'), "Align right", () => alignEl("r")));
    if (elSel.tagName === "IMG") {
      row2.appendChild(sep());
      const rep2 = mkBtn("Replace", "Replace image", replaceImg); rep2.classList.add("txt");
      row2.appendChild(rep2);
    }
    if (elSel.tagName === "A" || elSel.tagName === "BUTTON") {
      row2.appendChild(sep());
      const txt = mkBtn("Text", "Edit button text", () => { const v = prompt("Button text:", elSel.textContent.trim()); if (v !== null && v.trim()) { elSel.textContent = v.trim(); elRecord(); } }); txt.classList.add("txt");
      row2.appendChild(txt);
      if (elSel.tagName === "A") {
        const lnk = mkBtn("Link", "Edit link URL", () => { const v = prompt("Link URL:", elSel.getAttribute("href") || "https://"); if (v !== null && v.trim()) { elSel.setAttribute("href", v.trim()); elSel.target = "_blank"; elSel.rel = "noopener"; elRecord(); } }); lnk.classList.add("txt");
        row2.appendChild(lnk);
      }
    }
    const p2 = elSel.parentElement && elSel.parentElement.closest(WIDGET_SEL);
    if (p2) {
      row2.appendChild(sep());
      const up = mkBtn("Parent", "Select the containing block", () => selectEl(p2)); up.classList.add("txt");
      row2.appendChild(up);
    }
  }
  elBub.addEventListener("mousedown", e => { if (e.target.closest("button")) e.preventDefault(); });
  root.addEventListener("mouseover", e => {
    if (!editing) return;
    document.querySelectorAll(".ed-hov").forEach(x => x.classList.remove("ed-hov"));
    if (e.target.closest("[contenteditable='true']")) return;
    const w2 = e.target.closest(WIDGET_SEL);
    if (w2 && w2 !== elSel) w2.classList.add("ed-hov");
  });
  root.addEventListener("mouseleave", () => document.querySelectorAll(".ed-hov").forEach(x => x.classList.remove("ed-hov")));

  /* mode + bar wiring */
  function enterEditing() {
    editing = true; document.body.classList.add("editing");
    setContentEditable(true);
    current = snapshot(); undoStack = []; redoStack = []; dirty = false;
    refreshBar();
  }
  function exitEditing() {
    editing = false; document.body.classList.remove("editing");
    setContentEditable(false);
    bubble.classList.remove("show"); savedRange = null;
    hideEl();
    document.querySelectorAll(".ed-hov").forEach(x => x.classList.remove("ed-hov"));
  }
  // THE ONE LOGIN. With CFG.verifyUrl set (ZAH Site MCP serves it at
  // /zah-site/login) the server decides who may edit, so the client signs in
  // with the ZAH Account they already pay with. CFG.adminHash stays as the
  // key that needs no network: Zah's, and the way in when head office is
  // unreachable. Whoever gets in, a "zah-editor:login" event carries the
  // answer so a publish bridge can pick up its token.
  function announce(email, pw, data) {
    document.dispatchEvent(new CustomEvent("zah-editor:login", { detail: { email: email, password: pw, data: data || null } }));
    sessionStorage.setItem(CFG.storageKey + ":admin", "true");
  }
  async function signIn() {
    const email = prompt(CFG.verifyUrl ? "Sign in to edit. Your " + CFG.who + " email:" : "Admin email");
    if (!email) return false;
    const pw = prompt(CFG.verifyUrl ? "Password:" : "Admin password");
    if (!pw) return false;
    let said = "";
    if (CFG.verifyUrl) {
      let r = null, d = {};
      try {
        r = await fetch(CFG.verifyUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: email, password: pw }) });
        d = await r.json().catch(() => ({}));
      } catch (e) { r = null; }
      if (r && r.ok) { announce(email, pw, d); return true; }
      if (r && d && d.error) said = d.error;
    }
    // The server said no, or nothing was listening, or there is no network.
    // The page's own key gets its turn either way: it is the one that works
    // when head office cannot be reached, and it is how Zah gets in.
    if (CFG.adminHash && await hashCreds(email, pw) === CFG.adminHash) { announce(email, pw, null); return true; }
    alert(said || "Login failed.");
    return false;
  }
  document.getElementById("edToggle").addEventListener("click", async () => {
    if (sessionStorage.getItem(CFG.storageKey + ":admin") !== "true" && !(await signIn())) return;
    enterEditing();
  });
  // The site's /edit door lands here with ?edit=1; open the login on arrival
  // and tidy the address, so a shared or reloaded link is the plain page.
  if (/[?&]edit=1(&|$)/.test(location.search) || location.hash === "#edit") {
    try { history.replaceState(null, "", location.pathname + location.search.replace(/([?&])edit=1(&|$)/, "$1").replace(/[?&]$/, "")); } catch (e) {}
    setTimeout(() => document.getElementById("edToggle").click(), 0);
  }
  document.getElementById("edDone").addEventListener("click", () => {
    if (dirty && !confirm("You have unsaved changes. Leave edit mode anyway? (Save first to keep them.)")) return;
    exitEditing();
  });
  document.getElementById("edSave").addEventListener("click", () => {
    try { localStorage.setItem(CFG.storageKey, snapshot()); dirty = false; refreshBar(); setStatus("Saved"); }
    catch (e) { alert("Could not save (storage full). Large embedded images can exceed the browser limit."); }
  });
  document.getElementById("edReset").addEventListener("click", () => {
    if (!confirm("Reset the page to the original and discard all saved edits?")) return;
    localStorage.removeItem(CFG.storageKey); location.reload();
  });
  document.getElementById("edUndo").addEventListener("click", undo);
  document.getElementById("edRedo").addEventListener("click", redo);
  root.addEventListener("input", () => {
    if (!editing) return;
    dirty = true; setStatus("Unsaved");
    clearTimeout(typingTimer); typingTimer = setTimeout(record, 450);
  });
  // click resolution: links never navigate; media/buttons select directly; block padding
  // selects the block; text clicks stay in text mode.
  root.addEventListener("click", e => {
    if (!editing) return;
    const a = e.target.closest("a"); if (a) e.preventDefault();
    const direct = e.target.closest([CFG.root + " img", CFG.root + " video", CFG.root + " .ed-video", CFG.root + " a.button", CFG.root + " a.btn", CFG.root + " button"].join(", "));
    if (direct) { selectEl(direct); return; }
    if (e.target.closest("[contenteditable='true']")) { hideEl(); return; }
    const w3 = e.target.closest(WIDGET_SEL);
    if (w3) selectEl(w3); else hideEl();
  });
  document.addEventListener("keydown", e => {
    if (!editing) return;
    const typing = document.activeElement && document.activeElement.closest && document.activeElement.closest("[contenteditable='true'], input, select, textarea");
    if ((e.key === "Delete" || e.key === "Backspace") && elSel && !typing) { e.preventDefault(); delEl(); return; }
    if (e.key === "Escape" && elSel) { hideEl(); return; }
    if (!(e.ctrlKey || e.metaKey)) return;
    const k = e.key.toLowerCase();
    if (k === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
    else if ((k === "z" && e.shiftKey) || k === "y") { e.preventDefault(); redo(); }
    else if (k === "s") { e.preventDefault(); document.getElementById("edSave").click(); }
  });

  buildBubble();
})();
