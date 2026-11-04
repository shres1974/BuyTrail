/** Load the repository-root .env for scripts (never overrides already-set variables). */
import path from "node:path";
import { config } from "dotenv";
config({ path: path.resolve(import.meta.dirname, "../.env"), quiet: true });
