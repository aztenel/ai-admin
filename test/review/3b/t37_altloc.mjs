// altLoc: which location is used for the chat, depending on env.ALTEGIO_LOC_<ID> and CLIENTS[id].altegio.location (alt: 1398319 in code).
import { mk, show, D1 } from "./lib.mjs";
const h = await mk({});
const _log = console.log; console.log = (...a) => { if (!/^(guard|altegio|gemini)/.test(String(a[0]))) _log(...a); };
let n = 0;
for (const [client, envName, val] of [["alt", null, null], ["alt", "ALTEGIO_LOC_ALT", "555"], ["alt", "ALTEGIO_LOC_ALT", " 556 "], ["alt", "ALTEGIO_LOC_ALT", "0"], ["alt", "ALTEGIO_LOC_ALT", ""], ["alt", "ALTEGIO_LOC_ALT", "abc"], ["alt", "ALTEGIO_LOC_ALT", "557abc"], ["alt", "ALTEGIO_LOC_ALT", "-5"], ["alt", "ALTEGIO_LOC_ALT", "1e3"], ["alt", "ALTEGIO_LOC_ALT", 558], ["alt", "ALTEGIO_LOC_alt", "559"], ["barber", "ALTEGIO_LOC_BARBER", "560"], ["barber", null, null], ["dent", "ALTEGIO_LOC_ALT", "561"]]) {
  for (const k of Object.keys(h.env)) if (k.startsWith("ALTEGIO_LOC_")) delete h.env[k];
  if (envName) h.env[envName] = val;
  h.ALT.calls.length = 0; h.calls.tg.length = 0; h.gemini = ["Здравствуйте!"];
  await h.chat(client, "al" + (++n), "Привет");
  const first = h.ALT.calls[0] || "(no Altegio call — works as a plain client)";
  _log(`${client.padEnd(6)} ${envName ? envName + "=" + JSON.stringify(val) : "(no env)"} → ${first}${h.sys().includes("Запись в расписание") ? "" : " | prompt WITHOUT schedule rules; windows: " + (h.sys().match(/Свободные окна для записи[^\n]*\n([^\n]*)/) || ["", ""])[1].slice(0, 60)}`);
}
