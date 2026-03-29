import postgres from "postgres";

const sql = postgres("postgres://paperclip:paperclip@127.0.0.1:54329/paperclip");

async function query() {
  try {
    console.log("=== Companies ===");
    const companies = await sql`SELECT id, name, issue_prefix, status FROM companies LIMIT 10`;
    console.table(companies);

    console.log("\n=== Agents ===");
    const agents = await sql`SELECT id, company_id, name, role, status FROM agents LIMIT 10`;
    console.table(agents);

    console.log("\n=== Echo Agent ===");
    const echo = await sql`SELECT * FROM agents WHERE id = ${'49069b5c-b675-4197-929e-bcf05c29a5b1'}`;
    if (echo.length > 0) {
      console.log(JSON.stringify(echo[0], null, 2));
    } else {
      console.log("Echo agent not found");
    }
  } catch (err: any) {
    console.error("Error:", err.message);
  } finally {
    await sql.end();
  }
}

query();
