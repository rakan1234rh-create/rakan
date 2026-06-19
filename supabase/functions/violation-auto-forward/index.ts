import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

const VERSION = '2026-06-v1';
const EMP_TIMEOUT_HOURS = 24;
const SUP_TIMEOUT_HOURS = 48;
const WORKFLOW_PROCESS_STAGES = ['emp', 'sup', 'aud', 'mgt', 'hr'] as const;
const WORKFLOW_STAGE_SKIP_PERM: Record<string, string> = {
  sup: 'skip_stage_supervisor',
  aud: 'skip_stage_auditor',
  mgt: 'skip_stage_manager',
  hr: 'skip_stage_hr',
};
const STATE_LABELS: Record<string, string> = {
  emp: 'بانتظار رد الموظف',
  sup: 'بانتظار رد المشرف',
  aud: 'بانتظار التدقيق',
  mgt: 'بانتظار القرار الإداري',
  hr: 'بانتظار الموارد البشرية',
  closed: 'مغلقة',
};

type ViolationRow = {
  id: string;
  ticket_number?: string | number | null;
  violation_type?: string | null;
  employee_id?: string | null;
  branch_id?: string | null;
  supervisor_id?: string | null;
  state?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  logs?: unknown;
  auto_forwarded_emp?: boolean | null;
  auto_forwarded_sup?: boolean | null;
};

type WorkflowSkips = Record<string, boolean>;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function isDbTruthy(val: unknown) {
  return val === true || val === 1 || val === 'true' || val === 't';
}

function parseDbJsonArray(raw: unknown): Record<string, unknown>[] {
  if (Array.isArray(raw)) return raw as Record<string, unknown>[];
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function hoursSince(iso: string | null | undefined) {
  if (!iso) return 0;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return 0;
  return (Date.now() - ms) / (1000 * 60 * 60);
}

function getNowKsa() {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Riyadh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

function isSupStageEntryLog(log: Record<string, unknown> | null | undefined) {
  const action = String(log?.action || '');
  if (/رد الموظف/i.test(action)) return true;
  if (/تمرير تلقائي/i.test(action) && /المشرف|بانتظار رد المشرف/i.test(action)) return true;
  if (/تمرير.*للمشرف/i.test(action)) return true;
  return false;
}

function getStateStartTime(t: ViolationRow) {
  const logs = parseDbJsonArray(t.logs);
  if (t.state === 'emp') return t.created_at || null;
  if (t.state === 'sup') {
    for (let i = logs.length - 1; i >= 0; i--) {
      if (isSupStageEntryLog(logs[i])) return String(logs[i].date || '');
    }
    if (isDbTruthy(t.auto_forwarded_emp) && t.updated_at) return t.updated_at;
    return t.created_at || null;
  }
  return t.created_at || null;
}

function isWorkflowStageSkipped(stage: string, skips: WorkflowSkips) {
  const permId = WORKFLOW_STAGE_SKIP_PERM[stage];
  if (!permId) return false;
  return !!skips[permId];
}

function getActiveWorkflowStages(skips: WorkflowSkips) {
  const stages = WORKFLOW_PROCESS_STAGES.filter((s) => !isWorkflowStageSkipped(s, skips));
  return stages.length ? stages : ['emp'];
}

function getNextWorkflowState(current: string, skips: WorkflowSkips) {
  const stages = getActiveWorkflowStages(skips);
  const idx = stages.indexOf(current as typeof WORKFLOW_PROCESS_STAGES[number]);
  if (idx >= 0 && idx < stages.length - 1) return stages[idx + 1];
  const allIdx = WORKFLOW_PROCESS_STAGES.indexOf(current as typeof WORKFLOW_PROCESS_STAGES[number]);
  if (allIdx < 0) return null;
  for (let i = allIdx + 1; i < WORKFLOW_PROCESS_STAGES.length; i++) {
    const s = WORKFLOW_PROCESS_STAGES[i];
    if (!isWorkflowStageSkipped(s, skips)) return s;
  }
  return null;
}

async function loadWorkflowSkips(supabase: ReturnType<typeof createClient>) {
  const { data } = await supabase
    .from('platform_settings')
    .select('value')
    .eq('key', 'permissions_bundle_v1')
    .maybeSingle();
  const raw = data?.value;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const ws = (raw as { workflow_skips?: WorkflowSkips }).workflow_skips;
    if (ws && typeof ws === 'object') return ws;
  }
  return {};
}

function isAuthorizedCron(req: Request) {
  const cronSecret = Deno.env.get('AUTO_FORWARD_CRON_SECRET') ?? '';
  const headerSecret = req.headers.get('x-cron-secret') ?? '';
  if (cronSecret && headerSecret && headerSecret === cronSecret) return true;

  const auth = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (serviceKey && auth && auth === serviceKey) return true;

  return false;
}

async function notifyStatePush(
  supabaseUrl: string,
  serviceKey: string,
  record: ViolationRow,
  previousState: string,
) {
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/violation-push`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        notifyState: true,
        isAutoForward: true,
        previousState,
        dedupeKey: `cron:${record.id}:${previousState}:${record.state}`,
        record,
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      return { ok: false, error: text.slice(0, 200) };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

async function autoForwardTicket(
  supabase: ReturnType<typeof createClient>,
  supabaseUrl: string,
  serviceKey: string,
  t: ViolationRow,
  direction: 'emp_to_sup' | 'sup_to_aud',
  skips: WorkflowSkips,
) {
  const flagCol = direction === 'emp_to_sup' ? 'auto_forwarded_emp' : 'auto_forwarded_sup';
  const expectedState = direction === 'emp_to_sup' ? 'emp' : 'sup';
  const timeoutHours = direction === 'emp_to_sup' ? EMP_TIMEOUT_HOURS : SUP_TIMEOUT_HOURS;
  const roleLabel = direction === 'emp_to_sup' ? 'الموظف' : 'المشرف';

  const { data: current, error: readErr } = await supabase
    .from('violations')
    .select(`id, ticket_number, violation_type, employee_id, branch_id, supervisor_id, state, logs, ${flagCol}, created_at, updated_at, auto_forwarded_emp, auto_forwarded_sup`)
    .eq('id', t.id)
    .single();

  if (readErr || !current) return { ok: false, reason: 'read_failed' };
  if (isDbTruthy(current[flagCol])) return { ok: false, reason: 'already_forwarded' };
  if (current.state !== expectedState) return { ok: false, reason: 'state_changed' };

  const existingLogs = parseDbJsonArray(current.logs);
  const autoActionRe = direction === 'emp_to_sup'
    ? /تمرير تلقائي.*(المشرف|بانتظار رد المشرف)/i
    : /تمرير تلقائي.*(المدقق|بانتظار رد المدقق)/i;
  if (existingLogs.some((l) => autoActionRe.test(String(l?.action || '')))) {
    return { ok: false, reason: 'log_exists' };
  }

  const fromStage = expectedState;
  const newState = getNextWorkflowState(fromStage, skips) || 'closed';
  const actionLabel = `⚠️ تمرير تلقائي — ${STATE_LABELS[newState] || newState}`;
  const note = `تم تمرير التذكرة تلقائياً بعد انتهاء مهلة ${timeoutHours} ساعة دون رد من ${roleLabel}`;

  const newLog = {
    date: getNowKsa(),
    user: 'النظام',
    role: 'النظام',
    action: actionLabel,
    note,
  };

  const updatePayload: Record<string, unknown> = {
    state: newState,
    logs: [...existingLogs, newLog],
    [flagCol]: true,
  };

  let updateQuery = supabase
    .from('violations')
    .update(updatePayload)
    .eq('id', t.id)
    .eq('state', expectedState);
  updateQuery = updateQuery.or(`${flagCol}.is.null,${flagCol}.eq.false`);

  const { data: updated, error: updErr } = await updateQuery.select('id');
  if (updErr || !updated?.length) return { ok: false, reason: 'update_failed' };

  const merged: ViolationRow = {
    ...current,
    state: newState,
    [flagCol]: true,
  };
  const pushResult = await notifyStatePush(supabaseUrl, serviceKey, merged, expectedState);

  return {
    ok: true,
    id: t.id,
    ticket_number: current.ticket_number,
    from: expectedState,
    to: newState,
    push: pushResult,
  };
}

function resolveDirection(t: ViolationRow, skips: WorkflowSkips) {
  if (t.state === 'emp' && !isDbTruthy(t.auto_forwarded_emp)) {
    if (hoursSince(t.created_at) >= EMP_TIMEOUT_HOURS) return 'emp_to_sup' as const;
  }
  if (t.state === 'sup' && !isDbTruthy(t.auto_forwarded_sup) && !isWorkflowStageSkipped('sup', skips)) {
    if (hoursSince(getStateStartTime(t)) >= SUP_TIMEOUT_HOURS) return 'sup_to_aud' as const;
  }
  return null;
}

async function runAutoForward(supabase: ReturnType<typeof createClient>, supabaseUrl: string, serviceKey: string) {
  const skips = await loadWorkflowSkips(supabase);
  const empCutoff = new Date(Date.now() - EMP_TIMEOUT_HOURS * 60 * 60 * 1000).toISOString();

  const { data: empCandidates, error: empErr } = await supabase
    .from('violations')
    .select('id, ticket_number, violation_type, employee_id, branch_id, supervisor_id, state, created_at, updated_at, logs, auto_forwarded_emp, auto_forwarded_sup')
    .eq('state', 'emp')
    .or('auto_forwarded_emp.is.null,auto_forwarded_emp.eq.false')
    .lt('created_at', empCutoff)
    .limit(200);

  if (empErr) throw new Error(empErr.message);

  const { data: supCandidates, error: supErr } = await supabase
    .from('violations')
    .select('id, ticket_number, violation_type, employee_id, branch_id, supervisor_id, state, created_at, updated_at, logs, auto_forwarded_emp, auto_forwarded_sup')
    .eq('state', 'sup')
    .or('auto_forwarded_sup.is.null,auto_forwarded_sup.eq.false')
    .limit(200);

  if (supErr) throw new Error(supErr.message);

  const candidates = [...(empCandidates ?? []), ...(supCandidates ?? [])];
  const results: Record<string, unknown>[] = [];
  let forwarded = 0;

  for (const row of candidates) {
    const direction = resolveDirection(row, skips);
    if (!direction) continue;
    const result = await autoForwardTicket(supabase, supabaseUrl, serviceKey, row, direction, skips);
    results.push(result);
    if (result.ok) forwarded += 1;
  }

  return {
    scanned: candidates.length,
    forwarded,
    results: results.slice(0, 20),
    skips,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  if (req.method === 'GET') {
    return json({
      ok: true,
      service: 'violation-auto-forward',
      version: VERSION,
      empTimeoutHours: EMP_TIMEOUT_HOURS,
      supTimeoutHours: SUP_TIMEOUT_HOURS,
      cronSecretConfigured: !!(Deno.env.get('AUTO_FORWARD_CRON_SECRET')),
    });
  }

  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  if (!isAuthorizedCron(req)) {
    return json({ error: 'unauthorized — use x-cron-secret or service role bearer' }, 401);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceKey) {
    return json({ error: 'missing supabase env' }, 500);
  }

  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  try {
    const result = await runAutoForward(supabase, supabaseUrl, serviceKey);
    return json({ ok: true, version: VERSION, ...result });
  } catch (err) {
    return json({ ok: false, error: String(err) }, 500);
  }
});
