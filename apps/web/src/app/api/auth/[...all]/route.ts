import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/server/auth";

// Better Auth mounts its own routes (magic-link sign-in/verify, session, sign-out).
const handler = (req: Request) => auth().handler(req);
export const { GET, POST } = toNextJsHandler(handler);
