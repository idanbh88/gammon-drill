import StatsLoader from "@/components/StatsLoader";
import { loadQuizProblems } from "@/lib/problems";

/** The quiz's problems, the user's mistakes included, so their attempts count; reads the store on every request. */
export const dynamic = "force-dynamic";

export default async function StatsPage() {
  const problems = await loadQuizProblems();
  return (
    <main>
      <StatsLoader problems={problems} />
    </main>
  );
}
