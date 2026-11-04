import Link from "next/link";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { currentActor } from "@/server/http";
import { services } from "@/server/services";
import { SignOutButton } from "@/components/SignOutButton";
import "./globals.css";

export const metadata = {
  title: { default: "BuyTrail — sample-data demonstration", template: "%s · BuyTrail" },
  description: "Find the right item, understand the cost, and keep track after you buy.",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Every page reads the session and live catalog state: render per request, never at build time.
  await connection();
  const s = services();
  const actor = await currentActor();
  const demo = s.config.APP_MODE !== "live";
  return (
    <html lang="en-CA">
      <body className="min-h-screen">
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:bg-card focus:px-3 focus:py-2">
          Skip to main content
        </a>
        {demo && (
          <div role="note" aria-label="Sample data notice" className="border-b border-sample/30 bg-sample-soft px-4 py-2 text-center text-sm text-sample" data-testid="sample-banner">
            <strong>Interactive demonstration with sample data.</strong> Brands, stores, prices, history and alerts are fictional. Don&apos;t upload real receipts.
          </div>
        )}
        <header className="border-b border-line bg-card">
          <nav aria-label="Main" className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
            <Link href="/" className="mr-2 flex items-center gap-2 text-lg font-bold tracking-tight text-ink">
              <span aria-hidden="true" className="inline-block h-5 w-5 rounded-sm bg-teal" />
              BuyTrail
            </Link>
            <Link href="/search" className="text-sm font-medium hover:text-teal">
              Search
            </Link>
            <Link href="/watchlist" className="text-sm font-medium hover:text-teal">
              Watchlist
            </Link>
            <Link href="/purchases" className="text-sm font-medium hover:text-teal">
              Purchases
            </Link>
            <Link href="/notifications" className="text-sm font-medium hover:text-teal">
              Alerts
            </Link>
            <Link href="/settings" className="text-sm font-medium hover:text-teal">
              Settings
            </Link>
            {actor?.role === "admin" && (
              <Link href="/admin" className="text-sm font-medium hover:text-teal">
                Admin
              </Link>
            )}
            <span className="ml-auto text-sm text-muted">
              {actor ? (
                <span className="flex items-center gap-3">
                  <span className="hidden sm:inline">{actor.email}</span>
                  <SignOutButton />
                </span>
              ) : (
                <Link href="/sign-in" className="rounded-md border border-teal px-3 py-1.5 font-medium text-teal hover:bg-teal-soft">
                  Sign in
                </Link>
              )}
            </span>
          </nav>
        </header>
        <main id="main" className="mx-auto max-w-6xl px-4 py-8">
          {children}
        </main>
        <footer className="mx-auto max-w-6xl px-4 pb-10 text-xs text-muted">
          BuyTrail compares known totals before tax from supported sources only. Retailers handle checkout, payment, delivery and returns.
          {demo && " Operating level: D0 demonstration — no live retailer data is connected."}
        </footer>
      </body>
    </html>
  );
}
