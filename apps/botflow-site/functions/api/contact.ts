/**
 * Cloudflare Pages Function: POST /api/contact — сообщение из формы на странице «Контакты» уходит в Telegram.
 *
 * Переменные проекта Pages (Settings → Variables and Secrets):
 *   TG_TOKEN (Secret) — токен бота Telegram, TG_CHAT (Text) — id чата, можно несколько через запятую.
 * Форма на сайте появляется только при сборке с PUBLIC_CONTACT_FORM=1.
 * Без переменных — честный 503, сообщение никуда не «теряется молча».
 */
interface Env { TG_TOKEN?: string; TG_CHAT?: string }

const MAX = { name: 120, contact: 160, company: 160, message: 4000 } as const;
const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).host !== new URL(request.url).host) return json(403, { error: "Запрос с другого сайта." });
  if (Number(request.headers.get("content-length") || 0) > 16_000) return json(413, { error: "Слишком длинное сообщение." });

  let data: Record<string, unknown>;
  try { data = (await request.json()) as Record<string, unknown>; } catch { return json(400, { error: "Не удалось прочитать форму." }); }

  // ловушка и слишком быстрая отправка — скорее всего бот: отвечаем «ок» и ничего не делаем
  const started = Number(data.t);
  if (str(data.website, 200) || (started && Date.now() - started < 3000)) return json(200, { ok: true });

  const name = str(data.name, MAX.name), contact = str(data.contact, MAX.contact);
  const company = str(data.company, MAX.company), message = str(data.message, MAX.message);
  if (!name || !contact || !message) return json(400, { error: "Заполните имя, способ связи и задачу." });
  if (data.consent !== true) return json(400, { error: "Нужно согласие на обработку данных." });

  if (!env.TG_TOKEN || !env.TG_CHAT) return json(503, { error: "Форма временно не работает. Напишите нам другим способом со страницы «Контакты»." });

  const head = [`Заявка с сайта`, `Имя: ${name}`, `Связь: ${contact}`];
  if (company) head.push(`Компания: ${company}`);
  const text = `${head.join("\n")}\n\n${message}`;
  const chats = env.TG_CHAT.split(",").map((c) => c.trim()).filter(Boolean);
  let sent = 0;
  for (const chat_id of chats) {
    try {
      const r = await fetch(`https://api.telegram.org/bot${env.TG_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id, text, disable_web_page_preview: true }),
        signal: AbortSignal.timeout(5000),
      });
      if (r.ok) sent++;
      else console.log("contact tg", r.status);
    } catch (e) {
      console.log("contact tg error", (e as Error).name);
    }
  }
  return sent ? json(200, { ok: true }) : json(502, { error: "Не получилось отправить. Попробуйте ещё раз чуть позже." });
};

export const onRequest: PagesFunction<Env> = () => json(405, { error: "Только POST." });
