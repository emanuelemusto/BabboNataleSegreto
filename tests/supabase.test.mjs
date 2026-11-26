import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { callRpc, isSupabaseConfigured } from "../static/supabase.mjs";

test("SQL migrations keep PostgreSQL regex repetition counts within supported limits", async () => {
  const migrationDirectory = new URL("../supabase/migrations/", import.meta.url);
  const files = await readdir(migrationDirectory);

  for (const file of files.filter((name) => name.endsWith(".sql"))) {
    const sql = await readFile(new URL(file, migrationDirectory), "utf8");
    for (const match of sql.matchAll(/\{(\d+)(?:,(\d*))?\}/g)) {
      const lower = Number(match[1]);
      const upper = match[2] ? Number(match[2]) : lower;
      assert.ok(lower <= 255 && upper <= 255, `${file} contains unsupported regex bound ${match[0]}`);
    }
  }
});

test("existing participants can be found with their personal-code hash only", async () => {
  const migration = await readFile(
    new URL("../supabase/migrations/202611260003_link_existing_participant.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /function public\.santa_find_participant\(\s*p_draw_id uuid,\s*p_access_secret text/s);
  assert.match(migration, /security definer/i);
  assert.match(migration, /p\.access_hash = p_access_secret/);
  assert.match(migration, /grant execute on function public\.santa_find_participant\(uuid, text\) to anon, authenticated/i);
});

test("organizer can remove a participant only before the draw", async () => {
  const migration = await readFile(
    new URL("../supabase/migrations/202611260004_remove_participant.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /function public\.santa_remove_participant\(\s*p_draw_id uuid,\s*p_organizer_secret text,\s*p_participant_id uuid/s);
  assert.match(migration, /d\.organizer_hash = public\.santa_secret_hash\(p_organizer_secret\)/);
  assert.match(migration, /d\.status = 'open'/);
  assert.match(migration, /for update/i);
  assert.match(migration, /p\.id = p_participant_id/);
  assert.match(migration, /grant execute on function public\.santa_remove_participant\(uuid, text, uuid\) to anon, authenticated/i);
});

test("Supabase RPC uses the public key and sends only the requested function parameters", async () => {
  const previousConfig = globalThis.SECRET_SANTA_CONFIG;
  const previousFetch = globalThis.fetch;
  globalThis.SECRET_SANTA_CONFIG = {
    supabaseUrl: "https://santa-example.supabase.co/",
    supabaseAnonKey: "public-anon-key",
  };
  let observed;
  globalThis.fetch = async (url, options) => {
    observed = { url, options };
    return new Response(JSON.stringify([{ draw_id: "example" }]), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    assert.equal(isSupabaseConfigured(), true);
    const result = await callRpc("santa_create_draw", { p_title: "Natale" });
    assert.deepEqual(result, [{ draw_id: "example" }]);
    assert.equal(observed.url, "https://santa-example.supabase.co/rest/v1/rpc/santa_create_draw");
    assert.equal(observed.options.headers.apikey, "public-anon-key");
    assert.equal(observed.options.headers.Authorization, "Bearer public-anon-key");
    assert.deepEqual(JSON.parse(observed.options.body), { p_title: "Natale" });
  } finally {
    globalThis.fetch = previousFetch;
    if (previousConfig === undefined) delete globalThis.SECRET_SANTA_CONFIG;
    else globalThis.SECRET_SANTA_CONFIG = previousConfig;
  }
});

test("Supabase RPC rejects unconfigured projects and invalid function names", async () => {
  const previousConfig = globalThis.SECRET_SANTA_CONFIG;
  const previousFetch = globalThis.fetch;
  delete globalThis.SECRET_SANTA_CONFIG;
  globalThis.fetch = async () => {
    throw new Error("The RPC must not be called.");
  };
  try {
    assert.equal(isSupabaseConfigured(), false);
    await assert.rejects(() => callRpc("santa_create_draw"), /configura l’URL/);
    globalThis.SECRET_SANTA_CONFIG = {
      supabaseUrl: "https://santa-example.supabase.co",
      supabaseAnonKey: "public-anon-key",
    };
    await assert.rejects(() => callRpc("santa_create_draw;drop"), /Nome funzione non valido/);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousConfig === undefined) delete globalThis.SECRET_SANTA_CONFIG;
    else globalThis.SECRET_SANTA_CONFIG = previousConfig;
  }
});
