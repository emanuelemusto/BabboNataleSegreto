import { createDerangement } from "./draw.mjs";
import {
  createParticipantCredentials,
  decryptAssignment,
  encryptAssignment,
  hashSecret,
  randomSecret,
} from "./crypto.mjs";

const app = document.querySelector("#app");
const pageUrl = `${location.origin}${location.pathname}`;
const groupKey = (id) => `secret-santa:v1:${id}`;
const route = () => location.hash.slice(1).split("/").map(decodeURIComponent);
let pageRefreshTimer;

function startRefresh(callback) {
  window.clearInterval(pageRefreshTimer);
  pageRefreshTimer = window.setInterval(callback, 2000);
}

function showError(element, error) {
  element.textContent = error instanceof Error ? error.message : String(error);
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
  return group;
}

function saveGroup(group) {
  try {
    localStorage.setItem(groupKey(group.id), JSON.stringify(group));
  } catch {
    throw new Error("Non è stato possibile salvare il gruppo in questo browser.");
  }
}

function safeRouteLink(kind, id, secret = "") {
  return `${pageUrl}#${kind}/${encodeURIComponent(id)}${secret ? `/${encodeURIComponent(secret)}` : ""}`;
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
        showError(document.querySelector("#copy-error"), "Copia non disponibile: seleziona e copia il link manualmente.");
      }
    });
  });
}

function renderHome() {
  app.innerHTML = `
    <section class="card hero">
      <p class="eyebrow">Il regalo giusto, in segreto</p>
      <h1>Babbo Natale<br><span>segreto.</span></h1>
      <p class="intro">Crea un gruppo, raccogli le iscrizioni e fai partire il sorteggio. I risultati sono cifrati: l’organizzatore non può leggerli nell’app.</p>
      <div class="notice"><span class="notice-icon" aria-hidden="true">✳</span><div><strong>Una versione solo-browser</strong><p>GitHub Pages non conserva dati condivisi. Perciò tutti devono aprire l’invito sullo stesso dispositivo, nello stesso browser. I dati del gruppo restano lì.</p></div></div>
      <form id="create-form">
        <label for="title">Come si chiama il gruppo?</label>
        <input id="title" maxlength="80" placeholder="es. Natale in famiglia" required>
        <button class="button button-primary" type="submit">Crea il gruppo <span aria-hidden="true">→</span></button>
        <p id="create-error" class="message error" role="alert" hidden></p>
      </form>
      <div id="created" class="created" hidden>
        <p class="success-title">Gruppo pronto. Salva entrambi i link.</p>
        <label for="invite-link">Link d’invito (da aprire sullo stesso browser)</label>
        <div class="copy-row"><input id="invite-link" readonly><button class="button button-light" data-copy="invite-link">Copia</button></div>
        <label for="organizer-link">Link organizzatore (tienilo privato)</label>
        <div class="copy-row"><input id="organizer-link" readonly><button class="button button-light" data-copy="organizer-link">Copia</button></div>
        <p id="copy-error" class="message error" role="alert" hidden></p>
        <p class="hint">Il link organizzatore contiene una chiave privata: chi lo possiede può avviare o azzerare il gruppo. Non contiene accesso ai risultati.</p>
        <a id="open-organizer" class="button button-primary" href="#">Apri il pannello organizzatore <span aria-hidden="true">→</span></a>
      </div>
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
        title,
        managerHash: await hashSecret(organizerSecret),
        status: "open",
        participants: [],
        createdAt: new Date().toISOString(),
      };
      saveGroup(group);
      document.querySelector("#invite-link").value = safeRouteLink("group", id);
      const organizerLink = safeRouteLink("manage", id, organizerSecret);
      document.querySelector("#organizer-link").value = organizerLink;
      document.querySelector("#open-organizer").href = organizerLink;
      document.querySelector("#created").hidden = false;
      button.textContent = "Gruppo creato";
    } catch (reason) {
      showError(error, reason);
      button.disabled = false;
    }
  });
  wireCopyButtons();
}

function renderUnavailable() {
  app.innerHTML = `
    <section class="card">
      <p class="eyebrow">Gruppo non trovato</p>
      <h1>Questo gruppo<br><span>non è qui.</span></h1>
      <p class="intro">I gruppi esistono soltanto nella memoria del browser in cui sono stati creati. Controlla di aver aperto il link sullo stesso dispositivo e nello stesso browser usati per creare il gruppo.</p>
      <a class="button button-primary" href="${pageUrl}">Torna all’inizio <span aria-hidden="true">→</span></a>
    </section>`;
}

function renderGroup(groupId, lastSignup = null) {
  let group;
  try {
    group = loadGroup(groupId);
  } catch (reason) {
    app.innerHTML = `<section class="card"><p class="message error"></p></section>`;
    showError(document.querySelector(".message"), reason);
    return;
  }
  if (!group) {
    renderUnavailable();
    return;
  }
  app.innerHTML = `
    <section class="card">
      <p class="eyebrow">Sei dei nostri?</p>
      <h1 id="group-title"></h1>
      <p id="group-description" class="intro">Iscriviti con il tuo nome. Quando l’organizzatore avvierà il sorteggio, inserisci il tuo codice personale per scoprire a chi fare il regalo.</p>
      <div id="signup-code" class="notice" hidden>
        <span class="notice-icon" aria-hidden="true">✳</span>
        <div><strong>Iscrizione completata, <span id="signup-name"></span>!</strong><p>Salva questo codice: ti servirà per aprire il tuo risultato. Nessun altro, nemmeno l’organizzatore, può recuperarlo.</p>
          <div class="copy-row"><input id="personal-code" readonly><button class="button button-light" data-copy="personal-code">Copia codice</button></div>
          <p id="copy-error" class="message error" role="alert" hidden></p>
        </div>
      </div>
      <div id="group-status" class="status-card"></div>
      <form id="join-form">
        <label for="name">Il tuo nome</label>
        <input id="name" maxlength="80" autocomplete="name" placeholder="Nome e cognome" required>
        <button class="button button-primary" type="submit">Iscriviti al gruppo <span aria-hidden="true">→</span></button>
        <p id="join-error" class="message error" role="alert" hidden></p>
      </form>
      <form id="result-form" hidden>
        <p class="eyebrow">Il tuo risultato è cifrato</p>
        <label for="result-name">Il nome usato per iscriverti</label>
        <input id="result-name" maxlength="80" autocomplete="off" required>
        <label for="access-code">Il tuo codice personale</label>
        <input id="access-code" autocomplete="off" spellcheck="false" required>
        <button class="button button-primary" type="submit">Scopri il tuo abbinamento <span aria-hidden="true">→</span></button>
        <p id="result-error" class="message error" role="alert" hidden></p>
      </form>
      <div id="assignment" class="assignment" hidden><p class="eyebrow">Il tuo Babbo Natale segreto</p><h2>Fai un regalo a…</h2><p id="recipient" class="recipient"></p><p class="hint">Ps: shhh, non dirlo a nessuno!</p></div>
    </section>`;

  document.querySelector("#group-title").textContent = group.title;
  const status = document.querySelector("#group-status");
  const joinForm = document.querySelector("#join-form");
  const resultForm = document.querySelector("#result-form");
  const copyError = document.querySelector("#copy-error");

  if (lastSignup) {
    document.querySelector("#signup-code").hidden = false;
    document.querySelector("#signup-name").textContent = lastSignup.name;
    document.querySelector("#personal-code").value = lastSignup.code;
    wireCopyButtons();
  }

  function updateGroupView() {
    let current;
    try {
      current = loadGroup(groupId);
    } catch (reason) {
      showError(status, reason);
      return;
    }
    if (!current) {
      renderUnavailable();
      return;
    }
    status.textContent = current.status === "drawn"
      ? "Il sorteggio è pronto. Inserisci il tuo codice per vedere il destinatario."
      : `${current.participants.length} ${current.participants.length === 1 ? "persona iscritta" : "persone iscritte"} · ${current.status === "open" ? "Iscrizioni aperte" : "Sorteggio in corso"}`;
    joinForm.hidden = current.status !== "open";
    resultForm.hidden = current.status !== "drawn";
    if (current.status === "open") {
      document.querySelector("#assignment").hidden = true;
      document.querySelector("#group-description").hidden = false;
    } else {
      document.querySelector("#group-description").hidden = true;
    }
  }

  joinForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const error = document.querySelector("#join-error");
    error.hidden = true;
    const button = event.currentTarget.querySelector("button");
    button.disabled = true;
    try {
      const current = loadGroup(groupId);
      if (!current || current.status !== "open") throw new Error("Le iscrizioni sono chiuse.");
      const name = document.querySelector("#name").value.trim();
      if (!name || name.length > 80) throw new Error("Inserisci il tuo nome (massimo 80 caratteri).");
      if (current.participants.some((participant) => participant.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
        throw new Error("Questo nome è già iscritto al gruppo.");
      }
      const credentials = await createParticipantCredentials();
      current.participants.push({
        id: crypto.randomUUID(),
        name,
        publicKey: credentials.publicKey,
        privateKeyCiphertext: credentials.privateKeyCiphertext,
        privateKeyIv: credentials.privateKeyIv,
        assignmentCiphertext: null,
      });
      saveGroup(current);
      renderGroup(groupId, { name, code: credentials.accessCode });
    } catch (reason) {
      showError(error, reason);
      button.disabled = false;
    }
  });

  resultForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const error = document.querySelector("#result-error");
    error.hidden = true;
    const button = event.currentTarget.querySelector("button");
    button.disabled = true;
    try {
      const current = loadGroup(groupId);
      if (!current || current.status !== "drawn") throw new Error("Il sorteggio non è ancora pronto.");
      const name = document.querySelector("#result-name").value.trim();
      const accessCode = document.querySelector("#access-code").value.trim();
      const participant = current.participants.find(
        (entry) => entry.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
      );
      if (!participant?.assignmentCiphertext) throw new Error("Nome o codice personale non validi.");
      const recipient = await decryptAssignment(participant, accessCode);
      document.querySelector("#recipient").textContent = recipient;
      document.querySelector("#assignment").hidden = false;
    } catch (reason) {
      showError(error, reason);
    } finally {
      button.disabled = false;
    }
  });

  updateGroupView();
  startRefresh(updateGroupView);
}

function renderManager(groupId, organizerSecret) {
  let group;
  try {
    group = loadGroup(groupId);
  } catch (reason) {
    app.innerHTML = `<section class="card"><p class="message error"></p></section>`;
    showError(document.querySelector(".message"), reason);
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
      <p class="intro">Puoi avviare o azzerare il sorteggio, ma i risultati sono cifrati con i codici dei partecipanti: non vengono mostrati in questo pannello.</p>
      <div class="status-card"><span>Persone iscritte</span><strong id="participant-count">—</strong><span id="draw-status" class="status-pill"></span></div>
      <div class="actions">
        <button id="draw-button" class="button button-primary" type="button">Avvia il sorteggio <span aria-hidden="true">→</span></button>
        <button id="reset-button" class="button button-light" type="button">Azzera gruppo</button>
      </div>
      <p id="manager-message" class="message" role="status" hidden></p>
      <p id="manager-error" class="message error" role="alert" hidden></p>
      <div class="share-box">
        <label for="group-link">Link da aprire per iscriversi e vedere il risultato</label>
        <div class="copy-row"><input id="group-link" readonly><button class="button button-light" data-copy="group-link">Copia</button></div>
        <p id="copy-error" class="message error" role="alert" hidden></p>
        <p class="hint">Tutti devono usare questo link sullo stesso dispositivo e browser in cui il gruppo è stato creato. Azzera gruppo elimina iscrizioni e abbinamenti.</p>
      </div>
    </section>`;

  document.querySelector("#manager-title").textContent = group.title;
  document.querySelector("#group-link").value = safeRouteLink("group", groupId);
  const error = document.querySelector("#manager-error");
  const message = document.querySelector("#manager-message");
  let busy = false;

  async function refreshManagerView() {
    try {
      const current = loadGroup(groupId);
      if (!current || (await hashSecret(organizerSecret)) !== current.managerHash) {
        throw new Error("Link organizzatore non valido.");
      }
      document.querySelector("#participant-count").textContent = current.participants.length;
      document.querySelector("#draw-status").textContent = current.status === "drawn" ? "Sorteggio avviato" : "Iscrizioni aperte";
      document.querySelector("#draw-button").disabled = busy || current.status === "drawn" || current.participants.length < 2;
      document.querySelector("#reset-button").disabled = busy || (current.status === "open" && current.participants.length === 0);
    } catch (reason) {
      showError(error, reason);
      document.querySelector("#draw-button").disabled = true;
      document.querySelector("#reset-button").disabled = true;
    }
  }

  document.querySelector("#draw-button").addEventListener("click", async () => {
    error.hidden = true;
    message.hidden = true;
    busy = true;
    const button = document.querySelector("#draw-button");
    button.disabled = true;
    try {
      const current = loadGroup(groupId);
      if (!current || (await hashSecret(organizerSecret)) !== current.managerHash) {
        throw new Error("Link organizzatore non valido.");
      }
      if (current.status !== "open" || current.participants.length < 2) {
        throw new Error("Servono almeno due iscritti e le iscrizioni devono essere aperte.");
      }
      const assignments = createDerangement(current.participants.map((participant) => participant.id));
      for (const participant of current.participants) {
        const recipient = current.participants.find((entry) => entry.id === assignments[participant.id]);
        participant.assignmentCiphertext = await encryptAssignment(participant.publicKey, recipient.name);
      }
      current.status = "drawn";
      current.drawnAt = new Date().toISOString();
      saveGroup(current);
      showError(message, "Sorteggio avviato. Gli abbinamenti sono cifrati e non appaiono in questo pannello.");
      await refreshManagerView();
    } catch (reason) {
      showError(error, reason);
    } finally {
      busy = false;
      await refreshManagerView();
    }
  });

  document.querySelector("#reset-button").addEventListener("click", async () => {
    if (!window.confirm("Azzerare il gruppo? Tutte le iscrizioni e i risultati verranno eliminati.")) return;
    error.hidden = true;
    message.hidden = true;
    busy = true;
    await refreshManagerView();
    try {
      const current = loadGroup(groupId);
      if (!current || (await hashSecret(organizerSecret)) !== current.managerHash) {
        throw new Error("Link organizzatore non valido.");
      }
      current.participants = [];
      current.status = "open";
      delete current.drawnAt;
      saveGroup(current);
      showError(message, "Gruppo azzerato. Le iscrizioni sono di nuovo aperte.");
      await refreshManagerView();
    } catch (reason) {
      showError(error, reason);
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
  const [kind, id, secret] = route();
  if (kind === "group" && id) {
    renderGroup(id);
  } else if (kind === "manage" && id && secret) {
    renderManager(id, secret);
  } else {
    renderHome();
  }
}

window.addEventListener("hashchange", render);
render();
