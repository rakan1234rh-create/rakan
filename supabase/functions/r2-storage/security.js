/**
 * قيود أمنية مشتركة لمرفقات R2. هذا الملف بلا أسرار وبلا I/O كي يُختبر بـ Node.
 */
/** حد المرفق النهائي المخزَّن — يكفي لمقاطع هاتف/كاميرا قصيرة بعد ضغط/تحويل. */
export const R2_ATTACHMENT_MAX_BYTES = 100 * 1024 * 1024
export const R2_MULTIPART_PART_MAX_BYTES = 10 * 1024 * 1024
/** مع أجزاء العميل ~8MB يكفي لحد 100MB مع هامش. */
export const R2_MULTIPART_MAX_PARTS = 20

const MIME_BY_EXTENSION = {
  // هواتف/متصفحات ترسل أحياناً MIME غير مطابق للامتداد (خصوصاً iOS/Android).
  mp4: new Set(['video/mp4', 'video/x-m4v', 'video/quicktime']),
  m4v: new Set(['video/mp4', 'video/x-m4v']),
  mov: new Set(['video/quicktime', 'video/mp4']),
  webm: new Set(['video/webm']),
  avi: new Set(['video/x-msvideo', 'video/avi']),
  mkv: new Set(['video/x-matroska']),
  '3gp': new Set(['video/3gpp', 'video/3gpp2', 'video/mp4']),
  jpg: new Set(['image/jpeg']),
  jpeg: new Set(['image/jpeg']),
  png: new Set(['image/png']),
  gif: new Set(['image/gif']),
  webp: new Set(['image/webp']),
  pdf: new Set(['application/pdf']),
}

export function assertKey(key) {
  if (typeof key !== 'string' || !key.length) throw new Error('key مطلوب')
  if (key.length > 2048) throw new Error('key طويل جداً')
  if (
    key.includes('..')
    || key.startsWith('/')
    || key.endsWith('/')
    || key.includes('//')
    || key.includes('\0')
    || key.includes('\\')
  ) {
    throw new Error('مسار غير صالح')
  }
  if (!/^[a-zA-Z0-9_\-./]+$/.test(key)) throw new Error('أحرف غير مسموحة في المفتاح')
  return key
}

export function assertTempUploadKey(key, userId) {
  const cleanKey = assertKey(key)
  const uid = String(userId || '').trim()
  if (!uid) throw new Error('غير مصرح بالرفع في هذا المسار')
  const prefix = `temp_${uid}_`
  const suffix = cleanKey.slice(prefix.length)
  // الصيغة المتولدة من الواجهة هي temp_{auth_uid}_{nonce}/{safe-file-name}.
  // لا نسمح بمجلدات إضافية أو مقاطع فارغة كي لا يصبح فحص البادئة وحده قابلاً للالتفاف.
  if (!cleanKey.startsWith(prefix) || !/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(suffix)) {
    throw new Error('غير مصرح بالرفع في هذا المسار')
  }
  return cleanKey
}

function extensionForKey(key) {
  const base = assertKey(key).split('/').pop() || ''
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : ''
}

export function normalizedAttachmentContentType(key, contentType) {
  const ext = extensionForKey(key)
  const allowed = MIME_BY_EXTENSION[ext]
  if (!allowed) throw new Error('امتداد المرفق غير مسموح')
  const mime = String(contentType || '').split(';', 1)[0].trim().toLowerCase()
  if (!mime || !allowed.has(mime)) throw new Error('نوع MIME لا يطابق امتداد المرفق')
  return mime
}

export function assertAttachmentSize(size) {
  if (!Number.isFinite(size) || size < 1) throw new Error('جسم فارغ')
  if (size > R2_ATTACHMENT_MAX_BYTES) {
    const mb = Math.round(R2_ATTACHMENT_MAX_BYTES / 1048576)
    throw new Error(`حجم الملف يتجاوز الحد المسموح (${mb} ميغابايت)`)
  }
}

function ascii(bytes, offset, text) {
  if (!(bytes instanceof Uint8Array) || bytes.length < offset + text.length) return false
  for (let i = 0; i < text.length; i++) {
    if (bytes[offset + i] !== text.charCodeAt(i)) return false
  }
  return true
}

/** تحقق خفيف من ترويسة التنسيق؛ لا يحوّل المرفق إلى فحص مكافحة فيروسات. */
export function assertAttachmentSignature(key, bytes) {
  if (!(bytes instanceof Uint8Array) || !bytes.length) throw new Error('جسم فارغ')
  const ext = extensionForKey(key)
  const ok = {
    jpg: bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
    jpeg: bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
    png: bytes.length >= 8
      && bytes[0] === 0x89 && ascii(bytes, 1, 'PNG') && bytes[4] === 0x0d
      && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a,
    gif: ascii(bytes, 0, 'GIF87a') || ascii(bytes, 0, 'GIF89a'),
    webp: ascii(bytes, 0, 'RIFF') && ascii(bytes, 8, 'WEBP'),
    pdf: ascii(bytes, 0, '%PDF-'),
    mp4: ascii(bytes, 4, 'ftyp'),
    m4v: ascii(bytes, 4, 'ftyp'),
    mov: ascii(bytes, 4, 'ftyp'),
    '3gp': ascii(bytes, 4, 'ftyp'),
    avi: ascii(bytes, 0, 'RIFF') && ascii(bytes, 8, 'AVI '),
    webm: bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3,
    mkv: bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3,
  }[ext]
  if (!ok) throw new Error('محتوى الملف لا يطابق نوع المرفق المعلن')
}

export function assertAttachmentPayload(key, contentType, bytes) {
  normalizedAttachmentContentType(key, contentType)
  assertAttachmentSize(bytes?.byteLength)
  assertAttachmentSignature(key, bytes)
}

export function isAttachmentKey(key) {
  try {
    return !!MIME_BY_EXTENSION[extensionForKey(key)]
  } catch (_) {
    return false
  }
}
