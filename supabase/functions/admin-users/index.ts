// supabase/functions/admin-users/index.ts
//
// Edge Function آمنة للعمليات الإدارية على المستخدمين.
// تُستخدم بدلاً من تمرير Service Role Key للمتصفح.
//
// تتحقق من:
//   1. أن الطلب يحمل JWT صالح من Supabase Auth
//   2. أن المستخدم له role = 'admin' في جدول users
// ثم تستخدم Service Role Key (من المتغيرات السرية) لتنفيذ العملية.
//
// Deploy:
//   supabase functions deploy admin-users --no-verify-jwt
//   (نتحقق من JWT يدوياً عشان نقرأ المستخدم بأنفسنا)

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
// يدعم كلا التسميتين: legacy (SUPABASE_ANON_KEY) أو new (SUPABASE_PUBLISHABLE_KEY)
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_PUBLISHABLE_KEY')
  ?? Deno.env.get('SUPABASE_ANON_KEY')!;
// يدعم كلا التسميتين: legacy (SUPABASE_SERVICE_ROLE_KEY) أو new (SUPABASE_SECRET_KEY)
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SECRET_KEY')
  ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

serve(async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  try {
    // ── 1. التحقق من JWT الخاص بالمستخدم الحالي ──
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return json({ error: 'Missing authorization' }, 401);
    }
    const jwt = authHeader.replace('Bearer ', '');

    // عميل بصلاحيات المستخدم الحالي (للتحقق منه فقط)
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userErr } = await userClient.auth.getUser(jwt);
    if (userErr || !user) {
      return json({ error: 'Invalid session' }, 401);
    }

    // ── 2. التحقق من أن المستخدم Admin (نقرأ بصلاحيات الخدمة لتجاوز RLS بأمان) ──
    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: profile, error: profileErr } = await adminClient
      .from('users')
      .select('role, is_active')
      .eq('auth_uid', user.id)
      .maybeSingle();

    if (profileErr) {
      return json({ error: 'Failed to verify user' }, 500);
    }
    if (!profile) {
      return json({ error: 'User profile not found' }, 403);
    }
    if (!profile.is_active) {
      return json({ error: 'Account is disabled' }, 403);
    }
    if (profile.role !== 'admin') {
      return json({ error: 'Admin role required' }, 403);
    }

    // ── 3. تنفيذ العملية المطلوبة ──
    const body = await req.json();
    const { action } = body;

    switch (action) {
      case 'create': {
        const { email, password, metadata } = body;
        if (!email || !password) {
          return json({ error: 'Email and password are required' }, 400);
        }
        if (password.length < 6) {
          return json({ error: 'Password must be at least 6 characters' }, 400);
        }

        const { data, error } = await adminClient.auth.admin.createUser({
          email: String(email).trim().toLowerCase(),
          password,
          email_confirm: true,
          user_metadata: metadata || {},
        });
        if (error) return json({ error: error.message }, 400);
        return json({ id: data.user.id });
      }

      case 'delete': {
        const { authUid } = body;
        if (!authUid) return json({ error: 'authUid required' }, 400);

        // منع الـ admin من حذف نفسه عن طريق الخطأ
        if (authUid === user.id) {
          return json({ error: 'لا يمكنك حذف حسابك بنفسك' }, 400);
        }

        const { error } = await adminClient.auth.admin.deleteUser(authUid);
        if (error) return json({ error: error.message }, 400);
        return json({ ok: true });
      }

      case 'updateEmail': {
        const { authUid, email } = body;
        if (!authUid || !email) {
          return json({ error: 'authUid and email required' }, 400);
        }
        const { data, error } = await adminClient.auth.admin.updateUserById(authUid, {
          email: String(email).trim().toLowerCase(),
        });
        if (error) return json({ error: error.message }, 400);
        return json({ ok: true, user: data.user });
      }

      case 'updateMetadata': {
        const { authUid, metadata } = body;
        if (!authUid) return json({ error: 'authUid required' }, 400);
        const { data, error } = await adminClient.auth.admin.updateUserById(authUid, {
          user_metadata: metadata || {},
        });
        if (error) return json({ error: error.message }, 400);
        return json({ ok: true, user: data.user });
      }

      default:
        return json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (err) {
    console.error('Edge function error:', err);
    return json({ error: err instanceof Error ? err.message : 'Internal error' }, 500);
  }
});
