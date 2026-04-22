import { createFileRoute } from '@tanstack/react-router'
import { useAtomValue, useSetAtom } from 'jotai'
import { ExternalLink, Mountain, Zap } from 'lucide-react'
import { useState } from 'react'
import { SectionHeading } from '@/components/SectionHeading'
import { StatusDot } from '@/components/StatusDot'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { refreshStatusAtom, statusAtom } from '@/state/atoms'

function Sources() {
  const status = useAtomValue(statusAtom)
  const refresh = useSetAtom(refreshStatusAtom)
  if (!status) return null

  return (
    <div className="space-y-10">
      <SectionHeading
        index="01"
        title="数据源"
        subtitle="授权数据来源 · 工具不会把你的密码发给任何第三方。"
      />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <StravaPanel
          connected={status.stravaConnected}
          athleteId={status.stravaAthleteId}
          onChange={refresh}
        />
        <OnelapPanel
          connected={status.onelapConnected}
          account={status.onelapAccount}
          onChange={refresh}
        />
      </div>
    </div>
  )
}

function PanelChrome({
  number,
  brand,
  tag,
  connected,
  pill,
  children,
}: {
  number: string
  brand: string
  tag: string
  connected: boolean
  pill: string
  children: React.ReactNode
}) {
  return (
    <section
      className={cn(
        'relative overflow-hidden rounded-lg border bg-surface',
        connected ? 'border-border-strong' : 'border-border',
      )}
    >
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <div className="flex items-baseline gap-3">
          <span className="font-mono text-micro text-accent">{number}</span>
          <h2 className="font-display text-2xl uppercase leading-none text-fg">{brand}</h2>
          <span className="font-mono text-micro uppercase tracking-wider text-fg-subtle">
            {tag}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <StatusDot tone={connected ? 'success' : 'idle'} />
          <Badge variant={connected ? 'success' : 'outline'} className="font-mono text-micro">
            {pill}
          </Badge>
        </div>
      </div>
      <div className="p-6">{children}</div>
    </section>
  )
}

function StravaPanel({
  connected,
  athleteId,
  onChange,
}: {
  connected: boolean
  athleteId?: number
  onChange: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function authorize() {
    setBusy(true)
    setErr(null)
    const res = await api.authStrava()
    setBusy(false)
    if (!res.ok) {
      setErr(res.error.message)
      return
    }
    await onChange()
  }

  return (
    <PanelChrome
      number="01.A"
      brand="STRAVA"
      tag="官方 · OAuth"
      connected={connected}
      pill={connected ? '已连接' : '未连接'}
    >
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-3">
          <Datum label="运动员">
            <span className="font-mono tabular text-fg">{athleteId ?? '—'}</span>
          </Datum>
          <Datum label="权限">
            <span className="font-mono text-xs text-fg">activity:write</span>
          </Datum>
        </div>

        <p className="text-sm text-fg-muted">点击下方按钮，在浏览器中完成 Strava 授权即可。</p>

        {err ? (
          <Alert variant="destructive">
            <AlertDescription>{err}</AlertDescription>
          </Alert>
        ) : null}

        <div className="flex items-center gap-3">
          <Button onClick={authorize} disabled={busy} className="group">
            <Zap className="size-4" />
            {busy ? '等待回调…' : connected ? '重新授权' : '授权 Strava'}
          </Button>
          <a
            href="https://www.strava.com/settings/api"
            target="_blank"
            rel="noreferrer"
            className="font-mono text-xs text-fg-muted hover:text-accent"
          >
            Strava App 设置 <ExternalLink className="ml-0.5 inline size-3" />
          </a>
        </div>
      </div>
    </PanelChrome>
  )
}

function OnelapPanel({
  connected,
  account,
  onChange,
}: {
  connected: boolean
  account?: string
  onChange: () => Promise<void>
}) {
  const [a, setA] = useState('')
  const [p, setP] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  async function onSubmit(e: React.SyntheticEvent) {
    e.preventDefault()
    setBusy(true)
    setMsg(null)
    const res = await api.authOnelap({ account: a, password: p })
    setBusy(false)
    if (!res.ok) {
      setMsg({ kind: 'err', text: res.error.message })
      return
    }
    setMsg({ kind: 'ok', text: '已保存并通过登录验证' })
    setP('')
    await onChange()
  }

  return (
    <PanelChrome
      number="01.B"
      brand="ONELAP"
      tag="社区接口 · 顽鹿"
      connected={connected}
      pill={connected ? '已连接' : '未连接'}
    >
      <form className="space-y-5" onSubmit={onSubmit}>
        {connected ? (
          <Datum label="账号">
            <span className="font-mono text-fg">{account}</span>
          </Datum>
        ) : null}

        <div className="grid grid-cols-2 gap-4">
          <Field id="onelap-account" label="账号">
            <Input
              id="onelap-account"
              value={a}
              onChange={(e) => setA(e.target.value)}
              placeholder="手机号 / 邮箱"
              required
              autoComplete="off"
            />
          </Field>
          <Field id="onelap-password" label="密码">
            <Input
              id="onelap-password"
              type="password"
              value={p}
              onChange={(e) => setP(e.target.value)}
              required
              autoComplete="off"
            />
          </Field>
        </div>

        {msg ? (
          <Alert variant={msg.kind === 'ok' ? 'success' : 'destructive'}>
            <AlertDescription>{msg.text}</AlertDescription>
          </Alert>
        ) : null}

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={busy}>
            <Mountain className="size-4" />
            {busy ? '验证中…' : connected ? '更新账号' : '保存并登录'}
          </Button>
          <span className="font-mono text-micro uppercase tracking-wider text-fg-subtle">
            * 接口为社区已知，仅供个人使用
          </span>
        </div>
      </form>
    </PanelChrome>
  )
}

function Datum({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border bg-bg/40 px-3 py-2">
      <p className="font-mono text-micro uppercase tracking-stamp-mono text-fg-subtle">{label}</p>
      <div className="mt-1 text-sm">{children}</div>
    </div>
  )
}

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id} className="font-display text-mini uppercase tracking-stamp text-fg-muted">
        {label}
      </Label>
      {children}
    </div>
  )
}

export const Route = createFileRoute('/sources')({ component: Sources })
