/** Cron: إشعار Web Push عند انتهاء مدة البريك */

export const BREAK_EXPIRY_CRON_VERSION = '2026-09-break-expiry-v3-types';

type BreakRow = {
  id: string;
  user_id: string;
  break_type?: string | null;
  started_at: string;
  planned_duration_minutes: number | null;
  remaining_seconds: number | null;
  expiry_notified_at?: string | null;
};

function balanceSeconds(row: BreakRow): number {
  if (row.remaining_seconds != null && Number.isFinite(Number(row.remaining_seconds))) {
    return Number(row.remaining_seconds);
  }
  return Math.max(0, (Number(row.planned_duration_minutes) || 0) * 60);
}

function isExpired(row: BreakRow, nowMs = Date.now()): boolean {
  const start = new Date(row.started_at).getTime();
  if (!Number.isFinite(start)) return false;
  const elapsed = Math.max(0, Math.floor((nowMs - start) / 1000));
  return balanceSeconds(row) - elapsed <= 0;
}

export async function runBreakExpiryCron(
  supabase: ReturnType<typeof import('https://esm.sh/@supabase/supabase-js@2.49.1').createClient>,
  sendPush: (
    userIds: Set<string>,
    title: string,
    body: string,
    extras?: Record<string, unknown>,
  ) => Promise<{ sent?: number; error?: string; errors?: string[] }>,
) {
  const { data: rows, error } = await supabase
    .from('staff_breaks')
    .select('id, user_id, break_type, started_at, planned_duration_minutes, remaining_seconds, expiry_notified_at')
    .eq('status', 'active')
    .is('expiry_notified_at', null)
    .limit(200);

  if (error) throw new Error(error.message);

  const due = (rows || []).filter((r) => isExpired(r as BreakRow));
  let notified = 0;
  let pushed = 0;
  let deferred = 0;
  const results: Record<string, unknown>[] = [];

  for (const row of due) {
    const isRestroom = row.break_type === 'restroom';
    const title = isRestroom ? 'انتهت مدة بريك دورة المياه' : 'انتهت مدة البريك';
    const body = `${title} — يُرجى العودة وإيقاف الجلسة من التطبيق.`;
    const eventKey = `break_expiry_${row.id}`;

    try {
      await supabase.rpc('athar_upsert_notification', {
        p_user_id: row.user_id,
        p_event_key: eventKey,
        p_title: title,
        p_message: body,
        p_type: 'amber',
        p_icon: 'fa-mug-hot',
        p_ticket_id: null,
        p_scope: 'mine',
        p_is_auto: true,
        p_broadcast_id: null,
        p_broadcast_kind: null,
      });
    } catch (_) {
      // in-app notify is best-effort
    }

    const push = await sendPush(
      new Set([String(row.user_id)]),
      title,
      body,
      {
        tagSuffix: `break_expiry_${row.id}`,
        kind: 'break_expiry',
        url: './index.html?go=breaks',
      },
    );

    const pushSent = Number(push.sent) || 0;

    // لا نختم إلا بعد إرسال Web Push فعلي — وإلا يُعاد كل دقيقة والمنصة مقفلة.
    if (pushSent <= 0) {
      deferred += 1;
      results.push({
        id: row.id,
        user_id: row.user_id,
        ok: false,
        deferred: true,
        pushSent: 0,
        pushError: push.error || (push.errors?.length ? push.errors[0] : 'push not delivered'),
      });
      continue;
    }

    const { error: markErr } = await supabase
      .from('staff_breaks')
      .update({ expiry_notified_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', row.id)
      .eq('status', 'active')
      .is('expiry_notified_at', null);

    if (markErr) {
      results.push({ id: row.id, ok: false, error: markErr.message });
      continue;
    }

    notified += 1;
    pushed += pushSent;
    results.push({
      id: row.id,
      user_id: row.user_id,
      ok: true,
      pushSent,
      pushError: push.error || (push.errors?.length ? push.errors[0] : undefined),
    });
  }

  return {
    version: BREAK_EXPIRY_CRON_VERSION,
    scanned: (rows || []).length,
    due: due.length,
    notified,
    pushed,
    deferred,
    results: results.slice(0, 30),
  };
}
