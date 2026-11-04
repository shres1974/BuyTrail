import Link from "next/link";
import { notFound } from "next/navigation";
import { AppError, getOwnedPurchase, realUploadsAllowed } from "@buytrail/services";
import { pageActor } from "@/server/guard";
import { services } from "@/server/services";
import { Badge, Card, PageTitle, SampleBadge } from "@/components/ui";
import { DeadlineEditor } from "@/components/DeadlineEditor";
import { ReceiptPanel } from "@/components/ReceiptPanel";
import { ItemStatusButton } from "@/components/ItemStatusButton";

export const metadata = { title: "Purchase" };

export default async function PurchaseDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await pageActor(`/purchases/${id}`);
  const s = services();
  let p;
  try {
    p = await getOwnedPurchase(s.db, actor, id);
  } catch (e) {
    // Other users' purchases are indistinguishable from missing ones (G21).
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  }
  return (
    <div className="space-y-6">
      <nav aria-label="Breadcrumb" className="text-sm text-muted">
        <Link href="/purchases" className="underline">
          Purchases
        </Link>
      </nav>
      <PageTitle sub={`${p.merchantName} · ${p.purchasedOn}`}>{p.items.map((i) => i.description).join(", ")}</PageTitle>
      <div className="flex flex-wrap gap-2">
        {p.isDemo && <SampleBadge />}
        {p.status === "cancelled" && <Badge tone="warn">Cancelled</Badge>}
        <Badge>{p.paidTotal ? `Paid ${p.paidTotal.display}` : "Amount not entered"}</Badge>
      </div>
      {p.notes && (
        <Card>
          <h2 className="text-sm font-semibold">Notes</h2>
          <p className="mt-1 whitespace-pre-wrap text-sm">{p.notes}</p>
        </Card>
      )}
      <section aria-labelledby="items-h" className="space-y-3">
        <h2 id="items-h" className="text-lg font-semibold">
          Items and return dates
        </h2>
        {p.items.map((it) => (
          <Card key={it.id}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="font-medium">
                {it.description} {it.quantity > 1 && <span className="text-muted">× {it.quantity}</span>}
              </h3>
              <div className="flex items-center gap-2">
                {it.status === "returned" && <Badge tone="neutral">Returned</Badge>}
                <ItemStatusButton itemId={it.id} status={it.status} />
              </div>
            </div>
            <DeadlineEditor itemId={it.id} deadline={it.deadline} defaultTimezone={actor.timezone} disabled={p.status !== "active" || it.status === "returned"} />
          </Card>
        ))}
      </section>
      <section aria-labelledby="receipts-h">
        <h2 id="receipts-h" className="mb-3 text-lg font-semibold">
          Receipts
        </h2>
        <ReceiptPanel purchaseId={p.id} receipts={p.receipts} uploadsAllowed={realUploadsAllowed(s.config)} maxBytes={s.config.RECEIPT_MAX_BYTES} />
      </section>
    </div>
  );
}
