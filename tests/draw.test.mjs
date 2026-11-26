import assert from "node:assert/strict";
import test from "node:test";
import { webcrypto } from "node:crypto";
import { createDerangement } from "../static/draw.mjs";
import {
  createParticipantCredentials,
  decryptAssignment,
  encryptAssignment,
  hashSecret,
} from "../static/crypto.mjs";

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

test("hashSecret produces the same SHA-256 digest used by the database", async () => {
  assert.equal(
    await hashSecret("abc", "hex"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
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

test("hybrid encryption supports long names and rejects another participant's code", async () => {
  const participant = await createParticipantCredentials();
  const recipientName = "🎄".repeat(80);
  participant.assignmentCiphertext = await encryptAssignment(participant.publicKey, recipientName);
  assert.equal(await decryptAssignment(participant, participant.accessCode), recipientName);
  await assert.rejects(() => decryptAssignment(participant, "codice-sbagliato"));
});
