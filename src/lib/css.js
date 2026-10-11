// @ts-check
// Общий CSS служебных страниц (светлая и тёмная тема) — нужен страницам владельца и пульту рассылок.

export const BASE_CSS = `:root{--bg:#e6eeef;--panel:#fff;--ink:#12303a;--muted:#5e7780;--line:#d3dfe2;--head:#0f3d4c;--bot:#dcf4ea;--acc:#159a7a;--lead:#fff8e6;--leadl:#e8c766;--bad:#b3261e;--good:#1b7f4b}
@media (prefers-color-scheme:dark){:root{--bg:#0b1a1f;--panel:#12252b;--ink:#e4f0ee;--muted:#8fa9ae;--line:#23393f;--head:#0e2f39;--bot:#15463c;--acc:#2bbf98;--lead:#2e2811;--leadl:#9c8436;--bad:#ff8a80;--good:#6fd39c}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-family:system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif}`;

export const ADMIN_CSS = `${BASE_CSS}
.top{background:var(--head);color:#fff;padding:12px 16px;display:flex;align-items:center;gap:12px;position:sticky;top:0;z-index:5}.top b{font-size:17px;flex:1}.top a{color:#cfe9e2;font-size:14px;text-decoration:none}
.w{max-width:760px;margin:0 auto;padding:16px}h2{font-size:19px;margin:18px 0 8px}h3{font-size:16px;margin:16px 0 6px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:14px 16px;margin:10px 0}.card b{font-size:17px}.mut{color:var(--muted);font-size:14px}
.tags{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0}.tag{font-size:12.5px;padding:3px 9px;border-radius:99px;border:1px solid var(--line);color:var(--muted)}.tag.ok{border-color:var(--good);color:var(--good)}.tag.no{border-color:var(--bad);color:var(--bad)}
.row{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}.btn{display:inline-block;padding:9px 14px;border-radius:10px;border:1px solid var(--line);background:var(--panel);color:var(--ink);font-size:14.5px;text-decoration:none;cursor:pointer}
.btn.p{background:var(--acc);border-color:var(--acc);color:#fff;font-weight:600}.btn.d{color:var(--bad)}.btn:disabled{opacity:.5}
label{display:block;font-weight:600;margin:14px 0 4px;font-size:15px}label small{font-weight:400;color:var(--muted);display:block;margin-top:2px;line-height:1.4}
input[type=text],input[type=number],select,textarea{width:100%;padding:11px 12px;border:1px solid var(--line);border-radius:10px;font:inherit;font-size:16px;background:var(--panel);color:var(--ink)}textarea{min-height:92px;line-height:1.45}
.msg{border-radius:12px;padding:10px 14px;margin:12px 0;line-height:1.5;font-size:15px}.msg.e{background:#fdecea;color:#8c1d18}.msg.w{background:var(--lead);border:1px solid var(--leadl)}.msg.g{background:var(--bot)}
@media (prefers-color-scheme:dark){.msg.e{background:#3b1512;color:#ffb4ab}}
pre{white-space:pre-wrap;word-break:break-word;background:var(--bg);border-radius:10px;padding:10px 12px;font:13.5px/1.5 ui-monospace,Menlo,Consolas,monospace;margin:6px 0}[hidden]{display:none!important}`;
