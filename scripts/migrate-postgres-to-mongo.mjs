import 'dotenv/config';
import pg from 'pg';
import mongoose from 'mongoose';

const { Client } = pg;

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function getPostgresUrl() {
  return process.env.DIRECT_URL || process.env.DATABASE_URL;
}

async function connectPostgres() {
  const url = getPostgresUrl();
  if (!url) throw new Error('Missing DIRECT_URL or DATABASE_URL for Postgres source');
  const client = new Client({ connectionString: url });
  await client.connect();
  return client;
}

async function connectMongo() {
  const uri = requireEnv('MONGODB_URI');
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 });
  return mongoose.connection;
}

function toDate(value) {
  if (!value) return undefined;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

async function migrateJournalEntries(pgClient, mongoDb, { batchSize }) {
  const sourceCountRes = await pgClient.query('select count(*)::int as count from journal_entries');
  const sourceCount = sourceCountRes.rows?.[0]?.count ?? 0;

  console.log(`[migrate] journal_entries: source rows = ${sourceCount}`);

  let offset = 0;
  let totalUpserted = 0;

  const collection = mongoDb.collection('journal_entries');

  while (true) {
    const res = await pgClient.query(
      `
      select
        id,
        user_id,
        entry_text,
        reflection_text,
        summary,
        topic,
        mood,
        entities,
        highlights,
        created_at,
        updated_at
      from journal_entries
      order by created_at asc
      offset $1
      limit $2
      `,
      [offset, batchSize]
    );

    if (res.rows.length === 0) break;

    const ops = res.rows.map((r) => {
      const createdAt = toDate(r.created_at) || new Date();
      const updatedAt = toDate(r.updated_at) || createdAt;

      return {
        updateOne: {
          filter: { _id: r.id },
          update: {
            $set: {
              userId: r.user_id,
              entryText: r.entry_text,
              reflectionText: r.reflection_text,
              summary: r.summary ?? null,
              topic: r.topic ?? null,
              mood: r.mood ?? null,
              entities: r.entities ?? null,
              highlights: r.highlights ?? null,
              createdAt,
              updatedAt,
            },
          },
          upsert: true,
        },
      };
    });

    const result = await collection.bulkWrite(ops, { ordered: false });
    totalUpserted += (result.upsertedCount || 0) + (result.modifiedCount || 0);

    offset += res.rows.length;
    console.log(`[migrate] journal_entries: processed ${offset}/${sourceCount}`);
  }

  const destCount = await collection.countDocuments();
  console.log(`[migrate] journal_entries: dest docs = ${destCount}`);
  return { sourceCount, destCount, totalUpserted };
}

async function migrateUserPreferences(pgClient, mongoDb) {
  const sourceCountRes = await pgClient.query('select count(*)::int as count from user_preferences');
  const sourceCount = sourceCountRes.rows?.[0]?.count ?? 0;

  console.log(`[migrate] user_preferences: source rows = ${sourceCount}`);

  const res = await pgClient.query(
    `
    select
      user_id,
      auto_play_enabled,
      created_at,
      updated_at
    from user_preferences
    `
  );

  const collection = mongoDb.collection('user_preferences');

  if (res.rows.length > 0) {
    const ops = res.rows.map((r) => {
      const createdAt = toDate(r.created_at) || new Date();
      const updatedAt = toDate(r.updated_at) || createdAt;
      return {
        updateOne: {
          filter: { userId: r.user_id },
          update: {
            $set: {
              userId: r.user_id,
              autoPlayEnabled: r.auto_play_enabled ?? true,
              createdAt,
              updatedAt,
            },
          },
          upsert: true,
        },
      };
    });
    await collection.bulkWrite(ops, { ordered: false });
  }

  const destCount = await collection.countDocuments();
  console.log(`[migrate] user_preferences: dest docs = ${destCount}`);

  return { sourceCount, destCount };
}

async function main() {
  const batchSize = Number(process.env.MIGRATE_BATCH_SIZE || 500);

  const pgClient = await connectPostgres();
  const mongoConn = await connectMongo();

  try {
    const mongoDb = mongoConn.db;
    if (!mongoDb) throw new Error('Mongo connection has no db()');

    console.log('[migrate] Starting Postgres → Mongo migration');
    console.log(`[migrate] Batch size: ${batchSize}`);

    const entries = await migrateJournalEntries(pgClient, mongoDb, { batchSize });
    const prefs = await migrateUserPreferences(pgClient, mongoDb);

    console.log('[migrate] Done');
    console.log(JSON.stringify({ entries, prefs }, null, 2));
  } finally {
    await pgClient.end().catch(() => {});
    await mongoose.disconnect().catch(() => {});
  }
}

main().catch((err) => {
  console.error('[migrate] Failed:', err?.message || err);
  process.exit(1);
});

