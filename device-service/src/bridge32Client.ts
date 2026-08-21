const BRIDGE32_URL = process.env.BRIDGE32_URL ?? "http://127.0.0.1:8091";

async function call(path: string, body?: unknown) {
  const res = await fetch(`${BRIDGE32_URL}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json()) as { ok?: boolean; error?: string; [key: string]: unknown };
  if (!res.ok || json.ok === false) {
    throw new Error(json.error ?? `bridge32 ${path} failed with ${res.status}`);
  }
  return json;
}

export const bridge32 = {
  health: () => call("/health"),
  acr120Version: () => call("/acr120/version"),
  ch375Version: () => call("/ch375/version"),
  selectCard: (slot = 0) => call("/acr120/select", { slot }),
  readBlock: (slot: number, block: number, keyType: "A" | "B", key: string) =>
    call("/acr120/read-block", { slot, block, keyType, key }),
  writeBlock: (slot: number, block: number, keyType: "A" | "B", key: string, data: string) =>
    call("/acr120/write-block", { slot, block, keyType, key, data }),
};
