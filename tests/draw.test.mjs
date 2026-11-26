import assert from "node:assert/strict";
import test from "node:test";
import { webcrypto } from "node:crypto";
import { createDerangement } from "../static/draw.mjs";
import {
  createParticipantCredentials,
  decryptAssignment,
  encryptAssignment,
} from "../static/crypto.mjs";
import {
  createRegistrationPackage,
  createResultsPackage,
  validateRegistrationPackage,
  validateResultsPackage,
} from "../static/packages.mjs";

test("creates a complete derangement without self-assignments", () => {
  for (const participantIds of [
    ["a", "b"],
    ["a", "b", "c"],
    Array.from({ length: 30 }, (_, index) => `participant-${index}`),
  ]) {
    const result = createDerangement(participantIds, webcrypto);
    assert.deepEqual(Object.keys(result).sort(), [...participantIds].sort());
    assert.deepEqual(Object.values(result).sort(), [...participantIds].sort());
    for (const id of participantIds) assert.notEqual(result[id], id);
  }
});

test("rejects impossible or ambiguous participant lists", () => {
  assert.throws(() => createDerangement([]), RangeError);
  assert.throws(() => createDerangement(["one"]), RangeError);
  assert.throws(() => createDerangement(["same", "same"]), TypeError);
});

test("only the matching participant code decrypts a private assignment", async () => {
  const participant = await createParticipantCredentials();
  participant.assignmentCiphertext = await encryptAssignment(
    participant.publicKey,
    "Il destinatario segreto",
  );
  assert.equal(
    await decryptAssignment(participant, participant.accessCode),
    "Il destinatario segreto",
  );
  await assert.rejects(() => decryptAssignment(participant, "codice-sbagliato"));
});

test("registration files exclude the personal code and are tied to their group", async () => {
  const credentials = await createParticipantCredentials();
  const registration = createRegistrationPackage("round-1", "Natale", {
    id: "ada-id",
    name: "Ada",
    publicKey: credentials.publicKey,
    privateKeyCiphertext: credentials.privateKeyCiphertext,
    privateKeyIv: credentials.privateKeyIv,
  });
  const serialized = JSON.stringify(registration);
  assert.equal(serialized.includes(credentials.accessCode), false);
  assert.equal(validateRegistrationPackage(registration, "round-1").participant.name, "Ada");
  assert.throws(() => validateRegistrationPackage(registration, "round-2"));
});

test("a shared results JSON reveals an assignment only with its owner's code", async () => {
  const names = ["Ada", "Bruno", "Cleo"];
  const participants = await Promise.all(names.map(async (name, index) => ({
    id: `participant-${index}`,
    name,
    ...(await createParticipantCredentials()),
  })));
  const assignments = createDerangement(participants.map(({ id }) => id), webcrypto);
  const drawEntries = await Promise.all(participants.map(async (participant) => ({
    id: participant.id,
    name: participant.name,
    privateKeyCiphertext: participant.privateKeyCiphertext,
    privateKeyIv: participant.privateKeyIv,
    assignmentCiphertext: await encryptAssignment(
      participant.publicKey,
      participants.find(({ id }) => id === assignments[participant.id]).name,
    ),
  })));
  const results = validateResultsPackage(
    createResultsPackage("round-1", "Natale", drawEntries),
    "round-1",
  );

  for (const participant of participants) {
    const encryptedResult = results.assignments.find(({ id }) => id === participant.id);
    const recipient = await decryptAssignment(encryptedResult, participant.accessCode);
    assert.notEqual(recipient, participant.name);
    await assert.rejects(() => decryptAssignment(encryptedResult, randomInvalidCode()));
  }
  assert.throws(() => validateResultsPackage(results, "another-round"));
});

function randomInvalidCode() {
  return "codice-errato-non-corrispondente";
}
