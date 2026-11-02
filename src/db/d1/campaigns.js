// @ts-check
// Итоги одной рассылки в D1 (ТЗ v3.0 P0, 31.10.2026): по отчётам о сообщениях с номером рассылки (events.campaign_id, kind msg_*) —
// сколько получателей: ушло, доставлено, прочитано, не дошло, ответили; и сколько из получивших записались в Altegio после своего
// сообщения (bookings: время создания записи provider_created_at, без него — когда синхронизация её впервые увидела) в окне windowMs.
// Это связь по времени, а не доказательство, что записались из-за сообщения. Отменённые записи не считаются. Каждый получатель — один раз.

/** @param {any} db @param {string} ws @param {string} id @param {number} windowMs */
export async function campaignResults(db, ws, id, windowMs) {
  const [ev, bk] = await db.batch([
    db.prepare(`select kind, count(distinct coalesce(contact_id, event_key)) n from events where ws = ?1 and campaign_id = ?2
      and kind in ('msg_sent', 'msg_delivered', 'msg_read', 'msg_failed', 'msg_replied') group by kind`).bind(ws, id),
    db.prepare(`select count(distinct e.contact_id) n from events e join bookings b on b.ws = e.ws and b.contact_id = e.contact_id
      where e.ws = ?1 and e.campaign_id = ?2 and e.kind = 'msg_sent' and e.contact_id is not null and b.deleted = 0
        and coalesce(b.provider_created_at, b.first_seen_at) > e.at and coalesce(b.provider_created_at, b.first_seen_at) <= e.at + ?3`).bind(ws, id, windowMs)
  ]);
  /** @type {Record<string, number>} */
  const by = {};
  for (const r of ev.results || []) by[String(r.kind).replace(/^msg_/, "")] = +r.n || 0;
  return { sent: by.sent || 0, delivered: by.delivered || 0, read: by.read || 0, failed: by.failed || 0, replied: by.replied || 0, booked: +(((bk.results || [])[0] || {}).n || 0) };
}
