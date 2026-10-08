// Собирает страницу пульта из папки pult/ в один модуль pult.gen.js (его подключает worker.js).
// Запуск: node tools/build-pult.mjs        Проверка, что собранное свежее: node tools/build-pult.mjs --check
import fs from "node:fs";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = f => fs.readFileSync(root + "pult/" + f, "utf8");
const js = { demo: read("demo.js"), app: read("app.js"), views: read("views.js") };
for (const [k, code] of Object.entries(js)) {
  new vm.Script(code, { filename: k + ".js" }); // синтаксис
  if (/<\/script/i.test(code)) throw new Error(k + ".js содержит </script");
}
const css = read("design.base.css") + "\n" + read("layout.css");
const shell = read("shell.html");

function build(demo) {
  const rep = {
    "@@TITLE@@": demo ? "Пульт — демо" : "Чаты — AI-администратор",
    "@@APPTITLE@@": demo ? "Пульт демо" : "Пульт", // подпись под значком на экране «Домой»: демо и рабочий пульт не путаются
    "@@ROBOTS@@": demo ? '<meta name="robots" content="noindex,nofollow">' : '<meta name="robots" content="noindex,nofollow">',
    "@@MANIFEST@@": demo ? "/demo.webmanifest" : "/manifest.webmanifest",
    "@@CSS@@": css,
    "@@DEMOJS@@": demo ? js.demo : "window.__DEMO=false;",
    "@@APPJS@@": js.app,
    "@@VIEWSJS@@": js.views
  };
  let out = shell;
  for (const [k, v] of Object.entries(rep)) out = out.split(k).join(v); // split/join: в тексте могут быть символы «$»
  if (/@@[A-Z]+@@/.test(out)) throw new Error("остался незаполненный маркер " + out.match(/@@[A-Z]+@@/)[0]);
  return out;
}
const b64 = n => fs.readFileSync(root + "pult/icon-" + n + ".png").toString("base64");
const gen = "// Сгенерировано командой `node tools/build-pult.mjs` из папки pult/. Руками не править: правки пропадут при следующей сборке.\n" +
  "export const PULT_LIVE = " + JSON.stringify(build(false)) + ";\n" +
  "export const PULT_DEMO = " + JSON.stringify(build(true)) + ";\n" +
  "export const PULT_ICONS = " + JSON.stringify({ 180: b64(180), 192: b64(192), 512: b64(512) }) + ";\n";
const target = root + "pult.gen.js";
if (process.argv.includes("--check")) {
  const cur = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : "";
  if (cur !== gen) { console.error("pult.gen.js устарел: запустите node tools/build-pult.mjs"); process.exit(1); }
  console.log("pult.gen.js свежий");
} else { fs.writeFileSync(target, gen); console.log("pult.gen.js собран:", (gen.length / 1024).toFixed(0), "КБ"); }
