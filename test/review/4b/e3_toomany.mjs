// E. tooMany: limits depend on whether the client has an Altegio location (30 msgs/min and 40 new chats/day vs 12 and 8); env SESSIONS_PER_IP; IPv6 /64.
import { mk } from "./lib.mjs";
import * as W from "./worker.x.mjs";
const h = await mk(); const log = h.quiet();
h.loc(9501); h.gemini = ["Здравствуйте! Чем помочь?"];
const blocked = r => /Слишком много сообщений/.test(r.reply);
async function burst(c, ip, n, sidPrefix, sameSid) { let ok = 0, first = 0; for (let i = 1; i <= n; i++) { const r = await h.chatIp(c, sameSid ? sidPrefix : sidPrefix + i, "Привет", ip); if (blocked(r)) { if (!first) first = i; } else ok++; } return `${ok} answered, first blocked at #${first || "-"}`; }

log("######## messages per minute from one IP (same chat, so the daily new-chat counter is not involved)");
log("demo client (dent), 14 msgs:", await burst("dent", "20.0.0.1", 14, "m-dent", true));
log("Altegio client (alt), 33 msgs:", await burst("alt", "20.0.0.2", 33, "m-alt", true));
log("mixed: 12 msgs to dent, then alt from the same IP:", await burst("dent", "20.0.0.3", 12, "m-mix-d", true), "| alt:", await burst("alt", "20.0.0.3", 20, "m-mix-a", true), "| dent again:", await burst("dent", "20.0.0.3", 1, "m-mix-d", true));

log("\n######## new chats per day from one IP (each message = new chat; different IPs are used per test to stay below the per-minute limit)");
log("demo client, 10 new chats:", await burst("dent", "20.0.1.1", 10, "s-dent-"));
log("Altegio client, 28 new chats (per-minute limit 30 would stop a longer burst):", await burst("alt", "20.0.1.2", 28, "s-alt-"));
h.mem.set("ip:20.0.1.3:" + new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 10), "39");
log("Altegio client, counter preset to 39:", await burst("alt", "20.0.1.3", 3, "s-alt39-"));
h.mem.set("ip:20.0.1.4:" + new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 10), "9");
log("IP with 9 chats today: demo →", await burst("dent", "20.0.1.4", 1, "s-x-"), "| alt →", await burst("alt", "20.0.1.4", 1, "s-y-"));
h.env.SESSIONS_PER_IP = "3";
log("SESSIONS_PER_IP=3: demo →", await burst("dent", "20.0.2.1", 5, "s3-dent-"), "| alt →", await burst("alt", "20.0.2.2", 5, "s3-alt-"));
h.env.SESSIONS_PER_IP = "100";
log("SESSIONS_PER_IP=100: demo, 11 new chats →", await burst("dent", "20.0.2.3", 11, "s100-dent-"));
delete h.env.SESSIONS_PER_IP;
h.env.ALTEGIO_LOC_BARBER = "9502";
log("barber with ALTEGIO_LOC_BARBER set, 14 msgs:", await burst("barber", "20.0.3.1", 14, "m-barber", true));
delete h.env.ALTEGIO_LOC_BARBER;

log("\n######## IPv6: grouped by /64 (burst counter and daily counter)");
log("2001:db8:1:2::<host>, 14 msgs from 14 different hosts of one /64, demo client:");
{ let ok = 0, first = 0; for (let i = 1; i <= 14; i++) { const r = await h.chatIp("dent", "v6-" + i, "Привет", `2001:db8:1:2::${i.toString(16)}`); if (blocked(r)) { if (!first) first = i; } else ok++; } log(`   ${ok} answered, first blocked at #${first || "-"}`); }
log("KV day counters:", [...h.mem.keys()].filter(k => k.startsWith("ip:2001") || k.startsWith("ip:20.0.1.1")).map(k => k + "=" + h.mem.get(k)).join(" | "));
log("\n######## ipKey");
for (const ip of ["1.2.3.4", "::ffff:1.2.3.4", "::1", "2001:db8:1:2:3:4:5:6", "2001:DB8:1:2::9", "2001:0db8:0001:0002::", "2001:db8::1", "fe80::1%eth0", "64:ff9b::1.2.3.4", "", "local", " 1.2.3.4 ", "2001:db8:1:2:3:4:5", "::", "1:2:3:4:5:6:7:8:9"]) log(`  ${JSON.stringify(ip)} → ${JSON.stringify(W.ipKey(ip))}`);
process.exit(0);
