/**
 * مرصاد — تخزين المرفقات على Cloudflare R2 عبر توقيع S3 من جهة الخادم.
 * المفاتيح في متغيرات بيئة Supabase فقط (لا تُرسل للمتصفح).
 *
 * Secrets (Dashboard → Edge Functions → r2-storage → Secrets):
 *   R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ACCOUNT_ID, R2_BUCKET_NAME
 *   (بدائل مقبولة: AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY، CLOUDFLARE_ACCOUNT_ID، R2_BUCKET / AWS_S3_BUCKET)
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import {
  assertAttachmentPayload,
  assertAttachmentSignature,
  assertAttachmentSize,
  assertKey,
  assertTempUploadKey,
  normalizedAttachmentContentType,
  R2_ATTACHMENT_MAX_BYTES,
  R2_MULTIPART_MAX_PARTS,
  R2_MULTIPART_PART_MAX_BYTES,
} from './security.js'

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
let ListObjectsV2Command: any
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
      ListObjectsV2Command = s3mod.ListObjectsV2Command
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
    raw.split(',').map((s) => s.trim()).filter(Boolean).concat([
      'https://athar-app.online',
      'https://athar.app',
    ]),
  );
  const requestOrigin = req.headers.get('Origin') || '';
  const isAllowed = allowed.has(requestOrigin);
  return {
    'Access-Control-Allow-Origin': isAllowed ? requestOrigin : '',
    'Access-Control-Allow-Headers':
      'authorization, x-client-info, apikey, content-type, range, x-r2-action, x-r2-key, x-r2-upload-id, x-r2-part-number, x-r2-content-type, x-r2-from-key, x-r2-record-type, x-r2-record-id, x-r2-operation, x-r2-expected-state',
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

const AVATAR_PRESET_MAX_BYTES = 8 * 1024 * 1024

// لا يوجد Database type مولّد في هذا المستودع؛ هذه الدالة لا تعتمد من العميل
// إلا على RPC. إبقاء الحدّ هنا ضيقاً مهم أيضاً للاختبارات: لا ينبغي أن يضطر
// mock آمن إلى تقليد عميل Supabase كامل.
type RpcResult = { data: unknown; error: { message?: string } | null }
type RpcClient = {
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<RpcResult>
}

type AuthenticatedRequest =
  | { error: Response; user?: never; supabase?: never; isServiceRole?: never }
  | { user: { id: string }; supabase: RpcClient; isServiceRole: boolean; error?: never }

type AuthenticateRequest = (req: Request) => Promise<AuthenticatedRequest>

function assertAvatarPresetKey(key: string): string {
  const k = assertKey(key)
  if (!/^avatars\/presets\/[a-zA-Z0-9_-]+\.(webp|png|jpe?g)$/i.test(k)) {
    throw new Error('مسار صورة البروفايل غير صالح')
  }
  return k
}

async function requireAtharAdmin(
  supabase: RpcClient,
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

async function authenticateRequest(req: Request): Promise<AuthenticatedRequest> {
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
    m4v: 'video/mp4',
    mov: 'video/quicktime',
    webm: 'video/webm',
    avi: 'video/x-msvideo',
    mkv: 'video/x-matroska',
    '3gp': 'video/3gpp',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    pdf: 'application/pdf',
  }
  return map[ext] || 'application/octet-stream'
}

async function requireAttachmentRead(
  supabase: RpcClient,
  key: string,
): Promise<void> {
  const { data, error } = await supabase.rpc('athar_attachment_can_read', { p_key: key })
  if (error) {
    console.error('[r2-storage] attachment read check failed', error.message)
    throw new Error('تعذّر التحقق من صلاحية قراءة الملف')
  }
  if (!data) throw new Error('غير مصرح بقراءة هذا الملف')
}

async function requireAttachmentModify(
  supabase: RpcClient,
  key: string,
): Promise<void> {
  const { data, error } = await supabase.rpc('athar_attachment_can_modify', { p_key: key })
  if (error) {
    console.error('[r2-storage] attachment modify check failed', error.message)
    throw new Error('تعذّر التحقق من صلاحية تعديل الملف')
  }
  if (!data) throw new Error('غير مصرح بتعديل هذا الملف')
}

async function requireAttachmentMoveDestination(
  supabase: RpcClient,
  input: {
    recordType: string
    recordId: string
    fromKey: string
    toKey: string
    operation: string
    expectedState?: string
  },
): Promise<void> {
  const { data, error } = await supabase.rpc('athar_attachment_destination_can_modify', {
    p_record_type: input.recordType,
    p_record_id: input.recordId,
    p_from_key: input.fromKey,
    p_to_key: input.toKey,
    p_operation: input.operation,
    p_expected_state: input.expectedState || null,
  })
  if (error) {
    console.error('[r2-storage] attachment move check failed', error.message)
    throw new Error('تعذّر التحقق من وجهة نقل المرفق')
  }
  if (!data) throw new Error('غير مصرح بنقل المرفق إلى هذا السجل')
}

/**
 * Buffer an AWS SDK GetObject Body before PutObject.
 * Piping the live Node/Deno HTTP stream into PutObject fails in the Edge
 * runtime with `TypeError: unexpected end of file` (seen as r2-storage 503
 * right after athar_attachment_destination_can_modify succeeds).
 */
async function readAwsSdkBodyBytes(body: unknown): Promise<Uint8Array> {
  if (body == null) throw new Error('جسم الملف المؤقت فارغ')
  if (body instanceof Uint8Array) return body
  if (ArrayBuffer.isView(body)) {
    const view = body as ArrayBufferView
    return new Uint8Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength))
  }
  if (body instanceof ArrayBuffer) return new Uint8Array(body)
  if (typeof body === 'object') {
    const candidate = body as {
      transformToByteArray?: () => Promise<Uint8Array>
      transformToWebStream?: () => ReadableStream<Uint8Array>
      arrayBuffer?: () => Promise<ArrayBuffer>
    }
    if (typeof candidate.transformToByteArray === 'function') {
      return await candidate.transformToByteArray()
    }
    if (typeof candidate.arrayBuffer === 'function') {
      return new Uint8Array(await candidate.arrayBuffer())
    }
    if (typeof candidate.transformToWebStream === 'function') {
      return new Uint8Array(await new Response(candidate.transformToWebStream()).arrayBuffer())
    }
  }
  if (typeof Response !== 'undefined') {
    try {
      return new Uint8Array(await new Response(body as BodyInit).arrayBuffer())
    } catch {
      // fall through
    }
  }
  throw new Error('تعذّر قراءة جسم الملف المؤقت')
}

async function requireAttachmentMoveRollback(
  supabase: RpcClient,
  input: {
    recordType: string
    recordId: string
    fromKey: string
    toKey: string
    operation: string
    expectedState?: string
  },
): Promise<void> {
  const { data, error } = await supabase.rpc('athar_attachment_move_rollback_allowed', {
    p_record_type: input.recordType,
    p_record_id: input.recordId,
    p_from_key: input.fromKey,
    p_to_key: input.toKey,
    p_operation: input.operation,
    p_expected_state: input.expectedState || null,
  })
  if (error) {
    console.error('[r2-storage] attachment rollback check failed', error.message)
    throw new Error('تعذّر التحقق من تراجع نقل المرفق')
  }
  if (!data) throw new Error('غير مصرح بالتراجع عن نقل هذا المرفق')
}

function requestErrorStatus(error: unknown): number {
  const msg = error instanceof Error ? error.message : String(error || '')
  if (/ميغابايت|حجم.*(كبير|يتجاوز)/.test(msg)) return 413
  if (/PreconditionFailed|ConditionalRequestConflict|412|يوجد ملف/.test(msg)) return 409
  if (/غير مصرح/.test(msg)) return 403
  if (/غير صالح|غير مسموح|لا يطابق|مطلوب|فارغ/.test(msg)) return 400
  // Copy/verify failures are operational — keep the Arabic detail for the client
  // putFinal fallback instead of masking as a generic 500.
  if (/فشل نسخ المرفق|فشل التحقق من نسخة/.test(msg)) return 422
  return 500
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

  try {
    // HEAD: بيانات وصفية فقط (بدون جسم الملف)
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

    const range = req.headers.get('Range') || undefined

    // GET بدون Range: 302 إلى R2 — الفيديو الكبير لا يمر عبر Supabase
    if (!range) {
      const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
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

    // GET مع Range: بروكسي جزء صغير عبر Edge (للمشغّل/التحويل داخل المنصة فقط)
    const out = await s3.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: key,
        Range: range,
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
      status: out.ContentRange ? 206 : 200,
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

/** حقن محدود للاختبارات فقط؛ التنفيذ المنشور يستعمل الاعتمادات الافتراضية أدناه. */
export function installR2StorageTestAwsPrimitives(primitives: Record<string, unknown>): void {
  if ('AbortMultipartUploadCommand' in primitives) AbortMultipartUploadCommand = primitives.AbortMultipartUploadCommand
  if ('CompleteMultipartUploadCommand' in primitives) CompleteMultipartUploadCommand = primitives.CompleteMultipartUploadCommand
  if ('CopyObjectCommand' in primitives) CopyObjectCommand = primitives.CopyObjectCommand
  if ('CreateMultipartUploadCommand' in primitives) CreateMultipartUploadCommand = primitives.CreateMultipartUploadCommand
  if ('DeleteObjectCommand' in primitives) DeleteObjectCommand = primitives.DeleteObjectCommand
  if ('GetObjectCommand' in primitives) GetObjectCommand = primitives.GetObjectCommand
  if ('HeadObjectCommand' in primitives) HeadObjectCommand = primitives.HeadObjectCommand
  if ('ListObjectsV2Command' in primitives) ListObjectsV2Command = primitives.ListObjectsV2Command
  if ('PutObjectCommand' in primitives) PutObjectCommand = primitives.PutObjectCommand
  if ('UploadPartCommand' in primitives) UploadPartCommand = primitives.UploadPartCommand
}

export function createR2StorageHandler(deps: {
  requireR2Env?: typeof requireR2Env
  authenticateRequest?: AuthenticateRequest
  ensureAws?: typeof ensureAws
  makeS3?: typeof makeS3
} = {}) {
  const getR2Env = deps.requireR2Env || requireR2Env
  const authenticate = deps.authenticateRequest || authenticateRequest
  const loadAws = deps.ensureAws || ensureAws
  const newS3 = deps.makeS3 || makeS3

  return async (req: Request) => {
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

  const env = getR2Env()

  if (req.method === 'POST' && req.headers.get('X-R2-Action') === 'uploadPart') {
    if (!env) return json({ error: 'R2 غير مُعدّ (متغيرات البيئة على الدالة)' }, 503)
    const auth = await authenticate(req)
    if ('error' in auth && auth.error) return auth.error

    try {
      const key = assertTempUploadKey(req.headers.get('X-R2-Key') || '', auth.user.id)
      const contentType = normalizedAttachmentContentType(
        key,
        req.headers.get('X-R2-Content-Type') || '',
      )
      const uploadId = String(req.headers.get('X-R2-Upload-Id') || '').trim()
      const partNumber = parseInt(String(req.headers.get('X-R2-Part-Number') || '0'), 10)
      if (!uploadId || !Number.isFinite(partNumber) || partNumber < 1 || partNumber > R2_MULTIPART_MAX_PARTS) {
        return json({ error: 'معرّف الرفع أو رقم الجزء غير صالح' }, 400)
      }
      const bytes = new Uint8Array(await req.arrayBuffer())
      if (!bytes.length) return json({ error: 'جسم فارغ' }, 400)
      if (bytes.length > R2_MULTIPART_PART_MAX_BYTES) {
        return json({ error: 'حجم الجزء كبير جداً للرفع عبر الخادم' }, 413)
      }
      if (partNumber === 1) assertAttachmentSignature(key, bytes)
      await loadAws()
      const s3 = newS3(env)
      const out = await s3.send(
        new UploadPartCommand({
          Bucket: env.bucket,
          Key: key,
          UploadId: uploadId,
          PartNumber: partNumber,
          Body: bytes,
        }),
      )
      return json({ ok: true, etag: out.ETag, partNumber, contentType })
    } catch (e) {
      console.error('[r2-storage] uploadPart', e)
      const msg = e instanceof Error ? e.message : 'حدث خطأ أثناء رفع الجزء'
      const status = requestErrorStatus(e)
      return json({ error: msg }, status)
    }
  }

  if (req.method === 'POST' && req.headers.get('X-R2-Action') === 'replaceObject') {
    if (!env) return json({ error: 'R2 غير مُعدّ (متغيرات البيئة على الدالة)' }, 503)
    const auth = await authenticate(req)
    if ('error' in auth && auth.error) return auth.error

    try {
      const key = assertKey(req.headers.get('X-R2-Key') || '')
      if (!/\.(mp4|mov|m4v|webm|avi|mkv)$/i.test(key)) {
        return json({ error: 'استبدال الملف مسموح لفيديوهات المرفقات فقط' }, 400)
      }
      if (!auth.isServiceRole) await requireAttachmentModify(auth.supabase, key)
      const contentType = normalizedAttachmentContentType(key, req.headers.get('Content-Type') || '')
      const bytes = new Uint8Array(await req.arrayBuffer())
      assertAttachmentPayload(key, contentType, bytes)
      await loadAws()
      const s3 = newS3(env)
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
      const msg = e instanceof Error ? e.message : 'حدث خطأ أثناء استبدال الملف'
      return json({ error: msg }, requestErrorStatus(e))
    }
  }

  if (req.method === 'POST' && req.headers.get('X-R2-Action') === 'putAvatarPreset') {
    if (!env) return json({ error: 'R2 غير مُعدّ (متغيرات البيئة على الدالة)' }, 503)
    const auth = await authenticate(req)
    if ('error' in auth && auth.error) return auth.error

    try {
      const isAdmin = await requireAtharAdmin(auth.supabase)
      if (!isAdmin) return json({ error: 'غير مصرح — مدير النظام فقط' }, 403)
      const key = assertAvatarPresetKey(req.headers.get('X-R2-Key') || '')
      const contentType =
        (req.headers.get('Content-Type') || '').trim() || guessContentTypeFromKey(key)
      const bytes = new Uint8Array(await req.arrayBuffer())
      if (!bytes.length) return json({ error: 'جسم فارغ' }, 400)
      if (bytes.length > AVATAR_PRESET_MAX_BYTES) {
        return json({ error: 'حجم صورة البروفايل كبير جداً (الحد 8 ميغابايت)' }, 413)
      }
      await loadAws()
      const s3 = newS3(env)
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
    const auth = await authenticate(req)
    if ('error' in auth && auth.error) return auth.error

    try {
      const key = assertTempUploadKey(req.headers.get('X-R2-Key') || '', auth.user.id)
      const contentType = normalizedAttachmentContentType(key, req.headers.get('Content-Type') || '')
      const bytes = new Uint8Array(await req.arrayBuffer())
      assertAttachmentPayload(key, contentType, bytes)
      await loadAws()
      const s3 = newS3(env)
      await s3.send(new PutObjectCommand({
        Bucket: env.bucket,
        Key: key,
        Body: bytes,
        ContentType: contentType,
        // R2 يدعم شرط S3 هذا؛ يمنع طلباً ثانياً من الكتابة فوق temp قائم.
        IfNoneMatch: '*',
      }))
      return json({ ok: true, key, contentType })
    } catch (e) {
      const info = r2ErrInfo(e)
      console.error('[r2-storage] putObject', info.name, info.message, e)
      return json({
        error: info.message,
        r2Error: info.name,
      }, requestErrorStatus(e))
    }
  }

  // Client-held body → canonical key when server-side CopyObject is unavailable.
  // Avoids Edge GetObject (isolate crash) while still enforcing move ACL.
  if (req.method === 'POST' && req.headers.get('X-R2-Action') === 'putFinalObject') {
    if (!env) return json({ error: 'R2 غير مُعدّ (متغيرات البيئة على الدالة)' }, 503)
    const auth = await authenticate(req)
    if ('error' in auth && auth.error) return auth.error

    try {
      let fromKey: string
      try {
        fromKey = assertTempUploadKey(req.headers.get('X-R2-From-Key') || '', auth.user.id)
      } catch {
        fromKey = assertKey(req.headers.get('X-R2-From-Key') || '')
        if (!fromKey.startsWith('temp_')) throw new Error('غير مصرح بالرفع في هذا المسار')
      }
      const toKey = assertKey(req.headers.get('X-R2-Key') || '')
      if (!auth.isServiceRole) {
        await requireAttachmentMoveDestination(auth.supabase, {
          recordType: String(req.headers.get('X-R2-Record-Type') || ''),
          recordId: String(req.headers.get('X-R2-Record-Id') || ''),
          fromKey,
          toKey,
          operation: String(req.headers.get('X-R2-Operation') || 'create'),
          expectedState: req.headers.get('X-R2-Expected-State') || undefined,
        })
      }
      const contentType = normalizedAttachmentContentType(
        toKey,
        req.headers.get('Content-Type') || req.headers.get('X-R2-Content-Type') || '',
      )
      const bytes = new Uint8Array(await req.arrayBuffer())
      assertAttachmentPayload(toKey, contentType, bytes)
      // Leaf name must match temp → final rename contract used by moveObject.
      const leafOf = (key: string) => key.replace(/^.*\//, '')
      if (leafOf(fromKey) !== leafOf(toKey)) {
        throw new Error('اسم ملف الوجهة لا يطابق المرفق المؤقت')
      }
      await loadAws()
      const s3 = newS3(env)
      try {
        await s3.send(new HeadObjectCommand({ Bucket: env.bucket, Key: toKey }))
        return json({ error: 'يوجد ملف بالفعل في وجهة النقل' }, 409)
      } catch (e: unknown) {
        const name = e && typeof e === 'object' && 'name' in e ? String((e as { name: string }).name) : ''
        if (name && !['NotFound', 'NoSuchKey', '404'].includes(name)) throw e
      }
      await s3.send(new PutObjectCommand({
        Bucket: env.bucket,
        Key: toKey,
        Body: bytes,
        ContentType: contentType,
        ContentLength: bytes.byteLength,
        IfNoneMatch: '*',
      }))
      return json({
        ok: true,
        copied: true,
        sourceRetained: true,
        fromKey,
        toKey,
        bytes: bytes.byteLength,
        via: 'putFinal',
        verified: true,
      })
    } catch (e) {
      const info = r2ErrInfo(e)
      console.error('[r2-storage] putFinalObject', info.name, info.message, e)
      return json({
        error: info.message,
        r2Error: info.name,
      }, requestErrorStatus(e))
    }
  }

  if (req.method === 'GET' || req.method === 'HEAD') {
    if (!env) return json({ error: 'R2 غير مُعدّ (متغيرات البيئة على الدالة)' }, 503)
    try {
      await loadAws()
      const s3 = newS3(env)
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

  const auth = await authenticate(req)
  if ('error' in auth && auth.error) return auth.error
  const { user, supabase, isServiceRole } = auth
  void user

  let body: {
    action?: string
    key?: string
    contentType?: string
    prefix?: string
    fromKey?: string
    toKey?: string
    recordType?: string
    recordId?: string
    operation?: string
    expectedState?: string
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

    await loadAws()
    const s3 = newS3(env)

    if (action === 'signPut' || action === 'signUploadPart') {
      // لا يتيح S3 presigned PUT فرض الحجم أو منع overwrite على نحو موثوق.
      return json({ error: 'الرفع المباشر معطّل؛ استخدم مسار الرفع عبر الخادم' }, 410)
    }

    if (action === 'createMultipart') {
      const key = assertTempUploadKey(body.key || '', user.id)
      const contentType = normalizedAttachmentContentType(key, body.contentType || '')
      try {
        await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
        return json({ error: 'يوجد ملف بالمفتاح المؤقت نفسه' }, 409)
      } catch (e: unknown) {
        const name = e && typeof e === 'object' && 'name' in e ? String((e as { name: string }).name) : ''
        if (name && !['NotFound', 'NoSuchKey', '404'].includes(name)) throw e
      }
      const out = await s3.send(
        new CreateMultipartUploadCommand({
          Bucket: bucket,
          Key: key,
          ContentType: contentType,
        }),
      )
      if (!out.UploadId) throw new Error('تعذّر بدء الرفع المتعدد الأجزاء')
      return json({ uploadId: out.UploadId, key, contentType })
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
        .filter((p) => Number.isFinite(p.PartNumber) && p.PartNumber > 0 && p.PartNumber <= R2_MULTIPART_MAX_PARTS && p.ETag)
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
      const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
      assertAttachmentSize(Number(head.ContentLength || 0))
      normalizedAttachmentContentType(key, head.ContentType || '')
      return json({ ok: true, key, contentType: head.ContentType })
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
      return json({ error: 'استبدال المرفق عبر رابط مباشر معطّل؛ استخدم replaceObject' }, 410)
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
      const isAdmin = await requireAtharAdmin(supabase)
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

    if (action === 'adminListPrefix') {
      if (!isServiceRole) {
        return json({ error: 'غير مصرح' }, 403)
      }
      const prefix = String(body.prefix || '').trim()
      if (!prefix || prefix.includes('..')) {
        return json({ error: 'prefix غير صالح' }, 400)
      }
      const out = await s3.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: prefix,
          MaxKeys: 100,
        }),
      )
      const items = (out.Contents || []).map((o: { Key?: string; Size?: number; LastModified?: Date; ETag?: string }) => ({
        key: o.Key,
        size: o.Size ?? 0,
        lastModified: o.LastModified ? new Date(o.LastModified).toISOString() : null,
        etag: o.ETag || null,
      }))
      return json({ ok: true, prefix, items })
    }

    if (action === 'signGet') {
      const key = assertKey(body.key)
      if (!isServiceRole) await requireAttachmentRead(supabase, key)
      const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
      const ct = head.ContentType || guessContentTypeFromKey(key)
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
      if (!isServiceRole) await requireAttachmentRead(supabase, key)
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

    // فحص مفتاح temp مملوك فقط — يستخدم بعد فشل استجابة putObject/multipart
    // عندما يكون الملف قد كُتب فعلياً لكن العميل رأى Load failed.
    if (action === 'headTempObject') {
      const key = assertTempUploadKey(body.key || '', user.id)
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

    if (action === 'proxyGet') {
      const key = assertKey(body.key)
      if (!isServiceRole) await requireAttachmentRead(supabase, key)
      try {
        const out = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
        const ct = out.ContentType || guessContentTypeFromKey(key)
        const headers: Record<string, string> = {
          ..._cors,
          'Content-Type': ct,
          'Cache-Control': 'private, max-age=3600',
          'Content-Disposition': 'inline',
        }
        if (out.ContentLength != null) headers['Content-Length'] = String(out.ContentLength)
        if (!out.Body) return json({ error: 'جسم فارغ' }, 404)
        return new Response(out.Body as ReadableStream, { status: 200, headers })
      } catch (e: unknown) {
        const name =
          e && typeof e === 'object' && 'name' in e
            ? String((e as { name: string }).name)
            : ''
        if (name === 'NotFound' || name === 'NoSuchKey' || name === '404') {
          return json({ error: 'غير موجود', key }, 404)
        }
        throw e
      }
    }

    if (action === 'rollbackMove') {
      // Privileged repair may roll back a foreign temp_* copy; ACL is enforced below.
      let fromKey: string
      try {
        fromKey = assertTempUploadKey(body.fromKey || '', user.id)
      } catch {
        fromKey = assertKey(body.fromKey || '')
        if (!fromKey.startsWith('temp_')) throw new Error('غير مصرح بالرفع في هذا المسار')
      }
      const toKey = assertKey(body.toKey)
      if (!isServiceRole) {
        await requireAttachmentMoveRollback(supabase, {
          recordType: String(body.recordType || ''),
          recordId: String(body.recordId || ''),
          fromKey,
          toKey,
          operation: String(body.operation || ''),
          expectedState: body.expectedState,
        })
      }
      try {
        await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: toKey }))
        return json({ ok: true, rolledBack: true, fromKey, toKey })
      } catch (e: unknown) {
        const name = e && typeof e === 'object' && 'name' in e ? String((e as { name: string }).name) : ''
        if (name === 'NotFound' || name === 'NoSuchKey' || name === '404') {
          return json({ ok: true, rolledBack: true, missing: true, fromKey, toKey })
        }
        throw e
      }
    }

    if (action === 'moveObject') {
      // Owner path uses assertTempUploadKey. Privileged repair may move a foreign
      // temp_* object when athar_attachment_destination_can_modify allows it.
      let fromKey: string
      try {
        fromKey = assertTempUploadKey(body.fromKey || '', user.id)
      } catch {
        fromKey = assertKey(body.fromKey || '')
        if (!fromKey.startsWith('temp_')) throw new Error('غير مصرح بالرفع في هذا المسار')
      }
      const toKey = assertKey(body.toKey)
      if (!isServiceRole) {
        await requireAttachmentMoveDestination(supabase, {
          recordType: String(body.recordType || ''),
          recordId: String(body.recordId || ''),
          fromKey,
          toKey,
          operation: String(body.operation || ''),
          expectedState: body.expectedState,
        })
      }
      try {
        await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: toKey }))
        return json({ error: 'يوجد ملف بالفعل في وجهة النقل' }, 409)
      } catch (e: unknown) {
        const name = e && typeof e === 'object' && 'name' in e ? String((e as { name: string }).name) : ''
        if (name && !['NotFound', 'NoSuchKey', '404'].includes(name)) throw e
      }
      const sourceHead = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: fromKey }))
      const sourceLen = Number(sourceHead.ContentLength || 0)
      assertAttachmentSize(sourceLen)
      const sourceContentType = normalizedAttachmentContentType(fromKey, sourceHead.ContentType || '')
      normalizedAttachmentContentType(toKey, sourceContentType)
      // CopyObject only — never GetObject→Put on Edge.
      // Production Deno/Node compat crashes the isolate with
      // `TypeError: unexpected end of file` when GetObject bodies are read,
      // which surfaces as HTTP 503 / «انقطع الاتصال أثناء التخزين» and leaves
      // temp_* refs stuck on complaints + violations after #395/#398.
      const copySource = `${bucket}/${fromKey.split('/').map(encodeURIComponent).join('/')}`
      const removeBadDestination = async () => {
        try {
          await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: toKey }))
        } catch {
          /* best-effort */
        }
      }
      const runCopy = async (directive: 'REPLACE' | 'COPY') => {
        await s3.send(new CopyObjectCommand({
          Bucket: bucket,
          Key: toKey,
          CopySource: copySource,
          ...(directive === 'REPLACE'
            ? { MetadataDirective: 'REPLACE', ContentType: sourceContentType }
            : { MetadataDirective: 'COPY' }),
        }))
      }
      const isCopyConflict = (err: unknown) => {
        const copyMsg = err instanceof Error ? err.message : String(err || '')
        const copyName = err && typeof err === 'object' && 'name' in err
          ? String((err as { name: string }).name)
          : ''
        return /PreconditionFailed|ConditionalRequestConflict|412|يوجد ملف/.test(`${copyName} ${copyMsg}`)
      }
      // REPLACE+ContentType first (stable MIME on R2). Fall back to COPY once.
      try {
        await runCopy('REPLACE')
      } catch (copyErr: unknown) {
        if (isCopyConflict(copyErr)) throw copyErr
        await removeBadDestination()
        try {
          await runCopy('COPY')
        } catch (copyErr2: unknown) {
          if (isCopyConflict(copyErr2)) throw copyErr2
          const detail = copyErr2 instanceof Error ? copyErr2.message : String(copyErr2 || copyErr || '')
          throw new Error(
            detail
              ? `فشل نسخ المرفق على التخزين: ${detail}`
              : 'فشل نسخ المرفق على التخزين',
          )
        }
      }
      // Verify destination before the client finalizes DB + deletes temp.
      // A "successful" Copy that leaves a missing/empty object caused
      // «فشل تحميل … عبر الوسيط» after issue (DB final path, temp gone).
      // On verify failure: delete bad dest and retry Copy once — still no GetObject.
      const headDestinationOrThrow = async () => {
        try {
          return await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: toKey }))
        } catch (verifyErr: unknown) {
          const name = verifyErr && typeof verifyErr === 'object' && 'name' in verifyErr
            ? String((verifyErr as { name: string }).name)
            : ''
          throw new Error(
            name === 'NotFound' || name === 'NoSuchKey' || name === '404'
              ? 'فشل التحقق من نسخة المرفق بعد النقل'
              : (verifyErr instanceof Error ? verifyErr.message : 'فشل التحقق من نسخة المرفق بعد النقل'),
          )
        }
      }
      let destHead = await headDestinationOrThrow().catch(async (verifyErr) => {
        await removeBadDestination()
        await runCopy('REPLACE').catch(async () => {
          await removeBadDestination()
          await runCopy('COPY')
        })
        return headDestinationOrThrow().catch(() => {
          throw verifyErr instanceof Error ? verifyErr : new Error('فشل التحقق من نسخة المرفق بعد النقل')
        })
      })
      let destLen = Number(destHead.ContentLength || 0)
      if (destLen < 1 || destLen !== sourceLen) {
        await removeBadDestination()
        try {
          await runCopy('REPLACE')
        } catch {
          await runCopy('COPY')
        }
        destHead = await headDestinationOrThrow()
        destLen = Number(destHead.ContentLength || 0)
        if (destLen < 1 || destLen !== sourceLen) {
          await removeBadDestination()
          throw new Error('فشل التحقق من نسخة المرفق بعد النقل')
        }
      }
      // لا نحذف المصدر الآن: يجب أن ينجح RPC الذي يثبت المرجع في قاعدة
      // البيانات أولاً. عند فشله يمكن للعميل حذف النسخة النهائية بأمان
      // والإبقاء على temp لإعادة المحاولة، بلا orphan أو 404 مرجعي.
      return json({
        ok: true,
        copied: true,
        sourceRetained: true,
        fromKey,
        toKey,
        bytes: sourceLen,
        via: 'copy',
        verified: true,
      })
    }

    return json({ error: 'عملية غير معروفة' }, 400)
  } catch (e) {
    const info = r2ErrInfo(e)
    console.error('[r2-storage]', info.name, info.message, e)
    const status = requestErrorStatus(e)
    return json({
      error: status >= 500 ? 'حدث خطأ أثناء معالجة التخزين' : info.message,
    }, status)
  }
  }
}

if (import.meta.main) {
  Deno.serve(createR2StorageHandler())
}
