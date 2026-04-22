import { mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const guiDir = resolve(scriptDir, '..')
const source = resolve(guiDir, 'resources/icon.svg')
const output = resolve(guiDir, 'resources/icon.png')

await mkdir(dirname(output), { recursive: true })
await sharp(source).png().toFile(output)
