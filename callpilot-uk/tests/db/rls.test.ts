// Applies the migrations to a throwaway database and checks the row level security
// rules as real signed-in users would hit them. Needs a local Postgres:
//   TEST_DATABASE_URL=postgres://postgres@localhost:54329/postgres npm run test:db
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ADMIN_URL = process.env.TEST_DATABASE_URL;
const DB_NAME = "callpilot_rls_test";
const ROOT = join(__dirname, "..", "..");

const ALICE = "00000000-0000-4000-8000-00000000000a";
const BOB = "00000000-0000-4000-8000-00000000000b";

let db: Client;

async function asUser<T>(userId: string | null, fn: (c: Client) => Promise<T>): Promise<T> {
  await db.query("begin");
  try {
    await db.query(`set local role ${userId ? "authenticated" : "anon"}`);
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [userId ?? ""]);
    return await fn(db);
  } finally {
    await db.query("rollback");
  }
}

async function workspaceOf(userId: string) {
  const r = await db.query("select workspace_id from public.workspace_members where user_id = $1", [userId]);
  return r.rows[0].workspace_id as string;
}

describe.skipIf(!ADMIN_URL)("row level security", () => {
  let aliceWs: string;
  let bobWs: string;
  let bobBusiness: string;

  beforeAll(async () => {
    const admin = new Client({ connectionString: ADMIN_URL });
    await admin.connect();
    await admin.query(`drop database if exists ${DB_NAME} with (force)`);
    await admin.query(`create database ${DB_NAME}`);
    await admin.end();

    const url = new URL(ADMIN_URL!);
    url.pathname = `/${DB_NAME}`;
    db = new Client({ connectionString: url.toString() });
    await db.connect();
    await db.query(readFileSync(join(ROOT, "tests/db/supabase_stub.sql"), "utf8"));
    const migrationsDir = join(ROOT, "supabase/migrations");
    for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort()) {
      await db.query(readFileSync(join(migrationsDir, file), "utf8"));
    }

    // Signing up (inserting into auth.users) should create a workspace for each user.
    await db.query("insert into auth.users (id, email) values ($1, 'alice@example.test'), ($2, 'bob@example.test')", [ALICE, BOB]);
    aliceWs = await workspaceOf(ALICE);
    bobWs = await workspaceOf(BOB);
    const b = await db.query(
      "insert into public.businesses (workspace_id, name, business_type, created_by) values ($1, 'Bob Plumbing', 'Other', $2) returning id",
      [bobWs, BOB],
    );
    bobBusiness = b.rows[0].id;
    await db.query(
      "insert into public.calls (workspace_id, business_id, started_at, duration_seconds, outcome) values ($1, $2, now(), 90, 'lead_captured')",
      [bobWs, bobBusiness],
    );
  });

  afterAll(async () => {
    await db?.end();
  });

  it("gives every new user their own workspace as owner", async () => {
    expect(aliceWs).not.toBe(bobWs);
    const r = await db.query("select role from public.workspace_members where user_id = $1", [ALICE]);
    expect(r.rows).toEqual([{ role: "owner" }]);
  });

  it("signed-out visitors can read nothing", async () => {
    await asUser(null, async (c) => {
      await expect(c.query("select * from public.businesses")).rejects.toThrow(/permission denied/);
    });
  });

  it("users only see their own workspace, members, businesses and calls", async () => {
    await asUser(ALICE, async (c) => {
      expect((await c.query("select id from public.workspaces")).rows).toEqual([{ id: aliceWs }]);
      expect((await c.query("select user_id from public.workspace_members")).rows).toEqual([{ user_id: ALICE }]);
      expect((await c.query("select * from public.businesses")).rowCount).toBe(0);
      expect((await c.query("select * from public.calls")).rowCount).toBe(0);
    });
    await asUser(BOB, async (c) => {
      expect((await c.query("select id from public.businesses")).rows).toEqual([{ id: bobBusiness }]);
      expect((await c.query("select * from public.calls")).rowCount).toBe(1);
    });
  });

  it("users can add businesses to their own workspace only", async () => {
    await asUser(ALICE, async (c) => {
      const ok = await c.query(
        "insert into public.businesses (workspace_id, name, business_type, created_by) values ($1, 'Alice Salon', 'Other', $2) returning status",
        [aliceWs, ALICE],
      );
      expect(ok.rows[0].status).toBe("setup_needed");
    });
    await asUser(ALICE, async (c) => {
      await expect(
        c.query("insert into public.businesses (workspace_id, name, business_type, created_by) values ($1, 'Sneaky', 'Other', $2)", [
          bobWs,
          ALICE,
        ]),
      ).rejects.toThrow(/row-level security/);
    });
  });

  it("users cannot impersonate another creator or set protected columns", async () => {
    await asUser(ALICE, async (c) => {
      await expect(
        c.query("insert into public.businesses (workspace_id, name, business_type, created_by) values ($1, 'Fake', 'Other', $2)", [
          aliceWs,
          BOB,
        ]),
      ).rejects.toThrow(/row-level security/);
    });
    await asUser(ALICE, async (c) => {
      await expect(
        c.query("insert into public.businesses (workspace_id, name, business_type, created_by, status) values ($1, 'Fake', 'Other', $2, 'active')", [
          aliceWs,
          ALICE,
        ]),
      ).rejects.toThrow(/permission denied/);
    });
  });

  it("users cannot change, move or delete another workspace's businesses", async () => {
    await asUser(ALICE, async (c) => {
      const upd = await c.query("update public.businesses set name = 'Hacked' where id = $1", [bobBusiness]);
      expect(upd.rowCount).toBe(0);
      const del = await c.query("delete from public.businesses where id = $1", [bobBusiness]);
      expect(del.rowCount).toBe(0);
    });
    await asUser(BOB, async (c) => {
      await expect(c.query("update public.businesses set workspace_id = $1 where id = $2", [aliceWs, bobBusiness])).rejects.toThrow(
        /permission denied/,
      );
    });
    const still = await db.query("select name from public.businesses where id = $1", [bobBusiness]);
    expect(still.rows[0].name).toBe("Bob Plumbing");
  });

  it("users cannot write call records or add themselves to other workspaces", async () => {
    await asUser(BOB, async (c) => {
      await expect(
        c.query("insert into public.calls (workspace_id, business_id, started_at, outcome) values ($1, $2, now(), 'answered')", [
          bobWs,
          bobBusiness,
        ]),
      ).rejects.toThrow(/permission denied/);
    });
    await asUser(ALICE, async (c) => {
      await expect(
        c.query("insert into public.workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner')", [bobWs, ALICE]),
      ).rejects.toThrow(/permission denied/);
    });
  });

  it("call stats only count calls the user can see", async () => {
    await asUser(BOB, async (c) => {
      const r = await c.query("select * from public.workspace_call_stats($1)", [bobWs]);
      expect(r.rows[0]).toMatchObject({ total_calls: "1", leads_captured: "1", avg_duration_seconds: 90 });
    });
    await asUser(ALICE, async (c) => {
      const r = await c.query("select * from public.workspace_call_stats($1)", [bobWs]);
      expect(r.rows[0].total_calls).toBe("0");
    });
  });

  it("rejects calls linked to a business in a different workspace", async () => {
    await expect(
      db.query("insert into public.calls (workspace_id, business_id, started_at, outcome) values ($1, $2, now(), 'answered')", [
        aliceWs,
        bobBusiness,
      ]),
    ).rejects.toThrow(/foreign key/);
  });
});
