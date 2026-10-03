// Часы для проверок: всегда суббота, 3 октября 2026, 12:00 по Астане (дальше идут как обычно).
// Свободные окна демо-клиентов зависят от дня недели и времени — с настоящими часами проверки в одни дни проходили бы, а в другие нет.
const Real = Date, T0 = Real.UTC(2026, 9, 3, 7, 0, 0), started = Real.now();
const now = () => T0 + (Real.now() - started);
globalThis.Date = class extends Real {
  constructor(...a) { if (a.length) super(...a); else super(now()); }
  static now() { return now(); }
};
