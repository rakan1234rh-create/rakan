// violation-push production bundle (redeploy full source)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import webpush from 'npm:web-push@3.6.7';
import {
  AUTO_FORWARD_CRON_VERSION,
  isAuthorizedCron,
  normSecret,
  runAutoForwardCron,
} from './auto-forward-cron.ts';

function buildCorsHeaders(req: Request): Record<string, string> {
  const allowedOrigin = Deno.env.get('ALLOWED_ORIGIN') || 'https://athar-app.online';
  const requestOrigin = req.headers.get('Origin') || '';
  const isAllowed = requestOrigin === allowedOrigin;
  return {
    'Access-Control-Allow-Origin': isAllowed ? allowedOrigin : '',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  };
}

const corsHeaders = buildCorsHeaders(new Request('https://placeholder.test'));

type ViolationRow = {
  id: string;
  ticket_number?: string | number | null;
  violation_type?: string | null;
  employee_id?: string | null;
  branch_id?: string | null;
  state?: string | null;
  auto_forwarded_emp?: boolean | null;
  auto_forwarded_sup?: boolean | null;
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

type NotifUpsert = {
  userId: string;
  eventKey: string;
  title: string;
  message: string;
  type?: string;
  icon?: string;
  ticketId?: string | null;
  scope?: string;
  isAuto?: boolean;
  broadcastId?: string | null;
  broadcastKind?: string | null;
};

async function upsertAppNotification(
  supabase: ReturnType<typeof createClient>,
  row: NotifUpsert,
) {
  const { error } = await supabase.rpc('athar_upsert_notification', {
    p_user_id: row.userId,
    p_event_key: row.eventKey,
    p_title: row.title,
    p_message: row.message,
    p_type: row.type || 'amber',
    p_icon: row.icon || 'fa-bell',
    p_ticket_id: row.ticketId || null,
    p_scope: row.scope || 'mine',
    p_is_auto: row.isAuto || false,
    p_broadcast_id: row.broadcastId || null,
    p_broadcast_kind: row.broadcastKind || null,
  });
  if (error && !/does not exist|function/i.test(error.message)) {
    return { error: error.message };
  }
  return { ok: true };
}

let _activeCors: Record<string, string> = corsHeaders;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ..._activeCors, 'Content-Type': 'application/json' },
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
    const eventKey = isEmployee
      ? `violation_new_${record.id}`
      : isBranchMgr
        ? `bm_team_pending_${record.id}`
        : `violation_new_${record.id}`;
    await upsertAppNotification(supabase, {
      userId: uid,
      eventKey,
      title,
      message: body,
      type: isEmployee ? 'amber' : isBranchMgr ? 'amber' : 'blue',
      icon: isBranchMgr ? 'fa-clipboard-list' : 'fa-bell',
      ticketId: String(record.id),
      scope: isBranchMgr ? 'team' : 'mine',
    });
    if (isEmployee) {
      await upsertAppNotification(supabase, {
        userId: uid,
        eventKey: `pending_${record.id}`,
        title: 'مخالفة بانتظار ردك',
        message: `${record.violation_type || ''} — ${ticket}`.trim(),
        type: 'amber',
        icon: 'fa-bell',
        ticketId: String(record.id),
        scope: 'mine',
      });
    }
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

const recentStatePush = new Map<string, number>();
const STATE_PUSH_DEDUP_MS = 120_000;

function isDbTruthy(val: unknown) {
  return val === true || val === 1 || val === 'true' || val === 't';
}

function shouldSkipStatePush(dedupeKey: string) {
  const key = String(dedupeKey || '').trim();
  if (!key) return false;
  const now = Date.now();
  const last = recentStatePush.get(key);
  if (last && now - last < STATE_PUSH_DEDUP_MS) return true;
  recentStatePush.set(key, now);
  return false;
}

function resolveStatePushTitles(
  state: string,
  previousState: string | null | undefined,
  record: ViolationRow,
  isAutoForward?: boolean,
) {
  const prev = previousState != null ? String(previousState) : '';
  const autoEmpFwd = (isAutoForward && prev === 'emp' && state === 'sup')
    || (state === 'sup' && isDbTruthy(record.auto_forwarded_emp) && (!prev || prev === 'emp'));
  const autoSupFwd = (isAutoForward && prev === 'sup' && state === 'aud')
    || (state === 'aud' && isDbTruthy(record.auto_forwarded_sup) && (!prev || prev === 'sup'));

  let workflowCopy = STATE_PUSH_COPY[state] ? { ...STATE_PUSH_COPY[state] } : null;
  let bmCopy = BRANCH_MGR_STATE_PUSH_COPY[state] ? { ...BRANCH_MGR_STATE_PUSH_COPY[state] } : null;

  if (autoEmpFwd && state === 'sup') {
    workflowCopy = { title: 'مخالفة بانتظار رد المشرف (تمرير تلقائي)' };
    bmCopy = { title: 'تم تمرير مخالفة موظف فريقك للمشرف (تمرير تلقائي)' };
  } else if (autoSupFwd && state === 'aud') {
    workflowCopy = { title: 'تذكرة بانتظار التدقيق (تمرير تلقائي)' };
    bmCopy = { title: 'تم تمرير مخالفة موظف فريقك للمدقق (تمرير تلقائي)' };
  }

  return { workflowCopy, bmCopy, autoEmpFwd, autoSupFwd };
}

async function dispatchViolationStatePush(
  supabase: ReturnType<typeof createClient>,
  record: ViolationRow,
  previousState?: string | null,
  opts: { isAutoForward?: boolean; dedupeKey?: string } = {},
) {
  const state = String(record.state || '').trim();
  if (!state || state === 'uploading' || state === 'emp') {
    return { sent: 0, reason: 'state does not need push' };
  }
  if (previousState && String(previousState) === state) {
    return { sent: 0, reason: 'state unchanged' };
  }

  const dedupeKey = String(opts.dedupeKey || `${record.id}:${previousState || 'none'}:${state}`);
  if (shouldSkipStatePush(dedupeKey)) {
    return { sent: 0, reason: 'duplicate transition suppressed', dedupeKey };
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

  const { workflowCopy, bmCopy, autoEmpFwd, autoSupFwd } = resolveStatePushTitles(
    state,
    previousState,
    record,
    opts.isAutoForward,
  );
  const stateTag = autoEmpFwd && state === 'sup' ? `state_${state}_auto` : `state_${state}`;

  let totalSent = 0;
  const allErrors: string[] = [];
  const workflowIds = new Set([...recipientIds].filter((id) => !branchMgrIds.has(id)));
  if (workflowCopy && workflowIds.size) {
    for (const uid of workflowIds) {
      try {
        await upsertAppNotification(supabase, {
          userId: uid,
          eventKey: `pending_${record.id}`,
          title: workflowCopy.title,
          message: body,
          type: autoEmpFwd && state === 'sup' ? 'amber' : (state === 'aud' ? 'purple' : state === 'mgt' ? 'red' : state === 'hr' ? 'orange' : 'blue'),
          icon: autoEmpFwd && state === 'sup' ? 'fa-robot' : 'fa-bell',
          ticketId: String(record.id),
          scope: 'mine',
          isAuto: !!(autoEmpFwd && state === 'sup'),
        });
      } catch (err) {
        allErrors.push(`notif:${String(err).slice(0, 80)}`);
      }
    }
    const result = await sendPushToUserIds(
      supabase,
      workflowIds,
      workflowCopy.title,
      body,
      { ticketId: String(record.id), tagSuffix: stateTag },
    );
    totalSent += result.sent || 0;
    if (result.error) allErrors.push(String(result.error));
    if (result.errors?.length) allErrors.push(...result.errors);
  }

  if (bmCopy && branchMgrIds.size) {
    const bmEvent = autoEmpFwd && state === 'sup'
      ? `auto_fwd_${record.id}_emp_to_sup`
      : (autoSupFwd && state === 'aud'
        ? `auto_fwd_${record.id}_sup_to_aud`
        : `bm_team_status_${record.id}_${state}`);
    for (const uid of branchMgrIds) {
      try {
        await upsertAppNotification(supabase, {
          userId: uid,
          eventKey: bmEvent,
          title: bmCopy.title,
          message: body,
          type: state === 'sup' ? 'blue' : state === 'aud' ? 'purple' : state === 'mgt' ? 'red' : state === 'hr' ? 'orange' : 'amber',
          icon: (autoEmpFwd && state === 'sup') || (autoSupFwd && state === 'aud') ? 'fa-robot' : 'fa-reply',
          ticketId: String(record.id),
          scope: 'team',
          isAuto: !!(autoEmpFwd || autoSupFwd),
        });
      } catch (err) {
        allErrors.push(`notif:${String(err).slice(0, 80)}`);
      }
    }
    const result = await sendPushToUserIds(
      supabase,
      branchMgrIds,
      bmCopy.title,
      body,
      { ticketId: String(record.id), tagSuffix: `bm_${stateTag}` },
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
    dedupeKey,
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

  const seenEndpoints = new Set<string>();
  const uniqueSubs = (subs ?? []).filter((sub) => {
    const endpoint = String(sub?.endpoint || '');
    if (!endpoint || seenEndpoints.has(endpoint)) return false;
    seenEndpoints.add(endpoint);
    return true;
  });

  const staleEndpoints: string[] = [];
  let sent = 0;
  const errors: string[] = [];

  for (const sub of uniqueSubs) {
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
      ? `./index.html?broadcast=${encodeURIComponent(broadcastId)}&bckind=${encodeURIComponent(kind)}`
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
    subscriptions: uniqueSubs.length,
    errors: errors.length ? errors.slice(0, 3) : undefined,
  };
}

/** مقارنة زمنية ثابتة لمنع هجمات التوقيت */
async function safeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const ba = enc.encode(a);
  const bb = enc.encode(b);
  if (ba.length !== bb.length) return false;
  return crypto.subtle.timingSafeEqual(ba, bb);
}

async function isServiceRoleAuth(req: Request): Promise<boolean> {
  const serviceKey = (Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '').trim();
  if (!serviceKey) return false;
  const auth = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (auth && await safeEqual(auth, serviceKey)) return true;
  const apikey = (req.headers.get('apikey') || '').trim();
  if (apikey && await safeEqual(apikey, serviceKey)) return true;
  const probeKey = auth || apikey;
  if (!probeKey) return false;
  try {
    const url = Deno.env.get('SUPABASE_URL') ?? '';
    if (!url) return false;
    const probe = createClient(url, probeKey, { auth: { persistSession: false } });
    const { error } = await probe.from('violations').select('id').limit(1);
    return !error;
  } catch {
    return false;
  }
}

async function resolveUserIdFromJwt(req: Request) {
  try {
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
  } catch {
    return null;
  }
}

// [أمان] هل يستطيع صاحب الـJWT رؤية هذه المخالفة (عبر RLS)؟
// يُعيد true عند التحقق، و false عند عدم التأكد — fail-closed لمنع التجاوز.
async function userCanSeeViolation(req: Request, violationId: string): Promise<boolean> {
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return false;
    const url = Deno.env.get('SUPABASE_URL') ?? '';
    const anon = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    if (!url || !anon) return false;
    const uc = createClient(url, anon, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const { data, error } = await uc
      .from('violations')
      .select('id')
      .eq('id', violationId)
      .maybeSingle();
    if (error) return false;
    return !!data;
  } catch {
    return false;
  }
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
    const userIds = (target.userIds || []).map(String).filter(Boolean);
    if (!userIds.length) return [];
    const { data: activeUsers, error: uErr } = await supabase
      .from('users')
      .select('id')
      .eq('is_active', true)
      .in('id', userIds);
    if (uErr) throw new Error(uErr.message);
    for (const u of activeUsers ?? []) ids.add(u.id);
  }

  return Array.from(ids);
}

function parseBroadcastExpiresAt(raw: unknown): { ok: true; iso: string } | { ok: false; error: string } {
  if (raw == null || raw === '') {
    return { ok: false, error: 'موعد انتهاء الرسالة مطلوب (تاريخ وساعة)' };
  }
  const ms = new Date(String(raw)).getTime();
  if (!Number.isFinite(ms)) {
    return { ok: false, error: 'تاريخ أو وقت الانتهاء غير صالح' };
  }
  if (ms <= Date.now() + 60_000) {
    return { ok: false, error: 'موعد الانتهاء يجب أن يكون بعد دقيقة واحدة على الأقل' };
  }
  const maxMs = Date.now() + 366 * 24 * 60 * 60 * 1000;
  if (ms > maxMs) {
    return { ok: false, error: 'موعد الانتهاء بعيد جداً (الحد سنة واحدة)' };
  }
  return { ok: true, iso: new Date(ms).toISOString() };
}

async function insertBroadcastInboxRows(
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

  if (!title || title.length > 70) {
    return { status: 400, body: { error: 'العنوان مطلوب (70 حرفاً كحد أقصى)' } };
  }
  if (!body || body.length > 207) {
    return { status: 400, body: { error: 'نص الرسالة مطلوب (207 حرفاً كحد أقصى)' } };
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

  const expiresParsed = parseBroadcastExpiresAt(payload.expiresAt);
  if (!expiresParsed.ok) {
    return { status: 400, body: { error: expiresParsed.error } };
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
      expires_at: expiresParsed.iso,
    })
    .select('id')
    .single();
  if (bcErr || !broadcastRow?.id) {
    return { status: 500, body: { error: bcErr?.message || 'فشل حفظ النشرة — شغّل supabase/broadcasts.sql' } };
  }

  const broadcastId = broadcastRow.id;
  try {
    await insertBroadcastInboxRows(supabase, broadcastId, recipientIds, { title, body, kind });
  } catch (err) {
    await supabase.from('broadcasts').delete().eq('id', broadcastId);
    return { status: 500, body: { error: String(err) } };
  }

  const bcType = kind === 'motivational' ? 'green' : kind === 'alert' ? 'amber' : 'blue';
  const bcIcon = kind === 'motivational' ? 'fa-trophy' : kind === 'alert' ? 'fa-triangle-exclamation' : 'fa-bullhorn';
  for (const uid of recipientIds) {
    await upsertAppNotification(supabase, {
      userId: uid,
      eventKey: `broadcast_${broadcastId}`,
      title,
      message: body,
      type: bcType,
      icon: bcIcon,
      broadcastId,
      broadcastKind: kind,
      scope: 'mine',
    });
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
      expiresAt: expiresParsed.iso,
      errors: pushResult.errors,
    },
  };
}

Deno.serve(async (req) => {
  _activeCors = buildCorsHeaders(req);

  if (req.method === 'OPTIONS') return new Response('ok', { headers: _activeCors });

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
      version: '2026-06-notifications-db-v1',
      autoForwardCron: AUTO_FORWARD_CRON_VERSION,
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

  // ─── Cron: تمرير تلقائي للتذاكر المتأخرة (بدون متصفح) ───
  if (payload.autoForwardCron === true) {
    if (!await isAuthorizedCron(req, payload)) {
      const gotBody = !!normSecret(payload?.cronSecret);
      const gotHeader = !!normSecret(req.headers.get('x-cron-secret'));
      return json({
        error: 'unauthorized — use cronSecret in body, x-cron-secret header, or service role bearer',
        hint: gotBody
          ? 'cronSecret وصل لكنه لا يطابق AUTO_FORWARD_CRON_SECRET في Secrets'
          : gotHeader
            ? 'x-cron-secret وصل لكنه لا يطابق Secrets'
            : 'لم يصل أي سر — حدّث Cron ليرسل cronSecret داخل body',
      }, 401);
    }
    try {
      const result = await runAutoForwardCron(supabase, async (record, previousState) => {
        const push = await dispatchViolationStatePush(supabase, record, previousState, {
          isAutoForward: true,
          dedupeKey: `cron:${record.id}:${previousState}:${record.state}`,
        });
        if (push.error && !push.sent) return { ok: false, error: String(push.error) };
        return { ok: true };
      });
      return json({ ok: true, cron: AUTO_FORWARD_CRON_VERSION, ...result });
    } catch (err) {
      return json({ ok: false, error: String(err) }, 500);
    }
  }

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
    try {
      const serviceInternal = await isServiceRoleAuth(req);
      const userId = serviceInternal ? null : await resolveUserIdFromJwt(req);
      if (!userId && !serviceInternal) return json({ error: 'يجب تسجيل الدخول لإرسال التنبيه' }, 401);
      const record = extractRecord(payload);
      if (!record?.id) return json({ error: 'missing violation record in payload' }, 400);
      if (userId && !serviceInternal) {
        const canSee = await userCanSeeViolation(req, String(record.id));
        if (canSee !== true) return json({ error: 'غير مصرح بإرسال تنبيه لهذه التذكرة' }, 403);
      }
      const { data: row, error: rowErr } = await supabase
        .from('violations')
        .select('id, ticket_number, violation_type, employee_id, branch_id, state, auto_forwarded_emp, auto_forwarded_sup')
        .eq('id', record.id)
        .maybeSingle();
      if (rowErr) return json({ error: rowErr.message }, 500);
      if (!row) return json({ error: 'violation not found' }, 404);
      const merged: ViolationRow = { ...row, ...record, id: row.id };
      const previousState = payload.previousState != null ? String(payload.previousState) : null;
      const result = await dispatchViolationStatePush(supabase, merged, previousState, {
        isAutoForward: payload.isAutoForward === true,
        dedupeKey: payload.dedupeKey != null ? String(payload.dedupeKey) : undefined,
      });
      if (result.error && !result.sent) {
        return json({ ok: false, ...result }, 500);
      }
      return json({ ok: true, ...result });
    } catch (err) {
      return json({ ok: false, error: String(err) }, 500);
    }
  }

  // ─── إشعار من التطبيق بعد إنشاء مخالفة (JWT) ───
  if (payload.notify === true) {
    const userId = await resolveUserIdFromJwt(req);
    if (!userId) return json({ error: 'يجب تسجيل الدخول لإرسال التنبيه' }, 401);
    const record = extractRecord(payload);
    if (!record?.id) return json({ error: 'missing violation record in payload' }, 400);
    // [أمان] منع إساءة الاستخدام: المستخدم يرسل تنبيهاً فقط لتذكرة يراها
    {
      const canSee = await userCanSeeViolation(req, String(record.id));
      if (canSee === false) return json({ error: 'غير مصرح بإرسال تنبيه لهذه التذكرة' }, 403);
    }
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

  return json({ error: 'استخدم test:true أو notify:true أو notifyState:true أو autoForwardCron:true أو broadcast:true' }, 400);
});
