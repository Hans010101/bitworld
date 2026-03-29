#!/usr/bin/env node
import pg from 'pg';
const { Client } = pg;

const client = new Client({
  connectionString: 'postgres://paperclip:paperclip@127.0.0.1:54329/paperclip'
});

try {
  await client.connect();

  console.log('=== Companies ===');
  const companies = await client.query('SELECT id, name, issue_prefix, status FROM companies LIMIT 10');
  console.table(companies.rows);

  console.log('\n=== Agents ===');
  const agents = await client.query('SELECT id, company_id, name, role, status FROM agents LIMIT 10');
  console.table(agents.rows);

  // 查找 Echo agent
  console.log('\n=== Echo Agent ===');
  const echo = await client.query("SELECT * FROM agents WHERE id = '49069b5c-b675-4197-929e-bcf05c29a5b1'");
  if (echo.rows.length > 0) {
    console.log(JSON.stringify(echo.rows[0], null, 2));
  } else {
    console.log('Echo agent not found');
  }

} catch (err) {
  console.error('Error:', err.message);
} finally {
  await client.end();
}
