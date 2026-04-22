import { createFileRoute } from '@tanstack/react-router'
import { useAtomValue } from 'jotai'
import { FolderCog, Info, Palette } from 'lucide-react'
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
      <SectionHeading index="04" title="设置" subtitle="外观、存储路径、关于。" />

      <Accordion
        type="multiple"
        defaultValue={['theme', 'storage']}
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
                跟随系统、强制浅色或深色。设置会持久化到本机。
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
              <p className="text-sm text-fg-muted">所有数据都加密保存在本机的以下目录。</p>
              <code className="block rounded-md border border-border bg-bg/50 px-3 py-2 font-mono text-xs text-fg break-all">
                {status.configDir}
              </code>
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
                <span className="ml-2 font-mono text-xs">v0.3.0-dev</span>
              </p>
              <p>把国内不支持 Strava 同步的骑行平台，自动同步到 Strava。</p>
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

export const Route = createFileRoute('/settings')({ component: Settings })
