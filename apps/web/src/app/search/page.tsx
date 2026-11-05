import Link from "next/link";
import { Suspense } from "react";
import { CATEGORIES, isCategoryKey, relativeAge, type CategoryKey } from "@buytrail/domain";
import { AppError, searchCatalog } from "@buytrail/services";
import { services } from "@/server/services";
import { SearchForm } from "@/components/SearchForm";
import { RequestProductForm } from "@/components/RequestProductForm";
import { Badge, Card, Notice, LiveBadge, SampleBadge } from "@/components/ui";

export const metadata = { title: "Search" };

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function SearchPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const q = one(sp.q).slice(0, 200);
  const cat = one(sp.category);
  const category = isCategoryKey(cat) ? (cat as CategoryKey) : undefined;
  const condition = (["new", "refurbished", "used"].includes(one(sp.condition)) ? one(sp.condition) : "new") as "new";
  const sort = one(sp.sort) === "lowest_total" ? "lowest_total" : "relevance";
  const filters: Record<string, string> = {};
  for (const [k, v] of Object.entries(sp)) if (k.startsWith("f.") && one(v)) filters[k.slice(2)] = one(v).slice(0, 100);
  const s = services();
  const now = s.clock.now();

  let result: Awaited<ReturnType<typeof searchCatalog>> | null = null;
  let error: string | null = null;
  try {
    result = await searchCatalog(s.db, { q, category, condition, sort, filters: category ? filters : {}, cursor: one(sp.cursor) || undefined }, now, s.config.AUTH_SECRET);
  } catch (e) {
    error = e instanceof AppError ? e.message : "Search is temporarily unavailable. Try again in a moment.";
  }

  const link = (over: Record<string, string | null>) => {
    const p = new URLSearchParams();
    const base: Record<string, string> = { q, ...(category ? { category } : {}), condition, sort, ...Object.fromEntries(Object.entries(filters).map(([k, v]) => [`f.${k}`, v])) };
    for (const [k, v] of Object.entries({ ...base, ...over })) if (v) p.set(k, v);
    return `/search?${p.toString()}`;
  };
  const filterDefs = category ? CATEGORIES[category].attributes.filter((a) => a.filterable) : [];

  return (
    <div className="grid gap-6 lg:grid-cols-[16rem_1fr]">
      <aside aria-label="Filters" className="space-y-5">
        <form action="/search" method="get" className="space-y-5">
          <input type="hidden" name="q" value={q} />
          <fieldset>
            <legend className="text-sm font-semibold">Category</legend>
            <div className="mt-2 space-y-1 text-sm">
              <label className="flex items-center gap-2">
                <input type="radio" name="category" value="" defaultChecked={!category} /> All supported
              </label>
              {Object.entries(CATEGORIES).map(([k, v]) => (
                <label key={k} className="flex items-center gap-2">
                  <input type="radio" name="category" value={k} defaultChecked={category === k} /> {v.label}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="text-sm font-semibold">Condition</legend>
            <div className="mt-2 space-y-1 text-sm">
              {(["new", "refurbished", "used"] as const).map((c) => (
                <label key={c} className="flex items-center gap-2">
                  <input type="radio" name="condition" value={c} defaultChecked={condition === c} /> {c[0]!.toUpperCase() + c.slice(1)}
                </label>
              ))}
            </div>
          </fieldset>
          {filterDefs.length > 0 && (
            <fieldset>
              <legend className="text-sm font-semibold">{CATEGORIES[category!].label} details</legend>
              <div className="mt-2 space-y-3 text-sm">
                {filterDefs.map((a) => (
                  <label key={a.key} className="block">
                    <span className="text-muted">{a.label}</span>
                    <input name={`f.${a.key}`} defaultValue={filters[a.key] ?? ""} className="mt-1 block w-full rounded-md border border-[#9aa3b2] px-2 py-1" />
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          <fieldset>
            <legend className="text-sm font-semibold">Sort</legend>
            <select name="sort" defaultValue={sort} className="mt-2 block w-full rounded-md border border-[#9aa3b2] bg-card px-2 py-1 text-sm" aria-label="Sort results">
              <option value="relevance">Best match</option>
              <option value="lowest_total">Lowest known total (eligible offers)</option>
            </select>
          </fieldset>
          <button className="w-full rounded-md border border-teal px-3 py-2 text-sm font-medium text-teal hover:bg-teal-soft">Apply filters</button>
        </form>
        {result && (
          <div className="text-xs text-muted">
            <p className="font-semibold text-ink">Coverage</p>
            <p>{result.coverage.market}</p>
            <ul className="mt-1 list-disc pl-4">
              {result.coverage.sources.map((src) => (
                <li key={src.id}>
                  {src.name}
                  {src.mode === "demo" ? " — sample data" : " — live prices"}
                </li>
              ))}
            </ul>
          </div>
        )}
      </aside>

      <section aria-labelledby="results-heading">
        <Suspense>
          <SearchForm initial={q} />
        </Suspense>
        <h1 id="results-heading" className="mt-6 text-xl font-semibold">
          {q ? <>Results for “{q}”</> : category ? CATEGORIES[category].label : "All supported products"}
          {result && <span className="ml-2 text-sm font-normal text-muted">({result.total})</span>}
        </h1>
        {error && (
          <div className="mt-4">
            <Notice tone="bad" title="Search failed">
              {error} <Link href={link({ cursor: null })} className="underline">Retry</Link>
            </Notice>
          </div>
        )}
        {result && result.items.length === 0 && (
          <div className="mt-4 space-y-4">
            <Notice title="No matching supported products">
              BuyTrail currently covers headphones, computer monitors and small appliances from the sources listed under Coverage. It doesn&apos;t search the
              whole internet. Try a model code (e.g. “CP27Q”), a brand, or a broader word like “monitor”.
            </Notice>
            {q && <RequestProductForm query={q} />}
          </div>
        )}
        <ul className="mt-4 space-y-3">
          {result?.items.map((it) => (
            <li key={it.productId}>
              <Card className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div aria-hidden="true" className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-paper text-xs text-muted">
                  No image
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="font-semibold">
                    <Link href={`/products/${it.productId}${it.variantId ? `?variant=${it.variantId}` : ""}`} className="hover:text-teal hover:underline">
                      {it.title}
                    </Link>
                  </h2>
                  <p className="mt-0.5 text-sm text-muted">
                    Model {it.modelCodes.join(" / ")}
                    {it.distinguishing.length > 0 && <> · {it.distinguishing.join(" · ")}</>}
                    {it.needsVariantChoice && <> · {it.variantCount} variants</>}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {it.isDemo ? <SampleBadge /> : <LiveBadge />}
                    <Badge tone={condition === "new" ? "neutral" : "warn"}>{condition[0]!.toUpperCase() + condition.slice(1)}</Badge>
                    <Badge>{it.eligibleOfferCount} eligible offer{it.eligibleOfferCount === 1 ? "" : "s"}</Badge>
                    {it.incompleteTotalCount > 0 && <Badge tone="warn">{it.incompleteTotalCount} with total not confirmed</Badge>}
                    {it.latestCheckAt && <Badge>Checked {relativeAge(new Date(it.latestCheckAt), now)}</Badge>}
                  </div>
                </div>
                <div className="text-left sm:text-right">
                  <p className={`tabular font-semibold ${it.bestKnownTotal ? "" : "text-muted"}`}>{it.priceLabel}</p>
                  <Link href={`/products/${it.productId}${it.variantId ? `?variant=${it.variantId}` : ""}`} className="mt-1 inline-block text-sm font-medium text-teal underline">
                    {it.needsVariantChoice ? "Choose a variant" : "Compare offers"}
                  </Link>
                </div>
              </Card>
            </li>
          ))}
        </ul>
        {result?.nextCursor && (
          <div className="mt-6 text-center">
            <Link href={link({ cursor: result.nextCursor })} className="rounded-md border border-line bg-card px-4 py-2 text-sm font-medium hover:bg-paper">
              More results
            </Link>
          </div>
        )}
      </section>
    </div>
  );
}
