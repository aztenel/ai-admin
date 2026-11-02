// Ошибки обращения к серверу пульта.
/**
 * Ошибка с текстом для человека: сервер пульта сам пишет понятные причины («Клиент писал больше 24 часов назад…»).
 * errors — список ошибок формы (рассылки и автосценарий отвечают `{ ok: false, errors: [...] }`: показать каждую строкой);
 * confirm — сервер спрашивает подтверждение (`409 { confirm }` при «Запустить» с сигналом Meta: «да» — тот же запрос с force;
 * `409 { confirm, final }` — итоговая аудитория рассылки со второго номера: «да» — тот же запрос с sure и числом final.n).
 */
export class ApiError extends Error {
  readonly status: number;
  readonly offline: boolean;
  readonly errors?: string[];
  readonly confirm?: string;
  /** Поле формы, к которому относится ошибка (раздел «Клиенты»: `{ error, field }`). */
  readonly field?: string;
  /** Код отказа сервера («ga_off», «preview», «empty», «notest») — пульт по нему выбирает короткое объяснение. */
  readonly code?: string;
  /** Пробная отправка, которая не ушла: как сообщение увидит клиент (второй номер, вымышленный клиент). */
  readonly preview?: string;
  /** Запуск выключен (ga_off): как его включить — текст сервера, только владельцу. */
  readonly how?: string;
  /** Итоговая аудитория перед запуском (вместе с confirm) — как прислал сервер; разбирает data/live-campaigns.ts. */
  readonly final?: Record<string, unknown>;
  constructor(message: string, status: number, offline = false, extra?: { errors?: string[]; confirm?: string; field?: string; code?: string; preview?: string; how?: string; final?: Record<string, unknown> }) {
    super(message);
    this.status = status;
    this.offline = offline;
    if (extra?.errors) this.errors = extra.errors;
    if (extra?.confirm) this.confirm = extra.confirm;
    if (extra?.field) this.field = extra.field;
    if (extra?.code) this.code = extra.code;
    if (extra?.preview) this.preview = extra.preview;
    if (extra?.how) this.how = extra.how;
    if (extra?.final) this.final = extra.final;
  }
}
