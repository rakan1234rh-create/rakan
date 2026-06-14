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
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from 'npm:@aws-sdk/client-s3@3.733.0'
import { getSignedUrl } from 'npm:@aws-sdk/s3-request-presigner@3.733.0'

const cors: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, range',
  'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
  'Access-Control-Expose-Headers':
    'Content-Length, Content-Range, Accept-Ranges, Content-Type',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

function assertKey(key: unknown): string {
  if (typeof key !== 'string' || !key.length) throw new Error('key مطلوب')
  if (key.length > 2048) throw new Error('key طويل جداً')
  if (key.includes('..')) throw new Error('مسار غير صالح')
  return key
}

/** أول قيمة غير فارغة بعد trim (يدعم أسماء بديلة شائعة من Cloudflare / AWS) */
function envFirst(...keys: string[]) {
  for (const k of keys) {
    const v = Deno.env.get(k)
    if (v != null && String(v).trim().length) return String(v).trim()
  }
  return ''
}

function requireR2Env() {
  const accessKeyId = envFirst('R2_ACCESS_KEY_ID', 'AWS_ACCESS_KEY_ID')
  const secretAccessKey = envFirst('R2_SECRET_ACCESS_KEY', 'AWS_SECRET_ACCESS_KEY')
  const accountId = envFirst('R2_ACCOUNT_ID', 'CLOUDFLARE_ACCOUNT_ID')
  const bucket = envFirst('R2_BUCKET_NAME', 'R2_BUCKET', 'AWS_S3_BUCKET')
  if (!accessKeyId || !secretAccessKey || !accountId || !bucket) return null
  return { accessKeyId, secretAccessKey, accountId, bucket }
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
  // نفس السرّ عند التوقيع والتحقق — مرتبط بأسرار R2 الثابتة
  return `${env.secretAccessKey}:${env.accessKeyId}:${env.bucket}`
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
  s3: S3Client,
  bucket: string,
  env: NonNullable<ReturnType<typeof requireR2Env>>,
): Promise<Response | null> {
  const u = new URL(req.url)
  const token = u.searchParams.get('stream')
  if (!token) return null

  const key = await verifyStreamToken(token, env)
  if (!key) return json({ error: 'رمز بث غير صالح أو منتهٍ' }, 401)

  const range = req.headers.get('Range') || undefined

  try {
    if (req.method === 'HEAD') {
      const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
      const headers: Record<string, string> = { ...cors }
      headers['Content-Type'] = head.ContentType || 'application/octet-stream'
      headers['Accept-Ranges'] = 'bytes'
      if (head.ContentLength != null) {
        headers['Content-Length'] = String(head.ContentLength)
      }
      return new Response(null, { status: 200, headers })
    }

    const out = await s3.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: key,
        ...(range ? { Range: range } : {}),
      }),
    )

    const headers: Record<string, string> = { ...cors }
    headers['Content-Type'] = out.ContentType || 'application/octet-stream'
    headers['Accept-Ranges'] = 'bytes'
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
    const name =
      e && typeof e === 'object' && 'name' in e
        ? String((e as { name: string }).name)
        : ''
    if (name === 'NotFound' || name === 'NoSuchKey' || name === '404') {
      return json({ error: 'غير موجود' }, 404)
    }
    throw e
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors })
  }

  const env = requireR2Env()

  if (req.method === 'GET' || req.method === 'HEAD') {
    if (!env) return json({ error: 'R2 غير مُعدّ (متغيرات البيئة على الدالة)' }, 503)
    const s3 = makeS3(env)
    const streamResp = await handleStreamRequest(req, s3, env.bucket, env)
    if (streamResp) return streamResp
    return json({ error: 'Method not allowed' }, 405)
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return json({ error: 'لا يوجد رمز مصادقة' }, 401)
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  })

  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser()
  if (authErr || !user) {
    return json({ error: 'جلسة غير صالحة' }, 401)
  }

  let body: {
    action?: string
    key?: string
    contentType?: string
    fromKey?: string
    toKey?: string
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

  const s3 = makeS3(env)
  const { bucket } = env

  try {
    if (action === 'ping') {
      return json({ ok: true, mode: 'edge' })
    }

    if (action === 'signPut') {
      const key = assertKey(body.key)
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

    if (action === 'signGet') {
      const key = assertKey(body.key)
      const cmd = new GetObjectCommand({
        Bucket: bucket,
        Key: key,
      })
      const url = await getSignedUrl(s3, cmd, { expiresIn: 3600 })
      const streamToken = await makeStreamToken(key, env)
      return json({ url, key, streamToken })
    }

    if (action === 'headObject') {
      const key = assertKey(body.key)
      try {
        await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
        return json({ ok: true, key })
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
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[r2-storage]', msg, e)
    return json({ error: msg }, 500)
  }
})
