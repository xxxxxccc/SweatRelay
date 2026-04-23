import { createFileRoute } from '@tanstack/react-router'
import { useAtomValue } from 'jotai'
import { FolderCog, Globe, Info, Palette, ShieldCheck } from 'lucide-react'
import { SectionHeading } from '@/components/SectionHeading'
import { ThemeToggle } from '@/components/ThemeToggle'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { statusAtom } from '@/state/atoms'

function Settings() {
  const status = useAtomValue(statusAtom)
  if (!status) return null

  return (
    <div className="space-y-8">
      <SectionHeading index="04" title="设置" subtitle="外观、本地存储、外部服务入口和运行诊断。" />

      <Accordion
        type="multiple"
        defaultValue={['theme', 'storage', 'external', 'diagnostics']}
        className="rounded-lg border border-border bg-surface px-6"
      >
        <AccordionItem value="theme">
          <AccordionTrigger>
            <span className="flex items-center gap-3">
              <Palette className="size-4 text-fg-muted" />
              <span className="font-display text-base uppercase tracking-wider">外观</span>
            </span>
          </AccordionTrigger>
          <AccordionContent>
            <div className="space-y-3 pl-7">
              <p className="text-sm text-fg-muted">
                跟随系统、强制浅色或深色。这个设置只影响 GUI，本机持久化保存。
              </p>
              <ThemeToggle />
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="storage">
          <AccordionTrigger>
            <span className="flex items-center gap-3">
              <FolderCog className="size-4 text-fg-muted" />
              <span className="font-display text-base uppercase tracking-wider">本地存储</span>
            </span>
          </AccordionTrigger>
          <AccordionContent>
            <div className="space-y-3 pl-7">
              <p className="text-sm text-fg-muted">
                GUI 和 CLI
                共享同一套本地配置与凭证。环境变量只会覆盖运行时读取，不会替代这份持久化数据。
              </p>
              <code className="block rounded-md border border-border bg-bg/50 px-3 py-2 font-mono text-xs text-fg break-all">
                {status.configDir}
              </code>
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="external">
          <AccordionTrigger>
            <span className="flex items-center gap-3">
              <Globe className="size-4 text-fg-muted" />
              <span className="font-display text-base uppercase tracking-wider">外部服务</span>
            </span>
          </AccordionTrigger>
          <AccordionContent>
            <div className="space-y-4 pl-7">
              <p className="text-sm text-fg-muted">
                SweatRelay 的唯一原生目标端是 Strava。若你也使用 Intervals.icu，请在 Intervals.icu
                中连接 Strava，让活动经由 Strava 同步过去。
              </p>
              <div className="grid gap-3 sm:grid-cols-3">
                <ExternalLinkCard
                  href="https://www.strava.com/athlete/training"
                  label="打开 Strava"
                  desc="查看已上传活动"
                />
                <ExternalLinkCard
                  href="https://intervals.icu"
                  label="打开 Intervals.icu"
                  desc="进入训练分析平台"
                />
                <ExternalLinkCard
                  href="https://intervals.icu/settings"
                  label="去连接 Strava"
                  desc="在 Intervals.icu 侧完成授权"
                />
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="diagnostics">
          <AccordionTrigger>
            <span className="flex items-center gap-3">
              <ShieldCheck className="size-4 text-fg-muted" />
              <span className="font-display text-base uppercase tracking-wider">诊断</span>
            </span>
          </AccordionTrigger>
          <AccordionContent>
            <div className="grid gap-3 pl-7 sm:grid-cols-2">
              <DiagnosticItem
                label="OS Keyring 可用"
                value={yesNo(status.diagnostics.keyringAvailable)}
              />
              <DiagnosticItem
                label="creds.enc 已存在"
                value={yesNo(status.diagnostics.hasEncryptedCredentials)}
              />
              <DiagnosticItem
                label="Strava App 配置"
                value={yesNo(status.diagnostics.stravaConfigPresent)}
              />
              <DiagnosticItem
                label="Strava 已授权"
                value={yesNo(status.diagnostics.stravaTokensPresent)}
              />
              <DiagnosticItem
                label="Onelap 凭证"
                value={yesNo(status.diagnostics.onelapCredentialsPresent)}
              />
              <DiagnosticItem
                label="自动同步配置"
                value={yesNo(status.diagnostics.sharedConfigPresent)}
              />
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="about" className="border-b-0">
          <AccordionTrigger>
            <span className="flex items-center gap-3">
              <Info className="size-4 text-fg-muted" />
              <span className="font-display text-base uppercase tracking-wider">关于</span>
            </span>
          </AccordionTrigger>
          <AccordionContent>
            <div className="space-y-2 pl-7 text-sm text-fg-muted">
              <p>
                <span className="font-display uppercase tracking-wider text-fg">SweatRelay</span>
                <span className="ml-2 font-mono text-xs">v{status.appVersion}</span>
              </p>
              <p>同步控制台负责把 Onelap / 码表导出文件稳定送到 Strava。</p>
              <p>
                <a
                  href="https://github.com/xxxxxccc/SweatRelay"
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-xs text-accent hover:underline"
                >
                  github.com/xxxxxccc/SweatRelay ↗
                </a>
              </p>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  )
}

function ExternalLinkCard({ href, label, desc }: { href: string; label: string; desc: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="rounded-md border border-border bg-bg/40 px-4 py-3 transition-colors hover:border-border-strong"
    >
      <p className="font-display text-lg uppercase tracking-wide text-fg">{label}</p>
      <p className="mt-1 text-xs text-fg-muted">{desc}</p>
    </a>
  )
}

function DiagnosticItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-bg/40 px-3 py-3">
      <p className="font-mono text-micro uppercase tracking-stamp text-fg-subtle">{label}</p>
      <p className="mt-2 font-display text-xl uppercase text-fg">{value}</p>
    </div>
  )
}

function yesNo(value: boolean): string {
  return value ? '已就绪' : '未就绪'
}

export const Route = createFileRoute('/settings')({ component: Settings })
