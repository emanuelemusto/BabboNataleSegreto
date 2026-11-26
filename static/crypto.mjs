const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64 + "=".repeat((4 - base64.length % 4) % 4));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function randomBytes(length) {
  return crypto.getRandomValues(new Uint8Array(length));
}

export function randomSecret() {
  return toBase64Url(randomBytes(32));
}

export async function hashSecret(secret, encoding = "base64url") {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(secret));
  const bytes = new Uint8Array(digest);
  if (encoding === "hex") {
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  if (encoding !== "base64url") throw new TypeError("Hash encoding not supported.");
  return toBase64Url(bytes);
}

export async function createParticipantCredentials() {
  const accessCode = toBase64Url(randomBytes(16));
  const keyPair = await crypto.subtle.generateKey(
    {
      name: "RSA-OAEP",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["encrypt", "decrypt"],
  );
  const publicKey = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  const privateKey = await crypto.subtle.exportKey("jwk", keyPair.privateKey);
  const wrappingKey = await crypto.subtle.importKey(
    "raw",
    fromBase64Url(accessCode),
    "AES-GCM",
    false,
    ["encrypt"],
  );
  const privateKeyIv = randomBytes(12);
  const privateKeyCiphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: privateKeyIv },
    wrappingKey,
    encoder.encode(JSON.stringify(privateKey)),
  );
  return {
    accessCode,
    publicKey,
    privateKeyCiphertext: toBase64Url(new Uint8Array(privateKeyCiphertext)),
    privateKeyIv: toBase64Url(privateKeyIv),
  };
}

export async function encryptAssignment(publicKeyJwk, recipientName) {
  const publicKey = await crypto.subtle.importKey(
    "jwk",
    publicKeyJwk,
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["encrypt"],
  );
  const contentKeyBytes = randomBytes(32);
  const contentKey = await crypto.subtle.importKey(
    "raw",
    contentKeyBytes,
    "AES-GCM",
    false,
    ["encrypt"],
  );
  const iv = randomBytes(12);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    contentKey,
    encoder.encode(recipientName),
  );
  const wrappedKey = await crypto.subtle.encrypt(
    { name: "RSA-OAEP" },
    publicKey,
    contentKeyBytes,
  );
  return toBase64Url(encoder.encode(JSON.stringify({
    version: 1,
    key: toBase64Url(new Uint8Array(wrappedKey)),
    iv: toBase64Url(iv),
    ciphertext: toBase64Url(new Uint8Array(ciphertext)),
  })));
}

export async function decryptAssignment(participant, accessCode) {
  const wrappingKey = await crypto.subtle.importKey(
    "raw",
    fromBase64Url(accessCode),
    "AES-GCM",
    false,
    ["decrypt"],
  );
  const privateKeyJson = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64Url(participant.privateKeyIv) },
    wrappingKey,
    fromBase64Url(participant.privateKeyCiphertext),
  );
  const privateKey = await crypto.subtle.importKey(
    "jwk",
    JSON.parse(decoder.decode(privateKeyJson)),
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["decrypt"],
  );
  const envelope = JSON.parse(decoder.decode(fromBase64Url(participant.assignmentCiphertext)));
  if (
    envelope.version !== 1 ||
    typeof envelope.key !== "string" ||
    typeof envelope.iv !== "string" ||
    typeof envelope.ciphertext !== "string"
  ) {
    throw new Error("Il risultato cifrato non è valido.");
  }
  const contentKeyBytes = await crypto.subtle.decrypt(
    { name: "RSA-OAEP" },
    privateKey,
    fromBase64Url(envelope.key),
  );
  const contentKey = await crypto.subtle.importKey(
    "raw",
    contentKeyBytes,
    "AES-GCM",
    false,
    ["decrypt"],
  );
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64Url(envelope.iv) },
    contentKey,
    fromBase64Url(envelope.ciphertext),
  );
  return decoder.decode(plaintext);
}
