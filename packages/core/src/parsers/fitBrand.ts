/// <reference path="./garmin-fitsdk.d.ts" />
import { Decoder, Encoder, Profile, Stream } from '@garmin/fitsdk'
import { SweatRelayError } from '../util/errors.ts'

export interface RewriteFitBrandOptions {
  manufacturer?: number
  product?: number
  productName?: string
  descriptor?: string
}

const DEFAULT_BRAND: Required<RewriteFitBrandOptions> = {
  // FIT manufacturer is a uint16 enum. 255 is the standard "development"
  // manufacturer id and does not depend on the SDK string mapping table.
  manufacturer: 255,
  product: 1,
  productName: 'SweatRelay',
  descriptor: 'SweatRelay',
}

export function rewriteFitBrand(bytes: Buffer, opts: RewriteFitBrandOptions = {}): Buffer {
  const brand = { ...DEFAULT_BRAND, ...opts }
  const decoder = new Decoder(Stream.fromBuffer(bytes))
  if (!decoder.isFIT()) {
    throw new SweatRelayError('Cannot rewrite FIT brand: not a valid FIT file')
  }

  const encoder = new Encoder()
  const result = decoder.read({
    applyScaleAndOffset: true,
    convertDateTimesToDates: true,
    expandSubFields: true,
    expandComponents: true,
    mergeHeartRates: true,
    fieldDescriptionListener: (key, developerDataIdMesg, fieldDescriptionMesg) => {
      encoder.addDeveloperField(key, developerDataIdMesg, fieldDescriptionMesg)
    },
    mesgListener: (mesgNum, mesg) => {
      encoder.onMesg(mesgNum, rewriteMessage(mesgNum, mesg, brand))
    },
  })

  if (result.errors.length > 0) {
    throw new SweatRelayError(
      `Cannot rewrite FIT brand: ${result.errors.map((err) => err.message).join('; ')}`,
    )
  }

  return Buffer.from(encoder.close())
}

function rewriteMessage(
  mesgNum: number,
  mesg: unknown,
  brand: Required<RewriteFitBrandOptions>,
): Record<string, unknown> {
  const patched = { ...(mesg as Record<string, unknown>) }
  if (mesgNum === Profile.MesgNum.FILE_ID) {
    patched.manufacturer = brand.manufacturer
    patched.product = brand.product
    patched.productName = brand.productName
  }
  if (mesgNum === Profile.MesgNum.DEVICE_INFO) {
    patched.manufacturer = brand.manufacturer
    patched.product = brand.product
    patched.productName = brand.productName
    patched.descriptor = brand.descriptor
  }
  return patched
}
