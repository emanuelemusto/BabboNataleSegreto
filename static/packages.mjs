const ENCODING_PATTERN = /^[A-Za-z0-9_-]+$/;
const MAX_PARTICIPANTS = 500;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isEncodedValue(value) {
  return typeof value === "string" && value.length > 0 && ENCODING_PATTERN.test(value);
}

function isValidParticipant(value) {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    value.id.length > 0 &&
    typeof value.name === "string" &&
    value.name.trim().length > 0 &&
    value.name.length <= 80 &&
    isRecord(value.publicKey) &&
    value.publicKey.kty === "RSA" &&
    isEncodedValue(value.privateKeyCiphertext) &&
    isEncodedValue(value.privateKeyIv)
  );
}

export function createRegistrationPackage(groupId, title, participant) {
  return {
    format: "secret-santa-registration",
    version: 1,
    groupId,
    title,
    participant: {
      id: participant.id,
      name: participant.name,
      publicKey: participant.publicKey,
      privateKeyCiphertext: participant.privateKeyCiphertext,
      privateKeyIv: participant.privateKeyIv,
    },
  };
}

export function validateRegistrationPackage(value, expectedGroupId) {
  if (
    !isRecord(value) ||
    value.format !== "secret-santa-registration" ||
    value.version !== 1 ||
    value.groupId !== expectedGroupId ||
    typeof value.title !== "string" ||
    value.title.length > 80 ||
    !isValidParticipant(value.participant)
  ) {
    throw new Error("File d’iscrizione non valido o appartenente a un altro gruppo.");
  }
  return value;
}

export function createResultsPackage(groupId, title, assignments) {
  return {
    format: "secret-santa-results",
    version: 1,
    groupId,
    title,
    assignments: assignments.map((participant) => ({
      id: participant.id,
      name: participant.name,
      privateKeyCiphertext: participant.privateKeyCiphertext,
      privateKeyIv: participant.privateKeyIv,
      assignmentCiphertext: participant.assignmentCiphertext,
    })),
  };
}

export function validateResultsPackage(value, expectedGroupId = null) {
  if (
    !isRecord(value) ||
    value.format !== "secret-santa-results" ||
    value.version !== 1 ||
    typeof value.groupId !== "string" ||
    !value.groupId ||
    (expectedGroupId !== null && value.groupId !== expectedGroupId) ||
    typeof value.title !== "string" ||
    value.title.length > 80 ||
    !Array.isArray(value.assignments) ||
    value.assignments.length < 2 ||
    value.assignments.length > MAX_PARTICIPANTS
  ) {
    throw new Error("File dei risultati non valido.");
  }

  const participantIds = new Set();
  const normalizedNames = new Set();
  for (const assignment of value.assignments) {
    if (
      !isRecord(assignment) ||
      typeof assignment.id !== "string" ||
      !assignment.id ||
      typeof assignment.name !== "string" ||
      !assignment.name.trim() ||
      assignment.name.length > 80 ||
      !isEncodedValue(assignment.privateKeyCiphertext) ||
      !isEncodedValue(assignment.privateKeyIv) ||
      !isEncodedValue(assignment.assignmentCiphertext)
    ) {
      throw new Error("File dei risultati non valido.");
    }
    const normalizedName = assignment.name.trim().toLocaleLowerCase();
    if (participantIds.has(assignment.id) || normalizedNames.has(normalizedName)) {
      throw new Error("Il file contiene iscrizioni duplicate.");
    }
    participantIds.add(assignment.id);
    normalizedNames.add(normalizedName);
  }
  return value;
}
