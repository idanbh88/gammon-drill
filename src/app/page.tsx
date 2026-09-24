import QuizLoader from "@/components/QuizLoader";
import { loadQuizProblems } from "@/lib/problems";

/** The quiz reads the store (the user's mistakes) on every request. */
export const dynamic = "force-dynamic";

export default async function Home() {
  const problems = await loadQuizProblems();
  return (
    <main>
      <QuizLoader problems={problems} />
    </main>
  );
}
