import LessonListLoader from "@/components/LessonListLoader";
import UploadLessons from "@/components/UploadLessons";
import { readLessonSets } from "@/lib/lesson-store";
import { DATA_DIR } from "@/lib/problems";

/** The imported Backgammon Galaxy lessons and the upload form. Reads the lesson database on every request. */
export const dynamic = "force-dynamic";

export default function LessonsPage() {
  const sets = readLessonSets(DATA_DIR);
  const problems = sets.reduce((n, s) => n + s.problemIds.length, 0);
  return (
    <main className="mx-auto flex max-w-7xl flex-col gap-4 p-4">
      <div>
        <h1 className="text-xl font-semibold">Lessons</h1>
        <p className="text-sm text-stone-600">
          Backgammon Galaxy quiz sets{sets.length > 0 && `: ${sets.length} sets, ${problems} problems`}. Each set is played in its
          own order, with the author&rsquo;s analysis after every answer. The sets and their pictures stay on this machine
          (<code>data/lessons/</code>, not in git).
        </p>
      </div>
      <UploadLessons />
      <LessonListLoader sets={sets} />
    </main>
  );
}
