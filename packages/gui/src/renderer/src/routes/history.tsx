import { createFileRoute } from '@tanstack/react-router'
import { useAtomValue } from 'jotai'
import { ArrowUpRight, History as HistoryIcon } from 'lucide-react'
import { useMemo, useState } from 'react'
import { SectionHeading } from '@/components/SectionHeading'
import { StatusDot } from '@/components/StatusDot'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { statusAtom } from '@/state/atoms'

const SOURCE_LABELS: Record<string, string> = {
  onelap: 'Onelap',
  'onelap-folder': 'Onelap · Folder',
  'magene-folder': 'Magene',
  'blackbird-folder': 'Blackbird',
  folder: 'Folder',
}

function History() {
  const status = useAtomValue(statusAtom)
  const [filter, setFilter] = useState('')
  const records = status?.recentSyncs ?? []

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return records
    return records.filter(
      (r) =>
        r.key.toLowerCase().includes(q) ||
        r.source.toLowerCase().includes(q) ||
        (r.activityUrl ?? '').toLowerCase().includes(q),
    )
  }, [records, filter])

  return (
    <div className="space-y-8">
      <SectionHeading
        index="03"
        title="历史"
        subtitle="所有同步记录 · 最多展示 50 条"
        action={
          <div className="flex items-center gap-3">
            <Input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="搜索来源 / 标识 / 链接…"
              className="h-9 w-64 font-mono text-xs"
            />
            <span className="font-mono text-micro uppercase tracking-wider text-fg-muted">
              <span className="tabular text-fg">{filtered.length}</span>
              {filter ? ` / ${records.length}` : null}
            </span>
          </div>
        }
      />

      {records.length === 0 ? (
        <EmptyHistory />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-surface">
          <ScrollArea className="h-[calc(100vh-260px)]">
            <Table>
              <TableHeader className="sticky top-0 bg-surface">
                <TableRow>
                  <TableHead className="w-44">时间</TableHead>
                  <TableHead className="w-40">来源</TableHead>
                  <TableHead>标识</TableHead>
                  <TableHead className="w-24 text-center">状态</TableHead>
                  <TableHead className="w-32 text-right">活动</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r) => (
                  <TableRow key={r.key}>
                    <TableCell className="font-mono text-xs tabular text-fg-muted">
                      {formatFullTime(r.syncedAt)}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="font-display tracking-wide">
                        {SOURCE_LABELS[r.source] ?? r.source}
                      </Badge>
                    </TableCell>
                    <TableCell
                      className="max-w-0 truncate font-mono text-xs text-fg-muted"
                      title={r.key}
                    >
                      {r.key}
                    </TableCell>
                    <TableCell className="text-center">
                      <span className="inline-flex items-center justify-center">
                        <StatusDot tone="success" />
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      {r.activityUrl ? (
                        <a
                          href={r.activityUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 font-mono text-xs text-accent hover:underline"
                        >
                          {r.activityId ?? '打开'}
                          <ArrowUpRight className="size-3" />
                        </a>
                      ) : (
                        <span className="font-mono text-xs text-fg-subtle">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>
        </div>
      )}
    </div>
  )
}

function EmptyHistory() {
  return (
    <div className="flex flex-col items-center gap-3 rounded-md border border-dashed border-border px-5 py-20 text-sm text-fg-muted">
      <HistoryIcon className="size-8 text-fg-subtle" />
      <p className="font-display text-2xl uppercase tracking-wider text-fg">还没有同步</p>
      <p>同步过的活动会出现在这里。</p>
    </div>
  )
}

function formatFullTime(iso: string): string {
  const d = new Date(iso)
  const yyyy = d.getFullYear()
  const mm = (d.getMonth() + 1).toString().padStart(2, '0')
  const dd = d.getDate().toString().padStart(2, '0')
  const hh = d.getHours().toString().padStart(2, '0')
  const mi = d.getMinutes().toString().padStart(2, '0')
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`
}

export const Route = createFileRoute('/history')({ component: History })
