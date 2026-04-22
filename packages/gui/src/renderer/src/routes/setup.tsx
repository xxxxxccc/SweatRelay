import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useSetAtom } from 'jotai'
import { ArrowRight, Check, KeyRound, Lock, Zap } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { statusAtom } from '@/state/atoms'

interface Step {
  num: string
  title: string
  desc: string
  icon: React.ComponentType<{ className?: string }>
}

const STEPS: ReadonlyArray<Step> = [
  { num: '01', title: '本地密码', desc: '加密保存的连接信息', icon: Lock },
  { num: '02', title: 'Strava App', desc: '客户 ID & 密钥', icon: KeyRound },
  { num: '03', title: '点火并授权', desc: '授权', icon: Zap },
]

type Phase = 'idle' | 'configuring' | 'authorizing'

function Setup() {
  const setStatus = useSetAtom(statusAtom)
  const router = useRouter()
  const [passphrase, setPassphrase] = useState('')
  const [stravaClientId, setClientId] = useState('')
  const [stravaClientSecret, setClientSecret] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const busy = phase !== 'idle'

  const activeStep = useMemo(() => {
    if (passphrase.length < 8) return 0
    if (!stravaClientId || !stravaClientSecret) return 1
    return 2
  }, [passphrase, stravaClientId, stravaClientSecret])

  async function onSubmit(e: React.SyntheticEvent) {
    e.preventDefault()
    setError(null)

    setPhase('configuring')
    const cfg = await api.configure({ passphrase, stravaClientId, stravaClientSecret })
    if (!cfg.ok) {
      setPhase('idle')
      setError(cfg.error.message)
      return
    }

    setPhase('authorizing')
    const auth = await api.authStrava()
    setPhase('idle')
    if (!auth.ok) {
      // App is configured but OAuth was canceled / failed. Drop the user onto
      // the dashboard — the onboarding hero will guide them to retry.
      setStatus(cfg.value)
      setError(`Strava 授权未完成：${auth.error.message}。已保存配置，可在数据源页重试。`)
      router.navigate({ to: '/' })
      return
    }
    setStatus(auth.value)
    router.navigate({ to: '/' })
  }

  return (
    <div className="grid w-full max-w-5xl grid-cols-[280px_1fr] gap-16">
      <aside className="border-l border-border pl-6">
        <p className="mb-1 font-mono text-micro uppercase tracking-stamp-mono text-accent">
          出发前
        </p>
        <h2 className="mb-10 font-display text-3xl uppercase leading-none text-fg">
          赛前
          <br />
          准备
        </h2>
        <ol className="space-y-6">
          {STEPS.map((step, i) => {
            const done = i < activeStep
            const active = i === activeStep
            return (
              <li key={step.num} className="flex items-start gap-3">
                <span
                  className={cn(
                    'mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border font-mono text-micro',
                    done && 'border-accent bg-accent text-accent-fg',
                    active && 'border-accent text-accent',
                    !done && !active && 'border-border text-fg-subtle',
                  )}
                >
                  {done ? <Check className="size-3.5" /> : step.num}
                </span>
                <div>
                  <p
                    className={cn(
                      'font-display text-sm uppercase tracking-wider',
                      active ? 'text-fg' : done ? 'text-fg-muted' : 'text-fg-subtle',
                    )}
                  >
                    {step.title}
                  </p>
                  <p className="mt-0.5 text-xs text-fg-subtle">{step.desc}</p>
                </div>
              </li>
            )
          })}
        </ol>
      </aside>

      <div className="max-w-md">
        <p className="mb-2 font-mono text-micro uppercase tracking-stamp-mono text-fg-muted">
          首次启动 · 一次性
        </p>
        <h1 className="mb-2 font-display text-5xl uppercase leading-none text-fg">
          上路前
          <br />
          配置一下
        </h1>
        <p className="mb-6 max-w-md text-sm text-fg-muted">
          下面两项凭证从 Strava 自己拿。打开
          <a
            className="text-accent underline-offset-2 hover:underline"
            href="https://www.strava.com/settings/api"
            target="_blank"
            rel="noreferrer"
          >
            {' '}
            strava.com/settings/api{' '}
          </a>
          → 「我的 API 应用程序」→ 把<strong className="text-fg">「授权回调域」</strong>填{' '}
          <code className="font-mono text-fg">localhost</code> → 保存。然后照下面字段对照填。
        </p>

        <form className="space-y-6" onSubmit={onSubmit}>
          <Field
            id="passphrase"
            label="本地加密密码"
            from="自己临时想一个 · 只存在本机 · 用来加密本地保存的连接信息，不是 Strava/Onelap 账号的密码"
            hint="至少 8 位 · 丢失即不可恢复"
          >
            <Input
              id="passphrase"
              type="password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              autoFocus
              required
              minLength={8}
              placeholder="你想一串 ≥8 位的字符即可"
            />
          </Field>

          <Field id="cid" label="Client ID" from="Strava 页面上的「客户 ID」" hint="6 位数字">
            <Input
              id="cid"
              value={stravaClientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder="例如 228844"
              required
              inputMode="numeric"
            />
          </Field>

          <Field
            id="csec"
            label="Client Secret"
            from="Strava 页面上的「客户端密钥」（橙色高亮的长串）"
            hint="40 位十六进制 · 仅本机存储"
          >
            <Input
              id="csec"
              type="password"
              value={stravaClientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              placeholder="点 Strava 页面上的「显示」按钮即可复制"
              required
            />
          </Field>

          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <Button type="submit" disabled={busy} size="lg" className="group w-full">
            {phase === 'configuring' ? (
              '正在初始化…'
            ) : phase === 'authorizing' ? (
              '等待浏览器中完成 Strava 授权…'
            ) : (
              <>
                开始
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
              </>
            )}
          </Button>
          {phase === 'authorizing' ? (
            <p className="text-center text-xs text-fg-muted">
              浏览器已打开 Strava 登录页 · 授权完成会自动回到这里
            </p>
          ) : null}
        </form>
      </div>
    </div>
  )
}

function Field({
  id,
  label,
  from,
  hint,
  children,
}: {
  id: string
  label: string
  /** Where this value comes from — shown directly under the label. */
  from?: string
  /** Format / safety hint shown on the right of the label. */
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <Label
          htmlFor={id}
          className="font-display text-mini uppercase tracking-stamp text-fg-muted"
        >
          {label}
        </Label>
        {hint ? <span className="text-mini text-fg-subtle">{hint}</span> : null}
      </div>
      {from ? <p className="text-xs text-fg-muted">{from}</p> : null}
      {children}
    </div>
  )
}

export const Route = createFileRoute('/setup')({ component: Setup })
