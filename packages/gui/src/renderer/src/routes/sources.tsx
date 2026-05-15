import type { AppStatus } from '@shared/ipc.ts'
import { createFileRoute } from '@tanstack/react-router'
import { useAtomValue, useSetAtom } from 'jotai'
import {
  Activity,
  CloudUpload,
  ExternalLink,
  Mountain,
  RefreshCcw,
  Send,
  SlidersHorizontal,
  Unlink,
  Watch,
  Zap,
} from 'lucide-react'
import { useState } from 'react'
import { SectionHeading } from '@/components/SectionHeading'
import { StatusDot } from '@/components/StatusDot'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import {
  resetSourcePanelVisibilityAtom,
  SourcePanelIds,
  setSourcePanelVisibleAtom,
  sourcePanelOptions,
  sourcePanelVisibilityAtom,
} from '@/state/sources'
import { refreshStatusAtom, statusAtom } from '@/state/status'

const IMPORT_KIND_LABEL: Record<string, string> = {
  imported: '已导入',
  'skipped-already-imported': '已导入过',
  'skipped-duplicate': 'Garmin 已存在',
  error: '错误',
}

function Sources() {
  const status = useAtomValue(statusAtom)
  const refresh = useSetAtom(refreshStatusAtom)
  const visibility = useAtomValue(sourcePanelVisibilityAtom)
  if (!status) return null
  const visibleCount = sourcePanelOptions.filter((option) => visibility[option.id]).length

  return (
    <div className="space-y-10">
      <SectionHeading
        index="01"
        title="数据源"
        subtitle="连接输入端与上传目标。Onelap 提供骑行文件，Strava、高驰与 Garmin 负责接收，Intervals.icu 只读取训练负荷。"
        action={<SourcePanelVisibilityMenu status={status} visibleCount={visibleCount} />}
      />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        {visibility[SourcePanelIds.strava] ? (
          <StravaPanel
            connected={status.stravaConnected}
            athleteId={status.stravaAthleteId}
            onChange={refresh}
          />
        ) : null}
        {visibility[SourcePanelIds.onelap] ? (
          <OnelapPanel
            connected={status.onelapConnected}
            account={status.onelapAccount}
            onChange={refresh}
          />
        ) : null}
        {visibility[SourcePanelIds.intervals] ? (
          <IntervalsPanel connected={status.intervalsConnected} onChange={refresh} />
        ) : null}
        {visibility[SourcePanelIds.coros] ? (
          <CorosPanel
            connected={status.corosConnected}
            userId={status.corosUserId}
            onChange={refresh}
          />
        ) : null}
        {visibility[SourcePanelIds.garmin] ? (
          <GarminPanel
            connected={status.garminConnected}
            displayName={status.garminDisplayName}
            connectedDomain={status.garminDomain}
            trainingPlanSyncAvailable={status.garminTrainingPlanSyncAvailable}
            onChange={refresh}
          />
        ) : null}
      </div>
      {visibleCount === 0 ? <SourcePanelEmptyState /> : null}
    </div>
  )
}

function SourcePanelVisibilityMenu({
  status,
  visibleCount,
}: {
  status: AppStatus
  visibleCount: number
}) {
  const visibility = useAtomValue(sourcePanelVisibilityAtom)
  const setVisible = useSetAtom(setSourcePanelVisibleAtom)
  const resetVisibility = useSetAtom(resetSourcePanelVisibilityAtom)
  const connectedByPanel = {
    [SourcePanelIds.strava]: status.stravaConnected,
    [SourcePanelIds.onelap]: status.onelapConnected,
    [SourcePanelIds.intervals]: status.intervalsConnected,
    [SourcePanelIds.coros]: status.corosConnected,
    [SourcePanelIds.garmin]: status.garminConnected,
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="min-w-40 justify-between">
          <SlidersHorizontal className="size-4" />
          显示项
          <span className="font-mono text-micro text-fg-subtle">
            {visibleCount}/{sourcePanelOptions.length}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>面板显示</DropdownMenuLabel>
        {sourcePanelOptions.map((option) => (
          <DropdownMenuCheckboxItem
            key={option.id}
            checked={visibility[option.id]}
            onCheckedChange={(checked) => setVisible(option.id, checked === true)}
            onSelect={(event) => event.preventDefault()}
          >
            <span>{option.label}</span>
            <StatusDot
              tone={connectedByPanel[option.id] ? 'success' : 'idle'}
              className="ml-auto"
            />
          </DropdownMenuCheckboxItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => resetVisibility()}>
          <RefreshCcw className="mr-2 size-4" />
          全部显示
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function SourcePanelEmptyState() {
  const resetVisibility = useSetAtom(resetSourcePanelVisibilityAtom)

  return (
    <div className="rounded-lg border border-dashed border-border bg-surface px-6 py-10 text-center">
      <p className="font-display text-2xl uppercase tracking-wide text-fg">没有显示的面板</p>
      <p className="mt-2 text-sm text-fg-muted">打开右上角“显示项”，或直接恢复全部数据源面板。</p>
      <Button variant="outline" className="mt-5" onClick={() => resetVisibility()}>
        <RefreshCcw className="size-4" />
        全部显示
      </Button>
    </div>
  )
}

function PanelChrome({
  number,
  brand,
  tag,
  connected,
  pill,
  action,
  children,
}: {
  number: string
  brand: string
  tag: string
  connected: boolean
  pill: string
  action?: React.ReactNode
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
          {action}
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

        <p className="text-sm text-fg-muted">
          Strava 仍走官方 OAuth。完成一次授权后，Onelap 和文件夹同步都会走这条链路。
        </p>

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

function IntervalsPanel({
  connected,
  onChange,
}: {
  connected: boolean
  onChange: () => Promise<void>
}) {
  const [apiKey, setApiKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  async function onSubmit(e: React.SyntheticEvent) {
    e.preventDefault()
    setBusy(true)
    setMsg(null)
    const res = await api.authIntervals({ apiKey })
    setBusy(false)
    if (!res.ok) {
      setMsg({ kind: 'err', text: res.error.message })
      return
    }
    setApiKey('')
    setMsg({ kind: 'ok', text: '已保存并读取到训练负荷数据' })
    await onChange()
  }

  return (
    <PanelChrome
      number="01.C"
      brand="INTERVALS.ICU"
      tag="只读 · 训练负荷"
      connected={connected}
      pill={connected ? '已连接' : '未连接'}
    >
      <form className="space-y-5" onSubmit={onSubmit}>
        <div className="grid grid-cols-2 gap-3">
          <Datum label="指标">
            <span className="font-mono text-xs text-fg">CTL / ATL / TSB</span>
          </Datum>
          <Datum label="来源">
            <span className="font-mono text-xs text-fg">wellness API</span>
          </Datum>
        </div>

        <Field id="intervals-api-key" label="API Key">
          <Input
            id="intervals-api-key"
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="Intervals.icu Developer Settings"
            required
            autoComplete="off"
          />
        </Field>

        {msg ? (
          <Alert variant={msg.kind === 'ok' ? 'success' : 'destructive'}>
            <AlertDescription>{msg.text}</AlertDescription>
          </Alert>
        ) : null}

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={busy}>
            <Activity className="size-4" />
            {busy ? '读取中…' : connected ? '更新 API Key' : '连接 Intervals'}
          </Button>
          <a
            href="https://intervals.icu/settings"
            target="_blank"
            rel="noreferrer"
            className="font-mono text-xs text-fg-muted hover:text-accent"
          >
            Developer Settings <ExternalLink className="ml-0.5 inline size-3" />
          </a>
        </div>
      </form>
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

function CorosPanel({
  connected,
  userId,
  onChange,
}: {
  connected: boolean
  userId?: string
  onChange: () => Promise<void>
}) {
  const [corosUserId, setCorosUserId] = useState('')
  const [accessToken, setAccessToken] = useState('')
  const [cookie, setCookie] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [corosBusy, setCorosBusy] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [errors, setErrors] = useState<string[]>([])
  const refresh = useSetAtom(refreshStatusAtom)
  const status = useAtomValue(statusAtom)

  async function onSubmit(e: React.SyntheticEvent) {
    e.preventDefault()
    setBusy(true)
    setMsg(null)
    const res = await api.authCoros({
      userId: corosUserId,
      accessToken,
      regionId: 2,
      cookie,
    })
    setBusy(false)
    if (!res.ok) {
      setMsg({ kind: 'err', text: res.error.message })
      return
    }
    setAccessToken('')
    setCookie('')
    setMsg({ kind: 'ok', text: '已连接高驰，可以一键导入 Onelap 到 COROS' })
    await onChange()
  }

  async function importCorosNow() {
    setCorosBusy(true)
    setFeedback(null)
    setErrors([])
    const res = await api.syncOnelapToCoros()
    setCorosBusy(false)
    if (!res.ok) {
      setFeedback(res.error.message)
      return
    }
    const counts = res.value.reduce<Record<string, number>>((acc, o) => {
      acc[o.kind] = (acc[o.kind] ?? 0) + 1
      return acc
    }, {})
    const summary = Object.entries(counts)
      .map(([k, v]) => `${IMPORT_KIND_LABEL[k] ?? k} ${v}`)
      .join(' · ')
    setFeedback(summary || '没有新活动')
    const errorMessages = res.value
      .filter((o): o is Extract<typeof o, { kind: 'error' }> => o.kind === 'error')
      .map((o) => `${o.key ?? '未知活动'}：${o.error.message}`)
    setErrors(errorMessages)
    await refresh()
  }

  return (
    <PanelChrome
      number="01.D"
      brand="COROS"
      tag="高驰 · Training Hub"
      connected={connected}
      pill={connected ? '已连接' : '未连接'}
    >
      <form className="space-y-5" onSubmit={onSubmit}>
        <div className="grid grid-cols-2 gap-3">
          <Datum label="区域">
            <span className="font-mono text-xs text-fg">中国区</span>
          </Datum>
          <Datum label="用户">
            <span className="font-mono text-xs text-fg">{userId ?? '—'}</span>
          </Datum>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field id="coros-user-id" label="User ID">
            <Input
              id="coros-user-id"
              value={corosUserId}
              onChange={(e) => setCorosUserId(e.target.value)}
              placeholder="Training Hub 用户 ID"
              required
              autoComplete="off"
            />
          </Field>
          <Field id="coros-access-token" label="Access Token">
            <Input
              id="coros-access-token"
              type="password"
              value={accessToken}
              onChange={(e) => setAccessToken(e.target.value)}
              placeholder="cookie 里 CPL-coros-token= 后面的值"
              required
              autoComplete="off"
            />
          </Field>
        </div>

        <Field id="coros-cookie" label="完整 Cookie">
          <Input
            id="coros-cookie"
            value={cookie}
            onChange={(e) => setCookie(e.target.value)}
            placeholder="t.coros.com 任意请求里 cookie header 的完整内容"
            required
            autoComplete="off"
          />
        </Field>

        <p className="text-sm text-fg-muted">
          打开 t.coros.com，DevTools → Network 任挑一条 teamcnapi.coros.com 请求， 复制 Request
          Headers 里 cookie 整段（含 _c_WBKFRo / CPL-coros-token 等）。 STS 端点要校验 session
          cookie，缺失会 401。
        </p>

        {msg ? (
          <Alert variant={msg.kind === 'ok' ? 'success' : 'destructive'}>
            <AlertDescription>{msg.text}</AlertDescription>
          </Alert>
        ) : null}

        {feedback ? (
          <div className="rounded-md border border-border bg-surface px-4 py-2.5 text-sm">
            <span className="ml-3 text-fg">{feedback}</span>
          </div>
        ) : null}

        {errors.length > 0 ? (
          <Alert variant="destructive">
            <AlertDescription>
              <div className="space-y-1">
                <div className="font-medium">失败明细</div>
                <ul className="list-disc space-y-1 pl-4 font-mono text-xs">
                  {errors.slice(0, 5).map((msg) => (
                    <li key={msg} className="break-all">
                      {msg}
                    </li>
                  ))}
                  {errors.length > 5 ? (
                    <li className="text-fg-muted">
                      …以及另外 {errors.length - 5} 条，详情见 app.log
                    </li>
                  ) : null}
                </ul>
              </div>
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="flex items-center gap-4">
          <Button type="submit" disabled={busy}>
            <CloudUpload className="size-4" />
            {busy ? '校验中…' : connected ? '更新高驰登录态' : '连接高驰'}
          </Button>
          <Button
            onClick={importCorosNow}
            disabled={corosBusy || !status?.corosManualSyncAvailable}
            variant="outline"
            className="group min-w-40"
          >
            {corosBusy ? (
              <>
                <RefreshCcw className="size-4 animate-spin" />
                导入中
              </>
            ) : (
              <>
                <CloudUpload className="size-4" />
                导入高驰
              </>
            )}
          </Button>
        </div>
      </form>
    </PanelChrome>
  )
}

function GarminPanel({
  connected,
  displayName,
  connectedDomain,
  trainingPlanSyncAvailable,
  onChange,
}: {
  connected: boolean
  displayName?: string
  connectedDomain?: 'garmin.cn' | 'garmin.com'
  trainingPlanSyncAvailable: boolean
  onChange: () => Promise<void>
}) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mfaCode, setMfaCode] = useState('')
  const [domain, setDomain] = useState<'garmin.cn' | 'garmin.com'>('garmin.cn')
  const [needsMfa, setNeedsMfa] = useState(false)
  const [busy, setBusy] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [garminBusy, setGarminBusy] = useState(false)
  const [garminPlanBusy, setGarminPlanBusy] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [errors, setErrors] = useState<string[]>([])
  const refresh = useSetAtom(refreshStatusAtom)
  const status = useAtomValue(statusAtom)

  async function onSubmit(e: React.SyntheticEvent) {
    e.preventDefault()
    setBusy(true)
    setMsg(null)
    const res = await api.authGarmin({
      email,
      password,
      domain,
      ...(mfaCode ? { mfaCode } : {}),
    })
    setBusy(false)
    if (!res.ok) {
      setMsg({ kind: 'err', text: res.error.message })
      return
    }
    if (res.value.mfaRequired) {
      setNeedsMfa(true)
      setMsg({ kind: 'ok', text: '已发送验证码，填入验证码后再点一次连接' })
      return
    }
    setPassword('')
    setMfaCode('')
    setNeedsMfa(false)
    setMsg({ kind: 'ok', text: '已连接 Garmin，可以一键导入 Onelap 活动' })
    await onChange()
  }

  async function importGarminNow() {
    setGarminBusy(true)
    setFeedback(null)
    setErrors([])
    const res = await api.syncOnelapToGarmin()
    setGarminBusy(false)
    if (!res.ok) {
      setFeedback(res.error.message)
      return
    }
    const counts = res.value.reduce<Record<string, number>>((acc, o) => {
      acc[o.kind] = (acc[o.kind] ?? 0) + 1
      return acc
    }, {})
    const summary = Object.entries(counts)
      .map(([k, v]) => `${IMPORT_KIND_LABEL[k] ?? k} ${v}`)
      .join(' · ')
    setFeedback(summary || '没有新活动')
    const errorMessages = res.value
      .filter((o): o is Extract<typeof o, { kind: 'error' }> => o.kind === 'error')
      .map((o) => `${o.key ?? '未知活动'}：${o.error.message}`)
    setErrors(errorMessages)
    await refresh()
  }

  async function syncGarminTrainingPlanNow() {
    setGarminPlanBusy(true)
    setFeedback(null)
    setErrors([])
    const overview = await api.trainingPlan()
    if (!overview.ok) {
      setGarminPlanBusy(false)
      setFeedback(overview.error.message)
      return
    }
    if (overview.value.workouts.length === 0) {
      setGarminPlanBusy(false)
      setFeedback('训练计划里还没有课程')
      return
    }
    if (
      !window.confirm(
        `将本地计划里的 ${overview.value.workouts.length} 节训练课程同步到 Garmin 中国区？`,
      )
    ) {
      setGarminPlanBusy(false)
      return
    }
    const res = await api.syncTrainingPlanToGarmin({ planId: overview.value.plan.id })
    setGarminPlanBusy(false)
    if (!res.ok) {
      setFeedback(res.error.message)
      return
    }
    const { result } = res.value
    setFeedback(`已同步 ${result.created}/${result.attempted} 节训练课程到 Garmin`)
    const errorMessages = result.workouts
      .filter((workout) => workout.error)
      .map((workout) => `${workout.name}（${workout.date}）：${workout.error}`)
    setErrors(errorMessages)
    await refresh()
  }

  async function disconnectGarmin() {
    if (!window.confirm('断开当前 Garmin 登录态？之后可以重新选择中国区或国际区连接。')) return
    setDisconnecting(true)
    setMsg(null)
    setFeedback(null)
    setErrors([])
    try {
      const res = await api.disconnectGarmin()
      if (!res.ok) {
        setMsg({ kind: 'err', text: res.error.message })
        return
      }
      setPassword('')
      setMfaCode('')
      setNeedsMfa(false)
      setMsg({ kind: 'ok', text: '已断开 Garmin，可以重新选择区域连接' })
      await refresh()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setMsg({ kind: 'err', text: message })
    } finally {
      setDisconnecting(false)
    }
  }

  return (
    <PanelChrome
      number="01.E"
      brand="GARMIN"
      tag="佳明 · Connect"
      connected={connected}
      pill={connected ? '已连接' : '未连接'}
      action={
        connected ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={disconnectGarmin}
            disabled={busy || disconnecting || garminBusy || garminPlanBusy}
            className="text-fg-muted hover:text-danger"
          >
            {disconnecting ? (
              <RefreshCcw className="size-4 animate-spin" />
            ) : (
              <Unlink className="size-4" />
            )}
            {disconnecting ? '解绑中' : '解绑'}
          </Button>
        ) : null
      }
    >
      <form className="space-y-5" onSubmit={onSubmit}>
        <div className="grid grid-cols-2 gap-3">
          <Datum label="区域">
            <Select
              value={connectedDomain ?? domain}
              onValueChange={(value) => setDomain(value as 'garmin.cn' | 'garmin.com')}
              disabled={connected}
            >
              <SelectTrigger className="font-mono text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="garmin.cn">中国区</SelectItem>
                <SelectItem value="garmin.com">国际区</SelectItem>
              </SelectContent>
            </Select>
          </Datum>
          <Datum label="账号">
            <span className="font-mono text-xs text-fg">{displayName ?? '—'}</span>
          </Datum>
        </div>
        {connectedDomain ? (
          <p className="font-mono text-micro uppercase tracking-stamp text-fg-subtle">
            当前登录态：{connectedDomain === 'garmin.cn' ? '中国区 Garmin' : '国际区 Garmin'}
          </p>
        ) : null}

        <div className="grid grid-cols-2 gap-4">
          <Field id="garmin-email" label="账号">
            <Input
              id="garmin-email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Garmin 登录邮箱"
              required
              autoComplete="username"
            />
          </Field>
          <Field id="garmin-password" label="密码">
            <Input
              id="garmin-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </Field>
        </div>

        {needsMfa ? (
          <Field id="garmin-mfa" label="验证码">
            <Input
              id="garmin-mfa"
              value={mfaCode}
              onChange={(e) => setMfaCode(e.target.value)}
              placeholder="邮箱或短信收到的验证码"
              autoComplete="one-time-code"
            />
          </Field>
        ) : null}

        <p className="text-sm text-fg-muted">
          连接成功后只保存 Garmin 登录态，不保存密码。导入会把 Onelap 的 FIT 文件写入 Garmin Connect
          活动列表。
        </p>

        {msg ? (
          <Alert variant={msg.kind === 'ok' ? 'success' : 'destructive'}>
            <AlertDescription>{msg.text}</AlertDescription>
          </Alert>
        ) : null}

        {feedback ? (
          <div className="rounded-md border border-border bg-surface px-4 py-2.5 text-sm">
            <span className="ml-3 text-fg">{feedback}</span>
          </div>
        ) : null}

        {errors.length > 0 ? (
          <Alert variant="destructive">
            <AlertDescription>
              <div className="space-y-1">
                <div className="font-medium">导入失败的活动</div>
                <ul className="list-disc space-y-1 pl-4 font-mono text-xs">
                  {errors.slice(0, 5).map((msg) => (
                    <li key={msg} className="break-all">
                      {msg}
                    </li>
                  ))}
                  {errors.length > 5 ? (
                    <li className="text-fg-muted">
                      …以及另外 {errors.length - 5} 条，详情见 app.log
                    </li>
                  ) : null}
                </ul>
              </div>
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="flex items-center gap-4">
          <Button type="submit" disabled={busy}>
            <Watch className="size-4" />
            {busy ? '连接中…' : connected ? '更新 Garmin 登录态' : '连接 Garmin'}
          </Button>
          <Button
            type="button"
            onClick={importGarminNow}
            disabled={garminBusy || !status?.garminManualSyncAvailable}
            variant="outline"
            className="group min-w-40"
          >
            {garminBusy ? (
              <>
                <RefreshCcw className="size-4 animate-spin" />
                导入中
              </>
            ) : (
              <>
                <CloudUpload className="size-4" />
                导入 Garmin
              </>
            )}
          </Button>
          {connected && trainingPlanSyncAvailable ? (
            <Button
              type="button"
              onClick={syncGarminTrainingPlanNow}
              disabled={garminPlanBusy}
              variant="outline"
              className="group min-w-40"
            >
              {garminPlanBusy ? (
                <>
                  <RefreshCcw className="size-4 animate-spin" />
                  同步中
                </>
              ) : (
                <>
                  <Send className="size-4" />
                  同步课程
                </>
              )}
            </Button>
          ) : null}
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
