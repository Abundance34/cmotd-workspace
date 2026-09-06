import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL || "postgresql://procureflow:procureflow_local_only@db:5432/procureflow";
const sql = postgres(databaseUrl, { max: 1, connect_timeout: 10 });

const departments = [
  "Administration",
  "CMOTD",
  "CMOTD AND RACAM",
  "Facilities",
  "Finance",
  "General",
  "Logistics",
  "Maintenance",
  "Operations",
  "RACAM",
];

try {
  const now = new Date().toISOString();
  for (const name of departments) {
    await sql`
      INSERT INTO departments (name, description, status, created_at)
      VALUES (${name}, ${`Local ProcureFlow department: ${name}`}, 'Active', ${now})
      ON CONFLICT (name) DO UPDATE SET status = 'Active'
    `;
  }
  console.log(`Local Facility departments ready: ${departments.join(", ")}`);
} finally {
  await sql.end({ timeout: 5 });
}
