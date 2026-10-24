// Замер страницы сайта по правилам ui-ux-pro-max (docs/winchester-site-task.md §8а): контраст текста, кнопки и ссылки
// меньше 24 и 44 px, текст мельче 12 px, горизонтальная прокрутка — на 390 и 1440 px. Внешние адреса не открываются.
// Запуск: node apps/winchester-site/audit.cjs apps/winchester-site [страница, по умолчанию /]   (например /kk/)
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(process.argv[2] || __dirname), PAGE = process.argv[3] || '/';
const T = { '.html': 'text/html; charset=utf-8', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.jpg': 'image/jpeg' };
const srv = http.createServer((q, r) => { let p = decodeURIComponent(new URL(q.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, path.normalize(p)); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream' }); r.end(fs.readFileSync(f)); });
srv.listen(0, '127.0.0.1', async () => {
  process.env.PLAYWRIGHT_DISABLE_FORCED_CHROMIUM_PROXIED_LOOPBACK = '1';
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  for (const vp of [{ w: 390, h: 844, m: true }, { w: 1440, h: 900, m: false }]) {
    const pg = await b.newPage({ viewport: { width: vp.w, height: vp.h }, isMobile: vp.m, hasTouch: vp.m, reducedMotion: 'reduce' });
    await pg.route(/^https?:\/\/(?!127\.0\.0\.1)/, r => r.abort());
    await pg.goto(`http://127.0.0.1:${srv.address().port}${PAGE}`, { waitUntil: 'load' });
    await pg.evaluate(() => document.querySelectorAll('.rv').forEach(e => e.classList.add('in')));
    const res = await pg.evaluate(() => {
      const lum = c => { const m = c.match(/[\d.]+/g); if (!m) return null; const [r, g, b, a = 1] = m.map(Number); const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }; return { L: .2126 * f(r) + .7152 * f(g) + .0722 * f(b), a }; };
      const bgOf = el => { for (let e = el; e; e = e.parentElement) { const s = getComputedStyle(e); if (s.backgroundImage && s.backgroundImage !== 'none' && !/gradient/.test(s.backgroundImage)) return null; const c = s.backgroundColor; const l = lum(c); if (l && l.a > .9) return l.L; } return lum('rgb(255,255,255)').L; };
      const low = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const seen = new Set();
      while (walker.nextNode()) { const t = walker.currentNode; const el = t.parentElement; if (!t.textContent.trim() || seen.has(el)) continue; seen.add(el);
        const s = getComputedStyle(el); if (s.visibility === 'hidden' || s.display === 'none' || el.closest('[hidden],[aria-hidden=true],.wbk')) continue; const r = el.getBoundingClientRect(); if (!r.width) continue;
        const fg = lum(s.color); const bg = bgOf(el); if (!fg || bg == null) continue; const L = fg.L; const cr = (Math.max(L, bg) + .05) / (Math.min(L, bg) + .05);
        const big = parseFloat(s.fontSize) >= 24 || (parseFloat(s.fontSize) >= 18.66 && +s.fontWeight >= 700);
        if (cr < (big ? 3 : 4.5)) low.push(`${cr.toFixed(2)} ${s.fontSize} "${t.textContent.trim().slice(0, 40)}"`); }
      const small = [...document.querySelectorAll('a[href],button,[role=button],input,select,summary')].filter(e => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width && s.visibility !== 'hidden' && (r.height < 24 || r.width < 24) ; }).map(e => `${Math.round(e.getBoundingClientRect().width)}x${Math.round(e.getBoundingClientRect().height)} "${(e.textContent || e.getAttribute('aria-label') || '').trim().slice(0, 30)}"`);
      const small44 = [...document.querySelectorAll('a[href],button')].filter(e => { const r = e.getBoundingClientRect(); return r.width && r.height < 44 && getComputedStyle(e).visibility !== 'hidden'; }).length;
      const tiny = [...document.querySelectorAll('body *')].filter(e => e.childElementCount === 0 && e.textContent.trim() && parseFloat(getComputedStyle(e).fontSize) < 12 && e.getBoundingClientRect().width).map(e => `${getComputedStyle(e).fontSize} "${e.textContent.trim().slice(0, 30)}"`);
      return { hscroll: document.documentElement.scrollWidth > innerWidth, low, small, small44, tiny };
    });
    console.log(`\n== ${vp.w}px  горизонтальная прокрутка: ${res.hscroll}`);
    console.log(`контраст ниже нормы (${res.low.length}):`); res.low.slice(0, 14).forEach(x => console.log('  ' + x));
    console.log(`кнопки/ссылки меньше 24px (${res.small.length}):`); res.small.slice(0, 10).forEach(x => console.log('  ' + x));
    console.log(`ссылок/кнопок ниже 44px по высоте: ${res.small44}`);
    console.log(`текст мельче 12px (${res.tiny.length}):`); [...new Set(res.tiny)].slice(0, 12).forEach(x => console.log('  ' + x));
    await pg.close();
  }
  await b.close(); srv.close();
});
