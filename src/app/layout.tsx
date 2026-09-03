import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Backgammon Trainer",
  description: "Practice backgammon checker plays and cube decisions.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <header className="border-b border-stone-200 bg-white">
          <nav className="mx-auto flex max-w-7xl items-center gap-5 px-4 py-2 text-sm" aria-label="Main">
            <Link href="/" className="font-semibold text-stone-800">
              Backgammon Trainer
            </Link>
            <Link href="/" className="text-stone-600 hover:text-stone-900">
              Quiz
            </Link>
            <Link href="/stats" className="text-stone-600 hover:text-stone-900">
              Stats
            </Link>
            <Link href="/board" className="text-stone-600 hover:text-stone-900">
              Positions
            </Link>
          </nav>
        </header>
        {children}
      </body>
    </html>
  );
}
