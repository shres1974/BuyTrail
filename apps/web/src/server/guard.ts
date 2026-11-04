import { redirect } from "next/navigation";
import type { Actor } from "@buytrail/services";
import { currentActor } from "./http";

/** Server-side page guard. Every private page and API independently checks ownership. */
export async function pageActor(nextPath: string): Promise<Actor> {
  const a = await currentActor();
  if (!a) redirect(`/sign-in?next=${encodeURIComponent(nextPath)}`);
  return a;
}
