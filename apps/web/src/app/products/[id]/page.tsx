import Link from "next/link";
import { notFound } from "next/navigation";
import { AppError, PUBLIC_CONTEXT_ID, productDetail, variantHistory, variantOffers, type OfferDTO } from "@buytrail/services";
import { currentActor } from "@/server/http";
import { services } from "@/server/services";
import { Badge, Card, LiveBadge, Notice, SampleBadge } from "@/components/ui";
import { HistoryPanel } from "@/components/HistoryPanel";
import { WatchForm } from "@/components/WatchForm";
import { DemoPriceSimulator } from "@/components/DemoPriceSimulator";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = await services().db.product.findUnique({ where: { id }, select: { title: true } });
  return { title: p?.title ?? "Product" };
}

function OfferRow({ o, highlight }: { o: OfferDTO; highlight?: boolean }) {
  return (
    <tr className={highlight ? "bg-teal-soft/60" : ""}>
      <th scope="row" className="py-3 pr-3 text-left align-top font-medium">
        {o.rank !== null && <span className="sr-only">Rank {o.rank}: </span>}
        {o.merchant.name}
        {o.merchant.platform && <span className="block text-xs font-normal text-muted">via {o.merchant.platform}</span>}
        <span className="mt-1 flex flex-wrap gap-1">
          {o.isDemo ? <SampleBadge /> : <LiveBadge />}
          <Badge>{o.condition[0]!.toUpperCase() + o.condition.slice(1)}</Badge>
          {o.stock === "in_stock" ? <Badge tone="good">In stock</Badge> : o.stock === "out_of_stock" ? <Badge tone="bad">Out of stock</Badge> : <Badge tone="warn">Stock unknown</Badge>}
        </span>
      </th>
      <td className="tabular py-3 pr-3 align-top">{o.itemPrice ? `${o.itemPrice.display}` : <span className="text-muted">Unavailable</span>}</td>
      <td className="py-3 pr-3 align-top text-sm">{o.shippingText}</td>
      <td className="tabular py-3 pr-3 align-top text-sm">{o.feeStatus === "complete" ? (o.fees && o.fees.amountMinor !== "0" ? o.fees.display : "None") : "Unknown"}</td>
      <td className="tabular py-3 pr-3 align-top font-semibold">
        {o.knownTotal ? (
          <>
            {o.knownTotal.display}
            <span className="block text-xs font-normal text-muted">before tax</span>
          </>
        ) : (
          <span className="font-normal text-muted">Not confirmed</span>
        )}
      </td>
      <td className="py-3 pr-3 align-top text-xs text-muted">
        <span className={o.freshness === "stale" ? "font-medium text-warn" : ""}>
          {o.freshness === "stale" ? "Stale — " : ""}Checked {o.checkedAgo}
        </span>
        {o.lastCheckFailedAt && new Date(o.lastCheckFailedAt) > new Date(o.checkedAt) && <span className="block text-warn">Latest check failed; showing last confirmed data</span>}
        {o.reasonText.length > 0 && <span className="block">{o.reasonText.join(" · ")}</span>}
      </td>
      <td className="py-3 align-top">
        <a href={o.outboundUrl} rel="noopener noreferrer nofollow" target="_blank" className="whitespace-nowrap text-sm font-medium text-teal underline">
          View at store<span className="sr-only"> {o.merchant.name} (opens in a new tab)</span>
        </a>
      </td>
    </tr>
  );
}

function OfferCard({ o, highlight }: { o: OfferDTO; highlight?: boolean }) {
  return (
    <li className={`rounded-lg border p-3 text-sm ${highlight ? "border-teal bg-teal-soft/60" : "border-line"}`}>
      <div className="flex items-start justify-between gap-2">
        <p className="font-medium">
          {o.rank !== null && <span className="sr-only">Rank {o.rank}: </span>}
          {o.merchant.name}
          {o.merchant.platform && <span className="block text-xs font-normal text-muted">via {o.merchant.platform}</span>}
        </p>
        <p className="tabular text-right font-semibold">
          {o.knownTotal ? (
            <>
              {o.knownTotal.display}
              <span className="block text-xs font-normal text-muted">known total before tax</span>
            </>
          ) : (
            <span className="font-normal text-muted">Total not confirmed</span>
          )}
        </p>
      </div>
      <dl className="tabular mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
        <dt className="text-muted">Item price</dt>
        <dd>{o.itemPrice ? o.itemPrice.display : "Unavailable"}</dd>
        <dt className="text-muted">Shipping</dt>
        <dd>{o.shippingText}</dd>
        <dt className="text-muted">Fees</dt>
        <dd>{o.feeStatus === "complete" ? (o.fees && o.fees.amountMinor !== "0" ? o.fees.display : "None") : "Unknown"}</dd>
        <dt className="text-muted">Checked</dt>
        <dd className={o.freshness === "stale" ? "font-medium text-warn" : ""}>
          {o.freshness === "stale" ? "Stale — " : ""}
          {o.checkedAgo}
        </dd>
      </dl>
      <div className="mt-2 flex flex-wrap items-center gap-1">
        {o.isDemo ? <SampleBadge /> : <LiveBadge />}
        <Badge>{o.condition[0]!.toUpperCase() + o.condition.slice(1)}</Badge>
        {o.stock === "in_stock" ? <Badge tone="good">In stock</Badge> : o.stock === "out_of_stock" ? <Badge tone="bad">Out of stock</Badge> : <Badge tone="warn">Stock unknown</Badge>}
        {o.reasonText.map((r) => (
          <Badge key={r} tone="warn">
            {r}
          </Badge>
        ))}
      </div>
      <a href={o.outboundUrl} rel="noopener noreferrer nofollow" target="_blank" className="mt-2 inline-block text-sm font-medium text-teal underline">
        View at store<span className="sr-only"> {o.merchant.name} (opens in a new tab)</span>
      </a>
    </li>
  );
}

/** Table on wide screens; stacked cards on narrow screens so cost details are never hidden. */
function OfferTable({ caption, offers, highlightFirst }: { caption: string; offers: OfferDTO[]; highlightFirst?: boolean }) {
  return (
    <>
      <ul aria-label={caption} className="mt-2 space-y-2 md:hidden">
        {offers.map((o, i) => (
          <OfferCard key={o.offerId} o={o} highlight={highlightFirst && i === 0} />
        ))}
      </ul>
      <div className="hidden md:block">
        <table className="w-full text-sm" aria-label={caption}>
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
              <th scope="col" className="py-2 pr-3 font-medium">Seller</th>
              <th scope="col" className="py-2 pr-3 font-medium">Item price</th>
              <th scope="col" className="py-2 pr-3 font-medium">Shipping</th>
              <th scope="col" className="py-2 pr-3 font-medium">Fees</th>
              <th scope="col" className="py-2 pr-3 font-medium">Known total</th>
              <th scope="col" className="py-2 pr-3 font-medium">Freshness</th>
              <th scope="col" className="py-2 font-medium"><span className="sr-only">Store link</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {offers.map((o, i) => (
              <OfferRow key={o.offerId} o={o} highlight={highlightFirst && i === 0} />
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export default async function ProductPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SP> }) {
  const { id } = await params;
  const sp = await searchParams;
  const s = services();
  const now = s.clock.now();
  let product;
  try {
    product = await productDetail(s.db, id);
  } catch (e) {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  }
  const selected = product.variants.find((v) => v.id === one(sp.variant)) ?? (product.variants.length === 1 ? product.variants[0]! : null);
  const condition = (["new", "refurbished", "used"].includes(one(sp.condition)) ? one(sp.condition) : "new") as "new" | "refurbished" | "used";
  const actor = await currentActor();

  const [offers, history] = selected
    ? await Promise.all([variantOffers(s.db, selected.id, PUBLIC_CONTEXT_ID, condition, now), variantHistory(s.db, selected.id, PUBLIC_CONTEXT_ID, condition, now)])
    : [null, null];
  const criticalDefs = product.attributeDefs.filter((a) => a.key !== "market");
  const href = (variantId: string, cond = condition) => `/products/${product.id}?variant=${variantId}${cond !== "new" ? `&condition=${cond}` : ""}`;

  return (
    <div className="space-y-6">
      <nav aria-label="Breadcrumb" className="text-sm text-muted">
        <Link href="/search" className="underline">Search</Link> / <Link href={`/search?category=${product.category}`} className="underline">{product.categoryLabel}</Link>
      </nav>
      <header>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{product.title}</h1>
          {product.isDemo ? <SampleBadge /> : <LiveBadge />}
        </div>
        {product.description && <p className="mt-1 max-w-3xl text-muted">{product.description}</p>}
      </header>

      <Card>
        <h2 className="text-lg font-semibold" id="variant-heading">
          {selected ? "Selected variant" : "Choose a variant"}
        </h2>
        {!selected && <p className="mt-1 text-sm text-muted">Offers and price history appear after you choose one exact configuration.</p>}
        <ul aria-labelledby="variant-heading" className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {product.variants.map((v) => {
            const active = v.id === selected?.id;
            return (
              <li key={v.id}>
                <Link
                  href={href(v.id)}
                  aria-current={active ? "true" : undefined}
                  className={`block rounded-lg border px-3 py-2 text-sm ${active ? "border-teal bg-teal-soft ring-1 ring-teal" : "border-line hover:border-teal"}`}
                  data-testid={`variant-${v.id}`}
                >
                  <span className="block font-medium">{v.label}</span>
                  <span className="block text-xs text-muted">Model {v.modelCode}</span>
                </Link>
              </li>
            );
          })}
        </ul>
        {selected && (
          <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-muted">Model code</dt>
              <dd className="font-medium">{selected.modelCode}</dd>
            </div>
            {criticalDefs.map((a) =>
              selected.attributes[a.key] ? (
                <div key={a.key}>
                  <dt className="text-muted">{a.label}</dt>
                  <dd className="font-medium">{selected.attributes[a.key]}</dd>
                </div>
              ) : null,
            )}
            <div>
              <dt className="text-muted">Market</dt>
              <dd className="font-medium">Canada</dd>
            </div>
          </dl>
        )}
      </Card>

      {selected && offers && (
        <>
          <Card>
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h2 className="text-lg font-semibold">Offers</h2>
              <nav aria-label="Condition" className="flex gap-2 text-sm">
                {(["new", "refurbished", "used"] as const).map((c) => {
                  const available = offers.conditionsAvailable.includes(c);
                  return c === condition ? (
                    <span key={c} aria-current="true" className="rounded-full border border-teal bg-teal-soft px-3 py-1 font-medium text-teal-dark">
                      {c[0]!.toUpperCase() + c.slice(1)}
                    </span>
                  ) : available ? (
                    <Link key={c} href={href(selected.id, c)} className="rounded-full border border-line px-3 py-1 hover:border-teal">
                      {c[0]!.toUpperCase() + c.slice(1)}
                    </Link>
                  ) : null;
                })}
              </nav>
            </div>
            <p className="mt-2 text-sm" data-testid="offers-summary">
              {offers.summary}
            </p>
            {offers.explanation && (
              <p className="mt-1 text-sm text-muted" data-testid="offers-explanation">
                {offers.ranked[0]!.merchant.name} ranks first: {offers.explanation}
              </p>
            )}
            <p className="mt-1 text-xs text-muted">{offers.taxNote}</p>

            {offers.ranked.length > 0 ? (
              <div className="mt-4">
                <h3 className="text-sm font-semibold">Ranked by known total before tax</h3>
                <OfferTable caption="Eligible offers ranked by known total before tax" offers={offers.ranked} highlightFirst />
              </div>
            ) : (
              <div className="mt-4">
                <Notice tone="warn" title="No eligible offer right now">
                  No current offer for this exact variant and condition has a confirmed, fresh total. Offers below are shown for reference but aren&apos;t ranked.
                </Notice>
              </div>
            )}
            {offers.incompleteTotal.length > 0 && (
              <div className="mt-6">
                <h3 className="text-sm font-semibold">Total not confirmed</h3>
                <p className="text-xs text-muted">Shipping or fees are unknown, so these can&apos;t be ranked. A lower item price here doesn&apos;t mean a lower total.</p>
                <OfferTable caption="Offers whose total is not confirmed" offers={offers.incompleteTotal} />
              </div>
            )}
            {offers.stale.length > 0 && (
              <div className="mt-6">
                <h3 className="text-sm font-semibold">Not recently confirmed</h3>
                <p className="text-xs text-muted">These prices are older than the freshness limit. They are excluded from rankings and alerts.</p>
                <OfferTable caption="Stale offers" offers={offers.stale} />
              </div>
            )}
            {offers.other.length > 0 && (
              <div className="mt-6">
                <h3 className="text-sm font-semibold">Other offers (not compared)</h3>
                <p className="text-xs text-muted">Out of stock, conditional prices (e.g. membership), other currencies, or prices pending verification.</p>
                <OfferTable caption="Offers excluded from comparison" offers={offers.other} />
              </div>
            )}
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <h2 className="text-lg font-semibold">Price history</h2>
              <HistoryPanel history={history!} />
            </Card>
            <Card>
              <h2 className="text-lg font-semibold">Watch this exact variant</h2>
              {actor ? (
                <WatchForm
                  variantId={selected.id}
                  variantTitle={`${product.title} — ${selected.label}`}
                  condition={condition}
                  contextId={PUBLIC_CONTEXT_ID}
                  currentBest={offers.best?.knownTotal ?? null}
                />
              ) : (
                <p className="mt-2 text-sm">
                  <Link href={`/sign-in?next=${encodeURIComponent(href(selected.id))}`} className="font-medium text-teal underline">
                    Sign in
                  </Link>{" "}
                  to save a target-price watch for this exact variant.
                </p>
              )}
              {actor && (
                <p className="mt-4 text-sm">
                  Bought it?{" "}
                  <Link href={`/purchases/new?variant=${selected.id}`} className="font-medium text-teal underline">
                    Record the purchase
                  </Link>
                </p>
              )}
              {actor && s.config.APP_MODE !== "live" && (
                <DemoPriceSimulator
                  offers={[...offers.ranked, ...offers.incompleteTotal, ...offers.stale, ...offers.other].filter((o) => o.isDemo && o.itemPrice).map((o) => ({ id: o.offerId, label: `${o.merchant.name} (${o.itemPrice!.display})`, url: o.outboundUrl }))}
                />
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
