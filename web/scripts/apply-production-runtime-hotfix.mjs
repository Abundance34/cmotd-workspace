import fs from "node:fs";
import path from "node:path";

const root = "/app";
function read(relativePath) { return fs.readFileSync(path.join(root, relativePath), "utf8").replace(/\r\n?/g, "\n"); }
function write(relativePath, value) { fs.writeFileSync(path.join(root, relativePath), value, "utf8"); }

// Fix the Procurement dashboard base query. The ICT materializer adds requester.*
// columns to the SELECT, but an existing requester join elsewhere in the file
// caused its guard to skip adding the JOIN to this base query.
{
  const relativePath = "lib/procureflow/procurement-data.ts";
  let source = read(relativePath);
  const broken = "    FROM purchase_requests pr\n    LEFT JOIN users fm ON fm.id = pr.facility_manager_user_id\n  `;";
  const fixed = "    FROM purchase_requests pr\n    LEFT JOIN users fm ON fm.id = pr.facility_manager_user_id\n    LEFT JOIN users requester ON requester.id = pr.requested_by\n  `;";
  if (source.includes("requester.full_name AS requester_name") && source.includes(broken)) {
    source = source.replace(broken, fixed);
  }
  write(relativePath, source);
}

// PostgreSQL string literals use single quotes. The ICT materializer generated
// string_agg(pr.request_no, ", "), which PostgreSQL interprets as a column name.
{
  const relativePath = "lib/procureflow/parity-data.ts";
  let source = read(relativePath);
  source = source.replaceAll('string_agg(pr.request_no, ", ")', "string_agg(pr.request_no, ', ')");
  write(relativePath, source);
}

console.log("Production runtime SQL hotfix applied: Procurement requester JOIN and reimbursement request aggregation repaired.");
