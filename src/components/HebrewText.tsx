import { Fragment } from "react";
import { ltrRuns } from "@/lib/rtl";

/** Hebrew prose, right to left, with moves and signed numbers kept left to right (see rtl.ts). */
export default function HebrewText({ text, className = "whitespace-pre-line text-stone-800" }: { text: string; className?: string }) {
  return (
    <p dir="rtl" lang="he" className={className}>
      {ltrRuns(text).map((run, i) =>
        run.ltr ? (
          <bdi key={i} dir="ltr">
            {run.text}
          </bdi>
        ) : (
          <Fragment key={i}>{run.text}</Fragment>
        ),
      )}
    </p>
  );
}
