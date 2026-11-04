/**
 * pnpm admin:grant <email> — grant administrator role explicitly (audited). The only way to
 * become admin besides ADMIN_EMAILS in non-live local/demo setups.
 */
import "./_env";
import { getPrisma } from "@buytrail/db";
import { grantAdmin } from "@buytrail/services";

const email = process.argv[2];
if (!email) {
  console.error("Usage: pnpm admin:grant <email>");
  process.exit(1);
}
const db = getPrisma();
grantAdmin(db, email)
  .then(() => console.log(`Granted admin to ${email}.`))
  .catch((e) => {
    console.error(`Failed: ${e.message}`);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
