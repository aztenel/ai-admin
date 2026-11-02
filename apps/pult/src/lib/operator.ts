// Имя сотрудника на этом устройстве (ТЗ v2.0 §2.5). Вход в пульт — общий ключ компании, поэтому «кто ответил», «назначено мне» и
// push по сотруднику — по имени, которое сотрудник вводит один раз; сервер подписывает им ответы и действия (src/services/inbox/operator.js).
const KEY = "pult.op";
const clean = (s: string) => s.replace(/[\u0000-\u001f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 32);

export function getOperator(): string {
  try {
    return clean(localStorage.getItem(KEY) || "");
  } catch {
    return "";
  }
}
export function setOperator(name: string) {
  try {
    localStorage.setItem(KEY, clean(name));
  } catch {
    /* частный режим — имя до закрытия вкладки не сохранится */
  }
}
