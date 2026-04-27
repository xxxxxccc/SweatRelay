import { Decoder, Encoder, Profile, Stream } from '@garmin/fitsdk'
import { describe, expect, it } from 'vitest'
import { rewriteFitBrand } from '../src/parsers/fitBrand.ts'

describe('rewriteFitBrand', () => {
  it('rewrites FIT file and device brand metadata while keeping the file valid', () => {
    const original = makeFit()
    const rewritten = rewriteFitBrand(original)
    const messages = decode(rewritten)

    expect(messages.fileIdMesgs?.[0]).toMatchObject({
      manufacturer: 'development',
      product: 1,
      productName: 'SweatRelay',
      type: 'activity',
    })
    expect(messages.deviceInfoMesgs?.[0]).toMatchObject({
      manufacturer: 'development',
      product: 1,
      productName: 'SweatRelay',
      descriptor: 'SweatRelay',
    })
    expect(messages.recordMesgs).toHaveLength(1)
    expect(new Decoder(Stream.fromBuffer(rewritten)).isFIT()).toBe(true)
  })
})

function makeFit(): Buffer {
  const encoder = new Encoder()
  const timestamp = new Date('2026-04-27T01:00:00Z')
  encoder.onMesg(Profile.MesgNum.FILE_ID, {
    type: 'activity',
    manufacturer: 'onelap',
    product: 22,
    serialNumber: 1001441432,
    timeCreated: timestamp,
  })
  encoder.onMesg(Profile.MesgNum.DEVICE_INFO, {
    timestamp,
    manufacturer: 'onelap',
    product: 22,
    softwareVersion: 1,
    serialNumber: 1001441432,
  })
  encoder.onMesg(Profile.MesgNum.SESSION, {
    timestamp,
    startTime: timestamp,
    sport: 'cycling',
    subSport: 'virtualActivity',
    totalElapsedTime: 1,
    totalTimerTime: 1,
  })
  encoder.onMesg(Profile.MesgNum.RECORD, {
    timestamp,
    distance: 1,
    heartRate: 100,
  })
  return Buffer.from(encoder.close())
}

function decode(bytes: Buffer) {
  return new Decoder(Stream.fromBuffer(bytes)).read({
    applyScaleAndOffset: true,
    convertDateTimesToDates: true,
    expandSubFields: true,
    expandComponents: true,
    mergeHeartRates: true,
  }).messages
}
