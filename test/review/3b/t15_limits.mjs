// Rate limits: tooMany (sessions per IP) and the Altegio booking limits; ipKey for IPv4 / IPv6 / missing / garbage.
import { mk, show, D1, D2, J } from "./lib.mjs";
const h = await mk({ env: { ALTEGIO_LOC_ALT: "4150" } });
const _log = console.log; console.log = (...a) => { if (!/^(guard|altegio|gemini)/.test(String(a[0]))) _log(...a); };
const ipKeys = () => [...h.mem.keys()].filter(k => k.startsWith("ip:")).map(k => `${k}=${h.mem.get(k)}`);
const bkKeys = () => [...h.mem.keys()].filter(k => k.startsWith("bk:")).map(k => `${k}=${h.mem.get(k)}`);
h.gemini = ["Мужская стрижка от 6 000 ₸. Записать вас?"];

_log("=== A. tooMany: KV keys produced for different cf-connecting-ip values (barber, new session each)");
let n = 0;
for (const ip of ["203.0.113.7", "2a03:d000:1:2:aaaa:bbbb:cccc:1", "2a03:d000:1:2::9", "2a03:d000:1:3::9", "2001:db8::1", "2001:db8::2", "2001:db8::aaaa:1", "2001:db8:0:0:1::1", "::ffff:203.0.113.7", "::1", "", null, "garbage!!", ":::::", "2A03:D000:1:2::9"]) {
  const before = new Set(ipKeys().map(x => x.split("=")[0]));
  const d = await h.chatIp("barber", "ip" + (++n), "Сколько стоит стрижка?", ip);
  const added = ipKeys().filter(x => !before.has(x.split("=")[0]));
  _log(`  ip=${JSON.stringify(ip)} → new key: ${JSON.stringify(added)}${added.length ? "" : "  (counted into an existing key: " + ipKeys().join(", ").slice(0, 0) + ")"} status=${d.__status}`);
}
_log("  all ip keys: " + JSON.stringify(ipKeys(), null, 0));

_log("\n=== B. same /64, different hosts: 9th new session is refused (limit 8/day)");
let last; for (let i = 0; i < 9; i++) last = await h.chatIp("barber", "v6s" + i, "Сколько стоит стрижка?", `2a03:d000:7:7:${i + 1}::${i + 5}`);
_log("  9th: " + last.reply);
_log("=== B2. a /64 written with «::» inside the first four groups (2001:db8::/64) — hosts vary in the 5th group");
for (let i = 0; i < 9; i++) last = await h.chatIp("barber", "v6z" + i, "Сколько стоит стрижка?", `2001:db8::${i + 1}:0:0:5`);
_log("  9th: " + last.reply.slice(0, 60) + "  | keys: " + ipKeys().filter(k => k.includes("2001:db8::")).length);

_log("\n=== C. booking limit per IP: 6 chats, 6 different phones, same IPv4 → 6th goes to the administrator");
const names = ["Арсен", "Бекзат", "Виктор", "Галым", "Дамир", "Нурлан"], tms = ["10:00", "11:00", "13:00", "09:30", "10:00", "11:00"];
h.ALT.records.length = 0;
for (let i = 0; i < 6; i++) { h.gemini = ["Записала.\n" + h.tag(names[i], "Мужская стрижка", "любой", D1, tms[i])]; last = await h.chatIp("alt", "lim" + i, `${names[i]}, +7 707 10${i} 11 22, мужская стрижка завтра в ${tms[i]}`, "198.51.100.9"); }
_log(`  records: ${h.ALT.records.length}; 6th lead note: ${last.lead && last.lead.note}`);
_log("  bk keys: " + JSON.stringify(bkKeys()));

_log("\n=== D. no cf-connecting-ip header at all: per-IP booking limit is skipped, phone + location limits remain");
h.env.ALTEGIO_LOC_ALT = "4151"; h.ALT.records.length = 0;
for (let i = 0; i < 6; i++) { h.gemini = ["Записала.\n" + h.tag(names[i], "Мужская стрижка", "любой", D1, tms[i])]; last = await h.chatIp("alt", "nohdr" + i, `${names[i]}, +7 707 20${i} 11 22, мужская стрижка завтра в ${tms[i]}`, null); }
_log(`  records: ${h.ALT.records.length}; 6th: ${last.reply.slice(0, 80)}`);
_log("  bk keys for 4151: " + JSON.stringify(bkKeys().filter(k => k.includes(":4151:"))));

_log("\n=== E. /64 with «::» in the prefix: booking limit per IP can be dodged by changing the 5th group");
h.env.ALTEGIO_LOC_ALT = "4152"; h.ALT.records.length = 0;
for (let i = 0; i < 6; i++) { h.gemini = ["Записала.\n" + h.tag(names[i], "Мужская стрижка", "любой", D1, tms[i])]; last = await h.chatIp("alt", "v6b" + i, `${names[i]}, +7 707 30${i} 11 22, мужская стрижка завтра в ${tms[i]}`, `2001:db8::${i + 1}:0:0:9`); }
_log(`  records: ${h.ALT.records.length} (limit is 5 per IP per day)`);
_log("  bk keys for 4152: " + JSON.stringify(bkKeys().filter(k => k.includes(":4152:"))));
