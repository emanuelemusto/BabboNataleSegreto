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
      <div class="hero-ornament" aria-hidden="true"><span>✳</span></div>
      <p class="eyebrow">BABBO NATALE SEGRETO, TRA AMICI</p>
      <h1>Un regalo<br>per un amico.<br><span>E resta segreto.</span></h1>
      <p class="hero-copy">Organizza il sorteggio con i tuoi amici. Ognuno scoprirà chi gli è capitato; chi organizza non vedrà gli abbinamenti.</p>
      <form id="create-form" class="create-form">
        <label for="title">Come si chiama il vostro gruppo?</label>
        <div class="create-row"><input id="title" maxlength="80" placeholder="es. Amici del liceo" autocomplete="off" required><button class="button button-primary" type="submit">Crea il gruppo <span aria-hidden="true">→</span></button></div>
        <p id="create-error" class="message error" role="alert" hidden></p>
      </form>
    </section>
    <section class="how-grid" aria-label="Come funziona">
      <article class="how-card"><span class="step-number">01</span><h2>Crea il gruppo</h2><p>Prepara l’invito e tieni per te il link per organizzare.</p></article>
      <article class="how-card"><span class="step-number">02</span><h2>Invita gli amici</h2><p>Ognuno si aggiunge dal proprio telefono, con il suo nome.</p></article>
      <article class="how-card"><span class="step-number">03</span><h2>Fate il sorteggio</h2><p>Ognuno scopre in privato chi gli è capitato.</p></article>
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
      <p class="hero-copy">Manda il link d’invito nella chat del gruppo. Tieni per te il link organizzatore.</p>
      <label for="invite-link">LINK DA MANDARE AGLI AMICI</label>
      <div class="copy-row"><input id="invite-link" readonly><button class="button button-secondary" data-copy="invite-link">Copia</button></div>
      <label for="organizer-link">IL TUO LINK PER ORGANIZZARE · PRIVATO</label>
      <div class="copy-row"><input id="organizer-link" readonly><button class="button button-secondary" data-copy="organizer-link">Copia</button></div>
      <p id="copy-error" class="message error" role="alert" hidden></p>
      <a class="button button-primary button-wide" href="${organizerUrl}">Gestisci il gruppo <span aria-hidden="true">→</span></a>
      <p class="tiny-note">Con questo link puoi gestire il gruppo. Non mandarlo nella chat degli amici.</p>
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
      <div class="card-ornament" aria-hidden="true">✳</div>
      <p class="eyebrow">INVITO AL SORTEGGIO</p>
      <h1 id="group-title">Caricamento…</h1>
      <p class="hero-copy">Aggiungi il tuo nome alla lista. Quando il sorteggio è pronto, torna qui per scoprire chi ti è capitato.</p>
      <div id="joined-panel" class="joined-panel" hidden>
        <span class="joined-mark" aria-hidden="true">✓</span>
        <div><h2>Ci sei!</h2><p>Salva il tuo codice personale: ti servirà per vedere chi ti è capitato.</p>
          <div class="copy-row"><input id="personal-code" readonly><button class="button button-secondary" data-copy="personal-code">Copia codice</button></div>
          <a id="my-result-link" class="button button-primary button-wide" href="#">Vai al tuo sorteggio <span aria-hidden="true">→</span></a>
          <p id="copy-error" class="message error" role="alert" hidden></p>
          <p class="tiny-note">È un codice personale: tienilo per te, anche l’organizzatore non può recuperarlo.</p>
        </div>
      </div>
      <form id="join-form" class="stack-form">
        <label for="name">Il tuo nome</label>
        <input id="name" maxlength="80" autocomplete="name" placeholder="Nome e cognome" required>
        <button class="button button-primary button-wide" type="submit">Aggiungimi al gruppo <span aria-hidden="true">→</span></button>
        <p id="join-error" class="message error" role="alert" hidden></p>
      </form>
      <p id="group-state" class="state-line"></p>
    </section>`;

  const title = document.querySelector("#group-title");
  const state = document.querySelector("#group-state");
  const form = document.querySelector("#join-form");
  async function refresh() {
    try {
      const current = firstRow(await callRpc("santa_group_info", {
        p_draw_id: drawId,
        p_invite_secret: inviteSecret,
      }));
      title.textContent = current.draw_title;
      state.textContent = current.draw_status === "open"
        ? `${current.participant_count} ${Number(current.participant_count) === 1 ? "persona nel gruppo" : "persone nel gruppo"} · ci si può ancora aggiungere`
        : "Il sorteggio è fatto: non ci si può più iscrivere.";
      form.hidden = current.draw_status !== "open" || !document.querySelector("#joined-panel").hidden;
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
      document.querySelector("#group-title").textContent = result.draw_title;
      document.querySelector("#personal-code").value = credentials.accessCode;
      document.querySelector("#my-result-link").href = routeUrl("result", drawId, result.participant_id);
      document.querySelector("#joined-panel").hidden = false;
      form.hidden = true;
      copyButtons();
      await refresh();
    } catch (reason) {
      message(error, reason);
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
      <div class="card-ornament" aria-hidden="true">↗</div>
      <p class="eyebrow">LINK NON VALIDO</p>
      <h1>Questo gruppo<br><span>non è disponibile.</span></h1>
      <p class="hero-copy">Controlla il link oppure chiedi all’organizzatore di inviartelo di nuovo.</p>
      <a class="button button-primary button-wide" href="${pageUrl}">Torna alla pagina iniziale <span aria-hidden="true">→</span></a>
    </section>`;
}

function renderResult(drawId, participantId) {
  stopRefresh();
  app.innerHTML = `
    <section class="result-card result-reveal">
      <div class="card-ornament" aria-hidden="true">✳</div>
      <p class="eyebrow">AREA PERSONALE</p>
      <h1 id="result-title">Il tuo<br><span>abbinamento.</span></h1>
      <p class="hero-copy">Inserisci il codice personale che hai salvato quando ti sei iscritto. Solo tu puoi vedere il risultato.</p>
      <form id="result-form" class="stack-form">
        <label for="access-code">Codice personale</label>
        <input id="access-code" autocomplete="off" spellcheck="false" placeholder="Incolla il tuo codice" required>
        <button class="button button-primary button-wide" type="submit">Scopri chi ti è capitato <span aria-hidden="true">→</span></button>
        <p id="result-error" class="message error" role="alert" hidden></p>
      </form>
      <div id="assignment" class="assignment" hidden>
        <span class="eyebrow">A TE È CAPITATO</span>
        <p id="recipient" class="recipient"></p>
        <p class="tiny-note">Ora non dirlo agli altri fino allo scambio dei regali.</p>
      </div>
    </section>`;
  document.querySelector("#result-form").addEventListener("submit", async (event) => {
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
      document.querySelector("#result-title").textContent = result.draw_title;
      document.querySelector("#recipient").textContent = recipient;
      document.querySelector("#assignment").hidden = false;
      event.currentTarget.hidden = true;
    } catch (reason) {
      message(error, reason);
    } finally {
      button.disabled = false;
    }
  });
}

function renderManager(drawId, organizerSecret, inviteSecret) {
  stopRefresh();
  if (!drawId || !organizerSecret) return renderNotFound();
  app.innerHTML = `
    <section class="result-card organizer-card">
      <div class="eyebrow-row"><span class="eyebrow">PANNELLO ORGANIZZATORE</span><span class="admin-badge">ACCESSO PRIVATO</span></div>
      <h1 id="manager-title">Un attimo…</h1>
      <p class="hero-copy">Manda l’invito nella chat e aspetta che si aggiungano tutti. Quando siete pronti, avvia il sorteggio: non vedrai chi è capitato a ciascuno.</p>
      <div class="manager-stats"><div><span>AMICI NEL GRUPPO</span><strong id="participant-count">—</strong></div><span id="draw-status" class="status-pill">Caricamento…</span></div>
      <div id="participants" class="participant-list"></div>
      <div class="actions">
        <button id="draw-button" class="button button-primary button-wide" type="button">Fai il sorteggio <span aria-hidden="true">→</span></button>
        <button id="reset-button" class="button button-secondary button-wide" type="button">Svuota il gruppo</button>
      </div>
      <p id="manager-message" class="message success-message" role="status" hidden></p>
      <p id="manager-error" class="message error" role="alert" hidden></p>
      <div class="share-box">
        <label for="invite-link">INVITO DA GIRARE NELLA CHAT</label>
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
      document.querySelector("#draw-status").textContent = state.draw_status === "drawn" ? "Sorteggio fatto" : "Ci si può iscrivere";
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
        const joined = document.createElement("span");
        joined.className = "participant-check";
        joined.textContent = "CI SONO";
        row.append(name, joined);
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
        throw new Error("Servono almeno due amici e le iscrizioni devono essere aperte.");
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
      message(statusMessage, "Fatto! Ognuno può aprire il proprio link e vedere chi gli è capitato.");
    } catch (reason) {
      message(error, reason);
    } finally {
      busy = false;
      await refresh();
    }
  });

  document.querySelector("#reset-button").addEventListener("click", async () => {
    if (!window.confirm("Svuotare il gruppo? Verranno cancellati i nomi e, se già fatto, anche il sorteggio.")) return;
    busy = true;
    error.hidden = true;
    statusMessage.hidden = true;
    try {
      await callRpc("santa_reset_draw", {
        p_draw_id: drawId,
        p_organizer_secret: organizerSecret,
      });
      message(statusMessage, "Gruppo svuotato. Gli amici possono iscriversi di nuovo.");
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
    renderResult(id, secret);
  } else {
    renderHome();
  }
}

window.addEventListener("hashchange", render);
render();
