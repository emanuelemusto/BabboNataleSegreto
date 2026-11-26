import { createDerangement } from "./draw.mjs";
import {
  createParticipantCredentials,
  decryptAssignment,
  encryptAssignment,
  hashSecret,
  randomSecret,
} from "./crypto.mjs";
import {
  createRegistrationPackage,
  createResultsPackage,
  validateRegistrationPackage,
  validateResultsPackage,
} from "./packages.mjs";

const app = document.querySelector("#app");
const pageUrl = `${location.origin}${location.pathname}`;
const groupKey = (id) => `secret-santa:v1:${id}`;
const resultKey = (id) => `secret-santa:result:v1:${id}`;
const route = () => location.hash.slice(1).split("/").map(decodeURIComponent);
let pageRefreshTimer;
const recentlyDecrypted = new Map();

function startRefresh(callback) {
  window.clearInterval(pageRefreshTimer);
  pageRefreshTimer = window.setInterval(callback, 2000);
}

function showMessage(element, message) {
  element.textContent = message instanceof Error ? message.message : String(message);
  element.hidden = false;
}

function loadGroup(id) {
  let serialized;
  try {
    serialized = localStorage.getItem(groupKey(id));
  } catch {
    throw new Error("Questo browser non permette di salvare i dati del gruppo.");
  }
  if (!serialized) return null;
  let group;
  try {
    group = JSON.parse(serialized);
  } catch {
    throw new Error("I dati locali del gruppo non sono leggibili.");
  }
  if (
    group.id !== id ||
    typeof group.title !== "string" ||
    !Array.isArray(group.participants) ||
    (group.status !== "open" && group.status !== "drawn")
  ) {
    throw new Error("I dati locali del gruppo non sono validi.");
  }
  if (!group.roundId) group.roundId = group.id;
  return group;
}

function saveGroup(group) {
  try {
    localStorage.setItem(groupKey(group.id), JSON.stringify(group));
  } catch {
    throw new Error("Non è stato possibile salvare il gruppo in questo browser.");
  }
}

function safeRouteLink(kind, ...segments) {
  const suffix = segments.map((segment) => encodeURIComponent(segment)).join("/");
  return `${pageUrl}#${kind}/${suffix}`;
}

function downloadJson(data, fileName) {
  const blob = new Blob([`${JSON.stringify(data, null, 2)}\n`], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function readJsonFile(file) {
  if (!file) throw new Error("Seleziona un file JSON.");
  if (file.size > 5_000_000) throw new Error("Il file supera il limite consentito di 5 MB.");
  try {
    return JSON.parse(await file.text());
  } catch {
    throw new Error("Il file non contiene JSON valido.");
  }
}

function wireCopyButtons() {
  document.querySelectorAll("[data-copy]").forEach((button) => {
    button.addEventListener("click", async () => {
      const input = document.getElementById(button.dataset.copy);
      try {
        await navigator.clipboard.writeText(input.value);
        button.textContent = "Copiato!";
        window.setTimeout(() => { button.textContent = "Copia"; }, 1600);
      } catch {
        input.focus();
        input.select();
        const error = document.querySelector("#copy-error");
        if (error) showMessage(error, "Copia non disponibile: seleziona e copia il testo manualmente.");
      }
    });
  });
}

function renderHome() {
  app.innerHTML = `
    <section class="card hero">
      <p class="eyebrow">Il regalo giusto, in segreto</p>
      <h1>Babbo Natale<br><span>segreto.</span></h1>
      <p class="intro">Organizza il sorteggio senza server: scambiate piccoli file JSON; l’app cifra ogni risultato per il partecipante a cui è destinato.</p>
      <div class="notice"><span class="notice-icon" aria-hidden="true">✳</span><div><strong>Funziona anche da dispositivi diversi</strong><p>Le iscrizioni e il file dei risultati si passano manualmente, per esempio tramite un messaggio privato o un gruppo. Il codice personale non va condiviso con l’organizzatore.</p></div></div>
      <form id="create-form">
        <label for="title">Come si chiama il gruppo?</label>
        <input id="title" maxlength="80" placeholder="es. Natale in famiglia" required>
        <button class="button button-primary" type="submit">Crea il gruppo <span aria-hidden="true">→</span></button>
        <p id="create-error" class="message error" role="alert" hidden></p>
      </form>
      <div id="created" class="created" hidden>
        <p class="success-title">Gruppo pronto. Tieni al sicuro il link organizzatore.</p>
        <label for="invite-link">Link d’iscrizione da condividere</label>
        <div class="copy-row"><input id="invite-link" readonly><button class="button button-light" data-copy="invite-link">Copia</button></div>
        <label for="organizer-link">Il tuo link organizzatore</label>
        <div class="copy-row"><input id="organizer-link" readonly><button class="button button-light" data-copy="organizer-link">Copia</button></div>
        <p id="copy-error" class="message error" role="alert" hidden></p>
        <p class="hint">Le iscrizioni non vengono inviate automaticamente: ogni partecipante deve mandarti il proprio file JSON. Chi possiede il link organizzatore può avviare o azzerare il gruppo.</p>
        <a id="open-organizer" class="button button-primary" href="#">Apri il pannello organizzatore <span aria-hidden="true">→</span></a>
      </div>
    </section>
    <section class="card transfer-card">
      <p class="eyebrow">Hai ricevuto il file dei risultati?</p>
      <h2>Scopri il tuo<br>abbinamento.</h2>
      <p class="intro">Importa il JSON inviato dall’organizzatore, inserisci il tuo nome e il codice personale ricevuto al momento dell’iscrizione.</p>
      <form id="import-results-form">
        <label for="results-file">File JSON dei risultati</label>
        <input id="results-file" type="file" accept=".json,application/json" required>
        <label for="results-name">Il nome usato per iscriverti</label>
        <input id="results-name" maxlength="80" autocomplete="off" required>
        <label for="results-code">Il tuo codice personale</label>
        <input id="results-code" autocomplete="off" spellcheck="false" required>
        <button class="button button-primary" type="submit">Importa e scopri <span aria-hidden="true">→</span></button>
        <p id="import-results-error" class="message error" role="alert" hidden></p>
      </form>
    </section>`;

  document.querySelector("#create-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const error = document.querySelector("#create-error");
    error.hidden = true;
    const button = event.currentTarget.querySelector("button");
    button.disabled = true;
    try {
      const title = document.querySelector("#title").value.trim();
      if (!title || title.length > 80) throw new Error("Inserisci un nome del gruppo (massimo 80 caratteri).");
      const id = crypto.randomUUID();
      const organizerSecret = randomSecret();
      const group = {
        id,
        roundId: crypto.randomUUID(),
        title,
        managerHash: await hashSecret(organizerSecret),
        status: "open",
        participants: [],
        createdAt: new Date().toISOString(),
      };
      saveGroup(group);
      document.querySelector("#invite-link").value = safeRouteLink("signup", group.roundId, title);
      const organizerLink = safeRouteLink("manage", id, organizerSecret);
      document.querySelector("#organizer-link").value = organizerLink;
      document.querySelector("#open-organizer").href = organizerLink;
      document.querySelector("#created").hidden = false;
      button.textContent = "Gruppo creato";
    } catch (reason) {
      showMessage(error, reason);
      button.disabled = false;
    }
  });

  document.querySelector("#import-results-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const error = document.querySelector("#import-results-error");
    error.hidden = true;
    const button = event.currentTarget.querySelector("button");
    button.disabled = true;
    try {
      const bundle = validateResultsPackage(await readJsonFile(document.querySelector("#results-file").files[0]));
      const name = document.querySelector("#results-name").value.trim();
      const code = document.querySelector("#results-code").value.trim();
      await storeAndOpenResult(bundle, name, code);
    } catch (reason) {
      showMessage(error, reason);
      button.disabled = false;
    }
  });

  wireCopyButtons();
}

function renderUnavailable() {
  app.innerHTML = `
    <section class="card">
      <p class="eyebrow">Gruppo non disponibile</p>
      <h1>Questo gruppo<br><span>non è qui.</span></h1>
      <p class="intro">I dati di gestione sono salvati nel browser dell’organizzatore. Apri il suo link organizzatore sul dispositivo in cui ha creato il gruppo.</p>
      <a class="button button-primary" href="${pageUrl}">Torna all’inizio <span aria-hidden="true">→</span></a>
    </section>`;
}

function renderSignup(groupId, title) {
  if (!groupId || !title || title.length > 80) {
    renderUnavailable();
    return;
  }

  app.innerHTML = `
    <section class="card">
      <p class="eyebrow">Iscrizione al sorteggio</p>
      <h1 id="signup-title"></h1>
      <p class="intro">Iscriviti e invia all’organizzatore il file JSON generato. Conserva il tuo codice personale: servirà per decifrare il risultato.</p>
      <form id="join-form">
        <label for="name">Il tuo nome</label>
        <input id="name" maxlength="80" autocomplete="name" placeholder="Nome e cognome" required>
        <button class="button button-primary" type="submit">Crea l’iscrizione <span aria-hidden="true">→</span></button>
        <p id="join-error" class="message error" role="alert" hidden></p>
      </form>
      <div id="signup-ready" class="created" hidden>
        <p class="success-title">Iscrizione pronta da inviare</p>
        <label for="personal-code">Codice personale, da conservare e non condividere</label>
        <div class="copy-row"><input id="personal-code" readonly><button class="button button-light" data-copy="personal-code">Copia codice</button></div>
        <button id="download-registration" class="button button-primary" type="button">Scarica il file d’iscrizione JSON <span aria-hidden="true">↓</span></button>
        <p id="copy-error" class="message error" role="alert" hidden></p>
        <p class="hint">Invia solo il file JSON all’organizzatore, non il codice personale. Dopo il sorteggio, il file dei risultati verrà condiviso con il gruppo.</p>
      </div>
    </section>`;
  document.querySelector("#signup-title").textContent = title;

  let registrationPackage;
  document.querySelector("#join-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const error = document.querySelector("#join-error");
    error.hidden = true;
    const button = event.currentTarget.querySelector("button");
    button.disabled = true;
    try {
      const name = document.querySelector("#name").value.trim();
      if (!name || name.length > 80) throw new Error("Inserisci il tuo nome (massimo 80 caratteri).");
      const credentials = await createParticipantCredentials();
      const participant = {
        id: crypto.randomUUID(),
        name,
        publicKey: credentials.publicKey,
        privateKeyCiphertext: credentials.privateKeyCiphertext,
        privateKeyIv: credentials.privateKeyIv,
      };
      registrationPackage = createRegistrationPackage(groupId, title, participant);
      document.querySelector("#personal-code").value = credentials.accessCode;
      document.querySelector("#signup-ready").hidden = false;
      event.currentTarget.hidden = true;
      wireCopyButtons();
    } catch (reason) {
      showMessage(error, reason);
      button.disabled = false;
    }
  });

  document.querySelector("#download-registration").addEventListener("click", () => {
    if (!registrationPackage) return;
    const name = registrationPackage.participant.name
      .normalize("NFKD")
      .replace(/[^a-zA-Z0-9_-]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "partecipante";
    downloadJson(registrationPackage, `iscrizione-${name}.json`);
  });
}

async function storeAndOpenResult(bundle, name, code) {
  const participant = bundle.assignments.find(
    (entry) => entry.name.trim().toLocaleLowerCase() === name.trim().toLocaleLowerCase(),
  );
  if (!participant) throw new Error("Nome o codice personale non validi.");
  const recipient = await decryptAssignment(participant, code);
  try {
    localStorage.setItem(resultKey(bundle.groupId), JSON.stringify(bundle));
  } catch {
    throw new Error("Non è stato possibile salvare il file cifrato in questo browser.");
  }
  recentlyDecrypted.set(bundle.groupId, recipient);
  location.hash = `result/${encodeURIComponent(bundle.groupId)}`;
}

function renderResult(groupId) {
  let bundle = null;
  try {
    const stored = localStorage.getItem(resultKey(groupId));
    if (stored) bundle = validateResultsPackage(JSON.parse(stored), groupId);
  } catch {
    try {
      localStorage.removeItem(resultKey(groupId));
    } catch {
      // The result remains available for import again from the original JSON file.
    }
  }
  if (!bundle) {
    renderHome();
    const error = document.querySelector("#import-results-error");
    showMessage(error, "Non trovo il file dei risultati salvato qui: importalo di nuovo.");
    return;
  }

  app.innerHTML = `
    <section class="card">
      <p class="eyebrow">Il tuo Babbo Natale segreto</p>
      <h1 id="result-title"></h1>
      <p class="intro">Il file dei risultati è salvato cifrato in questo browser. Inserisci il tuo nome e il codice personale per aprire il tuo abbinamento.</p>
      <form id="open-result-form">
        <label for="result-name">Il tuo nome</label>
        <input id="result-name" maxlength="80" autocomplete="off" required>
        <label for="result-code">Il tuo codice personale</label>
        <input id="result-code" autocomplete="off" spellcheck="false" required>
        <button class="button button-primary" type="submit">Scopri il tuo abbinamento <span aria-hidden="true">→</span></button>
        <p id="result-error" class="message error" role="alert" hidden></p>
      </form>
      <div id="assignment" class="assignment" hidden><p class="eyebrow">Il tuo destinatario</p><h2>Fai un regalo a…</h2><p id="recipient" class="recipient"></p><p class="hint">Ps: shhh, non dirlo a nessuno!</p></div>
      <p class="message"><a href="${pageUrl}">Torna all’inizio</a></p>
    </section>`;
  document.querySelector("#result-title").textContent = bundle.title;

  const savedRecipient = recentlyDecrypted.get(groupId);
  if (savedRecipient) showAssignment(savedRecipient);

  document.querySelector("#open-result-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const error = document.querySelector("#result-error");
    error.hidden = true;
    const button = event.currentTarget.querySelector("button");
    button.disabled = true;
    try {
      const current = validateResultsPackage(
        JSON.parse(localStorage.getItem(resultKey(groupId))),
        groupId,
      );
      const name = document.querySelector("#result-name").value.trim();
      const code = document.querySelector("#result-code").value.trim();
      const participant = current.assignments.find(
        (entry) => entry.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase(),
      );
      if (!participant) throw new Error("Nome o codice personale non validi.");
      const recipient = await decryptAssignment(participant, code);
      recentlyDecrypted.set(groupId, recipient);
      showAssignment(recipient);
    } catch (reason) {
      showMessage(error, reason instanceof SyntaxError ? "File dei risultati non valido." : reason);
    } finally {
      button.disabled = false;
    }
  });
}

function showAssignment(recipient) {
  document.querySelector("#recipient").textContent = recipient;
  document.querySelector("#assignment").hidden = false;
}

function renderManager(groupId, organizerSecret) {
  let group;
  try {
    group = loadGroup(groupId);
  } catch (reason) {
    app.innerHTML = `<section class="card"><p class="message error"></p></section>`;
    showMessage(document.querySelector(".message"), reason);
    return;
  }
  if (!group) {
    renderUnavailable();
    return;
  }
  app.innerHTML = `
    <section class="card">
      <p class="eyebrow">Il tuo pannello organizzatore</p>
      <h1 id="manager-title"></h1>
      <p class="intro">Importa i file d’iscrizione ricevuti, avvia il sorteggio e invia il JSON cifrato a tutti. Ogni partecipante può decifrare solo il proprio risultato.</p>
      <div class="status-card"><span>Persone iscritte</span><strong id="participant-count">—</strong><span id="draw-status" class="status-pill"></span></div>
      <div id="registration-section">
        <form id="import-registrations-form">
          <label for="registrations-file">File d’iscrizione JSON (seleziona uno o più file)</label>
          <input id="registrations-file" type="file" accept=".json,application/json" multiple required>
          <button class="button button-light" type="submit">Importa iscrizioni</button>
          <p id="import-error" class="message error" role="alert" hidden></p>
        </form>
      </div>
      <div id="participant-list" class="participant-list" hidden></div>
      <div class="actions">
        <button id="draw-button" class="button button-primary" type="button">Avvia il sorteggio</button>
        <button id="download-results" class="button button-light" type="button" hidden>Scarica JSON cifrato dei risultati</button>
        <button id="reset-button" class="button button-light" type="button">Azzera gruppo</button>
      </div>
      <p id="manager-message" class="message" role="status" hidden></p>
      <p id="manager-error" class="message error" role="alert" hidden></p>
      <div class="share-box">
        <label for="group-link">Link d’iscrizione</label>
        <div class="copy-row"><input id="group-link" readonly><button class="button button-light" data-copy="group-link">Copia</button></div>
        <p id="copy-error" class="message error" role="alert" hidden></p>
        <p class="hint">Invia a ogni partecipante il link per iscriversi. Poi importa i JSON che ti mandano; dopo il sorteggio, condividi il file dei risultati nel gruppo. Il reset apre un nuovo turno e non può revocare file già scaricati.</p>
      </div>
    </section>`;

  document.querySelector("#manager-title").textContent = group.title;
  const error = document.querySelector("#manager-error");
  const message = document.querySelector("#manager-message");
  let busy = false;

  async function currentGroup() {
    const current = loadGroup(groupId);
    if (!current || (await hashSecret(organizerSecret)) !== current.managerHash) {
      throw new Error("Link organizzatore non valido.");
    }
    return current;
  }

  async function refreshManagerView() {
    try {
      const current = await currentGroup();
      document.querySelector("#group-link").value = safeRouteLink(
        "signup",
        current.roundId,
        current.title,
      );
      document.querySelector("#participant-count").textContent = current.participants.length;
      document.querySelector("#draw-status").textContent = current.status === "drawn" ? "Sorteggio avviato" : "Iscrizioni aperte";
      document.querySelector("#draw-button").disabled = busy || current.status === "drawn" || current.participants.length < 2;
      document.querySelector("#reset-button").disabled = busy || (current.status === "open" && current.participants.length === 0);
      document.querySelector("#download-results").hidden = current.status !== "drawn" || !current.resultsPackage;
      const list = document.querySelector("#participant-list");
      list.hidden = current.participants.length === 0;
      list.replaceChildren();
      for (const participant of current.participants) {
        const item = document.createElement("div");
        item.className = "participant-item";
        const name = document.createElement("span");
        name.textContent = participant.name;
        const state = document.createElement("span");
        state.className = "status-pill";
        state.textContent = current.status === "drawn" ? "Risultato cifrato" : "Iscritto";
        item.append(name, state);
        list.append(item);
      }
      document.querySelector("#registration-section").hidden = current.status !== "open";
    } catch (reason) {
      showMessage(error, reason);
      document.querySelector("#draw-button").disabled = true;
      document.querySelector("#reset-button").disabled = true;
    }
  }

  document.querySelector("#import-registrations-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const importError = document.querySelector("#import-error");
    importError.hidden = true;
    const button = event.currentTarget.querySelector("button");
    button.disabled = true;
    try {
      const current = await currentGroup();
      if (current.status !== "open") throw new Error("Le iscrizioni sono chiuse.");
      const files = Array.from(document.querySelector("#registrations-file").files || []);
      if (!files.length) throw new Error("Seleziona almeno un file d’iscrizione.");
      let totalBytes = 0;
      const packages = [];
      for (const file of files) {
        totalBytes += file.size;
        if (totalBytes > 10_000_000) throw new Error("I file selezionati superano il limite complessivo di 10 MB.");
        const registration = validateRegistrationPackage(
          await readJsonFile(file),
          current.roundId,
        );
        if (registration.title !== current.title) {
          throw new Error("Il file d’iscrizione appartiene a un altro gruppo.");
        }
        packages.push(registration);
      }
      const participants = [...current.participants];
      for (const registration of packages) {
        const participant = registration.participant;
        if (participants.some((existing) => existing.id === participant.id)) {
          throw new Error(`L’iscrizione di ${participant.name} è già stata importata.`);
        }
        if (participants.some((existing) => existing.name.trim().toLocaleLowerCase() === participant.name.trim().toLocaleLowerCase())) {
          throw new Error(`Il nome “${participant.name}” è già iscritto.`);
        }
        participants.push({ ...participant, assignmentCiphertext: null });
      }
      if (participants.length > 500) throw new Error("Il gruppo può avere al massimo 500 iscritti.");
      current.participants = participants;
      saveGroup(current);
      document.querySelector("#registrations-file").value = "";
      showMessage(message, `Importate ${packages.length} ${packages.length === 1 ? "iscrizione" : "iscrizioni"}.`);
      await refreshManagerView();
    } catch (reason) {
      showMessage(importError, reason);
    } finally {
      button.disabled = false;
    }
  });

  document.querySelector("#draw-button").addEventListener("click", async () => {
    error.hidden = true;
    message.hidden = true;
    busy = true;
    await refreshManagerView();
    try {
      const current = await currentGroup();
      if (current.status !== "open" || current.participants.length < 2) {
        throw new Error("Servono almeno due iscritti e le iscrizioni devono essere aperte.");
      }
      const assignments = createDerangement(current.participants.map((participant) => participant.id));
      const encryptedParticipants = [];
      for (const participant of current.participants) {
        const recipient = current.participants.find((entry) => entry.id === assignments[participant.id]);
        encryptedParticipants.push({
          ...participant,
          assignmentCiphertext: await encryptAssignment(participant.publicKey, recipient.name),
        });
      }
      current.participants = encryptedParticipants;
      current.resultsPackage = createResultsPackage(current.roundId, current.title, encryptedParticipants);
      current.status = "drawn";
      current.drawnAt = new Date().toISOString();
      saveGroup(current);
      downloadJson(current.resultsPackage, `risultati-${current.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.json`);
      showMessage(message, "Sorteggio pronto. Invia il file JSON cifrato a tutti i partecipanti.");
    } catch (reason) {
      showMessage(error, reason);
    } finally {
      busy = false;
      await refreshManagerView();
    }
  });

  document.querySelector("#download-results").addEventListener("click", async () => {
    try {
      const current = await currentGroup();
      const resultPackage = validateResultsPackage(current.resultsPackage, current.roundId);
      downloadJson(resultPackage, `risultati-${current.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.json`);
    } catch (reason) {
      showMessage(error, reason);
    }
  });

  document.querySelector("#reset-button").addEventListener("click", async () => {
    if (!window.confirm("Azzerare il gruppo e iniziare un nuovo turno? I file già inviati non possono essere revocati.")) return;
    error.hidden = true;
    message.hidden = true;
    busy = true;
    await refreshManagerView();
    try {
      const current = await currentGroup();
      current.roundId = crypto.randomUUID();
      current.participants = [];
      current.status = "open";
      delete current.resultsPackage;
      delete current.drawnAt;
      saveGroup(current);
      showMessage(message, "Gruppo azzerato. Condividi il nuovo link d’iscrizione del pannello.");
    } catch (reason) {
      showMessage(error, reason);
    } finally {
      busy = false;
      await refreshManagerView();
    }
  });

  wireCopyButtons();
  refreshManagerView();
  startRefresh(refreshManagerView);
}

async function render() {
  window.clearInterval(pageRefreshTimer);
  const [kind, id, third] = route();
  if (kind === "signup" && id && third) {
    renderSignup(id, third);
  } else if (kind === "manage" && id && third) {
    renderManager(id, third);
  } else if (kind === "result" && id) {
    renderResult(id);
  } else {
    renderHome();
  }
}

window.addEventListener("hashchange", render);
render();
