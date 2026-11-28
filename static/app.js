import { createDerangement } from "./draw.mjs";
import {
  createParticipantCredentials,
  decryptAssignment,
  encryptAssignment,
  hashSecret,
  randomSecret,
} from "./crypto.mjs";
import { callRpc, isSupabaseConfigured } from "./supabase.mjs";

const app = document.querySelector("#app");
const pageUrl = `${location.origin}${location.pathname}`;
const route = () => location.hash.slice(1).split("/").map(decodeURIComponent);
let refreshTimer;

function message(element, value) {
  if (!element) return;
  element.textContent = value instanceof Error ? value.message : String(value);
  element.hidden = false;
}

function routeUrl(kind, ...segments) {
  return `${pageUrl}#${kind}/${segments.map(encodeURIComponent).join("/")}`;
}

function participantSessionKey(drawId) {
  return `secret-santa:${drawId}`;
}

function saveParticipantSession(drawId, participantId, accessCode) {
  try {
    localStorage.setItem(participantSessionKey(drawId), JSON.stringify({ participantId, accessCode }));
    return true;
  } catch {
    return false;
  }
}

function removeParticipantSession(drawId) {
  try {
    localStorage.removeItem(participantSessionKey(drawId));
  } catch {
    return false;
  }
  return true;
}

function getParticipantSession(drawId, participantId) {
  try {
    const saved = localStorage.getItem(participantSessionKey(drawId));
    if (!saved) return null;
    const session = JSON.parse(saved);
    if (!session || (participantId && session.participantId !== participantId) || typeof session.accessCode !== "string") return null;
    return session;
  } catch {
    return null;
  }
}

function firstRow(result) {
  if (!Array.isArray(result) || !result.length) {
    throw new Error("Risposta Supabase non valida. Controlla la migrazione del database.");
  }
  return result[0];
}

function copyButtons() {
  document.querySelectorAll("[data-copy]").forEach((button) => {
    button.addEventListener("click", async () => {
      const input = document.getElementById(button.dataset.copy);
      try {
        await navigator.clipboard.writeText(input.value);
        button.textContent = "Copiato ✓";
        setTimeout(() => { button.textContent = "Copia"; }, 1600);
      } catch {
        input.focus();
        input.select();
        message(document.querySelector("#copy-error"), "Copia non disponibile: seleziona e copia il link.");
      }
    });
  });
}

function stopRefresh() {
  window.clearInterval(refreshTimer);
  refreshTimer = undefined;
}

function startRefresh(callback) {
  stopRefresh();
  refreshTimer = window.setInterval(callback, 4000);
}

function renderHome() {
  stopRefresh();
  app.innerHTML = `
    <section class="hero-card">
      <p class="eyebrow">ORGANIZZAZIONE DEL SORTEGGIO</p>
      <h1>Babbo Natale<br>segreto</h1>
      <p class="hero-copy">Organizza il sorteggio del tuo gruppo. Ogni partecipante riceve il proprio abbinamento; chi organizza non vede i risultati.</p>
      <form id="create-form" class="create-form">
        <label for="title">Nome del gruppo</label>
        <div class="create-row"><input id="title" maxlength="80" placeholder="es. Pasta Team" autocomplete="off" required><button class="button button-primary" type="submit">Crea gruppo</button></div>
        <p id="create-error" class="message error" role="alert" hidden></p>
      </form>
    </section>
    <section class="how-grid" aria-label="Come funziona">
      <article class="how-card"><span class="step-number">01</span><h2>Crea il gruppo</h2><p>Imposta il gruppo e conserva il link di gestione.</p></article>
      <article class="how-card"><span class="step-number">02</span><h2>Condividi l’invito</h2><p>I partecipanti si aggiungono dal proprio dispositivo.</p></article>
      <article class="how-card"><span class="step-number">03</span><h2>Avvia il sorteggio</h2><p>Ognuno consulta in privato il proprio abbinamento.</p></article>
    </section>
    <p id="setup-note" class="setup-note" hidden>La configurazione del database non è ancora completata.</p>`;
  const configured = isSupabaseConfigured();
  document.querySelector("#setup-note").hidden = configured;
  document.querySelector("#create-form button").disabled = !configured;
  document.querySelector("#create-form").addEventListener("submit", createGroup);
}

async function createGroup(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector("button");
  const error = document.querySelector("#create-error");
  error.hidden = true;
  button.disabled = true;
  try {
    const title = document.querySelector("#title").value.trim();
    const inviteSecret = randomSecret();
    const organizerSecret = randomSecret();
    const created = firstRow(await callRpc("santa_create_draw", {
      p_title: title,
      p_invite_secret: inviteSecret,
      p_organizer_secret: organizerSecret,
    }));
    showCreatedGroup(created.draw_id, created.draw_title, inviteSecret, organizerSecret);
  } catch (reason) {
    message(error, reason);
    button.disabled = false;
  }
}

function showCreatedGroup(drawId, title, inviteSecret, organizerSecret) {
  const inviteUrl = routeUrl("join", drawId, inviteSecret);
  const organizerUrl = routeUrl("manage", drawId, organizerSecret, inviteSecret);
  app.innerHTML = `
    <section class="result-card created-card">
      <p class="eyebrow">GRUPPO CREATO</p>
      <h1>${escapeHtml(title)}<br><span>è pronto.</span></h1>
      <p class="hero-copy">Condividi il link d’invito con il gruppo e conserva il link di gestione.</p>
      <label for="invite-link">LINK D’INVITO</label>
      <div class="copy-row"><input id="invite-link" readonly><button class="button button-secondary" data-copy="invite-link">Copia</button></div>
      <label for="organizer-link">LINK DI GESTIONE · PRIVATO</label>
      <div class="copy-row"><input id="organizer-link" readonly><button class="button button-secondary" data-copy="organizer-link">Copia</button></div>
      <p id="copy-error" class="message error" role="alert" hidden></p>
      <a class="button button-primary button-wide" href="${organizerUrl}">Apri gestione gruppo</a>
      <p class="tiny-note">Chi possiede questo link può gestire il gruppo. Conservalo in privato.</p>
    </section>`;
  document.querySelector("#invite-link").value = inviteUrl;
  document.querySelector("#organizer-link").value = organizerUrl;
  copyButtons();
}

function escapeHtml(text) {
  const element = document.createElement("span");
  element.textContent = text;
  return element.innerHTML;
}

function renderJoin(drawId, inviteSecret) {
  stopRefresh();
  if (!drawId || !inviteSecret) return renderNotFound();
  app.innerHTML = `
    <section class="result-card">
      <p class="eyebrow">INVITO AL SORTEGGIO</p>
      <h1 id="group-title">Caricamento…</h1>
      <p class="hero-copy">Inserisci il tuo nome per partecipare. Al termine del sorteggio potrai consultare il tuo abbinamento da questa pagina.</p>
      <div id="joined-panel" class="joined-panel" hidden>
        <span class="joined-mark" aria-hidden="true">✓</span>
        <div><h2>Iscrizione completata</h2><p>Apri il link personale per vedere il tuo abbinamento quando il sorteggio sarà pronto.</p>
          <div class="copy-row"><input id="personal-code" readonly><button class="button button-secondary" data-copy="personal-code">Copia codice</button></div>
          <a id="my-result-link" class="button button-primary button-wide" href="#">Apri il tuo abbinamento</a>
          <p id="copy-error" class="message error" role="alert" hidden></p>
          <p class="code-warning" role="alert"><strong>Importante:</strong> salva subito questo codice personale in un luogo sicuro. Se lo perdi, non sarà possibile recuperarlo e non potrai vedere il tuo abbinamento. Nemmeno l’organizzatore può recuperarlo.</p>
        </div>
      </div>
      <form id="join-form" class="stack-form">
        <label for="name">Il tuo nome</label>
        <input id="name" maxlength="80" autocomplete="name" placeholder="Nome e cognome" required>
        <button class="button button-primary button-wide" type="submit">Partecipa al sorteggio</button>
        <p id="join-error" class="message error" role="alert" hidden></p>
      </form>
      <p id="group-state" class="draw-notice participant-draw-notice" role="status">Verifica stato sorteggio…</p>
      <section class="participant-preview" aria-labelledby="participant-preview-title">
        <div class="participant-preview-heading">
          <h2 id="participant-preview-title">Partecipanti</h2>
          <span id="participant-preview-count" class="participant-count">0</span>
        </div>
        <ul id="participant-preview-list" class="participant-preview-list"></ul>
        <p id="participant-preview-empty" class="participant-preview-empty">Nessun partecipante iscritto.</p>
      </section>
      <a id="invite-result-link" class="button button-primary button-wide" href="#" hidden>Vai al tuo abbinamento</a>
      <details class="returning-participant">
        <summary>
          <strong>Hai già partecipato?</strong>
          <span>Apri questa sezione e inserisci il codice personale che hai salvato.</span>
        </summary>
        <p class="returning-help">Non serve iscriversi di nuovo. Il codice collega la tua iscrizione a questo dispositivo e apre il risultato se il sorteggio è già stato fatto.</p>
        <form id="returning-form" class="stack-form">
          <label for="returning-code">Codice personale</label>
          <input id="returning-code" autocomplete="off" spellcheck="false" placeholder="Incolla qui il codice personale" required>
          <button class="button button-secondary button-wide" type="submit">Collega la mia iscrizione</button>
          <p id="returning-error" class="message error" role="alert" hidden></p>
        </form>
      </details>
    </section>`;

  const title = document.querySelector("#group-title");
  const state = document.querySelector("#group-state");
  const form = document.querySelector("#join-form");
  let sessionChecked = false;
  let savedSession = null;
  let sessionWasReset = false;
  let lastSessionCheck = 0;
  let lastParticipantCount = null;

  async function refresh() {
    try {
      const current = firstRow(await callRpc("santa_group_info", {
        p_draw_id: drawId,
        p_invite_secret: inviteSecret,
      }));
      title.textContent = current.draw_title;
      const participantNames = Array.isArray(current.participants) ? current.participants : [];
      const participantList = document.querySelector("#participant-preview-list");
      const participantEmpty = document.querySelector("#participant-preview-empty");
      document.querySelector("#participant-preview-count").textContent = String(current.participant_count);
      participantList.replaceChildren();
      for (const participant of participantNames) {
        if (!participant?.name) continue;
        const item = document.createElement("li");
        item.textContent = participant.name;
        participantList.append(item);
      }
      participantEmpty.hidden = participantNames.length > 0;
      const participantCount = Number(current.participant_count);
      const now = Date.now();
      if (
        !sessionChecked ||
        participantCount !== lastParticipantCount ||
        now - lastSessionCheck >= 15000
      ) {
        const previousSession = savedSession;
        savedSession = null;
        const storedSession = getParticipantSession(drawId, null);
        if (storedSession) {
          try {
            const participant = firstRow(await callRpc("santa_find_participant", {
              p_draw_id: drawId,
              p_access_secret: await hashSecret(storedSession.accessCode, "hex"),
            }));
            savedSession = {
              participantId: participant.participant_id,
              accessCode: storedSession.accessCode,
            };
            if (participant.participant_id !== storedSession.participantId) {
              saveParticipantSession(drawId, participant.participant_id, storedSession.accessCode);
            }
          } catch (reason) {
            if (!reason.message.includes("Codice personale non valido per questo gruppo.")) throw reason;
            removeParticipantSession(drawId);
            sessionWasReset = true;
          }
        } else if (previousSession) {
          sessionWasReset = true;
        }
        sessionChecked = true;
        lastSessionCheck = now;
        lastParticipantCount = participantCount;
      }
      state.textContent = current.draw_status === "open"
        ? savedSession
          ? "Il sorteggio non è ancora stato effettuato. Sei già iscritto: torna qui quando l’organizzatore lo avrà avviato."
          : sessionWasReset
            ? "La vecchia iscrizione è stata azzerata. Ora puoi iscriverti di nuovo."
            : `Il sorteggio non è ancora stato effettuato. Ci sono ${current.participant_count} ${Number(current.participant_count) === 1 ? "persona iscritta" : "persone iscritte"} e le iscrizioni sono ancora aperte.`
        : savedSession
          ? "Sorteggio completato. Puoi aprire il tuo abbinamento qui sotto."
          : "Sorteggio completato. Per vedere il tuo risultato, apri il link personale che hai salvato.";
      if (sessionWasReset) document.querySelector("#joined-panel").hidden = true;
      state.classList.toggle("draw-notice-complete", current.draw_status === "drawn");
      const resultLink = document.querySelector("#invite-result-link");
      document.querySelector(".returning-participant").hidden = Boolean(savedSession);
      if (current.draw_status === "drawn" && savedSession) {
        resultLink.href = routeUrl("result", drawId, savedSession.participantId);
        resultLink.hidden = false;
      } else {
        resultLink.hidden = true;
      }
      form.hidden = current.draw_status !== "open" || Boolean(savedSession) || !document.querySelector("#joined-panel").hidden;
    } catch (reason) {
      form.hidden = true;
      message(state, reason);
      stopRefresh();
    }
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = form.querySelector("button");
    const error = document.querySelector("#join-error");
    error.hidden = true;
    button.disabled = true;
    try {
      const name = document.querySelector("#name").value.trim();
      const credentials = await createParticipantCredentials();
      const result = firstRow(await callRpc("santa_join_draw", {
        p_draw_id: drawId,
        p_invite_secret: inviteSecret,
        p_name: name,
        p_public_key: credentials.publicKey,
        p_private_key_ciphertext: credentials.privateKeyCiphertext,
        p_private_key_iv: credentials.privateKeyIv,
        p_access_hash: await hashSecret(credentials.accessCode, "hex"),
      }));
      const sessionSaved = saveParticipantSession(drawId, result.participant_id, credentials.accessCode);
      savedSession = { participantId: result.participant_id, accessCode: credentials.accessCode };
      sessionChecked = true;
      sessionWasReset = false;
      document.querySelector("#group-title").textContent = result.draw_title;
      document.querySelector("#personal-code").value = credentials.accessCode;
      document.querySelector("#my-result-link").href = routeUrl("result", drawId, result.participant_id);
      if (!sessionSaved) {
        document.querySelector("#copy-error").textContent = "La sessione non è disponibile in questo browser. Conserva il codice: ti servirà per aprire il risultato.";
        document.querySelector("#copy-error").hidden = false;
      }
      document.querySelector("#joined-panel").hidden = false;
      form.hidden = true;
      copyButtons();
      await refresh();
    } catch (reason) {
      message(error, reason);
      button.disabled = false;
    }
  });

  document.querySelector("#returning-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const returningForm = event.currentTarget;
    const button = returningForm.querySelector("button");
    const error = document.querySelector("#returning-error");
    error.hidden = true;
    button.disabled = true;
    try {
      const code = document.querySelector("#returning-code").value.trim();
      const participant = firstRow(await callRpc("santa_find_participant", {
        p_draw_id: drawId,
        p_access_secret: await hashSecret(code, "hex"),
      }));
      const sessionSaved = saveParticipantSession(drawId, participant.participant_id, code);
      savedSession = { participantId: participant.participant_id, accessCode: code };
      sessionChecked = true;
      sessionWasReset = false;
      if (participant.draw_status === "drawn") {
        window.location.assign(routeUrl("result", drawId, participant.participant_id));
        return;
      }
      returningForm.hidden = true;
      form.hidden = true;
      state.textContent = sessionSaved
        ? "Codice verificato. Il tuo accesso è collegato a questo dispositivo: torna qui dopo il sorteggio."
        : "Codice verificato, ma il browser non può salvare la sessione. Conserva il codice e torna qui dopo il sorteggio.";
    } catch (reason) {
      message(error, reason);
    } finally {
      button.disabled = false;
    }
  });
  refresh();
  startRefresh(refresh);
}

function renderNotFound() {
  stopRefresh();
  app.innerHTML = `
    <section class="result-card">
      <p class="eyebrow">LINK NON VALIDO</p>
      <h1>Questo gruppo<br><span>non è disponibile.</span></h1>
      <p class="hero-copy">Controlla il link oppure chiedi all’organizzatore di inviartelo di nuovo.</p>
      <a class="button button-primary button-wide" href="${pageUrl}">Torna alla pagina iniziale</a>
    </section>`;
}

function renderResult(drawId, participantId, accessCode) {
  stopRefresh();
  const savedSession = accessCode ? null : getParticipantSession(drawId, participantId);
  const sessionCode = savedSession?.accessCode;
  const initialCode = accessCode || sessionCode;
  app.innerHTML = `
    <section class="result-card result-reveal">
      <p class="eyebrow">AREA PERSONALE</p>
      <h1 id="result-title">Il tuo<br><span>abbinamento.</span></h1>
      <p class="hero-copy">${initialCode ? "Stiamo recuperando il tuo abbinamento. Solo tu puoi vedere il risultato." : "Il risultato è disponibile nella sessione in cui ti sei iscritto. In alternativa, inserisci il codice personale."}</p>
      <form id="result-form" class="stack-form" ${initialCode ? "hidden" : ""}>
        <label for="access-code">Codice personale</label>
        <input id="access-code" autocomplete="off" spellcheck="false" placeholder="Incolla il tuo codice" required>
        <button class="button button-primary button-wide" type="submit">Visualizza abbinamento</button>
        <p id="result-error" class="message error" role="alert" hidden></p>
      </form>
      <div id="assignment" class="assignment" hidden>
        <span class="eyebrow">A TE È CAPITATO</span>
        <p id="recipient" class="recipient"></p>
        <p class="tiny-note">Non condividere il risultato prima dello scambio dei regali.</p>
      </div>
    </section>`;
  const form = document.querySelector("#result-form");
  if (initialCode) document.querySelector("#access-code").value = initialCode;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector("button");
    const error = document.querySelector("#result-error");
    error.hidden = true;
    button.disabled = true;
    try {
      const code = document.querySelector("#access-code").value.trim();
      const result = firstRow(await callRpc("santa_my_assignment", {
        p_draw_id: drawId,
        p_participant_id: participantId,
        p_access_secret: await hashSecret(code, "hex"),
      }));
      const recipient = await decryptAssignment({
        privateKeyCiphertext: result.private_key_ciphertext,
        privateKeyIv: result.private_key_iv,
        assignmentCiphertext: result.assignment_ciphertext,
      }, code);
      saveParticipantSession(drawId, participantId, code);
      document.querySelector("#result-title").textContent = result.draw_title;
      document.querySelector("#recipient").textContent = recipient;
      document.querySelector("#assignment").hidden = false;
      event.currentTarget.hidden = true;
    } catch (reason) {
      message(error, reason);
      if (initialCode) event.currentTarget.hidden = false;
    } finally {
      button.disabled = false;
    }
  });
  if (initialCode) form.requestSubmit();
}

function renderManager(drawId, organizerSecret, inviteSecret) {
  stopRefresh();
  if (!drawId || !organizerSecret) return renderNotFound();
  app.innerHTML = `
    <section class="result-card organizer-card">
      <div class="eyebrow-row"><span class="eyebrow">PANNELLO ORGANIZZATORE</span><span class="admin-badge">ACCESSO PRIVATO</span></div>
      <h1 id="manager-title">Un attimo…</h1>
      <p class="hero-copy">Condividi l’invito e attendi che tutti i partecipanti si siano iscritti. Avvia il sorteggio quando il gruppo è pronto; gli abbinamenti resteranno privati.</p>
      <div class="manager-stats"><div><span>PARTECIPANTI</span><strong id="participant-count">—</strong></div><span id="draw-status" class="status-pill">Caricamento…</span></div>
      <p id="draw-notice" class="draw-notice" role="status">Verifica stato sorteggio…</p>
      <div id="participants" class="participant-list"></div>
      <div class="actions">
        <button id="draw-button" class="button button-primary button-wide" type="button">Avvia il sorteggio</button>
        <button id="reset-button" class="button button-secondary button-wide" type="button">Azzera gruppo</button>
      </div>
      <p id="manager-message" class="message success-message" role="status" hidden></p>
      <p id="manager-error" class="message error" role="alert" hidden></p>
      <div class="share-box">
        <label for="invite-link">LINK D’INVITO DA CONDIVIDERE</label>
        <div class="copy-row"><input id="invite-link" readonly><button class="button button-secondary" data-copy="invite-link">Copia</button></div>
        <p id="copy-error" class="message error" role="alert" hidden></p>
      </div>
    </section>`;
  const error = document.querySelector("#manager-error");
  const statusMessage = document.querySelector("#manager-message");
  let busy = false;

  async function adminState() {
    return firstRow(await callRpc("santa_organizer_state", {
      p_draw_id: drawId,
      p_organizer_secret: organizerSecret,
    }));
  }

  async function refresh() {
    try {
      const state = await adminState();
      document.querySelector("#manager-title").textContent = state.draw_title;
      document.querySelector("#participant-count").textContent = state.participant_count;
      const drawComplete = state.draw_status === "drawn";
      document.querySelector("#draw-status").textContent = drawComplete ? "Completato" : "Da effettuare";
      document.querySelector("#draw-notice").textContent = drawComplete
        ? "Sorteggio effettuato. I partecipanti possono aprire il proprio link per vedere l’abbinamento."
        : "Il sorteggio per questo gruppo NON è ancora stato effettuato. Avvialo con il pulsante qui sotto quando tutti si sono iscritti.";
      document.querySelector("#draw-notice").classList.toggle("draw-notice-complete", drawComplete);
      document.querySelector("#invite-link").value = routeUrl("join", drawId, inviteSecret);
      document.querySelector("#draw-button").disabled = busy || state.draw_status !== "open" || state.participant_count < 2;
      document.querySelector("#reset-button").disabled = busy || (state.draw_status === "open" && state.participant_count === 0);

      const list = firstRow(await callRpc("santa_organizer_participants", {
        p_draw_id: drawId,
        p_organizer_secret: organizerSecret,
      })).participants;
      const container = document.querySelector("#participants");
      container.replaceChildren();
      for (const participant of list) {
        const row = document.createElement("div");
        row.className = "participant-item";
        const name = document.createElement("span");
        name.textContent = participant.name;
        const actions = document.createElement("div");
        actions.className = "participant-actions";
        const remove = document.createElement("button");
        remove.className = "button button-secondary participant-remove";
        remove.type = "button";
        remove.textContent = "Rimuovi";
        remove.disabled = busy || state.draw_status !== "open";
        remove.setAttribute("aria-label", `Rimuovi ${participant.name} dal gruppo`);
        remove.addEventListener("click", async () => {
          if (busy || !window.confirm(`Rimuovere ${participant.name} dal gruppo?`)) return;
          busy = true;
          error.hidden = true;
          statusMessage.hidden = true;
          try {
            await callRpc("santa_remove_participant", {
              p_draw_id: drawId,
              p_organizer_secret: organizerSecret,
              p_participant_id: participant.id,
            });
            message(statusMessage, `${participant.name} è stato rimosso dal gruppo.`);
          } catch (reason) {
            message(error, reason);
          } finally {
            busy = false;
            await refresh();
          }
        });
        actions.append(remove);
        row.append(name, actions);
        container.append(row);
      }
    } catch (reason) {
      message(error, reason);
      document.querySelector("#draw-button").disabled = true;
      document.querySelector("#reset-button").disabled = true;
    }
  }

  document.querySelector("#draw-button").addEventListener("click", async () => {
    busy = true;
    error.hidden = true;
    statusMessage.hidden = true;
    await refresh();
    try {
      const state = await adminState();
      if (state.draw_status !== "open" || state.participant_count < 2) {
        throw new Error("Servono almeno due partecipanti e le iscrizioni devono essere aperte.");
      }
      const participantResponse = firstRow(await callRpc("santa_organizer_participants", {
        p_draw_id: drawId,
        p_organizer_secret: organizerSecret,
      }));
      const participants = participantResponse.participants;
      if (participants.length !== Number(state.participant_count)) {
        throw new Error("Le iscrizioni sono cambiate durante il sorteggio. Riprova.");
      }
      const mapping = createDerangement(participants.map((participant) => participant.id));
      const assignments = await Promise.all(participants.map(async (participant) => {
        const recipient = participants.find((entry) => entry.id === mapping[participant.id]);
        return {
          participant_id: participant.id,
          recipient_id: recipient.id,
          assignment_ciphertext: await encryptAssignment(participant.public_key, recipient.name),
        };
      }));
      await callRpc("santa_complete_draw", {
        p_draw_id: drawId,
        p_organizer_secret: organizerSecret,
        p_assignments: assignments,
      });
      message(statusMessage, "Sorteggio completato. Ogni partecipante può consultare il proprio abbinamento.");
    } catch (reason) {
      message(error, reason);
    } finally {
      busy = false;
      await refresh();
    }
  });

  document.querySelector("#reset-button").addEventListener("click", async () => {
    if (!window.confirm("Azzera il gruppo? Verranno cancellati i partecipanti e l'eventuale sorteggio.")) return;
    busy = true;
    error.hidden = true;
    statusMessage.hidden = true;
    try {
      await callRpc("santa_reset_draw", {
        p_draw_id: drawId,
        p_organizer_secret: organizerSecret,
      });
      message(statusMessage, "Gruppo azzerato. Le iscrizioni sono nuovamente aperte.");
    } catch (reason) {
      message(error, reason);
    } finally {
      busy = false;
      await refresh();
    }
  });

  copyButtons();
  refresh();
  startRefresh(refresh);
}

function render() {
  stopRefresh();
  const [kind, id, secret, extraSecret] = route();
  if (kind === "join" && id && secret) {
    renderJoin(id, secret);
  } else if (kind === "manage" && id && secret && extraSecret) {
    renderManager(id, secret, extraSecret);
  } else if (kind === "result" && id && secret) {
    renderResult(id, secret, extraSecret);
  } else {
    renderHome();
  }
}

window.addEventListener("hashchange", render);
render();
