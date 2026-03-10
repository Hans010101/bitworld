import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import postgres from "postgres";

export type RunDatabaseBackupOptions = {
  connectionString: string;
  backupDir: string;
  retentionDays: number;
  filenamePrefix?: string;
  connectTimeoutSeconds?: number;
  includeMigrationJournal?: boolean;
  excludeTables?: string[];
  nullifyColumns?: Record<string, string[]>;
};

export type RunDatabaseBackupResult = {
  backupFile: string;
  sizeBytes: number;
  prunedCount: number;
};

export type RunDatabaseRestoreOptions = {
  connectionString: string;
  backupFile: string;
  connectTimeoutSeconds?: number;
};

type SequenceDefinition = {
  sequence_name: string;
  data_type: string;
  start_value: string;
  minimum_value: string;
  maximum_value: string;
  increment: string;
  cycle_option: "YES" | "NO";
  owner_table: string | null;
  owner_column: string | null;
};

const STATEMENT_BREAKPOINT = "-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900";

function sanitizeRestoreErrorMessage(error: unknown): string {
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    const firstLine = typeof record.message === "string"
      ? record.message.split(/\r?\n/, 1)[0]?.trim()
      : "";
    const detail = typeof record.detail === "string" ? record.detail.trim() : "";
    const severity = typeof record.severity === "string" ? record.severity.trim() : "";
    const message = firstLine || detail || (error instanceof Error ? error.message : String(error));
    return severity ? `${severity}: ${message}` : message;
  }
  return error instanceof Error ? error.message : String(error);
}

function timestamp(date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function pruneOldBackups(backupDir: string, retentionDays: number, filenamePrefix: string): number {
  if (!existsSync(backupDir)) return 0;
  const safeRetention = Math.max(1, Math.trunc(retentionDays));
  const cutoff = Date.now() - safeRetention * 24 * 60 * 60 * 1000;
  let pruned = 0;

  for (const name of readdirSync(backupDir)) {
    if (!name.startsWith(`${filenamePrefix}-`) || !name.endsWith(".sql")) continue;
    const fullPath = resolve(backupDir, name);
    const stat = statSync(fullPath);
    if (stat.mtimeMs < cutoff) {
      unlinkSync(fullPath);
      pruned++;
    }
  }

  return pruned;
}

function formatBackupSize(sizeBytes: number): string {
  if (sizeBytes < 1024) return `${sizeBytes}B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)}K`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)}M`;
}

function formatSqlLiteral(value: string): string {
  const sanitized = value.replace(/\u0000/g, "");
  let tag = "$paperclip$";
  while (sanitized.includes(tag)) {
    tag = `$paperclip_${Math.random().toString(36).slice(2, 8)}$`;
  }
  return `${tag}${sanitized}${tag}`;
}

function normalizeTableNameSet(values: string[] | undefined): Set<string> {
  return new Set(
    (values ?? [])
      .map((value) => value.trim())
      .filter((value) => value.length > 0),
  );
}

function normalizeNullifyColumnMap(values: Record<string, string[]> | undefined): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  if (!values) return out;
  for (const [tableName, columns] of Object.entries(values)) {
    const normalizedTable = tableName.trim();
    if (normalizedTable.length === 0) continue;
    const normalizedColumns = new Set(
      columns
        .map((column) => column.trim())
        .filter((column) => column.length > 0),
    );
    if (normalizedColumns.size > 0) {
      out.set(normalizedTable, normalizedColumns);
    }
  }
  return out;
}

export async function runDatabaseBackup(opts: RunDatabaseBackupOptions): Promise<RunDatabaseBackupResult> {
  const filenamePrefix = opts.filenamePrefix ?? "paperclip";
  const retentionDays = Math.max(1, Math.trunc(opts.retentionDays));
  const connectTimeout = Math.max(1, Math.trunc(opts.connectTimeoutSeconds ?? 5));
  const includeMigrationJournal = opts.includeMigrationJournal === true;
  const excludedTableNames = normalizeTableNameSet(opts.excludeTables);
  const nullifiedColumnsByTable = normalizeNullifyColumnMap(opts.nullifyColumns);
  const sql = postgres(opts.connectionString, { max: 1, connect_timeout: connectTimeout });

  try {
    await sql`SELECT 1`;

    const lines: string[] = [];
    const emit = (line: string) => lines.push(line);
    const emitStatement = (statement: string) => {
      emit(statement);
      emit(STATEMENT_BREAKPOINT);
    };
    const emitStatementBoundary = () => {
      emit(STATEMENT_BREAKPOINT);
    };

    emit("-- Paperclip database backup");
    emit(`-- Created: ${new Date().toISOString()}`);
    emit("");
    emitStatement("BEGIN;");
    emitStatement("SET LOCAL session_replication_role = replica;");
    emitStatement("SET LOCAL client_min_messages = warning;");
    emit("");

    const allTables = await sql<{ tablename: string }[]>`
      SELECT c.relname AS tablename
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
      ORDER BY c.relname
    `;
    const tables = allTables.filter(({ tablename }) => {
      if (!includeMigrationJournal && tablename === "__drizzle_migrations") return false;
      return !excludedTableNames.has(tablename);
    });
    const includedTableNames = new Set(tables.map(({ tablename }) => tablename));

    // Get all enums
    const enums = await sql<{ typname: string; labels: string[] }[]>`
      SELECT t.typname, array_agg(e.enumlabel ORDER BY e.enumsortorder) AS labels
      FROM pg_type t
      JOIN pg_enum e ON t.oid = e.enumtypid
      JOIN pg_namespace n ON t.typnamespace = n.oid
      WHERE n.nspname = 'public'
      GROUP BY t.typname
      ORDER BY t.typname
    `;

    for (const e of enums) {
      const labels = e.labels.map((l) => `'${l.replace(/'/g, "''")}'`).join(", ");
      emitStatement(`CREATE TYPE "public"."${e.typname}" AS ENUM (${labels});`);
    }
    if (enums.length > 0) emit("");

    const allSequences = await sql<SequenceDefinition[]>`
      SELECT
        s.sequence_name,
        s.data_type,
        s.start_value,
        s.minimum_value,
        s.maximum_value,
        s.increment,
        s.cycle_option,
        tbl.relname AS owner_table,
        attr.attname AS owner_column
      FROM information_schema.sequences s
      JOIN pg_class seq ON seq.relname = s.sequence_name
      JOIN pg_namespace n ON n.oid = seq.relnamespace AND n.nspname = s.sequence_schema
      LEFT JOIN pg_depend dep ON dep.objid = seq.oid AND dep.deptype = 'a'
      LEFT JOIN pg_class tbl ON tbl.oid = dep.refobjid
      LEFT JOIN pg_attribute attr ON attr.attrelid = tbl.oid AND attr.attnum = dep.refobjsubid
      WHERE s.sequence_schema = 'public'
      ORDER BY s.sequence_name
    `;
    const sequences = allSequences.filter((seq) => !seq.owner_table || includedTableNames.has(seq.owner_table));

    if (sequences.length > 0) {
      emit("-- Sequences");
      for (const seq of sequences) {
        emitStatement(`DROP SEQUENCE IF EXISTS "${seq.sequence_name}" CASCADE;`);
        emitStatement(
          `CREATE SEQUENCE "${seq.sequence_name}" AS ${seq.data_type} INCREMENT BY ${seq.increment} MINVALUE ${seq.minimum_value} MAXVALUE ${seq.maximum_value} START WITH ${seq.start_value}${seq.cycle_option === "YES" ? " CYCLE" : " NO CYCLE"};`,
        );
      }
      emit("");
    }

    // Get full CREATE TABLE DDL via column info
    for (const { tablename } of tables) {
      const columns = await sql<{
        column_name: string;
        data_type: string;
        udt_name: string;
        is_nullable: string;
        column_default: string | null;
        character_maximum_length: number | null;
        numeric_precision: number | null;
        numeric_scale: number | null;
      }[]>`
        SELECT column_name, data_type, udt_name, is_nullable, column_default,
               character_maximum_length, numeric_precision, numeric_scale
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = ${tablename}
        ORDER BY ordinal_position
      `;

      emit(`-- Table: ${tablename}`);
      emitStatement(`DROP TABLE IF EXISTS "${tablename}" CASCADE;`);

      const colDefs: string[] = [];
      for (const col of columns) {
        let typeStr: string;
        if (col.data_type === "USER-DEFINED") {
          typeStr = `"${col.udt_name}"`;
        } else if (col.data_type === "ARRAY") {
          typeStr = `${col.udt_name.replace(/^_/, "")}[]`;
        } else if (col.data_type === "character varying") {
          typeStr = col.character_maximum_length
            ? `varchar(${col.character_maximum_length})`
            : "varchar";
        } else if (col.data_type === "numeric" && col.numeric_precision != null) {
          typeStr =
            col.numeric_scale != null
              ? `numeric(${col.numeric_precision}, ${col.numeric_scale})`
              : `numeric(${col.numeric_precision})`;
        } else {
          typeStr = col.data_type;
        }

        let def = `  "${col.column_name}" ${typeStr}`;
        if (col.column_default != null) def += ` DEFAULT ${col.column_default}`;
        if (col.is_nullable === "NO") def += " NOT NULL";
        colDefs.push(def);
      }

      // Primary key
      const pk = await sql<{ constraint_name: string; column_names: string[] }[]>`
        SELECT c.conname AS constraint_name,
               array_agg(a.attname ORDER BY array_position(c.conkey, a.attnum)) AS column_names
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(c.conkey)
        WHERE n.nspname = 'public' AND t.relname = ${tablename} AND c.contype = 'p'
        GROUP BY c.conname
      `;
      for (const p of pk) {
        const cols = p.column_names.map((c) => `"${c}"`).join(", ");
        colDefs.push(`  CONSTRAINT "${p.constraint_name}" PRIMARY KEY (${cols})`);
      }

      emit(`CREATE TABLE "${tablename}" (`);
      emit(colDefs.join(",\n"));
      emit(");");
      emitStatementBoundary();
      emit("");
    }

    const ownedSequences = sequences.filter((seq) => seq.owner_table && seq.owner_column);
    if (ownedSequences.length > 0) {
      emit("-- Sequence ownership");
      for (const seq of ownedSequences) {
        emitStatement(
          `ALTER SEQUENCE "${seq.sequence_name}" OWNED BY "${seq.owner_table!}"."${seq.owner_column!}";`,
        );
      }
      emit("");
    }

    // Foreign keys (after all tables created)
    const allForeignKeys = await sql<{
      constraint_name: string;
      source_table: string;
      source_columns: string[];
      target_table: string;
      target_columns: string[];
      update_rule: string;
      delete_rule: string;
    }[]>`
      SELECT
        c.conname AS constraint_name,
        src.relname AS source_table,
        array_agg(sa.attname ORDER BY array_position(c.conkey, sa.attnum)) AS source_columns,
        tgt.relname AS target_table,
        array_agg(ta.attname ORDER BY array_position(c.confkey, ta.attnum)) AS target_columns,
        CASE c.confupdtype WHEN 'a' THEN 'NO ACTION' WHEN 'r' THEN 'RESTRICT' WHEN 'c' THEN 'CASCADE' WHEN 'n' THEN 'SET NULL' WHEN 'd' THEN 'SET DEFAULT' END AS update_rule,
        CASE c.confdeltype WHEN 'a' THEN 'NO ACTION' WHEN 'r' THEN 'RESTRICT' WHEN 'c' THEN 'CASCADE' WHEN 'n' THEN 'SET NULL' WHEN 'd' THEN 'SET DEFAULT' END AS delete_rule
      FROM pg_constraint c
      JOIN pg_class src ON src.oid = c.conrelid
      JOIN pg_class tgt ON tgt.oid = c.confrelid
      JOIN pg_namespace n ON n.oid = src.relnamespace
      JOIN pg_attribute sa ON sa.attrelid = src.oid AND sa.attnum = ANY(c.conkey)
      JOIN pg_attribute ta ON ta.attrelid = tgt.oid AND ta.attnum = ANY(c.confkey)
      WHERE c.contype = 'f' AND n.nspname = 'public'
      GROUP BY c.conname, src.relname, tgt.relname, c.confupdtype, c.confdeltype
      ORDER BY src.relname, c.conname
    `;
    const fks = allForeignKeys.filter(
      (fk) => includedTableNames.has(fk.source_table) && includedTableNames.has(fk.target_table),
    );

    if (fks.length > 0) {
      emit("-- Foreign keys");
      for (const fk of fks) {
        const srcCols = fk.source_columns.map((c) => `"${c}"`).join(", ");
        const tgtCols = fk.target_columns.map((c) => `"${c}"`).join(", ");
        emitStatement(
          `ALTER TABLE "${fk.source_table}" ADD CONSTRAINT "${fk.constraint_name}" FOREIGN KEY (${srcCols}) REFERENCES "${fk.target_table}" (${tgtCols}) ON UPDATE ${fk.update_rule} ON DELETE ${fk.delete_rule};`,
        );
      }
      emit("");
    }

    // Unique constraints
    const allUniqueConstraints = await sql<{
      constraint_name: string;
      tablename: string;
      column_names: string[];
    }[]>`
      SELECT c.conname AS constraint_name,
             t.relname AS tablename,
             array_agg(a.attname ORDER BY array_position(c.conkey, a.attnum)) AS column_names
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(c.conkey)
      WHERE n.nspname = 'public' AND c.contype = 'u'
      GROUP BY c.conname, t.relname
      ORDER BY t.relname, c.conname
    `;
    const uniques = allUniqueConstraints.filter((entry) => includedTableNames.has(entry.tablename));

    if (uniques.length > 0) {
      emit("-- Unique constraints");
      for (const u of uniques) {
        const cols = u.column_names.map((c) => `"${c}"`).join(", ");
        emitStatement(`ALTER TABLE "${u.tablename}" ADD CONSTRAINT "${u.constraint_name}" UNIQUE (${cols});`);
      }
      emit("");
    }

    // Indexes (non-primary, non-unique-constraint)
    const allIndexes = await sql<{ tablename: string; indexdef: string }[]>`
      SELECT tablename, indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname NOT IN (
          SELECT conname FROM pg_constraint
          WHERE connamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
        )
      ORDER BY tablename, indexname
    `;
    const indexes = allIndexes.filter((entry) => includedTableNames.has(entry.tablename));

    if (indexes.length > 0) {
      emit("-- Indexes");
      for (const idx of indexes) {
        emitStatement(`${idx.indexdef};`);
      }
      emit("");
    }

    // Dump data for each table
    for (const { tablename } of tables) {
      const count = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM ${sql(tablename)}
      `;
      if ((count[0]?.n ?? 0) === 0) continue;

      // Get column info for this table
      const cols = await sql<{ column_name: string; data_type: string }[]>`
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = ${tablename}
        ORDER BY ordinal_position
      `;
      const colNames = cols.map((c) => `"${c.column_name}"`).join(", ");

      emit(`-- Data for: ${tablename} (${count[0]!.n} rows)`);

      const rows = await sql`SELECT * FROM ${sql(tablename)}`.values();
      const nullifiedColumns = nullifiedColumnsByTable.get(tablename) ?? new Set<string>();
      for (const row of rows) {
        const values = row.map((rawValue: unknown, index) => {
          const columnName = cols[index]?.column_name;
          const val = columnName && nullifiedColumns.has(columnName) ? null : rawValue;
          if (val === null || val === undefined) return "NULL";
          if (typeof val === "boolean") return val ? "true" : "false";
          if (typeof val === "number") return String(val);
          if (val instanceof Date) return formatSqlLiteral(val.toISOString());
          if (typeof val === "object") return formatSqlLiteral(JSON.stringify(val));
          return formatSqlLiteral(String(val));
        });
        emitStatement(`INSERT INTO "${tablename}" (${colNames}) VALUES (${values.join(", ")});`);
      }
      emit("");
    }

    // Sequence values
    if (sequences.length > 0) {
      emit("-- Sequence values");
      for (const seq of sequences) {
        const val = await sql<{ last_value: string; is_called: boolean }[]>`
          SELECT last_value::text, is_called FROM ${sql(seq.sequence_name)}
        `;
        if (val[0]) {
          emitStatement(`SELECT setval('"${seq.sequence_name}"', ${val[0].last_value}, ${val[0].is_called ? "true" : "false"});`);
        }
      }
      emit("");
    }

    emitStatement("COMMIT;");
    emit("");

    // Write the backup file
    mkdirSync(opts.backupDir, { recursive: true });
    const backupFile = resolve(opts.backupDir, `${filenamePrefix}-${timestamp()}.sql`);
    await writeFile(backupFile, lines.join("\n"), "utf8");

    const sizeBytes = statSync(backupFile).size;
    const prunedCount = pruneOldBackups(opts.backupDir, retentionDays, filenamePrefix);

    return {
      backupFile,
      sizeBytes,
      prunedCount,
    };
  } finally {
    await sql.end();
  }
}

export async function runDatabaseRestore(opts: RunDatabaseRestoreOptions): Promise<void> {
  const connectTimeout = Math.max(1, Math.trunc(opts.connectTimeoutSeconds ?? 5));
  const sql = postgres(opts.connectionString, { max: 1, connect_timeout: connectTimeout });

  try {
    await sql`SELECT 1`;
    const contents = await readFile(opts.backupFile, "utf8");
    const statements = contents
      .split(STATEMENT_BREAKPOINT)
      .map((statement) => statement.trim())
      .filter((statement) => statement.length > 0);

    for (const statement of statements) {
      await sql.unsafe(statement).execute();
    }
  } catch (error) {
    const statementPreview = typeof error === "object" && error !== null && typeof (error as Record<string, unknown>).query === "string"
      ? String((error as Record<string, unknown>).query)
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line.length > 0 && !line.startsWith("--"))
      : null;
    throw new Error(
      `Failed to restore ${basename(opts.backupFile)}: ${sanitizeRestoreErrorMessage(error)}${statementPreview ? ` [statement: ${statementPreview.slice(0, 120)}]` : ""}`,
    );
  } finally {
    await sql.end();
  }
}

export function formatDatabaseBackupResult(result: RunDatabaseBackupResult): string {
  const size = formatBackupSize(result.sizeBytes);
  const pruned = result.prunedCount > 0 ? `; pruned ${result.prunedCount} old backup(s)` : "";
  return `${result.backupFile} (${size}${pruned})`;
}
