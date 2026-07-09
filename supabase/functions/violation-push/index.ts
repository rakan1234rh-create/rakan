// violation-push — إشعارات المخالفات (الخطة الرسمية 2026)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import webpush from 'npm:web-push@3.6.7';
import {
  AUTO_FORWARD_CRON_VERSION,
  isAuthorizedCron,
  normSecret,
  runAutoForwardCron,
} from './auto-forward-cron.ts';
import {
  buildNewViolationTemplates,
  buildStateChangeTemplates,
  type RecipientRole,
  type ViolationNotifContext,
  type ViolationNotifTemplate,
} from './violation-notification-copy.ts';
import { runWeeklyDigest } from './violation-weekly-digest.ts';
import { Resend } from 'npm:resend@4.0.0';

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

type ViolationRow = ViolationNotifContext;

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

async function getActiveRoleUserIds(
  supabase: ReturnType<typeof createClient>,
  roles: string[],
) {
  const ids = new Set<string>();
  const { data, error } = await supabase
    .from('users')
    .select('id, is_active')
    .in('role', roles);
  if (error) throw new Error(error.message);
  for (const u of data ?? []) {
    if (!u?.id || u.is_active === false) continue;
    ids.add(String(u.id));
  }
  return ids;
}

async function resolveRecipientIds(
  supabase: ReturnType<typeof createClient>,
  record: ViolationRow,
  role: RecipientRole,
): Promise<Set<string>> {
  const ids = new Set<string>();
  if (role === 'employee' && record.employee_id) {
    ids.add(String(record.employee_id));
    return ids;
  }
  if (role === 'supervisor' && record.branch_id) {
    const supId = await getRegionSupervisorId(supabase, String(record.branch_id));
    if (supId) ids.add(supId);
    return ids;
  }
  if (role === 'branch_manager' && record.branch_id) {
    for (const id of await getBranchManagerIds(supabase, String(record.branch_id), record.employee_id)) {
      ids.add(id);
    }
    return ids;
  }
  if (role === 'auditor') {
    for (const id of await getActiveRoleUserIds(supabase, ['auditor', 'admin'])) ids.add(id);
    return ids;
  }
  if (role === 'manager') {
    for (const id of await getActiveRoleUserIds(supabase, ['manager', 'admin'])) ids.add(id);
    return ids;
  }
  if (role === 'hr') {
    for (const id of await getActiveRoleUserIds(supabase, ['hr', 'admin'])) ids.add(id);
    return ids;
  }
  return ids;
}

async function getEmployeeName(
  supabase: ReturnType<typeof createClient>,
  employeeId: string | null | undefined,
) {
  if (!employeeId) return '';
  const { data: emp } = await supabase
    .from('users')
    .select('name')
    .eq('id', employeeId)
    .maybeSingle();
  return String(emp?.name || '').trim();
}

async function dispatchNotificationTemplates(
  supabase: ReturnType<typeof createClient>,
  record: ViolationRow,
  templates: ViolationNotifTemplate[],
  employeeName: string,
  opts: { tagPrefix?: string } = {},
) {
  if (!templates.length) return { sent: 0, reason: 'no templates' };

  let totalSent = 0;
  const allErrors: string[] = [];
  const recipientCount = new Set<string>();
  const tagPrefix = opts.tagPrefix || 'vnotif';

  const templateResults = await Promise.all(templates.map(async (tpl) => {
    const userIds = await resolveRecipientIds(supabase, record, tpl.recipientRole);
    if (!userIds.size) return { sent: 0, errors: [] as string[] };

    const eventKey = `${tpl.eventKeySuffix}_${record.id}`;
    await Promise.all(Array.from(userIds).map((uid) => {
      recipientCount.add(uid);
      return upsertAppNotification(supabase, {
        userId: uid,
        eventKey,
        title: tpl.title,
        message: tpl.message,
        type: tpl.type,
        icon: tpl.icon,
        ticketId: String(record.id),
        scope: tpl.scope,
        isAuto: !!tpl.isAuto,
      });
    }));

    // Immediate Email Logic
    if (tpl.sendEmail) {
      const { data: users } = await supabase
        .from('users')
        .select('email')
        .in('id', Array.from(userIds))
        .eq('is_active', true);
      
      if (users?.length) {
        for (const u of users) {
          if (u.email) {
            try {
              await sendImmediateEmail(supabase, u.email, tpl.title, tpl.message, record);
            } catch (err) {
              allErrors.push(`Email failed to ${u.email}: ${err.message}`);
            }
          }
        }
      }
    }

    const pushResult = await sendPushToUserIds(
      supabase,
      userIds,
      tpl.title,
      tpl.message,
      {
        ticketId: String(record.id),
        tagSuffix: `${tagPrefix}_${tpl.eventKeySuffix}`,
      },
    );
    const errors: string[] = [];
    if (pushResult.error) errors.push(String(pushResult.error));
    if (pushResult.errors?.length) errors.push(...pushResult.errors);
    return { sent: pushResult.sent || 0, errors };
  }));

  for (const result of templateResults) {
    totalSent += result.sent;
    if (result.errors.length) allErrors.push(...result.errors);
  }

  return {
    sent: totalSent,
    recipients: recipientCount.size,
    errors: allErrors.length ? allErrors.slice(0, 5) : undefined,
  };
}

async function dispatchViolationInsertPush(
  supabase: ReturnType<typeof createClient>,
  record: ViolationRow,
) {
  const employeeName = await getEmployeeName(supabase, record.employee_id);
  const templates = buildNewViolationTemplates(record, employeeName);
  return dispatchNotificationTemplates(supabase, record, templates, employeeName, { tagPrefix: 'vnew' });
}

const recentStatePush = new Map<string, number>();
const STATE_PUSH_DEDUP_MS = 120_000;

function shouldSkipStatePush(dedupeKey: string) {
  const key = String(dedupeKey || '').trim();
  if (!key) return false;
  const now = Date.now();
  const last = recentStatePush.get(key);
  if (last && now - last < STATE_PUSH_DEDUP_MS) return true;
  recentStatePush.set(key, now);
  return false;
}

async function dispatchViolationStatePush(
  supabase: ReturnType<typeof createClient>,
  record: ViolationRow,
  previousState?: string | null,
  opts: { isAutoForward?: boolean; dedupeKey?: string } = {},
) {
  const state = String(record.state || '').trim();
  if (!state || state === 'uploading') {
    return { sent: 0, reason: 'state does not need push' };
  }
  if (previousState && String(previousState) === state) {
    return { sent: 0, reason: 'state unchanged' };
  }

  const dedupeKey = String(opts.dedupeKey || `${record.id}:${previousState || 'none'}:${state}`);
  if (shouldSkipStatePush(dedupeKey)) {
    return { sent: 0, reason: 'duplicate transition suppressed', dedupeKey };
  }

  const employeeName = await getEmployeeName(supabase, record.employee_id);
  const templates = buildStateChangeTemplates(record, previousState, employeeName);
  if (!templates.length) {
    return { sent: 0, reason: 'no notification scenario matched', state };
  }

  const result = await dispatchNotificationTemplates(
    supabase,
    record,
    templates,
    employeeName,
    { tagPrefix: 'vstate' },
  );

  return { ...result, state, dedupeKey };
}

async function sendImmediateEmail(
  supabase: ReturnType<typeof createClient>,
  to: string,
  title: string,
  body: string,
  record: ViolationRow,
) {
  const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
  const BREVO_API_KEY = Deno.env.get('BREVO_API_KEY') ?? '';
  const SENDER_EMAIL_RAW = Deno.env.get('SENDER_EMAIL') ?? 'no-reply@athar-app.online';
  const FULL_SENDER = SENDER_EMAIL_RAW.includes('<') ? SENDER_EMAIL_RAW : `ATHAR <${SENDER_EMAIL_RAW}>`;
  const SENDER_EMAIL = SENDER_EMAIL_RAW.includes('<') ? SENDER_EMAIL_RAW.match(/<(.+)>|$/)?.[1] || SENDER_EMAIL_RAW : SENDER_EMAIL_RAW;
  const SENDER_NAME = SENDER_EMAIL_RAW.includes('<') ? SENDER_EMAIL_RAW.split('<')[0].trim() : 'ATHAR';

  const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;
  const isApple = (email: string) => new Set(['icloud.com', 'me.com', 'mac.com']).has(email.split('@').pop()?.toLowerCase() ?? '');

  // Format ticket number to show only the last part (e.g., V-2026-0356 -> 0356)
  const rawTicket = String(record.ticket_number || record.id);
  const formattedTicket = rawTicket.includes('-') ? rawTicket.split('-').pop() : rawTicket;

  const subject = `${title} - رقم (${formattedTicket})`;
  const { data: userData } = await supabase.from('users').select('name').eq('email', to).maybeSingle();
  const userName = userData?.name || '';
  const greeting = userName ? `مرحباً ${userName.split(' ')[0]}،` : 'مرحباً،';

  const html = `
    <div dir="rtl" style="font-family: sans-serif; line-height: 1.6; color: #333;">
      <h2 style="color: #d9534f;">${title}</h2>
      <p><strong>${greeting}</strong></p>
      <p>${body}</p>
      <div style="background: #f4f4f4; padding: 15px; border-radius: 8px; margin-top: 20px;">
        <p><strong>رقم المخالفة:</strong> ${formattedTicket}</p>
        <p><strong>نوع المخالفة:</strong> ${record.violation_type || '—'}</p>
      </div>
      <p style="margin-top: 20px;">يرجى مراجعة التفاصيل عبر تطبيق أثر</p>
      <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
      <p style="font-size: 12px; color: #777;">رسالة تلقائية من منصة أثر يرجى عدم الرد على هذا البريد</p>
    </div>
  `;
  const text = `${title}: ${body}. رقم المخالفة: ${record.ticket_number || record.id}`;

  if (isApple(to) && BREVO_API_KEY) {
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': BREVO_API_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({
        sender: { name: SENDER_NAME, email: SENDER_EMAIL },
        to: [{ email: to }],
        subject,
        htmlContent: html,
        textContent: text
      }),
    });
    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Brevo failed: ${errText}`);
    }
  } else if (resend) {
    const { error } = await resend.emails.send({ from: FULL_SENDER, to: [to], subject, html, text });
    if (error) throw new Error(`Resend failed: ${error.message}`);
  } else {
    throw new Error('No email provider (Resend/Brevo) configured');
  }
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
  const errors: string[] = [];

  const pushOutcomes = await Promise.all(uniqueSubs.map(async (sub) => {
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
      return { ok: true as const, endpoint: sub.endpoint };
    } catch (err) {
      const status = (err as { statusCode?: number; body?: string })?.statusCode;
      const detail = (err as { body?: string })?.body || String(err);
      const stale = status === 404 || status === 410;
      const vapidErr = status === 403 || /vapid|credentials|authorization/i.test(detail);
      return {
        ok: false as const,
        endpoint: sub.endpoint,
        stale,
        vapidErr,
        detail: vapidErr
          ? 'VAPID mismatch — أوقف التنبيهات ثم فعّلها من جديد على الجهاز'
          : detail.slice(0, 120),
      };
    }
  }));

  let sent = 0;
  for (const outcome of pushOutcomes) {
    if (outcome.ok) {
      sent += 1;
      continue;
    }
    if (outcome.stale) staleEndpoints.push(outcome.endpoint);
    else if (outcome.detail) errors.push(outcome.detail);
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

async function safeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const ba = enc.encode(a);
  const bb = enc.encode(b);
  if (ba.length !== bb.length) return false;
  const subtle = globalThis.crypto?.subtle;
  if (subtle && typeof subtle.timingSafeEqual === 'function') {
    return subtle.timingSafeEqual(ba, bb);
  }
  let diff = 0;
  for (let i = 0; i < ba.length; i++) diff |= ba[i] ^ bb[i];
  return diff === 0;
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
      version: '2026-07-parallel-push-v1',
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

  if (payload.weeklyDigest === true) {
    if (!await isAuthorizedCron(req, payload)) {
      return json({ error: 'unauthorized cron secret' }, 401);
    }
    try {
      const result = await runWeeklyDigest(supabase);
      return json({ ok: true, ...result });
    } catch (err) {
      return json({ ok: false, error: String(err) }, 500);
    }
  }

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
        .select('id, ticket_number, violation_type, employee_id, branch_id, state, status_text, auto_forwarded_emp, auto_forwarded_sup')
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

  if (payload.notify === true) {
    const userId = await resolveUserIdFromJwt(req);
    if (!userId) return json({ error: 'يجب تسجيل الدخول لإرسال التنبيه' }, 401);
    const record = extractRecord(payload);
    if (!record?.id) return json({ error: 'missing violation record in payload' }, 400);
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

  if (payload.broadcast === true) {
    const admin = await resolveAdminFromJwt(req);
    if (!admin) return json({ error: 'مدير النظام فقط يمكنه إرسال النشرات' }, 403);
    const result = await dispatchBroadcastPush(supabase, admin.id, payload);
    return json(result.body, result.status);
  }

  return json({ error: 'استخدم test:true أو notify:true أو notifyState:true أو autoForwardCron:true أو broadcast:true' }, 400);
});
