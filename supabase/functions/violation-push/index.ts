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

function shortTicketNum(n: unknown) {
  const s = String(n ?? '').trim();
  if (!s) return '—';
  return s.length > 12 ? s.slice(-8) : s;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const auth = req.headers.get('Authorization') ?? '';
  if (!serviceKey || auth !== `Bearer ${serviceKey}`) {
    return json({ error: 'unauthorized' }, 401);
  }

  const vapidPublic = Deno.env.get('VAPID_PUBLIC_KEY') ?? '';
  const vapidPrivate = Deno.env.get('VAPID_PRIVATE_KEY') ?? '';
  const vapidSubject = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@athar.local';
  if (!vapidPublic || !vapidPrivate) {
    return json({ error: 'VAPID keys not configured' }, 500);
  }

  let payload: { type?: string; record?: ViolationRow } = {};
  try {
    payload = await req.json();
  } catch {
    return json({ error: 'invalid json' }, 400);
  }

  const record = payload.record;
  if (!record?.id) return json({ error: 'missing record' }, 400);
  if (payload.type && payload.type !== 'INSERT') {
    return json({ skipped: true, reason: 'not insert' });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    serviceKey,
    { auth: { persistSession: false } },
  );

  const recipientIds = new Set<string>();
  if (record.employee_id) recipientIds.add(record.employee_id);

  if (record.branch_id) {
    const { data: branchMgrs } = await supabase
      .from('users')
      .select('id')
      .eq('branch_id', record.branch_id)
      .eq('role', 'branch_manager')
      .eq('is_active', true);
    for (const u of branchMgrs ?? []) {
      if (u?.id && u.id !== record.employee_id) recipientIds.add(u.id);
    }

    const { data: branch } = await supabase
      .from('branches')
      .select('region_id')
      .eq('id', record.branch_id)
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

  if (!recipientIds.size) return json({ sent: 0, reason: 'no recipients' });

  const { data: subs, error: subsErr } = await supabase
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth_key, user_id')
    .in('user_id', Array.from(recipientIds));
  if (subsErr) return json({ error: subsErr.message }, 500);
  if (!subs?.length) return json({ sent: 0, reason: 'no subscriptions' });

  webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);

  const ticket = shortTicketNum(record.ticket_number);
  const vtype = String(record.violation_type || 'مخالفة').trim();
  const staleEndpoints: string[] = [];
  let sent = 0;

  for (const sub of subs) {
    const isEmployee = sub.user_id === record.employee_id;
    const title = isEmployee ? 'تم تسجيل مخالفة بحقك' : 'مخالفة جديدة في فريقك';
    const body = isEmployee
      ? `${vtype} — تذكرة ${ticket}`
      : `${vtype} — تذكرة ${ticket}`;

    const pushPayload = JSON.stringify({
      title,
      body,
      ticketId: record.id,
      tag: `violation_${record.id}_${sub.user_id}`,
      url: './index.html',
    });

    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth_key },
        },
        pushPayload,
      );
      sent += 1;
    } catch (err) {
      const status = (err as { statusCode?: number })?.statusCode;
      if (status === 404 || status === 410) staleEndpoints.push(sub.endpoint);
    }
  }

  if (staleEndpoints.length) {
    await supabase.from('push_subscriptions').delete().in('endpoint', staleEndpoints);
  }

  return json({ sent, recipients: recipientIds.size, subscriptions: subs.length });
});
