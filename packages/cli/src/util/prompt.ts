import { createInterface } from 'node:readline/promises'

export async function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    return (await rl.question(question)).trim()
  } finally {
    rl.close()
  }
}

/** Read a password without echoing. Falls back to plain prompt if not a TTY. */
export async function promptPassword(question: string): Promise<string> {
  if (!process.stdin.isTTY) return prompt(question)
  process.stdout.write(question)
  return new Promise((resolve) => {
    let answer = ''
    const onData = (chunk: Buffer) => {
      const s = chunk.toString('utf8')
      for (const ch of s) {
        if (ch === '\n' || ch === '\r') {
          process.stdin.removeListener('data', onData)
          process.stdin.setRawMode(false)
          process.stdin.pause()
          process.stdout.write('\n')
          resolve(answer)
          return
        }
        if (ch === '') {
          process.exit(130)
        }
        if (ch === '') {
          if (answer.length > 0) {
            answer = answer.slice(0, -1)
            process.stdout.write('\b \b')
          }
        } else {
          answer += ch
          process.stdout.write('*')
        }
      }
    }
    process.stdin.setRawMode(true)
    process.stdin.resume()
    process.stdin.on('data', onData)
  })
}
