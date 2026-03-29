import { createDb } from "./src/client.js";
import { companies, agents } from "./src/schema/index.js";
import { eq } from "drizzle-orm";

const url = process.env.DATABASE_URL || "postgres://paperclip:paperclip@127.0.0.1:54329/paperclip";
const db = createDb(url);

console.log("=== Querying database ===\n");

// 查询所有公司
const allCompanies = await db.select().from(companies);
console.log("Companies:");
console.table(allCompanies.map(c => ({ id: c.id, name: c.name, status: c.status })));

// 查询所有 agents
const allAgents = await db.select().from(agents);
console.log("\nAgents:");
console.table(allAgents.map(a => ({ id: a.id, name: a.name, role: a.role, status: a.status, companyId: a.companyId })));

// 查找 Echo agent
console.log("\n=== Looking for Echo Agent ===");
const echoId = "49069b5c-b675-4197-929e-bcf05c29a5b1";
const echo = await db.select().from(agents).where(eq(agents.id, echoId));

if (echo.length > 0) {
  console.log("Echo agent found:");
  console.log(JSON.stringify(echo[0], null, 2));
} else {
  console.log(`Echo agent (${echoId}) not found in database`);
  console.log("\nAvailable agents:");
  allAgents.forEach(a => {
    console.log(`  - ${a.name} (${a.id}) - ${a.role}`);
  });
}

process.exit(0);
