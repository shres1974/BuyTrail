import Link from "next/link";
import { listPurchases } from "@buytrail/services";
import { pageActor } from "@/server/guard";
import { services } from "@/server/services";
import { Badge, Card, Notice, PageTitle, SampleBadge, buttonPrimary, inputClass } from "@/components/ui";

export const metadata = { title: "Purchases" };

export default async function Purchases({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const actor = await pageActor("/purchases");
  const sp = await searchParams;
  const q = (sp.q ?? "").slice(0, 200);
  const items = await listPurchases(services().db, actor, q || null);
  return (
    <div>
      <PageTitle sub="Your private purchase notebook. Only you can see these records and receipts.">Purchases</PageTitle>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Link href="/purchases/new" className={buttonPrimary}>
          Record a purchase
        </Link>
        <form role="search" action="/purchases" className="flex gap-2">
          <label htmlFor="pq" className="sr-only">
            Search your purchases
          </label>
          <input id="pq" name="q" defaultValue={q} placeholder="Search merchant, item, notes" className={`${inputClass} w-64`} />
          <button className="rounded-md border border-line bg-card px-3 py-2 text-sm">Search</button>
        </form>
      </div>
      {items.length === 0 ? (
        <Notice title={q ? "No purchases match" : "No purchases recorded"}>
          {q ? "Try another word." : "Record anything you bought — it doesn't need to be in the comparison catalog."}
        </Notice>
      ) : (
        <ul className="space-y-3">
          {items.map((p) => {
            const deadlines = p.items.map((i) => i.deadline).filter(Boolean);
            return (
              <li key={p.id}>
                <Card>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h2 className="font-semibold">
                      <Link href={`/purchases/${p.id}`} className="hover:text-teal hover:underline">
                        {p.items.map((i) => i.description).join(", ")}
                      </Link>
                    </h2>
                    <span className="tabular font-semibold">{p.paidTotal?.display ?? <span className="font-normal text-muted">Amount not entered</span>}</span>
                  </div>
                  <p className="mt-1 text-sm text-muted">
                    {p.merchantName} · {p.purchasedOn}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs">
                    {p.isDemo && <SampleBadge />}
                    {p.status === "cancelled" && <Badge tone="warn">Cancelled</Badge>}
                    <Badge>{p.receipts.filter((r) => r.state === "ready").length} receipt(s)</Badge>
                    {deadlines.length ? <Badge tone="teal">Return date {deadlines.map((d) => d!.date).join(", ")}</Badge> : <Badge>Return date not set</Badge>}
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
