// Ошибки обращения к серверу пульта.
/**
 * Ошибка с текстом для человека: сервер пульта сам пишет понятные причины («Клиент писал больше 24 часов назад…»).
 * errors — список ошибок формы (рассылки и автосценарий отвечают `{ ok: false, errors: [...] }`: показать каждую строкой);
 * confirm — сервер спрашивает подтверждение (`409 { confirm }` при «Запустить» с сигналом Meta: «да» — тот же запрос с force).
 */
export class ApiError extends Error {
  readonly status: number;
  readonly offline: boolean;
  readonly errors?: string[];
  readonly confirm?: string;
  /** Поле формы, к которому относится ошибка (раздел «Клиенты»: `{ error, field }`). */
  readonly field?: string;
  constructor(message: string, status: number, offline = false, extra?: { errors?: string[]; confirm?: string; field?: string }) {
    super(message);
    this.status = status;
    this.offline = offline;
    if (extra?.errors) this.errors = extra.errors;
    if (extra?.confirm) this.confirm = extra.confirm;
    if (extra?.field) this.field = extra.field;
  }
}
