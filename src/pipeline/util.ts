export class HttpError extends Error {
  constructor(public status: number, message: string, public headers?: Headers) {
    super(message);
  }
}

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    let detail = '';
    try {
      detail = ((await res.json()) as any)?.message ?? '';
    } catch {}
    throw new HttpError(res.status, detail || `${res.status} ${res.statusText}`, res.headers);
  }
  return (await res.json()) as T;
}

/** Run `fn` over `items` with at most `limit` in flight. Failures resolve to undefined. */
export async function pool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, i: number) => Promise<R>,
  onEach?: (done: number) => void,
): Promise<(R | undefined)[]> {
  const out: (R | undefined)[] = new Array(items.length);
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      try {
        out[i] = await fn(items[i], i);
      } catch {
        out[i] = undefined;
      }
      onEach?.(++done);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export const chunk = <T>(arr: T[], n: number): T[][] =>
  Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

export const isBot = (login: string) =>
  /\[bot\]$|bot$|^bot-|^dependabot|^renovate|^greenkeeper|^github-actions|^snyk-|^imgbot|^allcontributors/i.test(login);
