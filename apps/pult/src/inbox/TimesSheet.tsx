// «Свободное время» прямо в чате (ТЗ v2.0 §7): мастер, услуга, день → свободные начала, где услуга помещается целиком (тот же расчёт,
// что у записи с сайта). Только смотреть: записать — в Altegio или ответом клиенту; найденное время можно скопировать.
import { Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { Sheet, toast } from "@/components/overlay";
import { Button } from "@/components/ui";
import { store } from "@/state/store";

type Cat = { available: boolean; why?: string; staff?: { id: string; name: string }[]; services?: { key: string; name: string; min: number; price: number }[]; today?: string };
type Times = { available?: boolean; date?: string | null; next?: string | null; slots?: { time: string; end: string; staff: string; price: number; min: number }[]; error?: string };

export function TimesSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [cat, setCat] = useState<Cat | null>(null);
  const [staff, setStaff] = useState("");
  const [svc, setSvc] = useState("");
  const [date, setDate] = useState("");
  const [res, setRes] = useState<Times | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open || cat) return;
    store.inboxApi<Cat>("/api/inbox/catalog").then((c) => {
      setCat(c);
      setSvc(c.services?.[0]?.key || "");
      setDate(c.today || "");
    }, (e: unknown) => setCat({ available: false, why: e instanceof Error ? e.message : "Altegio не ответил" }));
  }, [open, cat]);
  const look = async () => {
    setBusy(true);
    try {
      const q = new URLSearchParams({ services: svc, ...(staff ? { staff } : {}), ...(date ? { date } : {}) });
      setRes(await store.inboxApi<Times>("/api/inbox/times?" + q.toString()));
    } catch (e) {
      setRes({ error: e instanceof Error ? e.message : "Altegio не ответил" });
    }
    setBusy(false);
  };
  const name = (id: string) => cat?.staff?.find((m) => m.id === id)?.name || "";
  const copy = (t: string) => navigator.clipboard?.writeText(t).then(() => toast("Скопировано — вставьте в ответ"), () => toast(t));
  const field = "h-11 w-full rounded-lg border border-line bg-surface px-3 text-md outline-none focus:border-accent md:h-10 md:text-ui";
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Свободное время" description="Из Altegio, только посмотреть. Записать — в Altegio.">
      <div className="space-y-3 px-4 pb-4">
        {!cat ? (
          <p className="text-ui text-fg-3">Загружаю мастеров и услуги…</p>
        ) : !cat.available ? (
          <p className="text-ui text-fg-2">{cat.why || "Свободное время недоступно."}</p>
        ) : (
          <>
            <label className="block text-sm text-fg-2">
              Мастер
              <select value={staff} onChange={(e) => setStaff(e.target.value)} className={field}>
                <option value="">Любой мастер</option>
                {cat.staff?.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm text-fg-2">
              Услуга
              <select value={svc} onChange={(e) => setSvc(e.target.value)} className={field}>
                {cat.services?.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.name} · {s.min} мин
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm text-fg-2">
              День
              <input type="date" value={date} min={cat.today} onChange={(e) => setDate(e.target.value)} className={field} />
            </label>
            <Button variant="primary" className="w-full" busy={busy} onClick={() => void look()}>
              Показать время
            </Button>
          </>
        )}
        {res?.error && <p className="text-ui text-critical">{res.error}</p>}
        {res && !res.error && (
          <div>
            {res.slots?.length ? (
              <>
                <p className="mb-2 text-sm text-fg-3">{res.date}: услуга помещается целиком</p>
                <div className="flex flex-wrap gap-2">
                  {res.slots.slice(0, 24).map((s) => (
                    <button key={s.time + s.staff} type="button" onClick={() => copy(`${res.date?.split("-").reverse().join(".")} в ${s.time}, мастер ${name(s.staff)}`)} className="rounded-full border border-line px-3 py-1.5 text-sm tnum hover:bg-surface-2">
                      {s.time} · {name(s.staff)}
                    </button>
                  ))}
                </div>
                <p className="mt-2 flex items-center gap-1 text-xs text-fg-3">
                  <Copy aria-hidden className="size-3.5" /> Нажмите на время — скопируется для ответа клиенту
                </p>
              </>
            ) : (
              <p className="text-ui text-fg-2">Свободного времени в этот день нет{res.next ? ` — ближайший день: ${res.next.split("-").reverse().join(".")}` : ""}.</p>
            )}
          </div>
        )}
      </div>
    </Sheet>
  );
}
