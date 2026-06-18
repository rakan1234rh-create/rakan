import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import webpush from 'npm:web-push@3.6.7';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

type ViolationRow = {
  id: string;
  ticket_number?: string | number | null;
  violation_type?: string | null;
  employee_id?: string | null;
  branch_id?: string | null;
  state?: string | null;
};

type TargetMode = 'all' | 'roles' | 'branches' | 'users';
type BroadcastKind = 'motivational' | 'alert' | 'circular';

type TargetPayload = {
  mode?: TargetMode;
  roles?: string[];
  branchIds?: string[];
  userIds?: string[];
};

type PushExtras = {
  ticketId?: string;
  broadcastId?: string;
  kind?: BroadcastKind;
  tagSuffix?: string;
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

async function getBranchManagerIds(
  supabase: ReturnType<typeof createClient>,
  branchId: string,
  excludeUserId?: string | null,
) {
  const ids = new Set<string>();
  const { data, error } = await supabase
    .from('users')
    .select('id, is_active')
    .eq('branch_id', branchId)
    .eq('role', 'branch_manager');
  if (error) throw new Error(error.message);
  for (const u of data ?? []) {
    if (!u?.id) continue;
    if (u.is_active === false) continue;
    if (excludeUserId && String(u.id) === String(excludeUserId)) continue;
    ids.add(String(u.id));
  }
  return ids;
}

async function dispatchViolationInsertPush(
  supabase: ReturnType<typeof createClient>,
  record: ViolationRow,
) {
  const recipientIds = new Set<string>();
  const branchMgrIds = new Set<string>();
  if (record.employee_id) recipientIds.add(String(record.employee_id));

  if (record.branch_id) {
    const branchId = String(record.branch_id);
    for (const id of await getBranchManagerIds(supabase, branchId, record.employee_id)) {
      branchMgrIds.add(id);
      recipientIds.add(id);
    }

    const supId = await getRegionSupervisorId(supabase, branchId);
    if (supId) recipientIds.add(supId);
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
  const teamBody = employeeName
    ? `${employeeName} — تذكرة ${ticket}`
    : `تذكرة ${ticket}`;

  let totalSent = 0;
  const allErrors: string[] = [];

  for (const uid of recipientIds) {
    const isEmployee = uid === record.employee_id;
    const isBranchMgr = branchMgrIds.has(uid);
    const title = isEmployee
      ? 'تم تسجيل مخالفة بحقك'
      : isBranchMgr
        ? 'تم تسجيل مخالفة على موظف ضمن فريقك'
        : 'مخالفة جديدة في فريقك';
    const body = isEmployee ? `تذكرة ${ticket}` : teamBody;
    const result = await sendPushToUserIds(supabase, new Set([uid]), title, body, { ticketId: String(record.id) });
    totalSent += result.sent || 0;
    if (result.error) allErrors.push(String(result.error));
  }

  return {
    sent: totalSent,
    recipients: recipientIds.size,
    branchManagers: branchMgrIds.size,
    errors: allErrors.length ? allErrors.slice(0, 5) : undefined,
  };
}

async function getRegionSupervisorId(
  supabase: ReturnType<typeof createClient>,
  branchId: string,
) {
  const { data: branch } = await supabase
    .from('branches')
    .select('region_id')
    .eq('id', branchId)
    .maybeSingle();
  if (!branch?.region_id) return null;
  const { data: region } = await supabase
    .from('regions')
    .select('supervisor_id')
    .eq('id', branch.region_id)
    .maybeSingle();
  return region?.supervisor_id ? String(region.supervisor_id) : null;
}

async function resolveStateChangeRecipientIds(
  supabase: ReturnType<typeof createClient>,
  record: ViolationRow,
) {
  const state = String(record.state || '').trim();
  const ids = new Set<string>();
  const branchMgrIds = new Set<string>();
  const addRoleUsers = async (roles: string[]) => {
    const { data, error } = await supabase
      .from('users')
      .select('id, is_active')
      .in('role', roles);
    if (error) throw new Error(error.message);
    for (const u of data ?? []) {
      if (!u?.id || u.is_active === false) continue;
      ids.add(u.id);
    }
  };

  if (state === 'sup' && record.branch_id) {
    const supId = await getRegionSupervisorId(supabase, String(record.branch_id));
    if (supId) ids.add(supId);
  } else if (state === 'aud') {
    await addRoleUsers(['auditor', 'admin']);
  } else if (state === 'mgt') {
    await addRoleUsers(['manager', 'admin']);
  } else if (state === 'hr') {
    await addRoleUsers(['hr', 'admin']);
  }

  const branchTeamStates = new Set(['sup', 'aud', 'mgt', 'hr', 'closed', 'Warning_Issued']);
  if (record.branch_id && branchTeamStates.has(state)) {
    for (const id of await getBranchManagerIds(supabase, String(record.branch_id), record.employee_id)) {
      branchMgrIds.add(id);
      ids.add(id);
    }
  }

  if (record.employee_id) ids.delete(String(record.employee_id));
  return { ids, branchMgrIds };
}

const STATE_PUSH_COPY: Record<string, { title: string }> = {
  sup: { title: 'مخالفة بانتظار رد المشرف' },
  aud: { title: 'تذكرة بانتظار التدقيق' },
  mgt: { title: 'قرار إداري مطلوب' },
  hr: { title: 'قرار الموارد البشرية مطلوب' },
};

const BRANCH_MGR_STATE_PUSH_COPY: Record<string, { title: string }> = {
  sup: { title: 'رد موظف ضمن فريقك على المخالفة' },
  aud: { title: 'مخالفة موظف فريقك بانتظار التدقيق' },
  mgt: { title: 'مخالفة موظف فريقك بانتظار القرار الإداري' },
  hr: { title: 'مخالفة موظف فريقك بانتظار الموارد البشرية' },
  closed: { title: 'تم تحديث مخالفة موظف ضمن فريقك' },
  Warning_Issued: { title: 'تنبيه إداري صادر على موظف ضمن فريقك' },
};

async function dispatchViolationStatePush(
  supabase: ReturnType<typeof createClient>,
  record: ViolationRow,
  previousState?: string | null,
) {
  const state = String(record.state || '').trim();
  if (!state || state === 'uploading' || state === 'emp') {
    return { sent: 0, reason: 'state does not need push' };
  }
  if (previousState && String(previousState) === state) {
    return { sent: 0, reason: 'state unchanged' };
  }

  let recipientIds: Set<string>;
  let branchMgrIds: Set<string>;
  try {
    const resolved = await resolveStateChangeRecipientIds(supabase, record);
    recipientIds = resolved.ids;
    branchMgrIds = resolved.branchMgrIds;
  } catch (err) {
    return { error: String(err), sent: 0 };
  }
  if (!recipientIds.size) return { sent: 0, reason: 'no recipients for state' };

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
  const body = employeeName
    ? `${employeeName} — تذكرة ${ticket}`
    : `تذكرة ${ticket}`;

  let totalSent = 0;
  const allErrors: string[] = [];
  const workflowIds = new Set([...recipientIds].filter((id) => !branchMgrIds.has(id)));
  const workflowCopy = STATE_PUSH_COPY[state];
  if (workflowCopy && workflowIds.size) {
    const result = await sendPushToUserIds(
      supabase,
      workflowIds,
      workflowCopy.title,
      body,
      { ticketId: String(record.id), tagSuffix: `state_${state}` },
    );
    totalSent += result.sent || 0;
    if (result.error) allErrors.push(String(result.error));
    if (result.errors?.length) allErrors.push(...result.errors);
  }

  const bmCopy = BRANCH_MGR_STATE_PUSH_COPY[state];
  if (bmCopy && branchMgrIds.size) {
    const result = await sendPushToUserIds(
      supabase,
      branchMgrIds,
      bmCopy.title,
      body,
      { ticketId: String(record.id), tagSuffix: `bm_state_${state}` },
    );
    totalSent += result.sent || 0;
    if (result.error) allErrors.push(String(result.error));
    if (result.errors?.length) allErrors.push(...result.errors);
  }

  return {
    sent: totalSent,
    recipients: recipientIds.size,
    branchManagers: branchMgrIds.size,
    state,
    errors: allErrors.length ? allErrors.slice(0, 5) : undefined,
  };
}

async function sendPushToUserIds(
  supabase: ReturnType<typeof createClient>,
  userIds: Set<string>,
  title: string,
  body: string,
  extras: PushExtras = {},
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
    if (extras.broadcastId) return { sent: 0, subscriptions: 0 };
    return { error: 'no push_subscriptions for recipients — فعّل التنبيه من الجوال أولاً', sent: 0 };
  }

  const staleEndpoints: string[] = [];
  let sent = 0;
  const errors: string[] = [];

  for (const sub of subs) {
    const ticketId = extras.ticketId || '';
    const broadcastId = extras.broadcastId || '';
    const kind = extras.kind || 'circular';
    const tagSuffix = extras.tagSuffix || '';
    const tag = broadcastId
      ? `broadcast_${kind}_${broadcastId}_${sub.user_id}`
      : (ticketId
        ? `ticket_${ticketId}${tagSuffix ? `_${tagSuffix}` : ''}_${sub.user_id}`
        : `test_${sub.user_id}`);
    const url = broadcastId
      ? `./index.html?broadcast=${encodeURIComponent(broadcastId)}`
      : (ticketId
        ? `./index.html?ticket=${encodeURIComponent(ticketId)}`
        : './index.html');
    const pushPayload = JSON.stringify({
      title,
      body,
      ticketId,
      broadcastId,
      kind: broadcastId ? kind : undefined,
      tag,
      url,
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

async function resolveBroadcastRecipientIds(
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

async function insertBroadcastInboxRows(
  supabase: ReturnType<typeof createClient>,
  broadcastId: string,
  userIds: string[],
) {
  const chunkSize = 200;
  for (let i = 0; i < userIds.length; i += chunkSize) {
    const chunk = userIds.slice(i, i + chunkSize).map((user_id) => ({
      broadcast_id: broadcastId,
      user_id,
    }));
    const { error } = await supabase.from('broadcast_inbox').insert(chunk);
    if (error) throw new Error(error.message);
  }
}

async function dispatchBroadcastPush(
  supabase: ReturnType<typeof createClient>,
  adminId: string,
  payload: Record<string, unknown>,
) {
  const title = String(payload.title || '').trim();
  const body = String(payload.body || '').trim();
  const kind = String(payload.kind || 'circular') as BroadcastKind;
  const target = (payload.target && typeof payload.target === 'object')
    ? payload.target as TargetPayload
    : { mode: 'all' as TargetMode };

  if (!title || title.length > 120) {
    return { status: 400, body: { error: 'العنوان مطلوب (120 حرفاً كحد أقصى)' } };
  }
  if (!body || body.length > 500) {
    return { status: 400, body: { error: 'نص الرسالة مطلوب (500 حرفاً كحد أقصى)' } };
  }
  if (!['motivational', 'alert', 'circular'].includes(kind)) {
    return { status: 400, body: { error: 'نوع الرسالة غير صالح' } };
  }

  let recipientIds: string[] = [];
  try {
    recipientIds = await resolveBroadcastRecipientIds(supabase, target);
  } catch (err) {
    return { status: 500, body: { error: String(err) } };
  }
  if (!recipientIds.length) {
    return { status: 400, body: { error: 'لا يوجد مستلمون مطابقون للاستهداف' } };
  }

  const targetMode = target.mode || 'all';
  const { data: broadcastRow, error: bcErr } = await supabase
    .from('broadcasts')
    .insert({
      sender_id: adminId,
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
    return { status: 500, body: { error: bcErr?.message || 'فشل حفظ النشرة — شغّل supabase/broadcasts.sql' } };
  }

  const broadcastId = broadcastRow.id;
  try {
    await insertBroadcastInboxRows(supabase, broadcastId, recipientIds);
  } catch (err) {
    await supabase.from('broadcasts').delete().eq('id', broadcastId);
    return { status: 500, body: { error: String(err) } };
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

  return {
    status: 200,
    body: {
      ok: true,
      broadcastId,
      recipients: recipientIds.length,
      pushSent: pushResult.sent || 0,
      pushSubscriptions: pushResult.subscriptions || 0,
      errors: pushResult.errors,
    },
  };
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
      version: '2026-06-branch-mgr-push',
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

  // ─── إشعار عند تغيّر مرحلة التذكرة (مثلاً وصولها للمدير) ───
  if (payload.notifyState === true) {
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
    const previousState = payload.previousState != null ? String(payload.previousState) : null;
    const result = await dispatchViolationStatePush(supabase, merged, previousState);
    if (result.error && !result.sent) {
      return json({ ok: false, ...result }, 500);
    }
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

  // ─── نشرة admin (تحفيز / تنبيه / تعميم) ───
  if (payload.broadcast === true) {
    const admin = await resolveAdminFromJwt(req);
    if (!admin) return json({ error: 'مدير النظام فقط يمكنه إرسال النشرات' }, 403);
    const result = await dispatchBroadcastPush(supabase, admin.id, payload);
    return json(result.body, result.status);
  }

  return json({ error: 'استخدم test:true أو notify:true أو notifyState:true أو broadcast:true' }, 400);
});
