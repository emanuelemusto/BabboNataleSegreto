import assert from "node:assert/strict";
import test from "node:test";
import { webcrypto } from "node:crypto";
import { createDerangement } from "../static/draw.mjs";
import {
  createParticipantCredentials,
  decryptAssignment,
  encryptAssignment,
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
