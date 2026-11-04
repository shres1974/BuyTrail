import { notFound } from "next/navigation";
import { adminMatchQueue, adminSources } from "@buytrail/services";
import { pageActor } from "@/server/guard";
import { services } from "@/server/services";
import { Badge, Card, PageTitle } from "@/components/ui";
import { MatchDecisionForm } from "@/components/MatchDecisionForm";

export const metadata = { title: "Admin" };

export default async function Admin() {
  const actor = await pageActor("/admin");
  // Non-admins get a 404: the admin surface is not advertised (server-side check).
  if (actor.role !== "admin") notFound();
  const s = services();
  const [sources, queue] = await Promise.all([adminSources(s.db, actor, s.clock.now()), adminMatchQueue(s.db, actor)]);
  return (
    <div className="space-y-8">
      <PageTitle sub="Source health, permissions and uncertain matches. Every decision is audited.">Administration</PageTitle>
      <section aria-labelledby="src-h">
        <h2 id="src-h" className="mb-3 text-lg font-semibold">
          Sources
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <caption className="sr-only">Source health</caption>
            <thead className="text-left text-xs uppercase text-muted">
              <tr>
                <th scope="col" className="py-2">Source</th>
                <th scope="col">Mode / approval</th>
                <th scope="col">Status</th>
                <th scope="col">Budget today</th>
                <th scope="col">Last success / failure</th>
                <th scope="col">Listings by match status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {sources.map((x) => (
                <tr key={x.id}>
                  <th scope="row" className="py-2 text-left font-medium">
                    {x.name}
                    <span className="block text-xs font-normal text-muted">{x.id}</span>
                  </th>
                  <td>
                    <Badge tone={x.mode === "demo" ? "sample" : "neutral"}>{x.mode}</Badge> {x.approvalStatus}
                  </td>
                  <td>
                    <Badge tone={x.status === "enabled" ? "good" : x.status === "disabled" ? "neutral" : "warn"}>{x.status}</Badge>
                  </td>
                  <td className="tabular">
                    {x.usedToday} / {x.dailyRequestBudget}
                  </td>
                  <td className="text-xs">
                    {x.lastSuccessAt ?? "—"}
                    <br />
                    {x.lastFailureAt ? `${x.lastFailureAt} (${x.lastFailureCode})` : "—"}
                  </td>
                  <td className="text-xs">
                    {Object.entries(x.listingsByMatchStatus)
                      .map(([k, v]) => `${k}: ${v}`)
                      .join(", ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section aria-labelledby="mq-h">
        <h2 id="mq-h" className="mb-3 text-lg font-semibold">
          Match review queue ({queue.length})
        </h2>
        <p className="mb-3 text-sm text-muted">Candidates and quarantined listings never appear in comparisons until verified here.</p>
        <ul className="space-y-3">
          {queue.map((d) => (
            <li key={d.id}>
              <Card>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={d.status === "quarantined" ? "bad" : "warn"}>{d.status}</Badge>
                  <span className="text-xs text-muted">{d.reason}</span>
                  {d.listing.isDemo && <Badge tone="sample">Sample data</Badge>}
                </div>
                <p className="mt-2 font-medium">{d.listing.title}</p>
                <p className="text-xs text-muted">
                  {d.listing.merchant} · {d.listing.externalListingId} · brand {d.listing.brand ?? "—"} · model {d.listing.model ?? "—"} · ids{" "}
                  {JSON.stringify(d.listing.identifiers)}
                </p>
                <p className="mt-1 text-xs">Attributes: {JSON.stringify(d.listing.attributes)}</p>
                <p className="mt-1 text-xs text-muted">Evidence: {(d.evidence as string[]).join("; ")}</p>
                <MatchDecisionForm decisionId={d.id} candidates={d.candidates.map((c) => ({ id: c.id, title: `${c.title} (${c.modelCode}) ${JSON.stringify(c.attributes)}` }))} />
              </Card>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
