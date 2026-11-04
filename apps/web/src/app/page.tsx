import Link from "next/link";
import { Card } from "@/components/ui";
import { SearchForm } from "@/components/SearchForm";

export default function Home() {
  return (
    <div className="mx-auto max-w-3xl">
      <section className="py-8 text-center">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Find the right item, understand the cost, and keep track after you buy.</h1>
        <p className="mx-auto mt-3 max-w-2xl text-muted">
          Choose the exact model and variant, compare offers by their known total before tax, set a budget watch, and keep your purchases, receipts and return
          dates in one private notebook. Retailers handle checkout.
        </p>
        <div className="mx-auto mt-6 max-w-xl text-left">
          <SearchForm />
        </div>
        <p className="mt-3 text-sm text-muted">
          Supported now: headphones, computer monitors and small appliances · Canada · CAD. Try{" "}
          <Link className="text-teal underline" href="/search?q=CP27Q">
            CP27Q
          </Link>
          ,{" "}
          <Link className="text-teal underline" href="/search?q=northline+quiet">
            Northline Quiet
          </Link>{" "}
          or{" "}
          <Link className="text-teal underline" href="/search?q=kettle">
            kettle
          </Link>
          .
        </p>
      </section>
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <h2 className="font-semibold">Exact variants</h2>
          <p className="mt-1 text-sm text-muted">A 144 Hz model, a 2-pack or a refurbished unit is never silently compared with the item you picked.</p>
        </Card>
        <Card>
          <h2 className="font-semibold">Honest totals</h2>
          <p className="mt-1 text-sm text-muted">Item price + known shipping + known fees, before tax. Unknown shipping is shown separately and never ranked as cheapest.</p>
        </Card>
        <Card>
          <h2 className="font-semibold">After you buy</h2>
          <p className="mt-1 text-sm text-muted">Record what you paid, attach a receipt, and get a reminder before a return date you confirmed.</p>
        </Card>
      </div>
    </div>
  );
}
