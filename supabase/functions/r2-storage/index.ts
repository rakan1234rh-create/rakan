/**
 * مرصاد — تخزين المرفقات على Cloudflare R2 عبر توقيع S3 من جهة الخادم.
 * المفاتيح في متغيرات بيئة Supabase فقط (لا تُرسل للمتصفح).
 *
 * Secrets (Dashboard → Edge Functions → r2-storage → Secrets):
 *   R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ACCOUNT_ID, R2_BUCKET_NAME
 *   (بدائل مقبولة: AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY، CLOUDFLARE_ACCOUNT_ID، R2_BUCKET / AWS_S3_BUCKET)
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'

/* Lazy AWS SDK — OPTIONS/health/ping must not pay cold-start cost of client-s3. */
// deno-lint-ignore no-explicit-any
let AbortMultipartUploadCommand: any
// deno-lint-ignore no-explicit-any
let CompleteMultipartUploadCommand: any
// deno-lint-ignore no-explicit-any
let CopyObjectCommand: any
// deno-lint-ignore no-explicit-any
let CreateMultipartUploadCommand: any
// deno-lint-ignore no-explicit-any
let DeleteObjectCommand: any
// deno-lint-ignore no-explicit-any
let GetObjectCommand: any
// deno-lint-ignore no-explicit-any
let HeadObjectCommand: any
// deno-lint-ignore no-explicit-any
let PutObjectCommand: any
// deno-lint-ignore no-explicit-any
let UploadPartCommand: any
// deno-lint-ignore no-explicit-any
let S3Client: any
// deno-lint-ignore no-explicit-any
let getSignedUrl: any

let _awsReady: Promise<void> | null = null

async function ensureAws(): Promise<void> {
  if (S3Client) return
  if (!_awsReady) {
    _awsReady = (async () => {
      const [s3mod, signermod] = await Promise.all([
        import('npm:@aws-sdk/client-s3@3.733.0'),
        import('npm:@aws-sdk/s3-request-presigner@3.733.0'),
      ])
      AbortMultipartUploadCommand = s3mod.AbortMultipartUploadCommand
      CompleteMultipartUploadCommand = s3mod.CompleteMultipartUploadCommand
      CopyObjectCommand = s3mod.CopyObjectCommand
      CreateMultipartUploadCommand = s3mod.CreateMultipartUploadCommand
      DeleteObjectCommand = s3mod.DeleteObjectCommand
      GetObjectCommand = s3mod.GetObjectCommand
      HeadObjectCommand = s3mod.HeadObjectCommand
      PutObjectCommand = s3mod.PutObjectCommand
      UploadPartCommand = s3mod.UploadPartCommand
      S3Client = s3mod.S3Client
      getSignedUrl = signermod.getSignedUrl
    })()
  }
  await _awsReady
}

function buildCors(req: Request): Record<string, string> {
  const raw = Deno.env.get('ALLOWED_ORIGIN') || 'https://athar-app.online';
  const allowed = new Set(
    raw.split(',').map((s) => s.trim()).filter(Boolean).concat(['https://athar-app.online', 'https://athar.app']),
  );
  const requestOrigin = req.headers.get('Origin') || '';
  const isAllowed = allowed.has(requestOrigin);
  return {
    'Access-Control-Allow-Origin': isAllowed ? requestOrigin : '',
    'Access-Control-Allow-Headers':
      'authorization, x-client-info, apikey, content-type, range, x-r2-action, x-r2-key, x-r2-upload-id, x-r2-part-number',
    'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
    'Access-Control-Expose-Headers':
      'Content-Length, Content-Range, Accept-Ranges, Content-Type',
  };
}

const _defaultCors = buildCors(new Request('https://placeholder.test'));

let _cors: Record<string, string> = _defaultCors;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ..._cors, 'Content-Type': 'application/json' },
  })
}

/** رسالة خطأ R2/S3 آمنة للعميل (بدون أسرار) */
function r2ErrInfo(e: unknown): { name: string; message: string } {
  const name =
    e && typeof e === 'object' && 'name' in e
      ? String((e as { name: string }).name)
      : ''
  const message =
    e instanceof Error
      ? String(e.message || '').slice(0, 240)
      : String(e || '').slice(0, 240)
  return { name: name || 'Error', message: message || 'unknown' }
}

function assertKey(key: unknown): string {
  if (typeof key !== 'string' || !key.length) throw new Error('key مطلوب')
  if (key.length > 2048) throw new Error('key طويل جداً')
  if (key.includes('..') || key.startsWith('/') || key.includes('\0') || key.includes('\\')) {
    throw new Error('مسار غير صالح')
  }
  if (!/^[a-zA-Z0-9_\-./]+$/.test(key)) throw new Error('أحرف غير مسموحة في المفتاح')
  return key
}

const R2_PROXY_PUT_MAX_BYTES = 52 * 1024 * 1024
const R2_PROXY_PART_MAX_BYTES = 10 * 1024 * 1024
const AVATAR_PRESET_MAX_BYTES = 8 * 1024 * 1024

function assertTempUploadKey(key: string, userId: string): string {
  const k = assertKey(key)
  if (!k.startsWith(`temp_${userId}`)) {
    throw new Error('غير مصرح بالرفع في هذا المسار')
  }
  return k
}

function assertAvatarPresetKey(key: string): string {
  const k = assertKey(key)
  if (!/^avatars\/presets\/[a-zA-Z0-9_-]+\.(webp|png|jpe?g)$/i.test(k)) {
    throw new Error('مسار صورة البروفايل غير صالح')
  }
  return k
}

async function requireMirsadAdmin(
  supabase: ReturnType<typeof createClient>,
): Promise<boolean> {
  const { data, error } = await supabase.rpc('current_user_role')
  if (error) return false
  return data === 'admin'
}

function getBearerToken(req: Request): string {
  const authHeader = req.headers.get('Authorization') || ''
  const m = authHeader.match(/^Bearer\s+(.+)$/i)
  return m ? m[1].trim() : ''
}

/** مفتاح service_role من بيئة الدالة (JWT القديم أو sb_secret_*) */
function serviceRoleKeys(): string[] {
  return [
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
    Deno.env.get('SERVICE_ROLE_KEY') || '',
  ].map((s) => s.trim()).filter(Boolean)
}

function isServiceRoleRequest(req: Request): boolean {
  const token = getBearerToken(req)
  if (!token) return false
  if (serviceRoleKeys().some((k) => k === token)) return true
  // رمز صيانة لمرة التحويلات من الخادم (اختياري عبر سر R2_MAINT_TOKEN)
  const maint = (Deno.env.get('R2_MAINT_TOKEN') || '').trim()
  if (maint && token === maint) return true
  return false
}

async function authenticateRequest(req: Request) {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return { error: json({ error: 'لا يوجد رمز مصادقة' }, 401) }
  }

  if (isServiceRoleRequest(req)) {
    const serviceKey = serviceRoleKeys()[0]
    const supabase = createClient(supabaseUrl, serviceKey)
    return {
      user: { id: 'service-role' } as { id: string },
      supabase,
      isServiceRole: true as const,
    }
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  })

  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser()
  if (authErr || !user) {
    return { error: json({ error: 'جلسة غير صالحة' }, 401) }
  }

  return { user, supabase, isServiceRole: false as const }
}

/** أول قيمة غير فارغة بعد trim (يدعم أسماء بديلة شائعة من Cloudflare / AWS) */
function envFirst(...keys: string[]) {
  for (const k of keys) {
    const v = Deno.env.get(k)
    if (v != null && String(v).trim().length) return String(v).trim()
  }
  return ''
}

/**
 * يستخرج Account ID الحقيقي إذا لصق المستخدم رابط R2 كامل بالغلط.
 * أمثلة مقبولة:
 *   4621f6487cfcd2be41fe670609190c2e
 *   https://4621....r2.cloudflarestorage.com
 *   https://4621....r2.cloudflarestorage.com/athar-staging
 */
function normalizeR2AccountId(raw: string): string {
  let s = String(raw || '').trim()
  if (!s) return ''
  // أزل اقتباسات شائعة من اللصق
  s = s.replace(/^['"]+|['"]+$/g, '')
  // إذا كان رابطاً، خذ الـ host فقط
  try {
    if (/^https?:\/\//i.test(s) || s.includes('.r2.cloudflarestorage.com')) {
      const withScheme = /^https?:\/\//i.test(s) ? s : `https://${s}`
      const u = new URL(withScheme)
      s = u.hostname || s
    }
  } catch {
    /* keep s */
  }
  // ACCOUNT_ID.r2.cloudflarestorage.com → ACCOUNT_ID
  const m = s.match(/^([a-f0-9]{32})\.r2\.cloudflarestorage\.com$/i)
  if (m) return m[1].toLowerCase()
  // أحياناً يُلصق: ACCOUNT_ID.r2.../bucket أو نص فيه الـ id
  const anywhere = s.match(/([a-f0-9]{32})/i)
  if (anywhere && /r2\.cloudflarestorage\.com/i.test(String(raw))) {
    return anywhere[1].toLowerCase()
  }
  // قيمة نظيفة بطول 32 hex
  if (/^[a-f0-9]{32}$/i.test(s)) return s.toLowerCase()
  return s
}

function normalizeR2BucketName(raw: string): string {
  let s = String(raw || '').trim().replace(/^['"]+|['"]+$/g, '')
  if (!s) return ''
  // لو لصق رابط فيه اسم الـ bucket في المسار
  try {
    if (/^https?:\/\//i.test(s) || s.includes('.r2.cloudflarestorage.com')) {
      const withScheme = /^https?:\/\//i.test(s) ? s : `https://${s}`
      const u = new URL(withScheme)
      const seg = (u.pathname || '').split('/').filter(Boolean)[0]
      if (seg) return seg
    }
  } catch {
    /* keep s */
  }
  // athar-staging.r2.cloudflarestorage.com بالغلط
  const m = s.match(/^([a-z0-9][a-z0-9._-]*)\.r2\.cloudflarestorage\.com$/i)
  if (m) return m[1]
  return s
}

function requireR2Env() {
  const accessKeyId = envFirst('R2_ACCESS_KEY_ID', 'AWS_ACCESS_KEY_ID')
  const secretAccessKey = envFirst('R2_SECRET_ACCESS_KEY', 'AWS_SECRET_ACCESS_KEY')
  const accountId = normalizeR2AccountId(envFirst('R2_ACCOUNT_ID', 'CLOUDFLARE_ACCOUNT_ID'))
  const bucket = normalizeR2BucketName(envFirst('R2_BUCKET_NAME', 'R2_BUCKET', 'AWS_S3_BUCKET'))
  if (!accessKeyId || !secretAccessKey || !accountId || !bucket) return null
  return { accessKeyId, secretAccessKey, accountId, bucket }
}

/** بيانات تشخيص آمنة (بدون كشف الأسرار) */
function r2PublicDiag(env: NonNullable<ReturnType<typeof requireR2Env>>) {
  return {
    bucket: env.bucket,
    accountIdLen: env.accountId.length,
    accountIdSuffix: env.accountId.slice(-4),
    accessKeyIdPrefix: env.accessKeyId.slice(0, 4),
    accessKeyIdLen: env.accessKeyId.length,
    endpoint: `https://${env.accountId}.r2.cloudflarestorage.com`,
  }
}

function makeS3(env: NonNullable<ReturnType<typeof requireR2Env>>) {
  return new S3Client({
    region: 'auto',
    endpoint: `https://${env.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env.accessKeyId,
      secretAccessKey: env.secretAccessKey,
    },
    forcePathStyle: true,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  })
}

function guessContentTypeFromKey(key: string): string {
  const ext = key.includes('.') ? key.split('.').pop()!.toLowerCase() : ''
  const map: Record<string, string> = {
    mp4: 'video/mp4',
    mov: 'video/quicktime',
    webm: 'video/webm',
    avi: 'video/x-msvideo',
    mkv: 'video/x-matroska',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    pdf: 'application/pdf',
  }
  return map[ext] || 'application/octet-stream'
}

function b64url(data: Uint8Array | string): string {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64urlDecode(s: string): Uint8Array {
  const pad = s.length % 4 ? '='.repeat(4 - (s.length % 4)) : ''
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + pad
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function streamSecret(env: NonNullable<ReturnType<typeof requireR2Env>>) {
  // سرّ مستقل لتفادي بطلان الروابط عند تغيير مفاتيح R2
  return Deno.env.get('R2_STREAM_HMAC_SECRET') || `${env.secretAccessKey}:${env.accessKeyId}:${env.bucket}`
}

async function hmacSign(message: string, secret: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message))
  return b64url(new Uint8Array(sig))
}

async function makeStreamToken(
  key: string,
  env: NonNullable<ReturnType<typeof requireR2Env>>,
  ttlSec = 3600,
): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + ttlSec
  const msg = `${exp}:${key}`
  const sig = await hmacSign(msg, streamSecret(env))
  return `${b64url(msg)}.${sig}`
}

async function verifyStreamToken(
  token: string,
  env: NonNullable<ReturnType<typeof requireR2Env>>,
): Promise<string | null> {
  const parts = token.split('.')
  if (parts.length !== 2) return null
  let msg = ''
  try {
    msg = new TextDecoder().decode(b64urlDecode(parts[0]))
  } catch {
    return null
  }
  const colon = msg.indexOf(':')
  if (colon < 1) return null
  const exp = parseInt(msg.slice(0, colon), 10)
  const key = msg.slice(colon + 1)
  if (!key || !exp || exp < Math.floor(Date.now() / 1000)) return null
  const expected = await hmacSign(msg, streamSecret(env))
  if (expected !== parts[1]) return null
  return key
}

async function handleStreamRequest(
  req: Request,
  // deno-lint-ignore no-explicit-any
  s3: any,
  bucket: string,
  env: NonNullable<ReturnType<typeof requireR2Env>>,
): Promise<Response | null> {
  const u = new URL(req.url)
  const token = u.searchParams.get('stream')
  if (!token) return null

  const key = await verifyStreamToken(token, env)
  if (!key) return json({ error: 'رمز بث غير صالح أو منتهٍ' }, 401)

  const range = req.headers.get('Range') || undefined
  /** تجنّب تمرير فيديوهات كبيرة كاملة عبر Edge (غالباً 500/timeout) */
  const STREAM_FULL_PROXY_MAX = 8 * 1024 * 1024

  try {
    if (req.method === 'HEAD') {
      const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
      const headers: Record<string, string> = { ..._cors }
      headers['Content-Type'] = head.ContentType || guessContentTypeFromKey(key)
      headers['Accept-Ranges'] = 'bytes'
      if (head.ContentLength != null) {
        headers['Content-Length'] = String(head.ContentLength)
      }
      return new Response(null, { status: 200, headers })
    }

    // بدون Range: للفيديو/الملفات الكبيرة نوجّه لرابط R2 موقّع بدل بروكسي كامل عبر Worker
    if (!range) {
      try {
        const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
        const len = Number(head.ContentLength || 0)
        const isVideo = /\.(mp4|m4v|mov|webm|avi|mkv)$/i.test(key)
        if (isVideo || (len > 0 && len > STREAM_FULL_PROXY_MAX)) {
          const ct = head.ContentType || guessContentTypeFromKey(key)
          const signed = await getSignedUrl(
            s3,
            new GetObjectCommand({
              Bucket: bucket,
              Key: key,
              ResponseContentType: ct,
              ResponseContentDisposition: 'inline',
            }),
            { expiresIn: 3600 },
          )
          const headers: Record<string, string> = {
            ..._cors,
            Location: signed,
            'Cache-Control': 'no-store',
          }
          return new Response(null, { status: 302, headers })
        }
      } catch (headErr) {
        console.error('[r2-storage] stream preflight', r2ErrInfo(headErr))
      }
    }

    const out = await s3.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: key,
        ...(range ? { Range: range } : {}),
      }),
    )

    const headers: Record<string, string> = { ..._cors }
    headers['Content-Type'] = out.ContentType || guessContentTypeFromKey(key)
    headers['Accept-Ranges'] = 'bytes'
    headers['Cache-Control'] = 'private, max-age=3600'
    headers['Content-Disposition'] = 'inline'
    if (out.ContentLength != null) {
      headers['Content-Length'] = String(out.ContentLength)
    }
    if (out.ContentRange) headers['Content-Range'] = out.ContentRange

    const body = out.Body
    if (!body) return json({ error: 'جسم فارغ' }, 404)

    return new Response(body as ReadableStream, {
      status: range && out.ContentRange ? 206 : 200,
      headers,
    })
  } catch (e: unknown) {
    const info = r2ErrInfo(e)
    console.error('[r2-storage] stream', info.name, info.message, key)
    if (info.name === 'NotFound' || info.name === 'NoSuchKey' || info.name === '404') {
      return json({ error: 'غير موجود', key }, 404)
    }
    return json({
      error: `تعذّر بث الملف (${info.name}): ${info.message}`,
      r2Error: info.name,
      key,
    }, 500)
  }
}

Deno.serve(async (req) => {
  _cors = buildCors(req);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: _cors })
  }

  // فحص إعداد الأسرار بدون مصادقة — لا يحمّل AWS SDK (يُستخدم أيضاً لتسخين الـ isolate)
  if (req.method === 'GET') {
    const u = new URL(req.url)
    if (u.searchParams.get('health') === '1' || u.searchParams.get('warmup') === '1') {
      const accessKeyId = envFirst('R2_ACCESS_KEY_ID', 'AWS_ACCESS_KEY_ID')
      const secretAccessKey = envFirst('R2_SECRET_ACCESS_KEY', 'AWS_SECRET_ACCESS_KEY')
      const accountRaw = envFirst('R2_ACCOUNT_ID', 'CLOUDFLARE_ACCOUNT_ID')
      const bucketRaw = envFirst('R2_BUCKET_NAME', 'R2_BUCKET', 'AWS_S3_BUCKET')
      const accountId = normalizeR2AccountId(accountRaw)
      const bucket = normalizeR2BucketName(bucketRaw)
      const envOk = !!(accessKeyId && secretAccessKey && accountId && bucket)
      return json({
        ok: envOk,
        warm: true,
        hasAccessKeyId: !!accessKeyId,
        hasSecretAccessKey: !!secretAccessKey,
        hasAccountId: !!accountRaw,
        hasBucket: !!bucketRaw,
        accountIdLen: accountId.length,
        accountIdSuffix: accountId ? accountId.slice(-4) : '',
        accountIdLooksValid: /^[a-f0-9]{32}$/i.test(accountId),
        bucket,
        endpoint: accountId ? `https://${accountId}.r2.cloudflarestorage.com` : null,
      })
    }
  }

  const env = requireR2Env()

  if (req.method === 'POST' && req.headers.get('X-R2-Action') === 'uploadPart') {
    if (!env) return json({ error: 'R2 غير مُعدّ (متغيرات البيئة على الدالة)' }, 503)
    const auth = await authenticateRequest(req)
    if ('error' in auth && auth.error) return auth.error

    try {
      const key = assertTempUploadKey(req.headers.get('X-R2-Key') || '', auth.user.id)
      const uploadId = String(req.headers.get('X-R2-Upload-Id') || '').trim()
      const partNumber = parseInt(String(req.headers.get('X-R2-Part-Number') || '0'), 10)
      if (!uploadId || !Number.isFinite(partNumber) || partNumber < 1 || partNumber > 10_000) {
        return json({ error: 'معرّف الرفع أو رقم الجزء غير صالح' }, 400)
      }
      const bytes = new Uint8Array(await req.arrayBuffer())
      if (!bytes.length) return json({ error: 'جسم فارغ' }, 400)
      if (bytes.length > R2_PROXY_PART_MAX_BYTES) {
        return json({ error: 'حجم الجزء كبير جداً للرفع عبر الخادم' }, 413)
      }
      await ensureAws()
      const s3 = makeS3(env)
      const out = await s3.send(
        new UploadPartCommand({
          Bucket: env.bucket,
          Key: key,
          UploadId: uploadId,
          PartNumber: partNumber,
          Body: bytes,
        }),
      )
      return json({ ok: true, etag: out.ETag, partNumber })
    } catch (e) {
      console.error('[r2-storage] uploadPart', e)
      const msg = e instanceof Error ? e.message : 'حدث خطأ أثناء رفع الجزء'
      const status = msg.includes('غير مصرح') ? 403 : 500
      return json({ error: msg }, status)
    }
  }

  if (req.method === 'POST' && req.headers.get('X-R2-Action') === 'replaceObject') {
    if (!env) return json({ error: 'R2 غير مُعدّ (متغيرات البيئة على الدالة)' }, 503)
    const auth = await authenticateRequest(req)
    if ('error' in auth && auth.error) return auth.error

    try {
      const key = assertKey(req.headers.get('X-R2-Key') || '')
      if (!/\.(mp4|mov|m4v|webm|avi|mkv)$/i.test(key)) {
        return json({ error: 'استبدال الملف مسموح لفيديوهات المرفقات فقط' }, 400)
      }
      const { data: canSee, error: permErr } = await auth.supabase.rpc(
        'mirsad_user_can_see_attachment',
        { p_key: key },
      )
      if (permErr) {
        console.error('[r2-storage] replaceObject perm check failed', permErr.message)
        return json({ error: 'تعذّر التحقق من صلاحية الملف' }, 500)
      }
      if (!canSee) {
        return json({ error: 'غير مصرح بالوصول لهذا الملف' }, 403)
      }
      const contentType =
        (req.headers.get('Content-Type') || '').trim() || guessContentTypeFromKey(key)
      const bytes = new Uint8Array(await req.arrayBuffer())
      if (!bytes.length) return json({ error: 'جسم فارغ' }, 400)
      if (bytes.length > R2_PROXY_PUT_MAX_BYTES) {
        return json({ error: 'حجم الملف كبير جداً للرفع عبر الخادم' }, 413)
      }
      await ensureAws()
      const s3 = makeS3(env)
      await s3.send(
        new PutObjectCommand({
          Bucket: env.bucket,
          Key: key,
          Body: bytes,
          ContentType: contentType,
        }),
      )
      return json({ ok: true, key, replaced: true })
    } catch (e) {
      console.error('[r2-storage] replaceObject', e)
      return json({ error: 'حدث خطأ أثناء استبدال الملف' }, 500)
    }
  }

  if (req.method === 'POST' && req.headers.get('X-R2-Action') === 'putAvatarPreset') {
    if (!env) return json({ error: 'R2 غير مُعدّ (متغيرات البيئة على الدالة)' }, 503)
    const auth = await authenticateRequest(req)
    if ('error' in auth && auth.error) return auth.error

    try {
      const isAdmin = await requireMirsadAdmin(auth.supabase)
      if (!isAdmin) return json({ error: 'غير مصرح — مدير النظام فقط' }, 403)
      const key = assertAvatarPresetKey(req.headers.get('X-R2-Key') || '')
      const contentType =
        (req.headers.get('Content-Type') || '').trim() || guessContentTypeFromKey(key)
      const bytes = new Uint8Array(await req.arrayBuffer())
      if (!bytes.length) return json({ error: 'جسم فارغ' }, 400)
      if (bytes.length > AVATAR_PRESET_MAX_BYTES) {
        return json({ error: 'حجم صورة البروفايل كبير جداً (الحد 8 ميغابايت)' }, 413)
      }
      await ensureAws()
      const s3 = makeS3(env)
      await s3.send(
        new PutObjectCommand({
          Bucket: env.bucket,
          Key: key,
          Body: bytes,
          ContentType: contentType,
          CacheControl: 'public, max-age=31536000, immutable',
        }),
      )
      return json({ ok: true, key })
    } catch (e) {
      console.error('[r2-storage] putAvatarPreset', e)
      const msg = e instanceof Error ? e.message : 'حدث خطأ أثناء رفع صورة البروفايل'
      const status = msg.includes('غير مصرح') || msg.includes('غير صالح') ? 403 : 500
      return json({ error: msg }, status)
    }
  }

  if (req.method === 'POST' && req.headers.get('X-R2-Action') === 'putObject') {
    if (!env) return json({ error: 'R2 غير مُعدّ (متغيرات البيئة على الدالة)' }, 503)
    const auth = await authenticateRequest(req)
    if ('error' in auth && auth.error) return auth.error

    try {
      const key = assertTempUploadKey(req.headers.get('X-R2-Key') || '', auth.user.id)
      const contentType =
        (req.headers.get('Content-Type') || '').trim() || guessContentTypeFromKey(key)
      const bytes = new Uint8Array(await req.arrayBuffer())
      if (!bytes.length) return json({ error: 'جسم فارغ' }, 400)
      if (bytes.length > R2_PROXY_PUT_MAX_BYTES) {
        return json({ error: 'حجم الملف كبير جداً للرفع عبر الخادم' }, 413)
      }
      await ensureAws()
      const s3 = makeS3(env)
      // R2 + AWS SDK PutObjectCommand مع Body داخل Deno يفشل أحياناً بصمت/بطء.
      // المسار الأوثق: توقيع URL ثم PUT مباشر بـ fetch.
      const signed = await getSignedUrl(
        s3,
        new PutObjectCommand({
          Bucket: env.bucket,
          Key: key,
          ContentType: contentType,
        }),
        { expiresIn: 3600 },
      )
      const putRes = await fetch(signed, {
        method: 'PUT',
        headers: { 'Content-Type': contentType },
        body: bytes,
      })
      if (!putRes.ok) {
        const errText = (await putRes.text().catch(() => '')).slice(0, 240)
        console.error('[r2-storage] putObject signed PUT', putRes.status, errText)
        return json({
          error: `فشل الرفع إلى R2 (HTTP ${putRes.status}): ${errText || putRes.statusText}`,
          r2Error: `HTTP_${putRes.status}`,
          ...r2PublicDiag(env),
        }, 500)
      }
      return json({ ok: true, key })
    } catch (e) {
      const info = r2ErrInfo(e)
      console.error('[r2-storage] putObject', info.name, info.message, e)
      return json({
        error: `فشل الرفع إلى R2 (${info.name}): ${info.message}`,
        r2Error: info.name,
        ...r2PublicDiag(env),
      }, 500)
    }
  }

  if (req.method === 'GET' || req.method === 'HEAD') {
    if (!env) return json({ error: 'R2 غير مُعدّ (متغيرات البيئة على الدالة)' }, 503)
    try {
      await ensureAws()
      const s3 = makeS3(env)
      const streamResp = await handleStreamRequest(req, s3, env.bucket, env)
      if (streamResp) return streamResp
      return json({ error: 'Method not allowed' }, 405)
    } catch (e) {
      const info = r2ErrInfo(e)
      console.error('[r2-storage] GET/HEAD', info.name, info.message, e)
      return json({
        error: `تعذّر جلب الملف (${info.name}): ${info.message}`,
        r2Error: info.name,
      }, 500)
    }
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  const auth = await authenticateRequest(req)
  if ('error' in auth && auth.error) return auth.error
  const { user, supabase, isServiceRole } = auth
  void user

  let body: {
    action?: string
    key?: string
    contentType?: string
    fromKey?: string
    toKey?: string
    uploadId?: string
    partNumber?: number
    parts?: Array<{ partNumber?: number; etag?: string }>
  }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'جسم الطلب غير صالح' }, 400)
  }

  const action = body.action
  if (!env) {
    return json({ error: 'R2 غير مُعدّ (متغيرات البيئة على الدالة)' }, 503)
  }

  const { bucket } = env

  try {
    if (action === 'ping') {
      // لا تحمّل AWS SDK ولا تستدعِ R2 — يكفي وجود الأسرار لتمرير resolve في العميل.
      const diag = r2PublicDiag(env)
      return json({ ok: true, mode: 'edge', r2: 'ready', ...diag })
    }

    await ensureAws()
    const s3 = makeS3(env)

    if (action === 'signPut') {
      const key = assertTempUploadKey(body.key || '', user.id)
      const contentType =
        typeof body.contentType === 'string' && body.contentType.length
          ? body.contentType
          : 'application/octet-stream'

      const cmd = new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        ContentType: contentType,
      })
      const url = await getSignedUrl(s3, cmd, { expiresIn: 3600 })
      return json({ url, key })
    }

    if (action === 'createMultipart') {
      const key = assertTempUploadKey(body.key || '', user.id)
      const contentType =
        typeof body.contentType === 'string' && body.contentType.length
          ? body.contentType
          : guessContentTypeFromKey(key)
      const out = await s3.send(
        new CreateMultipartUploadCommand({
          Bucket: bucket,
          Key: key,
          ContentType: contentType,
        }),
      )
      if (!out.UploadId) throw new Error('تعذّر بدء الرفع المتعدد الأجزاء')
      return json({ uploadId: out.UploadId, key })
    }

    if (action === 'signUploadPart') {
      const key = assertTempUploadKey(body.key || '', user.id)
      const uploadId = String(body.uploadId || '').trim()
      const partNumber = Number(body.partNumber)
      if (!uploadId) return json({ error: 'uploadId مطلوب' }, 400)
      if (!Number.isFinite(partNumber) || partNumber < 1 || partNumber > 10_000) {
        return json({ error: 'رقم الجزء غير صالح' }, 400)
      }
      const cmd = new UploadPartCommand({
        Bucket: bucket,
        Key: key,
        UploadId: uploadId,
        PartNumber: partNumber,
      })
      const url = await getSignedUrl(s3, cmd, { expiresIn: 3600 })
      return json({ url, key, uploadId, partNumber })
    }

    if (action === 'completeMultipart') {
      const key = assertTempUploadKey(body.key || '', user.id)
      const uploadId = String(body.uploadId || '').trim()
      const parts = Array.isArray(body.parts) ? body.parts : []
      if (!uploadId) return json({ error: 'uploadId مطلوب' }, 400)
      if (!parts.length) return json({ error: 'لا توجد أجزاء مكتملة' }, 400)
      const normalized = parts
        .map((p) => ({
          PartNumber: Number(p.partNumber),
          ETag: String(p.etag || ''),
        }))
        .filter((p) => Number.isFinite(p.PartNumber) && p.PartNumber > 0 && p.ETag)
        .sort((a, b) => a.PartNumber - b.PartNumber)
      if (!normalized.length) return json({ error: 'أجزاء غير صالحة' }, 400)
      await s3.send(
        new CompleteMultipartUploadCommand({
          Bucket: bucket,
          Key: key,
          UploadId: uploadId,
          MultipartUpload: { Parts: normalized },
        }),
      )
      return json({ ok: true, key })
    }

    if (action === 'abortMultipart') {
      const key = assertTempUploadKey(body.key || '', user.id)
      const uploadId = String(body.uploadId || '').trim()
      if (!uploadId) return json({ error: 'uploadId مطلوب' }, 400)
      await s3.send(
        new AbortMultipartUploadCommand({
          Bucket: bucket,
          Key: key,
          UploadId: uploadId,
        }),
      )
      return json({ ok: true, key })
    }

    if (action === 'deleteObject') {
      const key = assertTempUploadKey(body.key || '', user.id)
      try {
        await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
        return json({ ok: true, key })
      } catch (e: unknown) {
        const name =
          e && typeof e === 'object' && 'name' in e
            ? String((e as { name: string }).name)
            : ''
        if (name === 'NotFound' || name === 'NoSuchKey' || name === '404') {
          return json({ ok: true, key, missing: true })
        }
        throw e
      }
    }

    if (action === 'signReplacePut') {
      const key = assertKey(body.key)
      if (!/\.(mp4|mov|m4v|webm|avi|mkv)$/i.test(key)) {
        return json({ error: 'استبدال الملف مسموح لفيديوهات المرفقات فقط' }, 400)
      }
      if (!isServiceRole) {
        const { data: canSee, error: permErr } = await supabase.rpc(
          'mirsad_user_can_see_attachment',
          { p_key: key },
        )
        if (permErr) {
          console.error('[r2-storage] signReplacePut perm check failed', permErr.message)
          return json({ error: 'تعذّر التحقق من صلاحية الملف' }, 500)
        }
        if (!canSee) {
          return json({ error: 'غير مصرح بالوصول لهذا الملف' }, 403)
        }
      }
      const ct =
        typeof body.contentType === 'string' && body.contentType.trim()
          ? body.contentType.trim()
          : guessContentTypeFromKey(key)
      const cmd = new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        ContentType: ct,
      })
      const url = await getSignedUrl(s3, cmd, { expiresIn: 3600 })
      return json({ url, key, contentType: ct })
    }

    if (action === 'signAvatarPresetGet') {
      const key = assertAvatarPresetKey(body.key || '')
      const ct =
        typeof body.contentType === 'string' && body.contentType.trim()
          ? body.contentType.trim()
          : guessContentTypeFromKey(key)
      const cmd = new GetObjectCommand({
        Bucket: bucket,
        Key: key,
        ResponseContentType: ct,
        ResponseContentDisposition: 'inline',
      })
      const url = await getSignedUrl(s3, cmd, { expiresIn: 3600 })
      const streamToken = await makeStreamToken(key, env)
      return json({ url, key, streamToken, contentType: ct })
    }

    if (action === 'deleteAvatarPreset') {
      const isAdmin = await requireMirsadAdmin(supabase)
      if (!isAdmin) return json({ error: 'غير مصرح — مدير النظام فقط' }, 403)
      const key = assertAvatarPresetKey(body.key || '')
      try {
        await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
        return json({ ok: true, key })
      } catch (e: unknown) {
        const name =
          e && typeof e === 'object' && 'name' in e
            ? String((e as { name: string }).name)
            : ''
        if (name === 'NotFound' || name === 'NoSuchKey' || name === '404') {
          return json({ ok: true, key, missing: true })
        }
        throw e
      }
    }

    if (action === 'signGet') {
      const key = assertKey(body.key)
      // [أمان] منع IDOR: لا نوقّع رابطاً/بثّاً إلا لملف يخص مخالفة يستطيع
      // المستخدم رؤيتها (تُفرض عبر RLS داخل الدالة SECURITY INVOKER).
      // استثناء: service_role للصيانة (تحويل HEVC من الخادم).
      if (!isServiceRole) {
        const { data: canSee, error: permErr } = await supabase.rpc(
          'mirsad_user_can_see_attachment',
          { p_key: key },
        )
        if (permErr) {
          console.error('[r2-storage] perm check failed', permErr.message)
          return json({ error: 'تعذّر التحقق من صلاحية الملف' }, 500)
        }
        if (!canSee) {
          return json({ error: 'غير مصرح بالوصول لهذا الملف' }, 403)
        }
      }
      const ct =
        typeof body.contentType === 'string' && body.contentType.trim()
          ? body.contentType.trim()
          : guessContentTypeFromKey(key)
      const cmd = new GetObjectCommand({
        Bucket: bucket,
        Key: key,
        ResponseContentType: ct,
        ResponseContentDisposition: 'inline',
      })
      const url = await getSignedUrl(s3, cmd, { expiresIn: 3600 })
      const streamToken = await makeStreamToken(key, env)
      return json({ url, key, streamToken, contentType: ct })
    }

    if (action === 'headObject') {
      const key = assertKey(body.key)
      if (!isServiceRole) {
        const { data: canSee, error: permErr } = await supabase.rpc(
          'mirsad_user_can_see_attachment',
          { p_key: key },
        )
        if (permErr) {
          console.error('[r2-storage] headObject perm check failed', permErr.message)
          return json({ error: 'تعذّر التحقق من صلاحية الملف' }, 500)
        }
        if (!canSee) {
          return json({ error: 'غير مصرح بالوصول لهذا الملف' }, 403)
        }
      }
      try {
        const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
        return json({
          ok: true,
          key,
          contentLength: head.ContentLength ?? null,
          contentType: head.ContentType || guessContentTypeFromKey(key),
        })
      } catch (e: unknown) {
        const name =
          e && typeof e === 'object' && 'name' in e
            ? String((e as { name: string }).name)
            : ''
        if (name === 'NotFound' || name === 'NoSuchKey' || name === '404') {
          return json({ ok: false, key })
        }
        throw e
      }
    }

    if (action === 'moveObject') {
      const fromKey = assertKey(body.fromKey)
      const toKey = assertKey(body.toKey)
      // [أمان] التأكد أن الملف المؤقت يخص المستخدم الحالي
      if (!fromKey.startsWith(`temp_${user.id}`)) {
        return json({ error: 'غير مصرح بنقل هذا الملف' }, 403)
      }
      if (!fromKey.startsWith('temp_')) {
        return json({ error: 'نقل الملفات مسموح من المجلد المؤقت فقط' }, 400)
      }
      const copySource = encodeURI(`${bucket}/${fromKey}`)
      await s3.send(
        new CopyObjectCommand({
          Bucket: bucket,
          Key: toKey,
          CopySource: copySource,
        }),
      )
      await s3.send(
        new DeleteObjectCommand({
          Bucket: bucket,
          Key: fromKey,
        }),
      )
      return json({ ok: true, fromKey, toKey })
    }

    return json({ error: 'عملية غير معروفة' }, 400)
  } catch (e) {
    const info = r2ErrInfo(e)
    console.error('[r2-storage]', info.name, info.message, e)
    return json({
      error: `حدث خطأ أثناء المعالجة (${info.name}): ${info.message}`,
      bucket,
      r2Error: info.name,
    }, 500)
  }
})
