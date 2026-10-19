// The current release test requires an explicit deployed-build hash before mutation.
// See release-ten-users-check.README.md; no args is a read-only help operation.
import { main } from './release-ten-users-check.mjs';
import { safeCode } from './release-ten-users-support.mjs';

main().catch((error) => {
  process.stderr.write(`Ten-user verification stopped (${safeCode(error)}). No credentials are printed; inspect the exact private run ledger.\n`);
  process.exitCode = 1;
});
