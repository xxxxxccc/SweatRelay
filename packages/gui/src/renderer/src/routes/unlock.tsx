import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useSetAtom } from 'jotai'
import { ArrowRight, LockKeyhole } from 'lucide-react'
import { useState } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api } from '@/lib/api'
import { statusAtom } from '@/state/atoms'

function Unlock() {
  const router = useRouter()
  const setStatus = useSetAtom(statusAtom)
  const [passphrase, setPassphrase] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(event: React.SyntheticEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    const result = await api.unlock({ passphrase })
    setBusy(false)
    if (!result.ok) {
      setError(result.error.message)
      return
    }
    setStatus(result.value)
    router.navigate({ to: '/' })
  }

  return (
    <div className="grid w-full max-w-4xl grid-cols-[280px_1fr] gap-16">
      <aside className="border-l border-border pl-6">
        <p className="mb-1 font-mono text-micro uppercase tracking-stamp-mono text-accent">
          已保存配置
        </p>
        <h2 className="mb-6 font-display text-3xl uppercase leading-none text-fg">
          只差
          <br />
          解锁
        </h2>
        <p className="max-w-[220px] text-sm text-fg-muted">
          你的 Strava / Onelap
          凭证已经保存在本机。这次不需要重新配置，只要输入本地加密密码即可恢复运行态。
        </p>
      </aside>

      <div className="max-w-md">
        <p className="mb-2 font-mono text-micro uppercase tracking-stamp-mono text-fg-muted">
          本地恢复
        </p>
        <h1 className="mb-2 font-display text-5xl uppercase leading-none text-fg">
          解锁
          <br />
          凭证
        </h1>
        <p className="mb-6 text-sm text-fg-muted">
          当前检测到已有加密凭证文件，但本次启动尚未解锁。输入你之前设置的本地密码即可继续。
        </p>

        <form className="space-y-6" onSubmit={onSubmit}>
          <div className="space-y-2">
            <Label
              htmlFor="unlock-passphrase"
              className="font-display text-mini uppercase tracking-stamp text-fg-muted"
            >
              本地加密密码
            </Label>
            <Input
              id="unlock-passphrase"
              type="password"
              value={passphrase}
              onChange={(event) => setPassphrase(event.target.value)}
              autoFocus
              required
              placeholder="输入之前设置的本地密码"
            />
          </div>

          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <Button type="submit" disabled={busy} size="lg" className="group w-full">
            {busy ? (
              '正在解锁…'
            ) : (
              <>
                <LockKeyhole className="size-4" />
                解锁并进入控制台
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
              </>
            )}
          </Button>
        </form>
      </div>
    </div>
  )
}

export const Route = createFileRoute('/unlock')({ component: Unlock })
