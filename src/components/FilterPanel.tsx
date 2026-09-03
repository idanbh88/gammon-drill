"use client";

import { CATEGORIES, type Category, type Problem } from "@/types/problem";
import {
  BAND_LABEL,
  categoryCounts,
  DEFAULT_FILTERS,
  DIFFICULTY_BANDS,
  isDefaultFilters,
  type DifficultyBand,
  type Filters,
} from "@/lib/filters";

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
  problems,
  matching,
  due,
}: {
  filters: Filters;
  onChange: (f: Filters) => void;
  problems: readonly Problem[];
  matching: number;
  due: number;
}) {
  const counts = categoryCounts(problems);
  const active = !isDefaultFilters(filters);
  return (
    <details className="rounded-lg border border-stone-200 bg-white" aria-label="Filters" open={active}>
      <summary className="cursor-pointer px-4 py-2 text-sm text-stone-600">
        <span className="font-medium text-stone-800">Filters</span>
        {active && <span className="ml-1 rounded bg-blue-100 px-1.5 text-xs text-blue-800">on</span>} · {matching} of{" "}
        {problems.length} problems · <span data-due>{due}</span> due
      </summary>
      <div className="grid gap-3 border-t border-stone-200 px-4 py-3 text-sm">
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
