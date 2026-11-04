import { redirect } from "next/navigation";
import { currentActor } from "@/server/http";
import { services } from "@/server/services";
import { PageTitle } from "@/components/ui";
import { SignInForm } from "@/components/SignInForm";

export const metadata = { title: "Sign in" };

/** Only same-site relative paths are allowed as post-sign-in destinations. */
function safeNext(n: string | undefined) {
  return n && n.startsWith("/") && !n.startsWith("//") && !n.includes("\\") ? n.slice(0, 500) : "/watchlist";
}

export default async function SignIn({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const sp = await searchParams;
  const next = safeNext(sp.next);
  if (await currentActor()) redirect(next);
  const s = services();
  return (
    <div className="mx-auto max-w-md">
      <PageTitle sub="We'll email you a one-time sign-in link. No password needed.">Sign in to BuyTrail</PageTitle>
      <SignInForm next={next} localMailbox={s.config.EMAIL_MODE === "local" ? s.config.MAILPIT_API_URL : null} />
    </div>
  );
}
