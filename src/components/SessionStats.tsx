import type { Stats } from "@/lib/storage";

export default function SessionStats({ stats, onReset }: { stats: Stats; onReset: () => void }) {
  const pct = stats.answered ? Math.round((100 * stats.correct) / stats.answered) : 0;
  return (
    <section
      aria-label="Session stats"
      className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-stone-200 bg-white px-4 py-3 text-sm"
    >
      <div>
        <div className="text-stone-500">Answered</div>
        <div className="text-lg font-semibold" data-stat="answered">{stats.answered}</div>
      </div>
      <div>
        <div className="text-stone-500">Correct</div>
        <div className="text-lg font-semibold" data-stat="correct">
          {stats.correct} <span className="text-sm font-normal text-stone-500">({pct}%)</span>
        </div>
      </div>
      <div>
        <div className="text-stone-500">Avg equity loss</div>
        <div className="text-lg font-semibold" data-stat="avg-loss">{stats.avgLoss.toFixed(3)}</div>
      </div>
      <button
        type="button"
        onClick={onReset}
        className="ml-auto rounded border border-stone-300 px-2 py-1 text-xs text-stone-600 hover:bg-stone-100"
      >
        Reset
      </button>
    </section>
  );
}
