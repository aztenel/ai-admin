import { execFileSync } from "node:child_process";
const D = import.meta.dirname;
const run = w => JSON.parse(execFileSync("node", [D + "/t40_regular_diff.mjs"], { env: { ...process.env, ...(w ? { WORKER: w } : {}) }, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).split("\n").find(l => l.startsWith("JSON:")).slice(5));
const dev = run(null), main = run(D + "/worker_main.mjs");
for (let i = 0; i < dev.length; i++) {
  const a = main[i], b = dev[i], same = JSON.stringify(a) === JSON.stringify(b);
  console.log(`${same ? "  =  " : " [≠] "}${b.name}`);
  if (!same) console.log(`        main: lead=${JSON.stringify(a.lead)} | «${a.reply}»\n        dev : lead=${JSON.stringify(b.lead)} | «${b.reply}»`);
}
