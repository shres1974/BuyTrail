import Link from "next/link";
import { formatMoney, money, relativeAge } from "@buytrail/domain";
import { listNotifications } from "@buytrail/services";
import { pageActor } from "@/server/guard";
import { services } from "@/server/services";
import { Badge, Card, Notice, PageTitle, SampleBadge } from "@/components/ui";
import { MarkReadButton } from "@/components/MarkReadButton";

export const metadata = { title: "Alerts" };

const DELIVERY_TEXT: Record<string, string> = {
  pending: "Email pending",
  claimed: "Email sending",
  accepted: "Email accepted by mail provider",
  retryable_failure: "Email will be retried",
  permanent_failure: "Email failed",
  unknown_outcome: "Email outcome unknown (not resent)",
  suppressed: "Email not sent",
  cancelled: "Email cancelled",
};

export default async function Notifications() {
  const actor = await pageActor("/notifications");
  const s = services();
  const now = s.clock.now();
  const items = await listNotifications(s.db, actor.id);
  const unread = items.filter((i) => !i.readAt).map((i) => i.id);
  return (
    <div>
      <PageTitle sub="Durable in-app alerts. Email is a separate delivery that may be delayed by your 24-hour cooldown or preferences.">Alerts</PageTitle>
      {unread.length > 0 && (
        <div className="mb-4">
          <MarkReadButton ids={unread} />
        </div>
      )}
      {items.length === 0 ? (
        <Notice title="No alerts yet">When a watched variant&apos;s eligible total reaches your target, or a return reminder is due, it appears here.</Notice>
      ) : (
        <ul className="space-y-3" data-testid="alerts">
          {items.map((n) => {
            const p = n.payload as Record<string, unknown>;
            const email = n.deliveries.find((d) => d.channel === "email");
            return (
              <li key={n.id}>
                <Card className={n.readAt ? "" : "border-teal/40"}>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    {n.isDemo && <Badge tone="sample">Sample alert — demonstration mode</Badge>}
                    {!n.readAt && <Badge tone="teal">New</Badge>}
                    <span className="text-muted">{relativeAge(new Date(n.createdAt), now)}</span>
                    {email && (
                      <Badge tone={email.state === "accepted" ? "good" : email.state.includes("failure") || email.state === "unknown_outcome" ? "warn" : "neutral"}>
                        {DELIVERY_TEXT[email.state] ?? email.state}
                        {email.state === "pending" && new Date(email.notBefore) > now ? ` until ${new Date(email.notBefore).toLocaleString("en-CA", { timeZone: actor.timezone })}` : ""}
                        {email.suppressedReason ? ` (${email.suppressedReason.replace(/_/g, " ")})` : ""}
                      </Badge>
                    )}
                  </div>
                  {n.type === "price_target_met" ? (
                    <div className="mt-2">
                      <h2 className="font-semibold">{String(p.headline)}</h2>
                      <p className="mt-1 text-sm">{String(p.title)} · {String(p.condition)}</p>
                      <p className="tabular mt-1 text-sm">
                        {formatMoney(money(BigInt((p.observedTotal as { amountMinor: string }).amountMinor)))} known total before tax at {String(p.merchant)} · your target{" "}
                        {formatMoney(money(BigInt((p.target as { amountMinor: string }).amountMinor)))}
                      </p>
                      <p className="mt-1 text-xs text-muted">Checked {relativeAge(new Date(String(p.checkedAt)), now)}. Prices may have changed since; the retailer&apos;s checkout is authoritative.</p>
                      <Link href={`/products/${String(p.productId)}?variant=${String(p.variantId)}`} className="mt-2 inline-block text-sm font-medium text-teal underline">
                        See current offers
                      </Link>
                    </div>
                  ) : n.type === "return_reminder" ? (
                    <div className="mt-2">
                      <h2 className="font-semibold">{String(p.headline)}</h2>
                      <p className="mt-1 text-sm">
                        Return date you set: {String(p.date)}
                        {p.cutoffTime ? ` at ${String(p.cutoffTime)}` : ""} ({String(p.timezone)}). BuyTrail can&apos;t confirm the retailer will accept a return.
                      </p>
                      <Link href="/purchases" className="mt-2 inline-block text-sm font-medium text-teal underline">
                        Open purchases
                      </Link>
                    </div>
                  ) : (
                    <p className="mt-2 text-sm">{String(p.message ?? n.type)}</p>
                  )}
                </Card>
              </li>
            );
          })}
        </ul>
      )}
      {items.some((i) => i.isDemo) && (
        <p className="mt-6 text-xs text-muted">
          <SampleBadge /> Alerts above come from simulated sample prices, not real retailers.
        </p>
      )}
    </div>
  );
}
