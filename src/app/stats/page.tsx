import StatsLoader from "@/components/StatsLoader";
import { loadProblems } from "@/lib/problems";

export default async function StatsPage() {
  const problems = await loadProblems();
  return (
    <main>
      <StatsLoader problems={problems} />
    </main>
  );
}
