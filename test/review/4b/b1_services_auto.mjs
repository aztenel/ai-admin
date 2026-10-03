// B. altPickServices on realistic price lists — automatic variants of every title.
// The lists go through the real altBase() (altText, altUniq) via a stubbed fetch, so titles are exactly what the bot shows to the LLM.
import * as W from "./worker.x.mjs";
import { LISTS } from "./b_lists.mjs";

const J = (o, status = 200) => new Response(JSON.stringify(o), { status });
let cur = null;
globalThis.fetch = async u => {
  const url = String(u);
  if (/book_services/.test(url)) return J({ success: true, data: { services: cur.services, category: cur.category || [] } });
  if (/book_staff/.test(url)) return J({ success: true, data: cur.staff || [] });
  throw new Error("unexpected " + url);
};
const env = { ALTEGIO_PARTNER: "k" };
let locN = 7000, stats = { ok: 0, ask: 0, wrong: 0 };
const fmtTail = x => ` — ${x.min ? `от ${String(x.min).replace(/\B(?=(\d{3})+(?!\d))/g, " ")} ₸` : "цену уточняет мастер"}${x.minutes ? `, около ${x.minutes} мин` : ""}`;
const variants = (x) => {
  const t = x.title, v = [];
  v.push(["exact", t]);
  v.push(["lower", t.toLowerCase()]);
  v.push(["upper", t.toUpperCase()]);
  v.push(["trailing dot", t + "."]);
  v.push(["quotes", `«${t}»`]);
  v.push(["with prompt tail", t + fmtTail(x)]);
  v.push(["with price tail only", t + ` — от ${x.min} ₸`]);
  v.push(["with (N мин)", t + ` (${x.minutes} мин)`]);
  v.push(["with ', N мин'", t + `, ${x.minutes} мин`]);
  v.push(["hyphen for dash", t.replace(/[—–]/g, "-")]);
  v.push(["no emoji/quotes", t.replace(/[^\p{L}\p{N}\s+\-()\/.,№&—–]/gu, "").replace(/\s+/g, " ").trim()]);
  v.push(["е for ё", t.replace(/ё/g, "е").replace(/Ё/g, "Е")]);
  v.push(["no № sign", t.replace(/№\s*/g, "")]);
  v.push(["No instead of №", t.replace(/№/g, "N")]);
  v.push(["spaces around +", t.replace(/\s*\+\s*/g, "+")]);
  v.push(["и instead of +", t.replace(/\s*\+\s*/g, " и ")]);
  v.push(["bullet prefix", "· " + t]);
  v.push(["услуга prefix", "услуга " + t]);
  return v.filter(([, s], i, a) => s && a.findIndex(z => z[1] === s) === i);
};
for (const [name, L] of Object.entries(LISTS)) {
  cur = L; const base = await W.altBase(env, ++locN, Date.now());
  console.log(`\n################ ${name}: ${base.services.length} services as the bot shows them`);
  const byId = new Map(base.services.map(x => [x.id, x]));
  const rows = [];
  for (const x of base.services) for (const [vn, s] of variants(x)) {
    const r = W.altPickServices(base.services, s);
    const got = r ? r.map(z => z.title) : null;
    if (r && r.length === 1 && r[0].id === x.id) { stats.ok++; continue; }
    if (!r) { stats.ask++; rows.push(`  ask    [${vn}] «${s}»  (title: «${x.title}»)`); continue; }
    stats.wrong++; rows.push(`  WRONG  [${vn}] «${s}» → ${JSON.stringify(got)}  (title: «${x.title}»)`);
  }
  console.log(rows.join("\n") || "  all variants resolved to their own title");
}
console.log("\nTOTAL", JSON.stringify(stats));
