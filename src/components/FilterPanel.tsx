"use client";

import { CATEGORIES, type Category, type Problem } from "@/types/problem";
import {
  BAND_LABEL,
  categoryCounts,
  DEFAULT_FILTERS,
  DIFFICULTY_BANDS,
  isDefaultFilters,
  MISTAKE_SIZE_LABEL,
  MISTAKE_SIZES,
  mistakeSize,
  onlySize,
  PROGRESS,
  PROGRESS_LABEL,
  SOURCE_LABEL,
  SOURCES,
  type DifficultyBand,
  type Filters,
} from "@/lib/filters";
import { THRESHOLDS } from "@/lib/matches";
import { orderSummary, orderText, type QuizOrder } from "@/lib/quiz-order";

function toggle<T>(list: T[], item: T): T[] {
  return list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
}

function Chip({ on, onClick, children, title }: { on: boolean; onClick: () => void; children: React.ReactNode; title?: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      title={title}
      onClick={onClick}
      className={`rounded-full border px-2.5 py-0.5 text-sm transition ${
        on ? "border-blue-600 bg-blue-600 text-white" : "border-stone-300 bg-white text-stone-700 hover:border-blue-400"
      }`}
    >
      {children}
    </button>
  );
}

export default function FilterPanel({
  filters,
  onChange,
  order,
  onOrderChange,
  problems,
  untried,
  matching,
  due,
}: {
  filters: Filters;
  onChange: (f: Filters) => void;
  order: QuizOrder;
  onOrderChange: (o: QuizOrder) => void;
  problems: readonly Problem[];
  /** Problems never answered, among all of them. */
  untried: number;
  matching: number;
  due: number;
}) {
  const counts = categoryCounts(problems);
  const active = !isDefaultFilters(filters);
  const orderNote = orderSummary(order);
  const size = onlySize(filters);
  return (
    <details className="rounded-lg border border-stone-200 bg-white" aria-label="Filters" open={active}>
      <summary className="cursor-pointer px-4 py-2 text-sm text-stone-600">
        <span className="font-medium text-stone-800">Filters and order</span>
        {active && <span className="ml-1 rounded bg-blue-100 px-1.5 text-xs text-blue-800">on</span>} · {matching} of{" "}
        {problems.length} problems · <span data-due>{due}</span> due
        {size && <span data-size-summary> · {MISTAKE_SIZE_LABEL[size].text.toLowerCase()}</span>}
        {filters.progress === "untried" && <span data-progress-summary> · not tried yet</span>}
        {orderNote && <span data-order-summary> · {orderNote}</span>}
      </summary>
      <div className="grid gap-3 border-t border-stone-200 px-4 py-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-20 text-stone-500">Source</span>
          {SOURCES.map((s) => (
            <Chip key={s} on={filters.source === s} onClick={() => onChange({ ...filters, source: s })}>
              {SOURCE_LABEL[s]}
              {s === "mistakes" && <span className="opacity-60"> {problems.filter((p) => p.origin).length}</span>}
              {s === "book" && <span className="opacity-60"> {problems.filter((p) => p.book).length}</span>}
            </Chip>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2" data-mistake-size>
          <span className="w-20 text-stone-500">Mistakes</span>
          <Chip on={size === null} onClick={() => onChange({ ...filters, mistakeSize: [] })}>
            All
          </Chip>
          {MISTAKE_SIZES.map((m) => (
            <Chip key={m} on={size === m} onClick={() => onChange({ ...filters, mistakeSize: [m] })} title={MISTAKE_SIZE_LABEL[m].title}>
              {MISTAKE_SIZE_LABEL[m].text} <span className="opacity-60">{problems.filter((p) => mistakeSize(p) === m).length}</span>
            </Chip>
          ))}
          <span className="text-xs text-stone-400">
            your own mistakes by what the move played lost: errors {THRESHOLDS.error}–{THRESHOLDS.blunder}, blunders {THRESHOLDS.blunder} or more
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2" data-progress>
          <span className="w-20 text-stone-500">Progress</span>
          {PROGRESS.map((pr) => (
            <Chip key={pr} on={filters.progress === pr} onClick={() => onChange({ ...filters, progress: pr })}>
              {PROGRESS_LABEL[pr]}
              {pr === "untried" && <span className="opacity-60"> {untried}</span>}
            </Chip>
          ))}
          <span className="text-xs text-stone-400">problems you have never answered in this browser</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-20 text-stone-500">Type</span>
          {(["all", "checker", "cube"] as const).map((t) => (
            <Chip key={t} on={filters.type === t} onClick={() => onChange({ ...filters, type: t })}>
              {t === "all" ? "All" : t === "checker" ? "Checker play" : "Cube"}
            </Chip>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-20 text-stone-500">Difficulty</span>
          {DIFFICULTY_BANDS.map((b: DifficultyBand) => (
            <Chip
              key={b}
              on={filters.difficulty.includes(b)}
              onClick={() => onChange({ ...filters, difficulty: toggle(filters.difficulty, b) })}
              title={BAND_LABEL[b]}
            >
              {b}
            </Chip>
          ))}
          <span className="text-xs text-stone-400">gap between the best and second-best answer</span>
        </div>
        <div className="flex flex-wrap items-start gap-2">
          <span className="w-20 pt-0.5 text-stone-500">Category</span>
          <div className="flex flex-1 flex-wrap gap-1.5">
            {CATEGORIES.map((c: Category) => (
              <Chip key={c} on={filters.categories.includes(c)} onClick={() => onChange({ ...filters, categories: toggle(filters.categories, c) })}>
                {c} <span className="opacity-60">{counts[c]}</span>
              </Chip>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-stone-100 pt-3" data-order>
          <span className="w-20 text-stone-500">Order</span>
          <Chip on={order.newFirst} onClick={() => onOrderChange({ ...order, newFirst: !order.newFirst })} title="Problems you have never answered come first, from the match you added last">
            New first
          </Chip>
          <Chip on={order.random} onClick={() => onOrderChange({ ...order, random: !order.random })} title="Any matching problem, due or not">
            Random
          </Chip>
          <span className="text-xs text-stone-400">{orderText(order)}</span>
        </div>
        {active && (
          <div>
            <button type="button" className="text-blue-700 underline" onClick={() => onChange(DEFAULT_FILTERS)}>
              Reset filters
            </button>
          </div>
        )}
      </div>
    </details>
  );
}
