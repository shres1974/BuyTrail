import Link from "next/link";
import { listWatches, readiness } from "@buytrail/services";
import { relativeAge } from "@buytrail/domain";
import { pageActor } from "@/server/guard";
import { services } from "@/server/services";
import { Card, LiveBadge, Notice, PageTitle, SampleBadge, Badge } from "@/components/ui";
import { WatchActions } from "@/components/WatchActions";

export const metadata = { title: "Watchlist" };

export default async function Watchlist() {
  const actor = await pageActor("/watchlist");
  const s = services();
  const now = s.clock.now();
  const [watches, ready] = await Promise.all([listWatches(s.db, now, actor), readiness(s.db, now)]);
  return (
    <div>
      <PageTitle sub="Target-price watches compare the lowest eligible known total before tax for an exact variant.">Watchlist</PageTitle>
      {!ready.worker.alive && (
        <div className="mb-4">
          <Notice tone="warn" title="Background checks are paused">
            The background worker isn&apos;t running, so prices aren&apos;t being re-evaluated and alerts won&apos;t be sent until it restarts.
          </Notice>
        </div>
      )}
      {watches.length === 0 ? (
        <Notice title="No watches yet">
          Find an item with <Link href="/search" className="underline">Search</Link>, choose its exact variant, and save a target price.
        </Notice>
      ) : (
        <ul className="space-y-3">
          {watches.map((w) => (
            <li key={w.id} id={w.id}>
              <Card>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <h2 className="font-semibold">
                      <Link href={`/products/${w.productId}?variant=${w.variantId}${w.condition !== "new" ? `&condition=${w.condition}` : ""}`} className="hover:text-teal hover:underline">
                        {w.title}
                      </Link>
                    </h2>
                    <div className="mt-1 flex flex-wrap gap-2 text-xs">
                      {w.isDemo ? <SampleBadge /> : <LiveBadge />}
                      <Badge>{w.condition}</Badge>
                      <Badge tone={w.status === "Meets target" ? "good" : w.status === "Paused" ? "neutral" : w.status.startsWith("Unable") ? "bad" : w.status.startsWith("No eligible") ? "warn" : "teal"}>{w.status}</Badge>
                      <Badge>{w.channels.includes("email") ? "In-app + email" : "In-app only"}</Badge>
                    </div>
                    <dl className="tabular mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
                      <div>
                        <dt className="text-muted">Target</dt>
                        <dd className="font-semibold">{w.target.display}</dd>
                      </div>
                      <div>
                        <dt className="text-muted">Current best eligible</dt>
                        <dd className="font-semibold">{w.currentBest?.display ?? "None"}</dd>
                      </div>
                      <div>
                        <dt className="text-muted">Last check</dt>
                        <dd>{w.lastCheckAt ? relativeAge(new Date(w.lastCheckAt), now) : "Never"}</dd>
                      </div>
                    </dl>
                  </div>
                  <WatchActions watch={{ id: w.id, version: w.version, lifecycle: w.lifecycle, target: w.target, channels: w.channels }} />
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
