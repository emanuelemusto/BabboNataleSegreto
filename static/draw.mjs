function randomIndex(max, cryptoApi) {
  if (!Number.isSafeInteger(max) || max < 1 || max > 0x100000000) {
    throw new RangeError("Invalid random index range.");
  }
  const range = 0x100000000;
  const limit = Math.floor(range / max) * max;
  const value = new Uint32Array(1);
  do {
    cryptoApi.getRandomValues(value);
  } while (value[0] >= limit);
  return value[0] % max;
}

export function createDerangement(participantIds, cryptoApi = globalThis.crypto) {
  if (!Array.isArray(participantIds) || participantIds.length < 2) {
    throw new RangeError("At least two participants are required.");
  }
  if (new Set(participantIds).size !== participantIds.length) {
    throw new TypeError("Participant IDs must be unique.");
  }
  if (!cryptoApi || typeof cryptoApi.getRandomValues !== "function") {
    throw new Error("Secure random numbers are not available in this browser.");
  }

  const recipients = participantIds.slice();
  do {
    for (let index = recipients.length - 1; index > 0; index -= 1) {
      const other = randomIndex(index + 1, cryptoApi);
      [recipients[index], recipients[other]] = [recipients[other], recipients[index]];
    }
  } while (recipients.some((recipient, index) => recipient === participantIds[index]));

  return Object.fromEntries(participantIds.map((giver, index) => [giver, recipients[index]]));
}
