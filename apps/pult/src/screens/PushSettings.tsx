// «Уведомления на этом устройстве» (ТЗ v2.0 §3): push приходит и при закрытом пульте. Честно про ограничения: iPhone — только
// с экрана «Домой», доставляют Apple и Google; на экран блокировки по умолчанию — без имени клиента и текста.
import { Bell, BellOff, Send } from "lucide-react";
import { useEffect, useState } from "react";
import { Checkbox, SelectField, TextField } from "@/campaigns/wizard/fields";
import { toast } from "@/components/overlay";
import { Button, Spinner } from "@/components/ui";
import { getOperator, setOperator } from "@/lib/operator";
import { DEFAULT_PREFS, PUSH_KINDS, pushDisable, pushEnable, pushSave, pushState, pushTest, type PushPrefs, type PushState } from "@/lib/push";
import { Group } from "./Page";

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const errText = (e: unknown) => (e instanceof Error && e.message ? e.message : "Не получилось. Попробуйте ещё раз.");

export function PushSettings({ ws }: { ws: string }) {
  const [st, setSt] = useState<PushState | null>(null);
  const [prefs, setPrefs] = useState<PushPrefs>(DEFAULT_PREFS);
  const [name, setName] = useState(getOperator());
  const [busy, setBusy] = useState("");

  useEffect(() => {
    let live = true;
    setSt(null);
    pushState(ws).then((s) => {
      if (!live) return;
      setSt(s);
      if (s.prefs) setPrefs(s.prefs);
      if (s.op) setName(s.op);
    });
    return () => {
      live = false;
    };
  }, [ws]);

  if (!st)
    return (
      <Group>
        <div className="flex items-center gap-3 py-3 text-sm text-fg-2">
          <Spinner /> Проверяю, что умеет это устройство…
        </div>
      </Group>
    );

  if (st.support === "ios-tab")
    return (
      <Group note="Нужен iOS 16.4 или новее. Во вкладке Safari уведомления не приходят, так устроен iPhone.">
        <div className="py-3 text-sm text-fg-2">
          <p className="mb-2 text-ui font-medium text-fg pointer-coarse:text-base">На iPhone уведомления работают, только если пульт добавлен на экран «Домой»</p>
          <ol className="list-decimal space-y-1 pl-5">
            <li>Внизу Safari нажмите «Поделиться» (квадрат со стрелкой).</li>
            <li>Выберите «На экран Домой» и нажмите «Добавить».</li>
            <li>Откройте пульт значком на экране «Домой», войдите и включите уведомления здесь.</li>
          </ol>
        </div>
      </Group>
    );
  if (st.support === "ios-old")
    return (
      <Group>
        <p className="py-3 text-sm text-fg-2">Обновите iPhone до iOS 16.4 или новее: на старых версиях уведомления от сайтов не приходят.</p>
      </Group>
    );
  if (st.support === "unsupported")
    return (
      <Group>
        <p className="py-3 text-sm text-fg-2">Этот браузер не умеет уведомления на закрытый пульт. Работают Chrome и Edge на компьютере и Android, Safari на iPhone с экрана «Домой».</p>
      </Group>
    );
  if (st.permission === "denied")
    return (
      <Group note="Потом закройте и снова откройте пульт.">
        <div className="py-3 text-sm text-fg-2">
          <p className="mb-1 text-ui font-medium text-fg pointer-coarse:text-base">Уведомления для пульта запрещены в настройках</p>
          {isIOS() ? (
            <p>iPhone: «Настройки» → «Уведомления» → «Пульт» → включите «Допуск уведомлений».</p>
          ) : (
            <p>Нажмите значок слева от адреса сайта → «Уведомления» → «Разрешить». На Android в Chrome: ⋮ → «Настройки» → «Настройки сайтов» → «Уведомления».</p>
          )}
        </div>
      </Group>
    );

  const enable = async () => {
    setOperator(name);
    setBusy("on");
    try {
      const s = await pushEnable(ws, prefs);
      setSt(s);
      if (s.prefs) setPrefs(s.prefs);
      if (s.on) toast("Уведомления на этом устройстве включены");
    } catch (e) {
      toast(errText(e), "critical");
    } finally {
      setBusy("");
    }
  };
  const save = async (next: PushPrefs, op = name) => {
    setPrefs(next);
    setOperator(op);
    try {
      const r = await pushSave(ws, next);
      setPrefs(r.prefs);
    } catch (e) {
      toast(errText(e), "critical");
    }
  };

  if (!st.on)
    return (
      <>
        <Group note="Уведомление приходит, даже когда пульт закрыт. Доставляют Apple и Google, обычно за секунды, но время доставки они не обещают.">
          <div className="space-y-1 py-2">
            <TextField label="Ваше имя в пульте" hint="По нему пульт понимает, что чат назначен вам, и присылает уведомление именно вам." value={name} maxLength={32} autoComplete="name" onChange={(e) => setName(e.target.value)} />
            {st.error && <p className="text-sm text-critical">{st.error}</p>}
            <div className="pt-2">
              <Button variant="primary" icon={Bell} busy={busy === "on"} onClick={enable}>
                Включить уведомления
              </Button>
            </div>
          </div>
        </Group>
      </>
    );

  const q = prefs.quiet;
  return (
    <>
      <Group title="Что присылать">
        {PUSH_KINDS.map((k) => (
          <Checkbox key={k.id} checked={prefs.kinds[k.id]} onChange={(v) => save({ ...prefs, kinds: { ...prefs.kinds, [k.id]: v } })}>
            {k.label}
            {k.note && <span className="block text-sm text-fg-3">{k.note}</span>}
          </Checkbox>
        ))}
      </Group>
      <Group title="Не беспокоить" note="По времени Астаны. «Номер WhatsApp перестал работать» приходит всегда.">
        <Checkbox checked={!!q} onChange={(v) => save({ ...prefs, quiet: v ? { from: 21, to: 9 } : null })}>
          Не присылать ночью
        </Checkbox>
        {q && (
          <div className="grid grid-cols-2 gap-3 pb-3">
            <SelectField label="С" value={q.from} onChange={(e) => save({ ...prefs, quiet: { ...q, from: Number(e.target.value) } })}>
              {HOURS.filter((h) => h !== q.to).map((h) => (
                <option key={h} value={h}>
                  {hh(h)}
                </option>
              ))}
            </SelectField>
            <SelectField label="До" value={q.to} onChange={(e) => save({ ...prefs, quiet: { ...q, to: Number(e.target.value) } })}>
              {HOURS.filter((h) => h !== q.from).map((h) => (
                <option key={h} value={h}>
                  {hh(h)}
                </option>
              ))}
            </SelectField>
          </div>
        )}
      </Group>
      <Group title="Экран блокировки" note={prefs.text ? "Имя и текст увидит любой, кто возьмёт телефон в руки." : "Сейчас видно только «Новое сообщение» и номер, без имени и текста."}>
        <Checkbox checked={prefs.text} onChange={(v) => save({ ...prefs, text: v })}>
          Показывать имя клиента и текст сообщения
        </Checkbox>
      </Group>
      <Group>
        <div className="space-y-3 py-3">
          <TextField label="Ваше имя в пульте" value={name} maxLength={32} autoComplete="name" onChange={(e) => setName(e.target.value)} onBlur={() => name !== getOperator() && save(prefs, name)} />
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              icon={Send}
              busy={busy === "test"}
              onClick={async () => {
                setBusy("test");
                try {
                  await pushTest(ws);
                  toast("Проверка отправлена. Уведомление придёт через несколько секунд");
                } catch (e) {
                  toast(errText(e), "critical");
                } finally {
                  setBusy("");
                }
              }}
            >
              Проверить
            </Button>
            <Button
              variant="ghost"
              icon={BellOff}
              busy={busy === "off"}
              className="text-critical hover:bg-critical-soft hover:text-critical"
              onClick={async () => {
                setBusy("off");
                try {
                  await pushDisable(ws);
                  setSt({ ...st, on: false, prefs: null });
                  toast("Уведомления на этом устройстве выключены");
                } catch (e) {
                  toast(errText(e), "critical");
                } finally {
                  setBusy("");
                }
              }}
            >
              Выключить на этом устройстве
            </Button>
          </div>
        </div>
      </Group>
      <p className="-mt-3 mb-4 px-4 text-sm text-fg-3">Уведомление приходит, даже когда пульт закрыт. Доставляют Apple и Google, обычно за секунды, но время доставки они не обещают.</p>
    </>
  );
}
