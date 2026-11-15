/* What a document is allowed to put on the reading page.
   A document is untrusted. Its content arrives here as a parsed tree that is not part of any page (so nothing in it
   has run or been fetched), and a NEW tree is built from it holding only what is on the lists below: the element
   names, the few attributes, the kinds of link and picture. Nothing is "cleaned" by removing bad parts from the
   original; whatever is not listed is simply never copied. Everything left out is counted so the reader can be told.
   The result is then shown inside a frame where the browser itself runs no scripts (see textview.js), and the page's
   Content-Security-Policy refuses any connection, so three things would have to fail at once. */

const KEEP = new Set(('a abbr b bdi bdo blockquote br caption cite code col colgroup dd del dfn div dl dt em figcaption figure ' +
  'h1 h2 h3 h4 h5 h6 hr i img ins kbd li mark ol p pre q rp rt ruby s samp small span strong sub sup table tbody td tfoot th thead tr u ul var wbr').split(' '));
// kept as a plain block or as its words only
const AS = { article: 'div', section: 'div', aside: 'div', header: 'div', footer: 'div', main: 'div', nav: 'div', address: 'div', center: 'div', hgroup: 'div', details: 'div', summary: 'p', strike: 's', tt: 'code', big: 'span', font: 'span', acronym: 'abbr', dir: 'ul', menu: 'ul' };
// left out whole, with everything inside
const DROP = new Set('script style link meta base head title template noscript iframe frame frameset object embed applet form input button textarea select option audio video source track canvas svg math dialog slot portal'.split(' '));
const ATTR = { '*': ['title', 'lang', 'dir'], a: [], img: ['alt', 'width', 'height'], td: ['colspan', 'rowspan'], th: ['colspan', 'rowspan', 'scope'], ol: ['start', 'type', 'reversed'], li: ['value'], col: ['span'], colgroup: ['span'] };
const IMG_DATA = /^data:image\/(png|jpe?g|gif|webp|bmp|avif);base64,[a-z0-9+/=\s]+$/i;
const MAX_DEPTH = 120;

export const newCount = () => ({ scripts: 0, handlers: 0, links: 0, remote: 0, remoteOther: 0, embeds: 0, missing: 0 });

/* sanitize(sourceNode, outDocument, options) -> DocumentFragment in outDocument
   options: count          a newCount() to add to
            classes        Set of class names that may be kept (only our own converters use classes)
            image(src)     for a picture address that is not data: or remote: return a blob: address or null
            link(href)     for a link that is not #…, http(s) or mailto: return '#id' to jump inside the document or null
            idPrefix       put in front of every id (ids from the document can never collide with ours) */
export function sanitize(src, out, o = {}) {
  const count = o.count || newCount(), classes = o.classes || null, pre = o.idPrefix ?? 'u-';
  const frag = out.createDocumentFragment();
  const remoteish = v => /^\s*(https?:|ftp:|\/\/)/i.test(v || '');

  function attrs(el, name, node) {
    for (const a of [...el.attributes]) {
      const n = a.name.toLowerCase(), v = a.value;
      if (n.startsWith('on')) { count.handlers++; continue; }
      if (n === 'id' || (n === 'name' && name === 'a')) { if (/^[\w.:-]{1,200}$/.test(v) && !node.id) node.id = pre + v; continue; }
      if (n === 'class') { if (classes) { const k = v.split(/\s+/).filter(c => classes.has(c)); if (k.length) node.className = k.join(' '); } continue; }
      if (ATTR['*'].includes(n) || (ATTR[name] || []).includes(n)) { if (v.length <= 2000) node.setAttribute(n, v); continue; }
    }
    if (name === 'a') {
      const h = (el.getAttribute('href') ?? el.getAttribute('xlink:href') ?? '').trim();
      if (!h) return;
      // the browser ignores tabs and line breaks inside an address, so "java\tscript:" must be judged without them
      const flat = h.replace(/[\u0000- \u00AD\u200B-\u200D\uFEFF]+/g, '');
      if (flat.startsWith('#')) node.setAttribute('href', '#' + pre + flat.slice(1));
      else if (/^(https?:\/\/|mailto:)/i.test(flat)) { node.setAttribute('href', flat); node.setAttribute('data-out', '1'); }
      else if (/^[a-z][a-z0-9+.-]*:/i.test(flat)) count.links++;                      // javascript:, data:, vbscript:, file: and anything else with a scheme
      else { const to = o.link ? o.link(flat) : null; if (to) node.setAttribute('href', to); } // a link to another file: only if we hold that file
    }
  }
  function picture(el) {
    const s = (el.getAttribute('src') ?? el.getAttribute('xlink:href') ?? el.getAttribute('href') ?? '').trim();
    const far = [el.getAttribute('srcset'), el.getAttribute('data-src')].some(x => /https?:|\/\//i.test(x || ''));
    let url = null;
    if (IMG_DATA.test(s)) url = s.replace(/\s+/g, '');
    else if (remoteish(s) || (!s && far)) { count.remote++; return null; }
    else if (/^[a-z][a-z0-9+.-]*:/i.test(s)) { if (s) count.missing++; return null; }   // data:image/svg, blob: from elsewhere, file:, javascript:
    else if (s && o.image) url = o.image(s);
    if (!url) { if (s) count.missing++; return null; }
    const im = out.createElement('img'); im.setAttribute('src', url); im.setAttribute('loading', 'lazy');
    return im;
  }
  function walk(node, into, depth) {
    for (const ch of node.childNodes) {
      if (ch.nodeType === 3 || ch.nodeType === 4) { into.appendChild(out.createTextNode(ch.nodeValue)); continue; }
      if (ch.nodeType !== 1) continue; // comments, processing instructions
      const name = ch.localName.toLowerCase();
      if (name === 'script') { count.scripts++; continue; }
      if (DROP.has(name)) {
        if (/^(iframe|frame|object|embed|applet|form|audio|video)$/.test(name)) count.embeds++;
        if (name === 'link' && remoteish(ch.getAttribute('href'))) count.remoteOther++;
        if (/^(iframe|frame|object|embed|audio|video|source|track)$/.test(name) && remoteish(ch.getAttribute('src') || ch.getAttribute('data'))) count.remoteOther++;
        if (name === 'style' && /@import|url\(\s*['"]?\s*(https?:|\/\/)/i.test(ch.textContent)) count.remoteOther++;
        if (name === 'svg') { // an ebook cover is often a picture wrapped in a drawing: keep the picture
          count.scripts += ch.getElementsByTagName('script').length;
          for (const im of ch.getElementsByTagName('image')) { const got = picture(im); if (got) into.appendChild(got); }
        }
        for (const a of ch.attributes || []) if (a.name.toLowerCase().startsWith('on')) count.handlers++;
        for (const e of ch.querySelectorAll ? ch.querySelectorAll('*') : []) for (const a of e.attributes) if (a.name.toLowerCase().startsWith('on')) count.handlers++;
        continue;
      }
      if (name === 'img' || name === 'image') {
        for (const a of ch.attributes) if (a.name.toLowerCase().startsWith('on')) count.handlers++;
        const im = picture(ch);
        if (im) { for (const k of ATTR.img) { const v = ch.getAttribute(k); if (v != null && v.length <= 2000 && (k === 'alt' || /^\d{1,5}$/.test(v))) im.setAttribute(k, v); } into.appendChild(im); }
        else { const alt = ch.getAttribute('alt'); if (alt) { const s = out.createElement('span'); s.className = 'noimg'; s.textContent = `[picture: ${alt.slice(0, 200)}]`; into.appendChild(s); } }
        continue;
      }
      const as = KEEP.has(name) ? name : AS[name];
      if (!as || depth > MAX_DEPTH) { // not on the list: its words are kept, the element is not
        for (const a of ch.attributes) if (a.name.toLowerCase().startsWith('on')) count.handlers++;
        walk(ch, into, depth + 1); continue;
      }
      const el = out.createElement(as);
      attrs(ch, name, el);
      into.appendChild(el);
      walk(ch, el, depth + 1);
    }
  }
  walk(src, frag, 0);
  return frag;
}

/* Parse markup from a document without it becoming part of any page: nothing in it runs or loads. */
export function inert(html, xml = false) {
  const p = new DOMParser();
  if (xml) { const d = p.parseFromString(html, 'application/xhtml+xml'); if (!d.getElementsByTagName('parsererror').length) return d; }
  return p.parseFromString(html, 'text/html');
}

/* The line shown above a document when something was left out. Plain words, real numbers. */
export function droppedLine(c) {
  const n = (k, one, many) => c[k] ? `${c[k]} ${c[k] === 1 ? one : many}` : '';
  const safety = [n('scripts', 'script (a small program)', 'scripts (small programs)'), n('handlers', 'hidden instruction that would run when you looked at or clicked something', 'hidden instructions that would run when you looked at or clicked something'), n('links', 'link that was not a plain web or email address', 'links that were not plain web or email addresses'), n('embeds', 'embedded form, frame or player', 'embedded forms, frames or players')].filter(Boolean);
  const out = [];
  if (safety.length) out.push(`Left out for safety: ${safety.join(', ')}.`);
  if (c.remote) out.push(c.remote === 1 ? '1 picture that lives on the internet was not loaded.' : `${c.remote} pictures that live on the internet were not loaded.`);
  if (c.remoteOther) out.push(c.remoteOther === 1 ? '1 other thing the document wanted from the internet (a style sheet, font or player) was not fetched.' : `${c.remoteOther} other things the document wanted from the internet (style sheets, fonts or players) were not fetched.`);
  if (c.missing) out.push(c.missing === 1 ? '1 picture could not be shown.' : `${c.missing} pictures could not be shown.`);
  return out.join(' ');
}
