function configuration() {
  const config = globalThis.SECRET_SANTA_CONFIG;
  if (
    !config ||
    typeof config.supabaseUrl !== "string" ||
    typeof config.supabaseAnonKey !== "string" ||
    !config.supabaseUrl.trim() ||
    !config.supabaseAnonKey.trim()
  ) {
    throw new Error("Per attivare i sorteggi, configura l’URL e la chiave pubblica Supabase in static/config.js.");
  }
  const url = new URL(config.supabaseUrl);
  if (url.protocol !== "https:" && url.hostname !== "localhost") {
    throw new Error("L’URL Supabase deve usare HTTPS.");
  }
  return {
    baseUrl: `${url.origin}/rest/v1/rpc`,
    anonKey: config.supabaseAnonKey.trim(),
  };
}

export async function callRpc(functionName, parameters = {}) {
  if (!/^[a-z][a-z0-9_]{1,63}$/.test(functionName)) {
    throw new TypeError("Nome funzione non valido.");
  }
  const { baseUrl, anonKey } = configuration();
  let response;
  try {
    response = await fetch(`${baseUrl}/${functionName}`, {
      method: "POST",
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(parameters),
    });
  } catch {
    throw new Error("Non riesco a raggiungere Supabase. Controlla la connessione e riprova.");
  }

  const responseText = await response.text();
  let data;
  try {
    data = responseText ? JSON.parse(responseText) : null;
  } catch {
    throw new Error("Supabase ha restituito una risposta non valida.");
  }
  if (!response.ok) {
    const detail = typeof data?.message === "string" ? data.message : "";
    throw new Error(detail || "Supabase non ha completato la richiesta.");
  }
  return data;
}

export function isSupabaseConfigured() {
  try {
    configuration();
    return true;
  } catch {
    return false;
  }
}
