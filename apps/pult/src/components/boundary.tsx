// Раздел или мастер, который грузится отдельным файлом, не загрузился: нет связи (лифт, метро), а файл раздела ещё не скачан, или после
// выкладки файлов прежней сборки уже нет. Без этой рамки React оставлял бы пустой экран. Здесь — «не загрузился» и «Повторить».
// «Повторить» перезагружает страницу: неудачную загрузку файла браузер запоминает до перезагрузки, повторный запрос его не скачает.
// Пока связи нет, перезагрузка увела бы на страницу браузера «нет интернета», откуда в приложении с экрана «Домой» не выйти, —
// тогда только подсказка (находка проверки 19.10.2026).
import { CircleAlert, RefreshCw, WifiOff } from "lucide-react";
import { Component, type ReactNode } from "react";
import { Button, EmptyState } from "./ui";

/** Ошибка загрузки файла раздела (Chrome, Safari, Firefox; Vite — «Unable to preload CSS»). */
const CHUNK = /dynamically imported module|Importing a module script failed|module script|Unable to preload|Failed to fetch/i;

type Props = { children: ReactNode; /** «Раздел», «Мастер рассылки» — кто не загрузился. */ what?: string; /** Кнопка «Закрыть» (лист, мастер). */ onClose?: () => void };
type State = { error: Error | null; offline: boolean };

export class ChunkBoundary extends Component<Props, State> {
  state: State = { error: null, offline: false };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  retry = () => {
    if (!navigator.onLine) return this.setState({ offline: true });
    location.reload();
  };

  render() {
    const { error, offline } = this.state;
    if (!error) return this.props.children;
    const chunk = CHUNK.test(error.message);
    const what = this.props.what || "Раздел";
    return (
      <div className="grid flex-1 place-items-center">
        <EmptyState
          icon={chunk ? WifiOff : CircleAlert}
          title={chunk ? `${what} не загрузился` : `${what} не открылся`}
          text={
            offline
              ? "Связи всё ещё нет. Проверьте интернет и нажмите «Повторить»."
              : chunk
                ? "Похоже, пропала связь. Проверьте интернет и нажмите «Повторить»."
                : "Что-то пошло не так. Нажмите «Повторить», страница обновится."
          }
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button variant="outline" icon={RefreshCw} onClick={this.retry}>
                Повторить
              </Button>
              {this.props.onClose && (
                <Button variant="ghost" onClick={this.props.onClose}>
                  Закрыть
                </Button>
              )}
            </div>
          }
        />
      </div>
    );
  }
}
