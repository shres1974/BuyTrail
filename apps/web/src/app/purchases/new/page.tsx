import { localToday } from "@buytrail/domain";
import { pageActor } from "@/server/guard";
import { services } from "@/server/services";
import { PageTitle } from "@/components/ui";
import { PurchaseForm } from "@/components/PurchaseForm";

export const metadata = { title: "Record a purchase" };

type SP = { variant?: string };

export default async function NewPurchase({ searchParams }: { searchParams: Promise<SP> }) {
  const actor = await pageActor("/purchases/new");
  const sp = await searchParams;
  const s = services();
  let prefill: { variantId: string; description: string } | null = null;
  if (sp.variant) {
    const v = await s.db.productVariant.findUnique({ where: { id: sp.variant }, include: { product: true } });
    if (v) prefill = { variantId: v.id, description: `${v.product.title} — ${v.label}` };
  }
  const hasWatches = prefill ? (await s.db.watch.count({ where: { userId: actor.id, variantId: prefill.variantId, lifecycle: "active" } })) > 0 : false;
  return (
    <div className="mx-auto max-w-2xl">
      <PageTitle sub="Record what you actually paid. Clicking through to a store is never treated as a purchase.">Record a purchase</PageTitle>
      <PurchaseForm today={localToday(s.clock.now(), actor.timezone)} prefill={prefill} hasActiveWatches={hasWatches} />
    </div>
  );
}
