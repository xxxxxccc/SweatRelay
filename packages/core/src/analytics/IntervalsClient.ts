import { SweatRelayError } from '../util/errors.ts'

const DEFAULT_ORIGIN = 'https://intervals.icu'
const DEFAULT_DAYS = 42
const DEFAULT_FORECAST_DAYS = 0

export const TrainingStatusLevels = {
  Good: 'good',
  Load: 'load',
  High: 'high',
  Recovery: 'recovery',
  Unknown: 'unknown',
} as const
export type TrainingStatusLevel = (typeof TrainingStatusLevels)[keyof typeof TrainingStatusLevels]

export const TrainingStatusReasonSeverities = {
  Info: 'info',
  Warning: 'warning',
  Danger: 'danger',
} as const
export type TrainingStatusReasonSeverity =
  (typeof TrainingStatusReasonSeverities)[keyof typeof TrainingStatusReasonSeverities]

export const TrainingStatusReasonSources = {
  Intervals: 'intervals',
  SweatRelay: 'sweatrelay',
} as const
export type TrainingStatusReasonSource =
  (typeof TrainingStatusReasonSources)[keyof typeof TrainingStatusReasonSources]

export interface IntervalsClientOptions {
  apiKey: string
  origin?: string
}

export interface IntervalsFetchFitnessOptions {
  days?: number
  forecastDays?: number
}

export interface IntervalsFitnessPoint {
  date: string
  ctl: number
  atl: number
  tsb: number
  rampRate?: number
  ctlLoad?: number
  atlLoad?: number
}

export interface IntervalsFitnessSummary {
  athleteId: '0'
  days: number
  fetchedAt: string
  latest?: IntervalsFitnessPoint
  points: IntervalsFitnessPoint[]
  forecast?: IntervalsForecastSummary
}

export interface IntervalsForecastSummary {
  days: number
  startDate: string
  endDate: string
  events: IntervalsPlannedEvent[]
  points: IntervalsFitnessPoint[]
  totalPlannedLoad: number
  minTsb?: number
  maxAtl?: number
}

export interface IntervalsPlannedEvent {
  id?: number
  date: string
  name?: string
  type?: string
  category?: string
  trainingLoad?: number
  ctl?: number
  atl?: number
  tsb?: number
}

export interface TrainingStatusReason {
  id: string
  severity: TrainingStatusReasonSeverity
  source: TrainingStatusReasonSource
  metric: string
  value?: number
  threshold?: string
  title: string
  detail: string
}

export interface TrainingLoadAssessment {
  level: TrainingStatusLevel
  title: string
  summary: string
  reasons: TrainingStatusReason[]
  checkedAt: string
}

export interface IntervalsTrainingLoadReport {
  summary: IntervalsFitnessSummary
  assessment: TrainingLoadAssessment
}

export interface IntervalsCalendarEventUpsert {
  category: string
  start_date_local: string
  type?: string
  name?: string
  description?: string
  moving_time?: number
  target?: string
  icu_training_load?: number
  external_id?: string
}

export interface IntervalsCalendarEventResult {
  id?: number
  external_id?: string
  start_date_local?: string
  category?: string
  name?: string
  type?: string
}

interface WellnessRecord {
  id?: unknown
  ctl?: unknown
  atl?: unknown
  rampRate?: unknown
  ctlLoad?: unknown
  atlLoad?: unknown
}

interface EventRecord {
  id?: unknown
  start_date_local?: unknown
  icu_training_load?: unknown
  load_target?: unknown
  icu_ctl?: unknown
  icu_atl?: unknown
  name?: unknown
  type?: unknown
  category?: unknown
}

export class IntervalsClient {
  private readonly apiKey: string
  private readonly origin: string

  constructor(options: IntervalsClientOptions) {
    this.apiKey = options.apiKey.trim()
    if (!this.apiKey) throw new SweatRelayError('Intervals.icu API key is required')
    this.origin = options.origin ?? DEFAULT_ORIGIN
  }

  async fetchFitness(
    options: number | IntervalsFetchFitnessOptions = {},
  ): Promise<IntervalsFitnessSummary> {
    const days = typeof options === 'number' ? options : (options.days ?? DEFAULT_DAYS)
    const forecastDays =
      typeof options === 'number'
        ? DEFAULT_FORECAST_DAYS
        : (options.forecastDays ?? DEFAULT_FORECAST_DAYS)
    const clampedDays = Math.max(1, Math.min(Math.trunc(days), 365))
    const newest = localDate(new Date())
    const oldestDate = new Date()
    oldestDate.setDate(oldestDate.getDate() - clampedDays + 1)
    const oldest = localDate(oldestDate)
    const url = new URL('/api/v1/athlete/0/wellness', this.origin)
    url.searchParams.set('oldest', oldest)
    url.searchParams.set('newest', newest)
    url.searchParams.set('fields', 'id,ctl,atl,rampRate,ctlLoad,atlLoad')

    const records = await this.getJson<WellnessRecord[]>(url)
    if (!Array.isArray(records)) {
      throw new SweatRelayError('Intervals.icu wellness response was not an array')
    }

    const points = records
      .map(toFitnessPoint)
      .filter((point): point is IntervalsFitnessPoint => point !== null)
      .toSorted((a, b) => a.date.localeCompare(b.date))
    const latest = points.at(-1)
    const forecast =
      forecastDays > 0
        ? await this.fetchForecast(Math.max(1, Math.min(Math.trunc(forecastDays), 31)))
        : undefined

    return {
      athleteId: '0',
      days: clampedDays,
      fetchedAt: new Date().toISOString(),
      ...(latest ? { latest } : {}),
      points,
      ...(forecast ? { forecast } : {}),
    }
  }

  async fetchTrainingLoadReport(
    options: IntervalsFetchFitnessOptions = {},
  ): Promise<IntervalsTrainingLoadReport> {
    const summary = await this.fetchFitness(options)
    return {
      summary,
      assessment: assessTrainingLoad(summary),
    }
  }

  async upsertCalendarEvents(
    events: readonly IntervalsCalendarEventUpsert[],
  ): Promise<IntervalsCalendarEventResult[]> {
    const url = new URL('/api/v1/athlete/0/events/bulk', this.origin)
    url.searchParams.set('upsert', 'true')
    const records = await this.postJson<IntervalsCalendarEventResult[]>(url, events)
    if (!Array.isArray(records)) {
      throw new SweatRelayError('Intervals.icu calendar upsert response was not an array')
    }
    return records
  }

  private async fetchForecast(days: number): Promise<IntervalsForecastSummary> {
    const startDate = localDate(new Date())
    const end = new Date()
    end.setDate(end.getDate() + days - 1)
    const endDate = localDate(end)
    const url = new URL('/api/v1/athlete/0/events', this.origin)
    url.searchParams.set('oldest', startDate)
    url.searchParams.set('newest', endDate)
    url.searchParams.set('category', 'WORKOUT,RACE_A,RACE_B,RACE_C')

    const records = await this.getJson<EventRecord[]>(url)
    if (!Array.isArray(records)) {
      throw new SweatRelayError('Intervals.icu events response was not an array')
    }

    const events = records
      .map(toPlannedEvent)
      .filter((event): event is IntervalsPlannedEvent => event !== null)
      .toSorted((a, b) => a.date.localeCompare(b.date))
    const pointsByDate = new Map<string, IntervalsFitnessPoint>()
    for (const event of events) {
      if (event.ctl === undefined || event.atl === undefined) continue
      pointsByDate.set(event.date, {
        date: event.date,
        ctl: event.ctl,
        atl: event.atl,
        tsb: event.ctl - event.atl,
      })
    }
    const points = [...pointsByDate.values()].toSorted((a, b) => a.date.localeCompare(b.date))
    const totalPlannedLoad = events.reduce((total, event) => total + (event.trainingLoad ?? 0), 0)
    const minTsb = minOptional(points.map((point) => point.tsb))
    const maxAtl = maxOptional(points.map((point) => point.atl))

    return {
      days,
      startDate,
      endDate,
      events,
      points,
      totalPlannedLoad,
      ...(minTsb !== undefined ? { minTsb } : {}),
      ...(maxAtl !== undefined ? { maxAtl } : {}),
    }
  }

  private async getJson<T>(url: URL): Promise<T> {
    return this.requestJson<T>(url, { method: 'GET' })
  }

  private async postJson<T>(url: URL, body: unknown): Promise<T> {
    return this.requestJson<T>(url, {
      method: 'POST',
      body: JSON.stringify(body),
      contentType: 'application/json',
    })
  }

  private async requestJson<T>(
    url: URL,
    options: { method: 'GET' | 'POST'; body?: string; contentType?: string },
  ): Promise<T> {
    const res = await fetch(url, {
      method: options.method,
      headers: {
        accept: 'application/json',
        authorization: basicAuth(this.apiKey),
        ...(options.contentType ? { 'content-type': options.contentType } : {}),
      },
      ...(options.body !== undefined ? { body: options.body } : {}),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new SweatRelayError(
        `Intervals.icu request failed: ${res.status} ${res.statusText}${text ? ` (${text.slice(0, 160)})` : ''}`,
      )
    }
    return (await res.json()) as T
  }
}

export function assessTrainingLoad(summary: IntervalsFitnessSummary): TrainingLoadAssessment {
  const reasons: TrainingStatusReason[] = []
  const latest = summary.latest
  if (!latest) {
    return {
      level: TrainingStatusLevels.Unknown,
      title: '数据不足',
      summary: 'Intervals.icu 暂时没有返回可用于判断的 CTL / ATL 记录。',
      reasons: [
        {
          id: 'missing-latest',
          severity: TrainingStatusReasonSeverities.Info,
          source: TrainingStatusReasonSources.Intervals,
          metric: 'wellness',
          title: '没有最新训练负荷',
          detail: '需要至少一条包含 CTL 和 ATL 的 wellness 记录。',
        },
      ],
      checkedAt: new Date().toISOString(),
    }
  }

  addTsbReason(reasons, latest.tsb, 'current-tsb', '当前 TSB')
  addRampReason(reasons, latest.rampRate)
  addAtlPressureReason(reasons, latest)
  addForecastReasons(reasons, summary.forecast)

  const level = resolveLevel(latest, reasons)
  return {
    level,
    title: titleForLevel(level),
    summary: summaryForLevel(level, latest, summary.forecast),
    reasons: reasons.length > 0 ? reasons : [balancedReason(latest)],
    checkedAt: new Date().toISOString(),
  }
}

function toFitnessPoint(record: WellnessRecord): IntervalsFitnessPoint | null {
  const date = typeof record.id === 'string' ? record.id : null
  const ctl = toFiniteNumber(record.ctl)
  const atl = toFiniteNumber(record.atl)
  if (!date || ctl === null || atl === null) return null

  const rampRate = toFiniteNumber(record.rampRate)
  const ctlLoad = toFiniteNumber(record.ctlLoad)
  const atlLoad = toFiniteNumber(record.atlLoad)
  return {
    date,
    ctl,
    atl,
    tsb: ctl - atl,
    ...(rampRate !== null ? { rampRate } : {}),
    ...(ctlLoad !== null ? { ctlLoad } : {}),
    ...(atlLoad !== null ? { atlLoad } : {}),
  }
}

function toPlannedEvent(record: EventRecord): IntervalsPlannedEvent | null {
  const date = dateOnly(record.start_date_local)
  if (!date) return null
  const trainingLoad =
    toFiniteNumber(record.icu_training_load) ?? toFiniteNumber(record.load_target) ?? undefined
  const ctl = toFiniteNumber(record.icu_ctl)
  const atl = toFiniteNumber(record.icu_atl)
  return {
    ...(typeof record.id === 'number' ? { id: record.id } : {}),
    date,
    ...(typeof record.name === 'string' ? { name: record.name } : {}),
    ...(typeof record.type === 'string' ? { type: record.type } : {}),
    ...(typeof record.category === 'string' ? { category: record.category } : {}),
    ...(trainingLoad !== undefined ? { trainingLoad } : {}),
    ...(ctl !== null ? { ctl } : {}),
    ...(atl !== null ? { atl } : {}),
    ...(ctl !== null && atl !== null ? { tsb: ctl - atl } : {}),
  }
}

function addTsbReason(
  reasons: TrainingStatusReason[],
  tsb: number,
  id: string,
  title: string,
): void {
  if (tsb <= -25) {
    reasons.push({
      id,
      severity: TrainingStatusReasonSeverities.Danger,
      source: TrainingStatusReasonSources.SweatRelay,
      metric: 'TSB',
      value: tsb,
      threshold: '<= -25',
      title,
      detail: 'Form 已进入深负荷区间，继续叠加强度的风险较高。',
    })
    return
  }
  if (tsb < -10) {
    reasons.push({
      id,
      severity: TrainingStatusReasonSeverities.Warning,
      source: TrainingStatusReasonSources.SweatRelay,
      metric: 'TSB',
      value: tsb,
      threshold: '< -10',
      title,
      detail: 'Form 处在负荷区间，可以训练，但不适合连续追加高强度。',
    })
    return
  }
  if (tsb > 15) {
    reasons.push({
      id,
      severity: TrainingStatusReasonSeverities.Info,
      source: TrainingStatusReasonSources.SweatRelay,
      metric: 'TSB',
      value: tsb,
      threshold: '> +15',
      title,
      detail: 'Form 明显偏正，适合比赛或测试；长期如此可能训练刺激不足。',
    })
  }
}

function addRampReason(reasons: TrainingStatusReason[], rampRate?: number): void {
  if (rampRate === undefined) return
  if (rampRate > 6) {
    reasons.push({
      id: 'ramp-high',
      severity: TrainingStatusReasonSeverities.Danger,
      source: TrainingStatusReasonSources.SweatRelay,
      metric: 'Ramp Rate',
      value: rampRate,
      threshold: '> +6/wk',
      title: 'Ramp Rate 过快',
      detail: 'Fitness 增长速度偏快，通常意味着近期负荷提升较激进。',
    })
    return
  }
  if (rampRate > 4) {
    reasons.push({
      id: 'ramp-load',
      severity: TrainingStatusReasonSeverities.Warning,
      source: TrainingStatusReasonSources.SweatRelay,
      metric: 'Ramp Rate',
      value: rampRate,
      threshold: '> +4/wk',
      title: 'Ramp Rate 偏快',
      detail: '负荷增长速度偏高，需要关注疲劳和恢复反馈。',
    })
  }
}

function addAtlPressureReason(
  reasons: TrainingStatusReason[],
  latest: IntervalsFitnessPoint,
): void {
  if (latest.ctl <= 0) return
  const ratio = latest.atl / latest.ctl
  if (ratio > 1.35) {
    reasons.push({
      id: 'atl-pressure-high',
      severity: TrainingStatusReasonSeverities.Danger,
      source: TrainingStatusReasonSources.SweatRelay,
      metric: 'ATL/CTL',
      value: ratio,
      threshold: '> 1.35',
      title: '短期疲劳明显高于基础',
      detail: 'ATL 明显高于 CTL，说明近期压力超过当前长期负荷基础较多。',
    })
    return
  }
  if (ratio > 1.2) {
    reasons.push({
      id: 'atl-pressure-load',
      severity: TrainingStatusReasonSeverities.Warning,
      source: TrainingStatusReasonSources.SweatRelay,
      metric: 'ATL/CTL',
      value: ratio,
      threshold: '> 1.20',
      title: '短期疲劳高于基础',
      detail: 'ATL 高于 CTL，当前处在比较明确的加载阶段。',
    })
  }
}

function addForecastReasons(
  reasons: TrainingStatusReason[],
  forecast?: IntervalsForecastSummary,
): void {
  if (!forecast || forecast.days <= 0) return
  if (forecast.minTsb !== undefined) {
    addTsbReason(reasons, forecast.minTsb, 'forecast-min-tsb', `未来 ${forecast.days} 天最低 TSB`)
  } else if (forecast.events.length > 0) {
    reasons.push({
      id: 'forecast-no-model',
      severity: TrainingStatusReasonSeverities.Info,
      source: TrainingStatusReasonSources.Intervals,
      metric: 'planned-load',
      value: forecast.totalPlannedLoad,
      title: '未来计划缺少预测曲线',
      detail:
        '已读取到计划负荷，但 Intervals.icu 没有返回未来 CTL / ATL，因此未来计划不参与风险分级。',
    })
  }
}

function resolveLevel(
  latest: IntervalsFitnessPoint,
  reasons: TrainingStatusReason[],
): TrainingStatusLevel {
  if (reasons.some((reason) => reason.severity === TrainingStatusReasonSeverities.Danger)) {
    return TrainingStatusLevels.High
  }
  if (reasons.some((reason) => reason.severity === TrainingStatusReasonSeverities.Warning)) {
    return TrainingStatusLevels.Load
  }
  if (latest.tsb > 15) return TrainingStatusLevels.Recovery
  return TrainingStatusLevels.Good
}

function titleForLevel(level: TrainingStatusLevel): string {
  if (level === TrainingStatusLevels.High) return '强度偏高'
  if (level === TrainingStatusLevels.Load) return '负荷中'
  if (level === TrainingStatusLevels.Recovery) return '恢复偏多'
  if (level === TrainingStatusLevels.Unknown) return '数据不足'
  return '适合训练'
}

function summaryForLevel(
  level: TrainingStatusLevel,
  latest: IntervalsFitnessPoint,
  forecast?: IntervalsForecastSummary,
): string {
  const base = `TSB ${signed(latest.tsb)} · CTL ${round(latest.ctl)} · ATL ${round(latest.atl)}`
  const future = forecast?.minTsb !== undefined ? ` · 未来最低 TSB ${signed(forecast.minTsb)}` : ''
  if (level === TrainingStatusLevels.High) return `${base}${future}，当前计划可能偏激进。`
  if (level === TrainingStatusLevels.Load)
    return `${base}${future}，可以训练，但需要控制连续高强度。`
  if (level === TrainingStatusLevels.Recovery)
    return `${base}${future}，适合测试或比赛，长期可能刺激不足。`
  return `${base}${future}，当前负荷处在可控区间。`
}

function balancedReason(latest: IntervalsFitnessPoint): TrainingStatusReason {
  return {
    id: 'balanced',
    severity: TrainingStatusReasonSeverities.Info,
    source: TrainingStatusReasonSources.SweatRelay,
    metric: 'TSB',
    value: latest.tsb,
    threshold: '-10 ~ +10',
    title: 'Form 处在平衡区间',
    detail: '没有触发高负荷或恢复偏多规则。',
  }
}

function dateOnly(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value)
  return match?.[1] ?? null
}

function minOptional(values: number[]): number | undefined {
  const finite = values.filter(Number.isFinite)
  return finite.length > 0 ? Math.min(...finite) : undefined
}

function maxOptional(values: number[]): number | undefined {
  const finite = values.filter(Number.isFinite)
  return finite.length > 0 ? Math.max(...finite) : undefined
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return value
}

function localDate(date: Date): string {
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function basicAuth(apiKey: string): string {
  return `Basic ${Buffer.from(`API_KEY:${apiKey}`).toString('base64')}`
}

function signed(value: number): string {
  return `${value > 0 ? '+' : ''}${round(value)}`
}

function round(value: number): string {
  return value.toFixed(Math.abs(value) >= 100 ? 0 : 1)
}
