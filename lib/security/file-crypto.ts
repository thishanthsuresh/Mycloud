const PBKDF2_ITERATIONS = 310_000;
const PIN_DIGITS = 4;

function toBase64(bytes: Uint8Array<ArrayBufferLike>) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): ArrayBuffer {
  const decoded = atob(value);
  const bytes = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index++) bytes[index] = decoded.charCodeAt(index);
  return bytes.buffer;
}

async function deriveKey(pin: string, salt: ArrayBuffer) {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export function validatePin(pin: string, digits?: number) {
  const validDigits = digits === undefined ? [4, 8] : [digits];
  if (!validDigits.some((length) => new RegExp(`^\\d{${length}}$`).test(pin))) {
    throw new Error(`PIN must be exactly ${validDigits.join(" or ")} digits.`);
  }
}

export function generatePin() {
  const maximum = 0x1_0000_0000;
  const cutoff = Math.floor(maximum / 10_000) * 10_000;
  const random = new Uint32Array(1);
  do {
    crypto.getRandomValues(random);
  } while (random[0] >= cutoff);
  return String(random[0] % 10_000).padStart(PIN_DIGITS, "0");
}

export async function encryptFile(bytes: ArrayBuffer, pin: string) {
  validatePin(pin, PIN_DIGITS);
  const salt = crypto.getRandomValues(new Uint8Array(16)).buffer;
  const iv = crypto.getRandomValues(new Uint8Array(12)).buffer;
  const key = await deriveKey(pin, salt);
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, bytes);
  return { encrypted, salt: toBase64(new Uint8Array(salt)), iv: toBase64(new Uint8Array(iv)) };
}

export async function decryptFile(bytes: ArrayBuffer, pin: string, salt: string, iv: string, pinDigits?: number) {
  validatePin(pin, pinDigits);
  const key = await deriveKey(pin, fromBase64(salt));
  return crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(iv) }, key, bytes);
}
