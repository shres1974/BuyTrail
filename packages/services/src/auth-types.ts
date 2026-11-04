import { AppError } from "./errors";

/** Authenticated actor resolved on the server from the session. Never from client input. */
export type Actor = { id: string; email: string; role: "user" | "admin"; timezone: string };

/** Administrator access is explicit (role column set by admin-grant), never inferred. */
export function requireAdmin(actor: Actor): void {
  if (actor.role !== "admin") throw new AppError("FORBIDDEN", "Administrator access required");
}
