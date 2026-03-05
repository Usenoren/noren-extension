/**
 * Chrome Native Messaging bridge to the Noren Keychain host.
 * Falls back gracefully when the desktop app isn't installed.
 */

const HOST_NAME = "ink.noren.keychain";

interface KeychainResponse {
  ok: boolean;
  key?: string | null;
  has_key?: boolean;
  error?: string;
}

function send(message: Record<string, string>): Promise<KeychainResponse> {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendNativeMessage(HOST_NAME, message, (response) => {
        if (chrome.runtime.lastError || !response) {
          resolve({ ok: false, error: chrome.runtime.lastError?.message || "no response" });
        } else {
          resolve(response as KeychainResponse);
        }
      });
    } catch {
      resolve({ ok: false, error: "native messaging unavailable" });
    }
  });
}

let _available: boolean | null = null;

export async function isKeychainAvailable(): Promise<boolean> {
  if (_available !== null) return _available;
  const res = await send({ action: "ping" });
  _available = res.ok;
  return _available;
}

export async function keychainGet(provider: string): Promise<string | null> {
  if (!(await isKeychainAvailable())) return null;
  const res = await send({ action: "get", provider });
  return res.ok ? (res.key ?? null) : null;
}

export async function keychainStore(provider: string, key: string): Promise<boolean> {
  if (!(await isKeychainAvailable())) return false;
  const res = await send({ action: "store", provider, key });
  return res.ok;
}

export async function keychainDelete(provider: string): Promise<boolean> {
  if (!(await isKeychainAvailable())) return false;
  const res = await send({ action: "delete", provider });
  return res.ok;
}

export async function keychainHas(provider: string): Promise<boolean | null> {
  if (!(await isKeychainAvailable())) return null;
  const res = await send({ action: "has", provider });
  return res.ok ? (res.has_key ?? false) : null;
}
