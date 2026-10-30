import {
  assertAttachmentPayload,
  assertKey,
  assertTempUploadKey,
  normalizedAttachmentContentType,
  R2_ATTACHMENT_MAX_BYTES,
} from './security.js'

function expectThrow(fn: () => unknown, message: string): void {
  let threw = false
  try {
    fn()
  } catch {
    threw = true
  }
  if (!threw) throw new Error(message)
}

const UID = '11111111-1111-1111-1111-111111111111'

Deno.test('security helper يسمح بمفتاح temp مملوك وصيغة ملف آمنة فقط', () => {
  const key = `temp_${UID}_nonce123/report.pdf`
  if (assertTempUploadKey(key, UID) !== key) throw new Error('المفتاح المملوك رُفض')
  if (assertKey(`violations/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/video.mp4`).includes('..')) {
    throw new Error('مفتاح سليم تغير')
  }
})

Deno.test('security helper يرفض traversal وملكية temp لمستخدم آخر ومقاطع غير سليمة', () => {
  expectThrow(() => assertKey('violations/a/../b.pdf'), 'path traversal accepted')
  expectThrow(() => assertKey('violations//a.pdf'), 'empty segment accepted')
  expectThrow(() => assertKey('violations/a\\b.pdf'), 'backslash accepted')
  expectThrow(
    () => assertTempUploadKey(`temp_22222222-2222-2222-2222-222222222222_nonce/report.pdf`, UID),
    'foreign temp key accepted',
  )
  expectThrow(() => assertTempUploadKey(`temp_${UID}_nonce//report.pdf`, UID), 'empty temp segment accepted')
  expectThrow(() => assertTempUploadKey(`temp_${UID}_nonce/nested/report.pdf`, UID), 'nested temp path accepted')
})

Deno.test('security helper يطابق MIME والتوقيع والحجم مع الامتداد', () => {
  const pdf = new TextEncoder().encode('%PDF-1.7\nbody')
  if (normalizedAttachmentContentType('x.pdf', 'application/pdf; charset=binary') !== 'application/pdf') {
    throw new Error('لم يُطبع MIME الصحيح')
  }
  assertAttachmentPayload('x.pdf', 'application/pdf', pdf)
  expectThrow(() => assertAttachmentPayload('x.pdf', 'image/png', pdf), 'MIME mismatch accepted')
  expectThrow(
    () => assertAttachmentPayload('x.png', 'image/png', pdf),
    'signature mismatch accepted',
  )
  expectThrow(
    () => assertAttachmentPayload('x.pdf', 'application/pdf', new Uint8Array(R2_ATTACHMENT_MAX_BYTES + 1)),
    'oversized payload accepted',
  )
})

Deno.test('security helper يقبل MIME شائع للهواتف على امتدادات الفيديو', () => {
  if (normalizedAttachmentContentType('clip.mp4', 'video/quicktime') !== 'video/quicktime') {
    throw new Error('mp4+quicktime رُفض')
  }
  if (normalizedAttachmentContentType('clip.mov', 'video/mp4') !== 'video/mp4') {
    throw new Error('mov+mp4 رُفض')
  }
  if (normalizedAttachmentContentType('clip.3gp', 'video/3gpp') !== 'video/3gpp') {
    throw new Error('3gp رُفض')
  }
  const ftyp = new Uint8Array([0, 0, 0, 0x18, ...new TextEncoder().encode('ftypisom'), 0, 0, 0, 0])
  assertAttachmentPayload('clip.mp4', 'video/mp4', ftyp)
  assertAttachmentPayload('clip.3gp', 'video/3gpp', ftyp)
})
