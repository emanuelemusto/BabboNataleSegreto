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
