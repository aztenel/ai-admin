// Ошибки обращения к серверу пульта.
/** Ошибка с текстом для человека: сервер пульта сам пишет понятные причины («Клиент писал больше 24 часов назад…»). */
export class ApiError extends Error {
  readonly status: number;
  readonly offline: boolean;
  constructor(message: string, status: number, offline = false) {
    super(message);
    this.status = status;
    this.offline = offline;
  }
}
