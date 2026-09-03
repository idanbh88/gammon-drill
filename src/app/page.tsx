import QuizLoader from "@/components/QuizLoader";
import { loadProblems } from "@/lib/problems";

export default async function Home() {
  const problems = await loadProblems();
  return (
    <main>
      <QuizLoader problems={problems} />
    </main>
  );
}
