import {
  createR2StorageHandler,
  installR2StorageTestAwsPrimitives,
} from './index.ts'

const UID = '11111111-1111-1111-1111-111111111111'
const RECORD = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const FOREIGN_RECORD = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
const BUCKET = 'test-r2'

type ObjectValue = { body: Uint8Array; contentType: string }

class FakeCommand {
  input: Record<string, unknown>
  constructor(input: Record<string, unknown>) {
    this.input = input
  }
}
class FakeHeadObjectCommand extends FakeCommand {}
class FakeGetObjectCommand extends FakeCommand {}
class FakePutObjectCommand extends FakeCommand {}
class FakeDeleteObjectCommand extends FakeCommand {}
class FakeListObjectsV2Command extends FakeCommand {}
class FakeAbortMultipartUploadCommand extends FakeCommand {}
class FakeCompleteMultipartUploadCommand extends FakeCommand {}
class FakeCopyObjectCommand extends FakeCommand {}
class FakeCreateMultipartUploadCommand extends FakeCommand {}
class FakeUploadPartCommand extends FakeCommand {}

installR2StorageTestAwsPrimitives({
  HeadObjectCommand: FakeHeadObjectCommand,
  GetObjectCommand: FakeGetObjectCommand,
  PutObjectCommand: FakePutObjectCommand,
  DeleteObjectCommand: FakeDeleteObjectCommand,
  ListObjectsV2Command: FakeListObjectsV2Command,
  AbortMultipartUploadCommand: FakeAbortMultipartUploadCommand,
  CompleteMultipartUploadCommand: FakeCompleteMultipartUploadCommand,
  CopyObjectCommand: FakeCopyObjectCommand,
  CreateMultipartUploadCommand: FakeCreateMultipartUploadCommand,
  UploadPartCommand: FakeUploadPartCommand,
})

function namedError(name: string): Error {
  const error = new Error(name)
  error.name = name
  return error
}

class FakeS3 {
  objects = new Map<string, ObjectValue>()

  async send(command: FakeCommand): Promise<Record<string, unknown>> {
    const key = String(command.input.Key || '')
    if (command instanceof FakeHeadObjectCommand) {
      const value = this.objects.get(key)
      if (!value) throw namedError('NotFound')
      return { ContentLength: value.body.byteLength, ContentType: value.contentType }
    }
    if (command instanceof FakeGetObjectCommand) {
      const value = this.objects.get(key)
      if (!value) throw namedError('NotFound')
      // Mimic the AWS SDK stream mixin: raw pipe into PutObject must not be
      // relied on (production Deno hits "unexpected end of file").
      const bodyBytes = value.body
      return {
        Body: {
          transformToByteArray: async () => bodyBytes,
          async *[Symbol.asyncIterator]() {
            throw new TypeError('unexpected end of file')
          },
        },
        ContentLength: value.body.byteLength,
        ContentType: value.contentType,
      }
    }
    if (command instanceof FakePutObjectCommand) {
      if (command.input.IfNoneMatch === '*' && this.objects.has(key)) throw namedError('PreconditionFailed')
      const body = command.input.Body
      if (!(body instanceof Uint8Array) || !body.byteLength) {
        throw new TypeError('unexpected end of file')
      }
      this.objects.set(key, { body, contentType: String(command.input.ContentType || '') })
      return {}
    }
    if (command instanceof FakeCopyObjectCommand) {
      if (command.input.IfNoneMatch === '*' && this.objects.has(key)) throw namedError('PreconditionFailed')
      // Mirror R2/S3: CopySource is bucket/key with path segments URI-encoded.
      const rawSource = String(command.input.CopySource || '')
      const slash = rawSource.indexOf('/')
      const encodedKey = slash >= 0 ? rawSource.slice(slash + 1) : rawSource
      const srcKey = encodedKey.split('/').map((seg) => {
        try { return decodeURIComponent(seg) } catch { return seg }
      }).join('/')
      const value = this.objects.get(srcKey)
      if (!value) throw namedError('NotFound')
      const directive = String(command.input.MetadataDirective || 'COPY').toUpperCase()
      this.objects.set(key, {
        body: value.body,
        contentType: directive === 'REPLACE'
          ? String(command.input.ContentType || value.contentType)
          : value.contentType,
      })
      return {}
    }
    if (command instanceof FakeDeleteObjectCommand) {
      this.objects.delete(key)
      return {}
    }
    throw new Error(`unsupported fake command: ${command.constructor.name}`)
  }
}

type Permission = 'allow' | 'deny'
function buildHandler(s3: FakeS3, permission: Permission = 'allow') {
  const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = []
  const supabase = {
    rpc: async (fn: string, args: Record<string, unknown> = {}) => {
      rpcCalls.push({ fn, args })
      const allowed = permission === 'allow'
        && (!['athar_attachment_destination_can_modify', 'athar_attachment_move_rollback_allowed'].includes(fn)
          || args.p_record_id === RECORD)
      if (fn === 'athar_attachment_can_read' || fn === 'athar_attachment_can_modify'
        || fn === 'athar_attachment_destination_can_modify' || fn === 'athar_attachment_move_rollback_allowed') {
        return { data: allowed, error: null }
      }
      if (fn === 'current_user_role') return { data: 'admin', error: null }
      throw new Error(`unexpected RPC ${fn}`)
    },
  }
  const handler = createR2StorageHandler({
    requireR2Env: () => ({ accessKeyId: 'key', secretAccessKey: 'secret', accountId: 'a'.repeat(32), bucket: BUCKET }),
    authenticateRequest: async () => ({ user: { id: UID }, supabase, isServiceRole: false as const }),
    ensureAws: async () => {},
    makeS3: () => s3 as never,
  })
  return { handler, rpcCalls }
}

function tempKey(file = 'file.pdf'): string {
  return `temp_${UID}_nonce123/${file}`
}
function req(action: string, body: Record<string, unknown>): Request {
  return new Request('https://edge.test/functions/v1/r2-storage', {
    method: 'POST',
    headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...body }),
  })
}
function pdf(): Uint8Array {
  return new TextEncoder().encode('%PDF-1.7\nbody')
}
function mp4(): Uint8Array {
  return new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d])
}

// Deno's lib.dom currently rejects Uint8Array<ArrayBufferLike> as BodyInit.
// Copy to a concrete ArrayBuffer so the fixture remains a real binary request.
function requestBody(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

Deno.test('handler يرفض temp أجنبي وpath traversal قبل أي كتابة', async () => {
  const s3 = new FakeS3()
  const { handler } = buildHandler(s3)
  const foreign = `temp_22222222-2222-2222-2222-222222222222_nonce123/file.pdf`
  const denied = await handler(new Request('https://edge.test', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer test',
      'Content-Type': 'application/pdf',
      'X-R2-Action': 'putObject',
      'X-R2-Key': foreign,
    },
    body: requestBody(pdf()),
  }))
  if (denied.status !== 403) throw new Error(`expected 403, got ${denied.status}`)

  const traversal = await handler(req('moveObject', {
    fromKey: tempKey(),
    toKey: `violations/${RECORD}/../other.pdf`,
    recordType: 'violation', recordId: RECORD, operation: 'create',
  }))
  if (traversal.status !== 400) throw new Error(`expected 400, got ${traversal.status}`)
  if (s3.objects.size !== 0) throw new Error('rejected requests wrote an object')
})

Deno.test('handler يسمح بـ headTempObject للمفتاح المملوك فقط', async () => {
  const s3 = new FakeS3()
  const owned = tempKey()
  s3.objects.set(owned, { body: pdf(), contentType: 'application/pdf' })
  const { handler } = buildHandler(s3)

  const ok = await handler(req('headTempObject', { key: owned }))
  if (ok.status !== 200) throw new Error(`expected 200, got ${ok.status}`)
  const okBody = await ok.json()
  if (!okBody.ok || okBody.contentLength !== s3.objects.get(owned)!.body.byteLength) {
    throw new Error('owned temp head failed')
  }

  const foreign = `temp_22222222-2222-2222-2222-222222222222_nonce123/file.pdf`
  s3.objects.set(foreign, { body: pdf(), contentType: 'application/pdf' })
  const denied = await handler(req('headTempObject', { key: foreign }))
  if (denied.status !== 403 && denied.status !== 400) {
    throw new Error(`foreign temp head expected 403/400, got ${denied.status}`)
  }
})

Deno.test('handler يسمح بالاستبدال للفعل المصرح فقط ويرفض قارئاً بلا edit', async () => {
  const key = `violations/${RECORD}/clip.mp4`
  const allowedStore = new FakeS3()
  allowedStore.objects.set(key, { body: mp4(), contentType: 'video/mp4' })
  const { handler, rpcCalls } = buildHandler(allowedStore)
  const allowed = await handler(new Request('https://edge.test', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer test', 'Content-Type': 'video/mp4',
      'X-R2-Action': 'replaceObject', 'X-R2-Key': key,
    },
    body: requestBody(mp4()),
  }))
  if (allowed.status !== 200 || !(await allowed.json()).replaced) throw new Error('authorized replacement failed')
  if (!rpcCalls.some((call) => call.fn === 'athar_attachment_can_modify')) {
    throw new Error('replacement did not request modify permission')
  }

  const deniedStore = new FakeS3()
  deniedStore.objects.set(key, { body: mp4(), contentType: 'video/mp4' })
  const { handler: deniedHandler } = buildHandler(deniedStore, 'deny')
  const denied = await deniedHandler(new Request('https://edge.test', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer test', 'Content-Type': 'video/mp4',
      'X-R2-Action': 'replaceObject', 'X-R2-Key': key,
    },
    body: requestBody(mp4()),
  }))
  if (denied.status !== 403) throw new Error(`read-only replacement expected 403, got ${denied.status}`)
})

Deno.test('handler ينفذ temp -> record-copy ثم commit cleanup بلا overwrite', async () => {
  const s3 = new FakeS3()
  const fromKey = tempKey()
  const toKey = `violations/${RECORD}/file.pdf`
  s3.objects.set(fromKey, { body: pdf(), contentType: 'application/pdf' })
  const { handler, rpcCalls } = buildHandler(s3)

  // 1) سجل جديد يحمل المرجع المؤقت، 2) نسخ من temp إلى UUID record namespace.
  const record = { id: RECORD, attachments: [{ p: fromKey }] }
  const copied = await handler(req('moveObject', {
    fromKey, toKey, recordType: 'violation', recordId: RECORD, operation: 'create',
  }))
  if (copied.status !== 200 || !(await copied.json()).sourceRetained) throw new Error('move copy failed')
  if (!s3.objects.has(fromKey) || !s3.objects.has(toKey)) throw new Error('copy must retain source before DB commit')
  if (!rpcCalls.some((call) => call.fn === 'athar_attachment_destination_can_modify')) {
    throw new Error('move did not validate destination record')
  }

  // Simulated successful guarded DB finalizer updates only this record, then temp cleanup.
  record.attachments[0].p = toKey
  const cleanup = await handler(req('deleteObject', { key: fromKey }))
  if (cleanup.status !== 200 || s3.objects.has(fromKey) || !s3.objects.has(toKey)) {
    throw new Error('commit cleanup did not preserve final object')
  }

  // The same destination cannot be overwritten by a second temp object.
  const second = tempKey('second.pdf')
  s3.objects.set(second, { body: pdf(), contentType: 'application/pdf' })
  const collision = await handler(req('moveObject', {
    fromKey: second, toKey, recordType: 'violation', recordId: RECORD, operation: 'create',
  }))
  if (collision.status !== 409 || !s3.objects.has(second)) throw new Error('destination overwrite was not prevented')
})

Deno.test('handler rejects moveObject when destination verify fails after copy (no GetObject)', async () => {
  class BrokenCopyS3 extends FakeS3 {
    getObjectCalls = 0
    copyCalls = 0
    override async send(command: FakeCommand) {
      if (command instanceof FakeGetObjectCommand) {
        this.getObjectCalls += 1
        return super.send(command)
      }
      if (command instanceof FakeCopyObjectCommand) {
        this.copyCalls += 1
        const key = String(command.input.Key || '')
        // Pretend CopyObject succeeded but wrote an empty object every time.
        this.objects.set(key, { body: new Uint8Array(), contentType: 'application/pdf' })
        return {}
      }
      return super.send(command)
    }
  }
  const s3 = new BrokenCopyS3()
  const fromKey = tempKey()
  const toKey = `violations/${RECORD}/file.pdf`
  s3.objects.set(fromKey, { body: pdf(), contentType: 'application/pdf' })
  const { handler } = buildHandler(s3)
  const res = await handler(req('moveObject', {
    fromKey, toKey, recordType: 'violation', recordId: RECORD, operation: 'create',
  }))
  // Must fail closed without GetObject — Edge GetObject crashes the isolate (503).
  if (res.status === 200) {
    throw new Error('empty copy must not be accepted as a successful move')
  }
  if (s3.getObjectCalls !== 0) {
    throw new Error('moveObject must not fall back to GetObject after bad copy')
  }
  if (s3.copyCalls < 2) {
    throw new Error('verify failure should retry CopyObject at least once')
  }
  if (s3.objects.has(toKey) && (s3.objects.get(toKey)?.body.byteLength || 0) === 0) {
    throw new Error('empty destination must be removed after failed verify')
  }
  if (!s3.objects.has(fromKey)) throw new Error('temp source must remain until DB finalize')
})

Deno.test('handler moveObject never GetObjects when CopyObject fails outright', async () => {
  class CopyFailS3 extends FakeS3 {
    getObjectCalls = 0
    override async send(command: FakeCommand) {
      if (command instanceof FakeGetObjectCommand) {
        this.getObjectCalls += 1
        return super.send(command)
      }
      if (command instanceof FakeCopyObjectCommand) {
        throw new Error('AccessDenied: copy not allowed')
      }
      return super.send(command)
    }
  }
  const s3 = new CopyFailS3()
  const fromKey = tempKey()
  const toKey = `violations/${RECORD}/file.pdf`
  s3.objects.set(fromKey, { body: pdf(), contentType: 'application/pdf' })
  const { handler } = buildHandler(s3)
  const res = await handler(req('moveObject', {
    fromKey, toKey, recordType: 'violation', recordId: RECORD, operation: 'create',
  }))
  if (res.status === 200) throw new Error('failed copy must not succeed')
  if (s3.getObjectCalls !== 0) throw new Error('failed copy must not fall back to GetObject')
  if (s3.objects.has(toKey)) throw new Error('failed copy must not leave a destination object')
  // Outer handler masks 5xx detail; still must fail closed without GetObject.
  if (res.status < 400) throw new Error(`expected error status, got ${res.status}`)
})

Deno.test('handler buffers GetObject body for complaint reply moveObject (no live stream pipe)', async () => {
  const s3 = new FakeS3()
  const fromKey = tempKey('reply.png')
  const toKey = `complaints/${RECORD}/reply.png`
  s3.objects.set(fromKey, {
    body: new TextEncoder().encode('\x89PNG\r\n\x1a\ncomplaint-reply'),
    contentType: 'image/png',
  })
  const { handler, rpcCalls } = buildHandler(s3)
  const copied = await handler(req('moveObject', {
    fromKey,
    toKey,
    recordType: 'complaint',
    recordId: RECORD,
    operation: 'reply',
  }))
  if (copied.status !== 200) {
    throw new Error(`complaint reply move failed: ${copied.status} ${await copied.text()}`)
  }
  const payload = await copied.json()
  if (!payload.copied || !payload.sourceRetained) throw new Error('expected buffered copy result')
  if (!s3.objects.has(toKey) || !s3.objects.has(fromKey)) {
    throw new Error('buffered move must write destination and retain temp')
  }
  if (!rpcCalls.some((call) =>
    call.fn === 'athar_attachment_destination_can_modify' && call.args.p_operation === 'reply'
  )) {
    throw new Error('reply move must authorize via destination_can_modify')
  }
})

Deno.test('handler يعوّض نسخة نقل فاشلة قبل تثبيت المرجع ولا يحذف مرجعاً مكتملًا', async () => {
  const fromKey = tempKey()
  const toKey = `complaints/${RECORD}/file.pdf`
  const s3 = new FakeS3()
  s3.objects.set(fromKey, { body: pdf(), contentType: 'application/pdf' })
  const { handler } = buildHandler(s3)
  const copied = await handler(req('moveObject', {
    fromKey, toKey, recordType: 'complaint', recordId: RECORD, operation: 'reply',
  }))
  if (copied.status !== 200) throw new Error('setup copy failed')

  // Simulated DB rejection: temp remains and rollback removes only unreferenced final.
  const rollback = await handler(req('rollbackMove', {
    fromKey, toKey, recordType: 'complaint', recordId: RECORD, operation: 'reply',
  }))
  if (rollback.status !== 200 || !s3.objects.has(fromKey) || s3.objects.has(toKey)) {
    throw new Error('failed transfer left an orphan or deleted its retry source')
  }

  // A denied rollback models a final path already committed by a lost response.
  s3.objects.set(toKey, { body: pdf(), contentType: 'application/pdf' })
  const { handler: committedHandler } = buildHandler(s3, 'deny')
  const denied = await committedHandler(req('rollbackMove', {
    fromKey, toKey, recordType: 'complaint', recordId: RECORD, operation: 'reply',
  }))
  if (denied.status !== 403 || !s3.objects.has(toKey)) {
    throw new Error('rollback deleted a final object after commit')
  }

  const forged = await handler(req('moveObject', {
    fromKey, toKey: `complaints/${FOREIGN_RECORD}/file.pdf`,
    recordType: 'complaint', recordId: FOREIGN_RECORD, operation: 'reply',
  }))
  if (forged.status !== 403 || s3.objects.has(`complaints/${FOREIGN_RECORD}/file.pdf`)) {
    throw new Error('foreign record destination was accepted')
  }
})

Deno.test('handler putFinalObject writes canonical key with move ACL (no GetObject)', async () => {
  const s3 = new FakeS3()
  const fromKey = tempKey('shot.webp')
  const toKey = `complaints/${RECORD}/shot.webp`
  s3.objects.set(fromKey, { body: pdf(), contentType: 'application/pdf' })
  const { handler, rpcCalls } = buildHandler(s3)
  // Minimal RIFF/WEBP signature accepted by assertAttachmentSignature.
  const body = new Uint8Array([
    0x52, 0x49, 0x46, 0x46, 0x18, 0x00, 0x00, 0x00,
    0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20,
    0x0c, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
  ])
  const res = await handler(new Request('https://edge.test', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer test',
      'Content-Type': 'image/webp',
      'X-R2-Action': 'putFinalObject',
      'X-R2-Key': toKey,
      'X-R2-From-Key': fromKey,
      'X-R2-Record-Type': 'complaint',
      'X-R2-Record-Id': RECORD,
      'X-R2-Operation': 'create',
    },
    body: requestBody(body),
  }))
  if (res.status !== 200) throw new Error(`putFinalObject failed: ${res.status} ${await res.text()}`)
  const payload = await res.json()
  if (!payload.ok || payload.via !== 'putFinal' || payload.bytes !== body.byteLength) {
    throw new Error(`unexpected putFinal payload ${JSON.stringify(payload)}`)
  }
  if (!s3.objects.has(toKey) || !s3.objects.has(fromKey)) {
    throw new Error('putFinal must write destination and retain temp')
  }
  if (!rpcCalls.some((call) => call.fn === 'athar_attachment_destination_can_modify')) {
    throw new Error('putFinal must authorize via destination_can_modify')
  }
})
