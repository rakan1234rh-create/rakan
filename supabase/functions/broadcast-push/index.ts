import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import webpush from 'npm:web-push@3.6.7';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type TargetMode = 'all' | 'roles' | 'branches' | 'users';
type BroadcastKind = 'motivational' | 'alert' | 'circular';

type TargetPayload = {
  mode?: TargetMode;
  roles?: string[];
  branchIds?: string[];
  userIds?: string[];
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function kindTag(kind: BroadcastKind, broadcastId: string, userId: string) {
  return `broadcast_${kind}_${broadcastId}_${userId}`;
}

async function resolveAdminFromJwt(req: Request) {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return null;
  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const anon = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!url || !anon || !serviceKey) return null;

  const userClient = createClient(url, anon, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return null;

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: profile } = await admin
    .from('users')
    .select('id, role, is_active')
    .eq('auth_uid', user.id)
    .maybeSingle();
  if (!profile?.id || profile.is_active === false) return null;
  if (String(profile.role) !== 'admin') return null;
  return profile;
}

async function resolveRecipientIds(
  supabase: ReturnType<typeof createClient>,
  target: TargetPayload,
) {
  const mode = target.mode || 'all';
  const ids = new Set<string>();

  if (mode === 'all') {
    const { data, error } = await supabase.from('users').select('id').eq('is_active', true);
    if (error) throw new Error(error.message);
    for (const u of data ?? []) ids.add(u.id);
  } else if (mode === 'roles') {
    const roles = (target.roles || []).map(String).filter(Boolean);
    if (!roles.length) return [];
    const { data, error } = await supabase
      .from('users')
      .select('id')
      .eq('is_active', true)
      .in('role', roles);
    if (error) throw new Error(error.message);
    for (const u of data ?? []) ids.add(u.id);
  } else if (mode === 'branches') {
    const branchIds = (target.branchIds || []).map(String).filter(Boolean);
    if (!branchIds.length) return [];
    const { data: branchUsers, error: buErr } = await supabase
      .from('users')
      .select('id')
      .eq('is_active', true)
      .in('branch_id', branchIds);
    if (buErr) throw new Error(buErr.message);
    for (const u of branchUsers ?? []) ids.add(u.id);

    const { data: branches, error: bErr } = await supabase
      .from('branches')
      .select('region_id')
      .in('id', branchIds);
    if (bErr) throw new Error(bErr.message);
    const regionIds = [...new Set((branches ?? []).map((b) => b.region_id).filter(Boolean))];
    if (regionIds.length) {
      const { data: regions, error: rErr } = await supabase
        .from('regions')
        .select('supervisor_id')
        .in('id', regionIds);
      if (rErr) throw new Error(rErr.message);
      for (const r of regions ?? []) {
        if (r.supervisor_id) ids.add(r.supervisor_id);
      }
    }
  } else if (mode === 'users') {
    for (const id of (target.userIds || []).map(String).filter(Boolean)) ids.add(id);
  }

  return Array.from(ids);
}

async function sendPushToUserIds(
  supabase: ReturnType<typeof createClient>,
  userIds: Set<string>,
  title: string,
  body: string,
  opts: { broadcastId: string; kind: BroadcastKind },
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
      error: 'VAPID key pair invalid in secrets',
      sent: 0,
      detail: String(err).slice(0, 120),
    };
  }

  const { data: subs, error: subsErr } = await supabase
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth_key, user_id')
    .in('user_id', Array.from(userIds));
  if (subsErr) return { error: subsErr.message, sent: 0 };
  if (!subs?.length) return { sent: 0, subscriptions: 0 };

  const staleEndpoints: string[] = [];
  let sent = 0;
  const errors: string[] = [];

  for (const sub of subs) {
    const pushPayload = JSON.stringify({
      title,
      body,
      broadcastId: opts.broadcastId,
      kind: opts.kind,
      tag: kindTag(opts.kind, opts.broadcastId, sub.user_id),
      url: './index.html?broadcast=' + encodeURIComponent(opts.broadcastId) + '&bckind=' + encodeURIComponent(opts.kind),
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
      else errors.push(detail.slice(0, 120));
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

async function insertInboxRows(
  supabase: ReturnType<typeof createClient>,
  broadcastId: string,
  userIds: string[],
  meta: { title: string; body: string; kind: BroadcastKind },
) {
  const chunkSize = 200;
  for (let i = 0; i < userIds.length; i += chunkSize) {
    const chunk = userIds.slice(i, i + chunkSize).map((user_id) => ({
      broadcast_id: broadcastId,
      user_id,
      title: meta.title,
      body: meta.body,
      kind: meta.kind,
    }));
    const { error } = await supabase.from('broadcast_inbox').insert(chunk);
    if (error) throw new Error(error.message);
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  if (req.method === 'GET') {
    return json({ ok: true, service: 'broadcast-push' });
  }

  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const admin = await resolveAdminFromJwt(req);
  if (!admin) return json({ error: 'مدير النظام فقط يمكنه إرسال النشرات' }, 403);

  let payload: Record<string, unknown> = {};
  try {
    payload = await req.json();
  } catch {
    return json({ error: 'invalid json' }, 400);
  }

  const title = String(payload.title || '').trim();
  const body = String(payload.body || '').trim();
  const kind = String(payload.kind || 'circular') as BroadcastKind;
  const target = (payload.target && typeof payload.target === 'object')
    ? payload.target as TargetPayload
    : { mode: 'all' as TargetMode };

  if (!title || title.length > 120) {
    return json({ error: 'العنوان مطلوب (120 حرفاً كحد أقصى)' }, 400);
  }
  if (!body || body.length > 207) {
    return json({ error: 'نص الرسالة مطلوب (207 حرفاً كحد أقصى)' }, 400);
  }
  if (!['motivational', 'alert', 'circular'].includes(kind)) {
    return json({ error: 'نوع الرسالة غير صالح' }, 400);
  }

  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    serviceKey,
    { auth: { persistSession: false } },
  );

  let recipientIds: string[] = [];
  try {
    recipientIds = await resolveRecipientIds(supabase, target);
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
  if (!recipientIds.length) {
    return json({ error: 'لا يوجد مستلمون مطابقون للاستهداف' }, 400);
  }

  const targetMode = target.mode || 'all';
  const { data: broadcastRow, error: bcErr } = await supabase
    .from('broadcasts')
    .insert({
      sender_id: admin.id,
      title,
      body,
      kind,
      target_mode: targetMode,
      target_roles: target.roles || [],
      target_branch_ids: target.branchIds || [],
      target_user_ids: target.userIds || [],
      recipient_count: recipientIds.length,
      push_sent_count: 0,
    })
    .select('id')
    .single();
  if (bcErr || !broadcastRow?.id) {
    return json({ error: bcErr?.message || 'فشل حفظ النشرة' }, 500);
  }

  const broadcastId = broadcastRow.id;

  try {
    await insertInboxRows(supabase, broadcastId, recipientIds, { title, body, kind });
  } catch (err) {
    await supabase.from('broadcasts').delete().eq('id', broadcastId);
    return json({ error: String(err) }, 500);
  }

  const pushResult = await sendPushToUserIds(
    supabase,
    new Set(recipientIds),
    title,
    body,
    { broadcastId, kind },
  );

  await supabase
    .from('broadcasts')
    .update({ push_sent_count: pushResult.sent || 0 })
    .eq('id', broadcastId);

  return json({
    ok: true,
    broadcastId,
    recipients: recipientIds.length,
    pushSent: pushResult.sent || 0,
    pushSubscriptions: pushResult.subscriptions || 0,
    errors: pushResult.errors,
  });
});
