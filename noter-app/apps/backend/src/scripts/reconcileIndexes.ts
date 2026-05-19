/**
 * Reconcile MongoDB indexes against schema definitions.
 *
 * Run: pnpm --filter backend run db:reconcile-indexes
 *
 * Why: in production we set `mongoose.set('autoIndex', false)` because
 * autoIndex blocks app startup on large collections while building indexes
 * synchronously, and it can re-introduce dropped indexes accidentally. The
 * tradeoff is that index changes in code are no longer reflected in the
 * database automatically — this script does that explicitly, with a diff
 * report so you can review before applying.
 *
 * Flags:
 *   --dry-run   show what would change, do not apply
 *   --drop-extra drop indexes that exist in DB but not in schema (default: warn only)
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

// Pull in all models so they register on the mongoose instance.
import Note from '../models/Note';
import Task from '../models/Task';
import User from '../models/User';
import McpAuditLog from '../models/McpAuditLog';
import AIProjectSync from '../models/AIProjectSync';
import AIConversationSync from '../models/AIConversationSync';
import AIMessageSync from '../models/AIMessageSync';

const dotenvPath = process.env.DOTENV_PATH;
if (dotenvPath) {
  dotenv.config({ path: dotenvPath });
} else {
  const candidate = path.join(process.cwd(), 'apps', 'backend', '.env');
  if (fs.existsSync(candidate)) dotenv.config({ path: candidate });
  else dotenv.config();
}

const DRY_RUN = process.argv.includes('--dry-run');
const DROP_EXTRA = process.argv.includes('--drop-extra');

const MODELS = [
  Note,
  Task,
  User,
  McpAuditLog,
  AIProjectSync,
  AIConversationSync,
  AIMessageSync,
];

type IndexKey = Record<string, 1 | -1 | 'text' | 'hashed' | '2dsphere' | string | number>;
type IndexSpec = { name: string; key: IndexKey; options: Record<string, unknown> };

const indexKeyFingerprint = (key: IndexKey): string =>
  Object.entries(key).map(([k, v]) => `${k}:${v}`).join('|');

const main = async (): Promise<void> => {
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    console.error('MONGO_URI not set');
    process.exit(1);
  }
  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 5000 });
  console.log(`reconcile-indexes (dry-run=${DRY_RUN}, drop-extra=${DROP_EXTRA})`);

  let mismatched = 0;
  let created = 0;
  let dropped = 0;

  for (const model of MODELS) {
    const collection = model.collection;
    const collName = collection.collectionName;
    // Schema-side: what should exist
    const schemaIndexes = model.schema.indexes() as Array<[IndexKey, Record<string, unknown>]>;
    // The implicit _id index is always present; we don't need to track it.
    const expected: IndexSpec[] = schemaIndexes.map(([key, options]) => ({
      name: (options.name as string) || indexKeyFingerprint(key),
      key,
      options: options || {},
    }));

    // DB-side: what currently exists
    let actual: Array<{ name: string; key: IndexKey; [k: string]: unknown }> = [];
    try {
      actual = (await collection.indexes()) as typeof actual;
    } catch (err) {
      console.warn(`[${collName}] could not list indexes: ${(err as Error).message}`);
      continue;
    }

    const expectedByFp = new Map(expected.map((e) => [indexKeyFingerprint(e.key), e]));
    const actualByFp = new Map(actual.filter((a) => a.name !== '_id_').map((a) => [indexKeyFingerprint(a.key), a]));

    console.log(`\n=== ${collName} ===`);
    console.log(`  schema indexes: ${expected.length}`);
    console.log(`  db indexes:     ${actual.length - 1} (excluding _id_)`);

    // Missing in DB → create
    for (const [fp, spec] of expectedByFp) {
      if (!actualByFp.has(fp)) {
        mismatched++;
        console.log(`  + CREATE  ${JSON.stringify(spec.key)} ${JSON.stringify(spec.options)}`);
        if (!DRY_RUN) {
          try {
            await collection.createIndex(spec.key as any, spec.options as any);
            created++;
          } catch (err) {
            console.error(`    create failed: ${(err as Error).message}`);
          }
        }
      }
    }

    // Extra in DB → optionally drop
    for (const [fp, a] of actualByFp) {
      if (!expectedByFp.has(fp)) {
        mismatched++;
        const verb = DROP_EXTRA ? 'DROP' : 'WARN';
        console.log(`  - ${verb}   ${a.name} ${JSON.stringify(a.key)}`);
        if (DROP_EXTRA && !DRY_RUN) {
          try {
            await collection.dropIndex(a.name);
            dropped++;
          } catch (err) {
            console.error(`    drop failed: ${(err as Error).message}`);
          }
        }
      }
    }
  }

  console.log(`\nSUMMARY:`);
  console.log(`  mismatched: ${mismatched}`);
  console.log(`  created:    ${created}`);
  console.log(`  dropped:    ${dropped}`);
  if (DRY_RUN && mismatched > 0) {
    console.log(`\nRun without --dry-run to apply.`);
  }
  if (!DROP_EXTRA && mismatched > 0) {
    console.log(`Add --drop-extra to remove indexes not in schema.`);
  }

  await mongoose.disconnect();
  // Non-zero exit if dry-run found drift, so CI can gate on this.
  process.exit(DRY_RUN && mismatched > 0 ? 2 : 0);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
