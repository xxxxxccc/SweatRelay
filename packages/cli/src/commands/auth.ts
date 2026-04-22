import { OnelapApiAdapter } from '@sweatrelay/adapter-onelap'
import { buildContext, STRAVA_TOKENS_CRED_KEY } from '../context.ts'
import { openBrowser } from '../util/openBrowser.ts'
import { prompt, promptPassword } from '../util/prompt.ts'

export async function authStrava(): Promise<void> {
  const ctx = buildContext()
  console.log('打开浏览器进行 Strava 授权…')
  const tokens = await ctx.oauth.authorize({
    openUrl: (url) => {
      console.log(`如果浏览器没有自动打开，请手动访问：\n  ${url}`)
      openBrowser(url)
    },
  })
  await ctx.credentials.set(STRAVA_TOKENS_CRED_KEY, JSON.stringify(tokens))
  console.log(`✓ Strava 授权成功（运动员: ${tokens.athleteId ?? '未知'}）`)
  console.log(`  连接信息已加密保存到 ${ctx.credsPath}`)
}

export async function authOnelap(): Promise<void> {
  const ctx = buildContext()
  const account = await prompt('Onelap 账号：')
  const password = await promptPassword('Onelap 密码：')
  const adapter = new OnelapApiAdapter({ credentials: ctx.credentials })
  await adapter.saveCredentials(account, password)
  // Eagerly try logging in to surface bad credentials immediately.
  try {
    const refs: unknown[] = []
    for await (const ref of adapter.list({ limit: 1 })) refs.push(ref)
    console.log('✓ Onelap 登录成功，凭证已加密保存。')
  } catch (err) {
    console.error('✗ Onelap 凭证已保存，但首次登录失败：', (err as Error).message)
    console.error('  下次同步时会重试。')
  }
}
