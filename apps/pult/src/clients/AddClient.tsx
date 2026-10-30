// «Добавить клиента» вручную: номер и имя. Такой номер уже есть — сервер отвечает id существующего (created: false), и раздел открывает
// его карточку с пометкой «уже есть», а не создаёт второго. Ошибка поля (неверный номер) — под полем.
import { useEffect, useState, type FormEvent } from "react";
import { TextField } from "@/campaigns/wizard/fields";
import { Sheet } from "@/components/overlay";
import { Button } from "@/components/ui";
import { store } from "@/state/store";
import { errField, errMsg } from "./common";

export function AddClient({ ws, open, onOpenChange, onDone }: { ws: string; open: boolean; onOpenChange: (v: boolean) => void; onDone: (id: string, created: boolean) => void }) {
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ field: string; text: string } | null>(null);
  useEffect(() => {
    if (!open) return;
    setPhone("");
    setName("");
    setErr(null);
  }, [open]);

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!phone.trim()) return setErr({ field: "phone", text: "Введите номер телефона." });
    setBusy(true);
    setErr(null);
    try {
      const r = await store.source!.addContact(ws, phone.trim(), name.trim());
      onDone(r.id, r.created);
    } catch (x) {
      setErr({ field: errField(x), text: errMsg(x) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Новый клиент"
      description="Номер — обязательно, имя — по желанию. Согласие на рекламу и запреты — в карточке клиента."
      footer={
        <Button variant="primary" size="lg" className="mb-1 w-full" busy={busy} onClick={() => void submit()}>
          Добавить
        </Button>
      }
    >
      <form onSubmit={(e) => void submit(e)} className="px-4" noValidate>
        <TextField
          label="Номер телефона"
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="off"
          placeholder="+7 700 000 00 00"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          error={err && (err.field === "phone" || !err.field) ? err.text : undefined}
        />
        <TextField
          label="Имя"
          name="name"
          optional
          autoComplete="off"
          maxLength={60}
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={err && err.field === "name" ? err.text : undefined}
        />
        <button type="submit" className="sr-only" tabIndex={-1}>
          Добавить
        </button>
      </form>
    </Sheet>
  );
}
