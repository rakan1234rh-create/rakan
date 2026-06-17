import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import webpush from 'npm:web-push@3.6.7';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type ViolationRow = {
  id: string;
  ticket_number?: string | number | null;
  violation_type?: string | null;
  employee_id?: string | null;
  branch_id?: string | null;
  state?: string | null;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/** نفس منطق index.html: V-2026-0282 → 0282 */
function shortTicketNum(n: unknown) {
  if (n == null || n === '') return '—';
  const parts = String(n).trim().split('-');
  return parts.length >= 3 ? parts[parts.length - 1] : String(n).trim();
}

function extractRecord(payload: Record<string, unknown>): ViolationRow | null {
  if (payload?.record && typeof payload.record === 'object') {
    return payload.record as ViolationRow;
  }
  if (payload?.id) {
    return payload as ViolationRow;
  }
  return null;
}

async function dispatchViolationInsertPush(
  supabase: ReturnType<typeof createClient>,
  record: ViolationRow,
) {
  const recipientIds = new Set<string>();
  if (record.employee_id) recipientIds.add(String(record.employee_id));

  if (record.branch_id) {
    const branchId = String(record.branch_id);
    const { data: branchMgrs } = await supabase
      .from('users')
      .select('id')
      .eq('branch_id', branchId)
      .eq('role', 'branch_manager')
      .eq('is_active', true);
    for (const u of branchMgrs ?? []) {
      if (u?.id && u.id !== record.employee_id) recipientIds.add(u.id);
    }

    const { data: branch } = await supabase
      .from('branches')
      .select('region_id')
      .eq('id', branchId)
      .maybeSingle();
    if (branch?.region_id) {
      const { data: region } = await supabase
        .from('regions')
        .select('supervisor_id')
        .eq('id', branch.region_id)
        .maybeSingle();
      if (region?.supervisor_id) recipientIds.add(region.supervisor_id);
    }
  }

  if (!recipientIds.size) return { sent: 0, reason: 'no recipients' };

  const ticket = shortTicketNum(record.ticket_number);
  let employeeName = '';
  if (record.employee_id) {
    const { data: emp } = await supabase
      .from('users')
      .select('name')
      .eq('id', record.employee_id)
      .maybeSingle();
    employeeName = String(emp?.name || '').trim();
  }

  let totalSent = 0;
  const allErrors: string[] = [];

  for (const uid of recipientIds) {
    const isEmployee = uid === record.employee_id;
    const title = isEmployee ? 'تم تسجيل مخالفة بحقك' : 'مخالفة جديدة في فريقك';
    const body = isEmployee
      ? `تذكرة ${ticket}`
      : employeeName
        ? `${employeeName} — تذكرة ${ticket}`
        : `تذكرة ${ticket}`;
    const result = await sendPushToUserIds(supabase, new Set([uid]), title, body, String(record.id));
    totalSent += result.sent || 0;
    if (result.error) allErrors.push(String(result.error));
  }

  return {
    sent: totalSent,
    recipients: recipientIds.size,
    errors: allErrors.length ? allErrors.slice(0, 5) : undefined,
  };
}

async function sendPushToUserIds(
  supabase: ReturnType<typeof createClient>,
  userIds: Set<string>,
  title: string,
  body: string,
  ticketId?: string,
) {
  const vapidPublic = Deno.env.get('VAPID_PUBLIC_KEY') ?? '';
  const vapidPrivate = Deno.env.get('VAPID_PRIVATE_KEY') ?? '';
  const vapidSubject = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@athar.local';
  if (!vapidPublic || !vapidPrivate) {
    return { error: 'VAPID keys not configured in Edge Function secrets', sent: 0 };
  }
  try {
    webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);
  } catch (err) {
    return {
      error: 'VAPID key pair invalid in secrets — public and private must match',
      sent: 0,
      detail: String(err).slice(0, 120),
    };
  }

  const { data: subs, error: subsErr } = await supabase
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth_key, user_id')
    .in('user_id', Array.from(userIds));
  if (subsErr) return { error: subsErr.message, sent: 0 };
  if (!subs?.length) {
    return { error: 'no push_subscriptions for recipients — فعّل التنبيه من الجوال أولاً', sent: 0 };
  }

  const staleEndpoints: string[] = [];
  let sent = 0;
  const errors: string[] = [];

  for (const sub of subs) {
    const pushPayload = JSON.stringify({
      title,
      body,
      ticketId: ticketId || '',
      tag: ticketId ? `test_${ticketId}_${sub.user_id}` : `test_${sub.user_id}`,
      url: './index.html',
    });
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } },
        pushPayload,
      );
      sent += 1;
    } catch (err) {
      const status = (err as { statusCode?: number; body?: string })?.statusCode;
      const detail = (err as { body?: string })?.body || String(err);
      if (status === 404 || status === 410) staleEndpoints.push(sub.endpoint);
      else if (status === 403 || /vapid|credentials|authorization/i.test(detail)) {
        errors.push('VAPID mismatch — أوقف التنبيهات ثم فعّلها من جديد على الجهاز');
      } else errors.push(detail.slice(0, 120));
    }
  }

  if (staleEndpoints.length) {
    await supabase.from('push_subscriptions').delete().in('endpoint', staleEndpoints);
  }

  return {
    sent,
    subscriptions: subs.length,
    errors: errors.length ? errors.slice(0, 3) : undefined,
  };
}

async function resolveUserIdFromJwt(req: Request) {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return null;
  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const anon = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  if (!url || !anon) return null;
  const userClient = createClient(url, anon, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return null;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: profile } = await admin.from('users').select('id').eq('auth_uid', user.id).maybeSingle();
  return profile?.id ?? null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  if (req.method === 'GET') {
    const vapidPublic = Deno.env.get('VAPID_PUBLIC_KEY') ?? '';
    const vapidPrivate = Deno.env.get('VAPID_PRIVATE_KEY') ?? '';
    let vapidValid = false;
    if (vapidPublic && vapidPrivate) {
      try {
        webpush.setVapidDetails(
          Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@athar.local',
          vapidPublic,
          vapidPrivate,
        );
        vapidValid = true;
      } catch (_) { /* invalid pair */ }
    }
    return json({
      ok: true,
      service: 'violation-push',
      vapidConfigured: !!(vapidPublic && vapidPrivate),
      vapidValid,
      vapidPublicKey: vapidPublic || null,
    });
  }

  let payload: Record<string, unknown> = {};
  try {
    payload = await req.json();
  } catch {
    return json({ error: 'invalid json' }, 400);
  }

  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    serviceKey,
    { auth: { persistSession: false } },
  );

  // ─── اختبار من التطبيق (المستخدم الحالي) ───
  if (payload.test === true) {
    const userId = await resolveUserIdFromJwt(req);
    if (!userId) return json({ error: 'يجب تسجيل الدخول لاختبار التنبيه' }, 401);
    const result = await sendPushToUserIds(
      supabase,
      new Set([userId]),
      'اختبار التنبيهات',
      'التنبيهات الخارجية تعمل ✓',
    );
    if (result.error && !result.sent) return json({ ok: false, ...result }, 500);
    return json({ ok: true, ...result });
  }

  // ─── إشعار من التطبيق بعد إنشاء مخالفة (JWT) ───
  if (payload.notify === true) {
    const userId = await resolveUserIdFromJwt(req);
    if (!userId) return json({ error: 'يجب تسجيل الدخول لإرسال التنبيه' }, 401);
    const record = extractRecord(payload);
    if (!record?.id) return json({ error: 'missing violation record in payload' }, 400);
    const { data: row, error: rowErr } = await supabase
      .from('violations')
      .select('id, ticket_number, violation_type, employee_id, branch_id, state')
      .eq('id', record.id)
      .maybeSingle();
    if (rowErr) return json({ error: rowErr.message }, 500);
    if (!row) return json({ error: 'violation not found' }, 404);
    const merged: ViolationRow = { ...row, ...record, id: row.id };
    const result = await dispatchViolationInsertPush(supabase, merged);
    if (result.errors?.length && !result.sent) {
      return json({ ok: false, ...result }, 500);
    }
    return json({ ok: true, ...result });
  }

  return json({ error: 'استخدم test:true أو notify:true' }, 400);
});
