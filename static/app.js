const $ = (selector) => document.querySelector(selector);
const inviteToken = location.pathname.startsWith("/g/") ? location.pathname.slice(3) : null;
const organizerToken = location.pathname.startsWith("/organizer/")
  ? location.pathname.slice("/organizer/".length)
  : null;

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error || "Si è verificato un errore.");
    error.status = response.status;
    throw error;
  }
  return data;
}

function showMessage(element, message) {
  element.textContent = message;
  element.hidden = false;
}

document.querySelectorAll("[data-copy]").forEach((button) => {
  button.addEventListener("click", async () => {
    const input = document.getElementById(button.dataset.copy);
    await navigator.clipboard.writeText(input.value);
    button.textContent = "Copiato!";
    window.setTimeout(() => { button.textContent = "Copia"; }, 1600);
  });
});

const createForm = $("#create-form");
if (createForm) {
  createForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const error = $("#create-error");
    error.hidden = true;
    try {
      const result = await requestJson("/api/draws", {
        method: "POST",
        body: JSON.stringify({ title: $("#title").value }),
      });
      $("#invite-link").value = result.invite_url;
      $("#organizer-link").value = result.organizer_url;
      $("#open-organizer").href = result.organizer_url;
      createForm.hidden = true;
      $("#created").hidden = false;
    } catch (reason) {
      showMessage(error, reason.message);
    }
  });
}

if (inviteToken) {
  const accessKey = `secret-santa:${inviteToken}`;
  const joinForm = $("#join-form");
  const error = $("#group-error");
  let polling = false;

  async function refreshParticipantState() {
    if (polling) return;
    polling = true;
    try {
      const state = await requestJson(`/api/groups/${encodeURIComponent(inviteToken)}/state`);
      $("#group-title").textContent = state.title;
      const savedToken = localStorage.getItem(accessKey);
      if (savedToken) {
        try {
          const participantState = await requestJson(
            `/api/groups/${encodeURIComponent(inviteToken)}/me`,
            { headers: { Authorization: `Bearer ${savedToken}` } },
          );
          if (participantState.status === "drawn") {
            $("#waiting").hidden = true;
            $("#join-form").hidden = true;
            $("#assignment").hidden = false;
            $("#recipient").textContent = participantState.recipient;
          } else {
            $("#join-form").hidden = true;
            $("#waiting").hidden = false;
            $("#group-description").hidden = true;
          }
          return;
        } catch (reason) {
          if (reason.status !== 401 && reason.status !== 410) throw reason;
          localStorage.removeItem(accessKey);
        }
      }

      if (state.status === "drawn" && localStorage.getItem(accessKey)) {
        const result = await requestJson(`/api/groups/${encodeURIComponent(inviteToken)}/me`, {
          headers: { Authorization: `Bearer ${localStorage.getItem(accessKey)}` },
        });
        $("#waiting").hidden = true;
        $("#join-form").hidden = true;
        $("#assignment").hidden = false;
        $("#recipient").textContent = result.recipient;
        return;
      }

      const token = localStorage.getItem(accessKey);
      if (token) {
        joinForm.hidden = true;
        $("#waiting").hidden = false;
        $("#group-description").hidden = true;
        $("#waiting-copy").textContent = state.status === "drawn"
          ? "Il sorteggio è pronto. Ricarica la pagina con il browser usato per iscriverti."
          : "Il tuo abbinamento apparirà qui quando il sorteggio sarà pronto. Puoi chiudere questa pagina e tornare più tardi dallo stesso browser.";
      } else if (state.status === "drawn") {
        joinForm.hidden = true;
        $("#group-description").textContent = "Le iscrizioni sono chiuse: non è più possibile unirsi a questo gruppo.";
      } else {
        joinForm.hidden = false;
      }
    } catch (reason) {
      showMessage(error, reason.message);
    } finally {
      polling = false;
    }
  }

  joinForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    $("#join-error").hidden = true;
    try {
      const result = await requestJson(`/api/groups/${encodeURIComponent(inviteToken)}/participants`, {
        method: "POST",
        body: JSON.stringify({ name: $("#name").value }),
      });
      localStorage.setItem(accessKey, result.access_token);
      await refreshParticipantState();
    } catch (reason) {
      showMessage($("#join-error"), reason.message);
    }
  });

  refreshParticipantState();
  window.setInterval(refreshParticipantState, 5000);
}

if (organizerToken) {
  const encodedToken = encodeURIComponent(organizerToken);
  const baseUrl = `/api/organizer/${encodedToken}`;
  $("#group-link").value = `${location.origin}/g/${inviteTokenFromOrganizerPage()}`;
  async function refreshOrganizerState() {
    try {
      const state = await requestJson(`${baseUrl}/state`);
      $("#organizer-title").textContent = state.title;
      $("#participant-count").textContent = state.participant_count;
      $("#draw-status").textContent = state.status === "drawn" ? "Sorteggio avviato" : "Iscrizioni aperte";
      $("#draw-button").disabled = state.status === "drawn" || state.participant_count < 2;
      $("#reset-button").disabled = state.participant_count === 0 && state.status === "open";
    } catch (reason) {
      showMessage($("#organizer-error"), reason.message);
    }
  }

  $("#draw-button").addEventListener("click", async () => {
    $("#organizer-error").hidden = true;
    try {
      await requestJson(`${baseUrl}/draw`, { method: "POST", body: "{}" });
      showMessage($("#organizer-message"), "Sorteggio avviato. Gli abbinamenti sono visibili solo ai partecipanti.");
      await refreshOrganizerState();
    } catch (reason) {
      showMessage($("#organizer-error"), reason.message);
    }
  });

  $("#reset-button").addEventListener("click", async () => {
    if (!window.confirm("Azzerare il gruppo? Tutti gli iscritti e gli abbinamenti verranno cancellati.")) return;
    $("#organizer-error").hidden = true;
    try {
      await requestJson(`${baseUrl}/reset`, { method: "POST", body: "{}" });
      showMessage($("#organizer-message"), "Gruppo azzerato. Le iscrizioni sono di nuovo aperte.");
      await refreshOrganizerState();
    } catch (reason) {
      showMessage($("#organizer-error"), reason.message);
    }
  });

  refreshOrganizerState();
  window.setInterval(refreshOrganizerState, 5000);
}

function inviteTokenFromOrganizerPage() {
  return new URLSearchParams(location.search).get("invite") || "";
}
