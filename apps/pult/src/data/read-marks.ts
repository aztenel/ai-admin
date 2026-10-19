// Отметки «прочитано» на этом устройстве. Счётчика непрочитанных на сервере пока нет (после фазы 2 — chats.unread_count),
// поэтому пульт помнит, когда администратор открывал каждый чат. Первый вход на устройстве считает прочитанным всё,
// что было до него: иначе весь список загорелся бы «новым».
const KEY = "pult2.read";
type Store = Record<string, { base: number; m: Record<string, number> }>;

function load(): Store {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "{}") as Store;
  } catch {
    return {};
  }
}

export function readMarks() {
  let s = load();
  const save = () => {
    try {
      // не больше 500 чатов на компанию: старые отметки отбрасываем
      for (const ws of Object.keys(s)) {
        const e = Object.entries(s[ws].m);
        if (e.length > 500) s[ws].m = Object.fromEntries(e.sort((a, b) => b[1] - a[1]).slice(0, 500));
      }
      localStorage.setItem(KEY, JSON.stringify(s));
    } catch {
      /* частный режим браузера — отметки живут до закрытия вкладки */
    }
  };
  const ensure = (ws: string) => {
    if (!s[ws]) {
      s[ws] = { base: Date.now(), m: {} };
      save();
    }
    return s[ws];
  };
  return {
    forWorkspace(ws: string) {
      s = load();
      const w = ensure(ws);
      return (key: string, at: number) => at <= Math.max(w.base, w.m[key] || 0);
    },
    mark(ws: string, key: string, at = Date.now()) {
      const w = ensure(ws);
      w.m[key] = Math.max(w.m[key] || 0, at);
      save();
    },
  };
}
