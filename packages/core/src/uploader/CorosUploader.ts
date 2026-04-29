import { createHash, createHmac, randomUUID } from 'node:crypto'
import { request } from 'undici'
import type { FileFormat } from '../activity/Activity.ts'
import { CorosApiError, SweatRelayError } from '../util/errors.ts'

const STS_CREDENTIAL_MARKER = '9y78gpoERW4lBNYL'
const COROS_SOURCE_WEB_IMPORT = 1
// faq.coros.com is the (regionless) STS broker; app_id + app_secret are taken
// from the prod openapi config baked into the t.coros.com webapp bundle. The
// `sign` query param is computed per-request via signOpenapi() — sorting the
// remaining params, concatenating key+value pairs, appending app_secret, then
// md5 → uppercase. There is no auth header on this endpoint.
const COROS_STS_HOST = 'https://faq.coros.com'
const COROS_APP_ID = '1660188068672619112'
const COROS_APP_SECRET = 'e03f8a02bd61636076a0c4a87320a5f4'

export const CorosRegionIds = {
  global: 1,
  china: 2,
  europe: 3,
} as const

export type CorosRegionId = (typeof CorosRegionIds)[keyof typeof CorosRegionIds]

export interface CorosSession {
  userId: string
  accessToken: string
  regionId: CorosRegionId
  cookie?: string
}

export interface CorosUploadOptions {
  filename?: string
  dataType: Extract<FileFormat, 'fit' | 'fit.gz' | 'tcx' | 'tcx.gz'>
}

export interface CorosImportResult {
  importId: string
  md5: string
  objectKey: string
  filename: string
}

export interface CorosImportTask {
  id?: string | number
  importId?: string | number
  status?: string | number
  fileName?: string
  oriFileName?: string
  createdAt?: string
  updatedAt?: string
}

export interface CorosUploaderConfig {
  getSession(): Promise<CorosSession>
}

interface CorosRegionConfig {
  id: CorosRegionId
  label: string
  appHost: string
  teamApi: string
  bucket: string
  service: 'aliyun' | 'aws'
}

interface CorosStsResponse {
  code?: number
  result?: string
  data?: {
    credentials?: string
  }
  message?: string
  msg?: string
}

interface CorosImportResponse {
  data?: {
    id?: string | number
    idString?: string
    status?: number
    errorSize?: number
    finishSize?: number
  }
  result?: string
  message?: string
  msg?: string
}

interface CorosImportListResponse {
  result?: string
  data?: CorosImportTask[] | { list?: CorosImportTask[] }
}

interface AliyunStsCredentials {
  Region: string
  AccessKeyId: string
  AccessKeySecret: string
  SecurityToken: string
  Bucket?: string
}

interface AwsStsCredentials {
  Region: string
  AccessKeyId: string
  SecretAccessKey: string
  SessionToken: string
  Bucket?: string
}

type StsCredentials = AliyunStsCredentials | AwsStsCredentials

// All regions share the same Training Hub origin — t.coros.com routes per
// account to the right team*api backend; the per-region apiHost below is what
// the JS client actually calls.
const COROS_WEB_ORIGIN = 'https://t.coros.com'
const COROS_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36'

const COROS_REGIONS: Record<CorosRegionId, CorosRegionConfig> = {
  [CorosRegionIds.global]: {
    id: CorosRegionIds.global,
    label: 'Global',
    appHost: COROS_WEB_ORIGIN,
    teamApi: 'https://teamapi.coros.com',
    bucket: 'coros-s3',
    service: 'aws',
  },
  [CorosRegionIds.china]: {
    id: CorosRegionIds.china,
    label: 'China',
    appHost: COROS_WEB_ORIGIN,
    teamApi: 'https://teamcnapi.coros.com',
    bucket: 'coros-oss',
    service: 'aliyun',
  },
  [CorosRegionIds.europe]: {
    id: CorosRegionIds.europe,
    label: 'Europe',
    appHost: COROS_WEB_ORIGIN,
    teamApi: 'https://teameuapi.coros.com',
    bucket: 'eu-coros',
    service: 'aws',
  },
}

export class CorosUploader {
  private readonly config: CorosUploaderConfig

  constructor(config: CorosUploaderConfig) {
    this.config = config
  }

  async upload(file: Buffer, opts: CorosUploadOptions): Promise<CorosImportResult> {
    const session = normalizeSession(await this.config.getSession())
    const region = regionFor(session.regionId)
    const filename = sanitizeFilename(opts.filename ?? `sweatrelay.${stripGzip(opts.dataType)}`)
    const md5 = createHash('md5').update(file).digest('hex')
    const upload = packageForCoros(file, {
      dataType: opts.dataType,
      filename,
      md5,
      userId: session.userId,
    })
    const sts = await this.fetchSts(session, region)

    if (region.service === 'aliyun') {
      await putAliyunObject(
        sts as AliyunStsCredentials,
        region.bucket,
        upload.objectKey,
        upload.body,
      )
    } else {
      await putAwsObject(sts as AwsStsCredentials, region.bucket, upload.objectKey, upload.body)
    }

    const importId = await this.registerImport(session, region, {
      bucket: storageBucket(sts, region.bucket),
      md5,
      size: file.length,
      objectKey: upload.objectKey,
      serviceName: region.service,
      oriFileName: filename,
    })

    return {
      importId,
      md5,
      objectKey: upload.objectKey,
      filename,
    }
  }

  async fetchRecentImports(size = 10): Promise<CorosImportTask[]> {
    const session = normalizeSession(await this.config.getSession())
    const region = regionFor(session.regionId)
    const res = await request(`${region.teamApi}/activity/fit/getImportSportList`, {
      method: 'POST',
      headers: this.apiHeaders(session, region, 'application/json'),
      body: JSON.stringify({ size }),
    })
    const json = await readJson<CorosImportListResponse>(res, 'COROS import list')
    assertCorosResult(json, 'COROS import list')
    if (Array.isArray(json.data)) return json.data
    return json.data?.list ?? []
  }

  private async fetchSts(
    _session: CorosSession,
    region: CorosRegionConfig,
  ): Promise<StsCredentials> {
    const params: Record<string, string | number> = {
      bucket: region.bucket,
      service: region.service,
      v: 2,
      app_id: COROS_APP_ID,
    }
    const sign = signOpenapi(params, COROS_APP_SECRET)
    const url = new URL(`${COROS_STS_HOST}/openapi/oss/sts`)
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v))
    url.searchParams.set('sign', sign)
    const res = await request(url, {
      method: 'GET',
      headers: { accept: 'application/json, text/plain, */*' },
    })
    const json = await readJson<CorosStsResponse>(res, 'COROS storage credential')
    if (json.code !== 200 || !json.data?.credentials) {
      throw new CorosApiError(
        `COROS storage credential failed: ${json.message ?? json.msg ?? json.result ?? 'unknown'}`,
        res.statusCode,
        json,
      )
    }
    return decodeStsCredentials(json.data.credentials)
  }

  private async registerImport(
    session: CorosSession,
    region: CorosRegionConfig,
    args: {
      bucket: string
      md5: string
      size: number
      objectKey: string
      serviceName: 'aliyun' | 'aws'
      oriFileName: string
    },
  ): Promise<string> {
    const jsonParameter = JSON.stringify({
      source: COROS_SOURCE_WEB_IMPORT,
      timezone: -(new Date().getTimezoneOffset() / 60) * 4,
      bucket: args.bucket,
      md5: args.md5,
      size: args.size,
      object: args.objectKey,
      serviceName: args.serviceName,
      oriFileName: args.oriFileName,
    })
    const multipart = buildMultipartBody([{ name: 'jsonParameter', value: jsonParameter }])
    const res = await request(`${region.teamApi}/activity/fit/import`, {
      method: 'POST',
      headers: {
        ...this.apiHeaders(session, region),
        'content-type': multipart.contentType,
        'content-length': String(multipart.body.length),
      },
      body: multipart.body,
      bodyTimeout: 60000,
      headersTimeout: 60000,
    })
    const json = await readJson<CorosImportResponse>(res, 'COROS import register')
    assertCorosResult(json, 'COROS import register')
    const importId = json.data?.idString ?? json.data?.id
    if (!importId) {
      throw new CorosApiError(
        'COROS accepted the file but did not return an import id',
        res.statusCode,
        json,
      )
    }
    if (json.data?.errorSize && json.data.errorSize > 0) {
      throw new CorosApiError(
        `COROS rejected the file (errorSize=${json.data.errorSize}, status=${json.data.status})`,
        res.statusCode,
        json,
      )
    }
    return String(importId)
  }

  private apiHeaders(
    session: CorosSession,
    region: CorosRegionConfig,
    contentType?: string,
  ): Record<string, string> {
    return {
      accept: 'application/json, text/plain, */*',
      'accept-language': 'zh-CN,zh;q=0.9',
      ...(contentType ? { 'content-type': contentType } : {}),
      // The webapp sends header names in lowercase; some COROS edges
      // (notably the CN STS) reject the camelCase variants.
      accesstoken: session.accessToken,
      cookie: session.cookie ?? defaultCookie(session),
      origin: region.appHost,
      referer: `${region.appHost}/`,
      'user-agent': COROS_USER_AGENT,
      yfheader: JSON.stringify({ userId: session.userId }),
    }
  }
}

function normalizeSession(session: CorosSession): CorosSession {
  const userId = session.userId.trim()
  const accessToken = session.accessToken.trim()
  if (!userId) throw new SweatRelayError('COROS userId is required')
  if (!accessToken) throw new SweatRelayError('COROS access token is required')
  return {
    userId,
    accessToken,
    regionId: session.regionId ?? CorosRegionIds.china,
    ...(session.cookie?.trim() ? { cookie: session.cookie.trim() } : {}),
  }
}

function regionFor(regionId: CorosRegionId): CorosRegionConfig {
  const region = COROS_REGIONS[regionId]
  if (!region) throw new SweatRelayError(`Unsupported COROS region: ${regionId}`)
  return region
}

function packageForCoros(
  file: Buffer,
  opts: { dataType: CorosUploadOptions['dataType']; filename: string; md5: string; userId: string },
): { body: Buffer; objectKey: string } {
  const extension = extensionFor(opts.dataType)
  if (extension === '.gz') {
    return {
      body: file,
      objectKey: `fit_zip/${opts.userId}/${opts.md5}.gz`,
    }
  }

  const zip = zipSingleFile(`${opts.md5}/${opts.filename}`, file)
  return {
    body: zip,
    objectKey: `fit_zip/${opts.userId}/${opts.md5}.zip`,
  }
}

function extensionFor(dataType: CorosUploadOptions['dataType']): '.fit' | '.tcx' | '.gz' {
  if (dataType.endsWith('.gz')) return '.gz'
  return dataType === 'fit' ? '.fit' : '.tcx'
}

function stripGzip(dataType: CorosUploadOptions['dataType']): 'fit' | 'tcx' {
  return dataType.replace('.gz', '') as 'fit' | 'tcx'
}

function sanitizeFilename(filename: string): string {
  const cleaned = filename
    .replaceAll('\\', '_')
    .replaceAll('/', '_')
    .replace(/[\r\n]/g, '_')
    .trim()
  return cleaned || 'sweatrelay.fit'
}

function defaultCookie(session: CorosSession): string {
  return `CPL-coros-token=${encodeURIComponent(session.accessToken)}; CPL-coros-region=${session.regionId}`
}

/**
 * COROS openapi signature: sort param keys ascending, concatenate
 * `key1value1key2value2...`, append app_secret, md5 → uppercase hex.
 * Mirrors the `signParams` function in the t.coros.com webapp bundle.
 */
function signOpenapi(params: Record<string, string | number>, secret: string): string {
  const keys = Object.keys(params).sort()
  let payload = ''
  for (const k of keys) {
    const v = params[k]
    if (v === undefined || v === null || typeof v === 'object') continue
    payload += `${k}${v}`
  }
  payload += secret
  return createHash('md5').update(payload).digest('hex').toUpperCase()
}

function decodeStsCredentials(encoded: string): StsCredentials {
  const stripped = encoded.replace(STS_CREDENTIAL_MARKER, '')
  const decoded = Buffer.from(stripped, 'base64').toString('utf8')
  return JSON.parse(decoded) as StsCredentials
}

function storageBucket(sts: StsCredentials, fallback: string): string {
  return 'Bucket' in sts && sts.Bucket ? sts.Bucket : fallback
}

async function putAliyunObject(
  sts: AliyunStsCredentials,
  fallbackBucket: string,
  objectKey: string,
  body: Buffer,
): Promise<void> {
  const bucket = sts.Bucket ?? fallbackBucket
  const contentType = 'text/plain'
  const date = new Date().toUTCString()
  const host = `${bucket}.${sts.Region}.aliyuncs.com`
  const securityHeader = `x-oss-security-token:${sts.SecurityToken}`
  const stringToSign = [
    'PUT',
    '',
    contentType,
    date,
    securityHeader,
    `/${bucket}/${objectKey}`,
  ].join('\n')
  const signature = createHmac('sha1', sts.AccessKeySecret).update(stringToSign).digest('base64')
  const res = await request(`https://${host}/${encodeObjectKey(objectKey)}`, {
    method: 'PUT',
    headers: {
      authorization: `OSS ${sts.AccessKeyId}:${signature}`,
      'content-type': contentType,
      'content-length': String(body.length),
      date,
      host,
      'x-oss-security-token': sts.SecurityToken,
    },
    body,
  })
  if (res.statusCode < 200 || res.statusCode >= 300) {
    const text = await res.body.text()
    throw new CorosApiError(`COROS OSS upload failed: ${res.statusCode}`, res.statusCode, text)
  }
  await res.body.dump()
}

async function putAwsObject(
  sts: AwsStsCredentials,
  fallbackBucket: string,
  objectKey: string,
  body: Buffer,
): Promise<void> {
  const bucket = sts.Bucket ?? fallbackBucket
  const contentType = 'text/plain'
  const now = new Date()
  const amzDate = toAmzDate(now)
  const dateStamp = amzDate.slice(0, 8)
  const host = `${bucket}.s3.${sts.Region}.amazonaws.com`
  const payloadHash = createHash('sha256').update(body).digest('hex')
  const canonicalUri = `/${encodeObjectKey(objectKey)}`
  const canonicalHeaders =
    `content-type:${contentType}\n` +
    `host:${host}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amzDate}\n` +
    `x-amz-security-token:${sts.SessionToken}\n`
  const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date;x-amz-security-token'
  const canonicalRequest = [
    'PUT',
    canonicalUri,
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n')
  const scope = `${dateStamp}/${sts.Region}/s3/aws4_request`
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    createHash('sha256').update(canonicalRequest).digest('hex'),
  ].join('\n')
  const signingKey = awsSigningKey(sts.SecretAccessKey, dateStamp, sts.Region)
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex')
  const res = await request(`https://${host}${canonicalUri}`, {
    method: 'PUT',
    headers: {
      authorization: `AWS4-HMAC-SHA256 Credential=${sts.AccessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      'content-type': contentType,
      'content-length': String(body.length),
      host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
      'x-amz-security-token': sts.SessionToken,
    },
    body,
  })
  if (res.statusCode < 200 || res.statusCode >= 300) {
    const text = await res.body.text()
    throw new CorosApiError(`COROS S3 upload failed: ${res.statusCode}`, res.statusCode, text)
  }
  await res.body.dump()
}

function awsSigningKey(secret: string, dateStamp: string, region: string): Buffer {
  const dateKey = createHmac('sha256', `AWS4${secret}`).update(dateStamp).digest()
  const dateRegionKey = createHmac('sha256', dateKey).update(region).digest()
  const dateRegionServiceKey = createHmac('sha256', dateRegionKey).update('s3').digest()
  return createHmac('sha256', dateRegionServiceKey).update('aws4_request').digest()
}

function toAmzDate(date: Date): string {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, '')
}

async function readJson<T>(
  res: Awaited<ReturnType<typeof request>>,
  operation: string,
): Promise<T> {
  const text = await res.body.text()
  let json: T
  try {
    json = JSON.parse(text) as T
  } catch {
    throw new CorosApiError(
      `${operation} returned non-JSON ${res.statusCode}`,
      res.statusCode,
      text,
    )
  }
  if (res.statusCode >= 400) {
    throw new CorosApiError(`${operation} failed: ${res.statusCode}`, res.statusCode, json)
  }
  return json
}

function assertCorosResult(
  json: { result?: string; message?: string; msg?: string },
  label: string,
): void {
  if (json.result && json.result !== '0000') {
    throw new CorosApiError(
      `${label} failed: ${json.message ?? json.msg ?? json.result}`,
      200,
      json,
    )
  }
}

interface MultipartTextPart {
  name: string
  value: string
}

function buildMultipartBody(parts: MultipartTextPart[]): { body: Buffer; contentType: string } {
  const boundary = `sweatrelay-${randomUUID()}`
  const chunks: Buffer[] = []
  for (const part of parts) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${escapeMultipartValue(part.name)}"\r\n\r\n${part.value}\r\n`,
      ),
    )
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`))
  return {
    body: Buffer.concat(chunks),
    contentType: `multipart/form-data; boundary=${boundary}`,
  }
}

function escapeMultipartValue(value: string): string {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"')
    .replaceAll('\r', '')
    .replaceAll('\n', '')
}

function encodeObjectKey(objectKey: string): string {
  return objectKey.split('/').map(encodeURIComponent).join('/')
}

function zipSingleFile(entryName: string, bytes: Buffer): Buffer {
  const nameBytes = Buffer.from(entryName.replaceAll('\\', '/'), 'utf8')
  const crc = crc32(bytes)
  const { time, date } = dosDateTime(new Date())
  const localHeader = Buffer.alloc(30)
  localHeader.writeUInt32LE(0x04034b50, 0)
  localHeader.writeUInt16LE(20, 4)
  localHeader.writeUInt16LE(0, 6)
  localHeader.writeUInt16LE(0, 8)
  localHeader.writeUInt16LE(time, 10)
  localHeader.writeUInt16LE(date, 12)
  localHeader.writeUInt32LE(crc, 14)
  localHeader.writeUInt32LE(bytes.length, 18)
  localHeader.writeUInt32LE(bytes.length, 22)
  localHeader.writeUInt16LE(nameBytes.length, 26)
  localHeader.writeUInt16LE(0, 28)

  const centralOffset = localHeader.length + nameBytes.length + bytes.length
  const centralHeader = Buffer.alloc(46)
  centralHeader.writeUInt32LE(0x02014b50, 0)
  centralHeader.writeUInt16LE(20, 4)
  centralHeader.writeUInt16LE(20, 6)
  centralHeader.writeUInt16LE(0, 8)
  centralHeader.writeUInt16LE(0, 10)
  centralHeader.writeUInt16LE(time, 12)
  centralHeader.writeUInt16LE(date, 14)
  centralHeader.writeUInt32LE(crc, 16)
  centralHeader.writeUInt32LE(bytes.length, 20)
  centralHeader.writeUInt32LE(bytes.length, 24)
  centralHeader.writeUInt16LE(nameBytes.length, 28)
  centralHeader.writeUInt16LE(0, 30)
  centralHeader.writeUInt16LE(0, 32)
  centralHeader.writeUInt16LE(0, 34)
  centralHeader.writeUInt16LE(0, 36)
  centralHeader.writeUInt32LE(0, 38)
  centralHeader.writeUInt32LE(0, 42)

  const centralSize = centralHeader.length + nameBytes.length
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(1, 8)
  end.writeUInt16LE(1, 10)
  end.writeUInt32LE(centralSize, 12)
  end.writeUInt32LE(centralOffset, 16)
  end.writeUInt16LE(0, 20)

  return Buffer.concat([localHeader, nameBytes, bytes, centralHeader, nameBytes, end])
}

function dosDateTime(date: Date): { time: number; date: number } {
  const time =
    (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2)
  const dosDate = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  return { time, date: dosDate }
}

const CRC32_TABLE = new Uint32Array(256).map((_, index) => {
  let c = index
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  }
  return c >>> 0
})

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc = (CRC32_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}
