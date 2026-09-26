/** A small in-memory fake of the GitHub contents API, for tests. */
import { vi } from 'vitest';
import { base64ToBytes, bytesToBase64 } from '../crypto/base64';
import { gitBlobSha } from '../storage/github';

export interface FakeGitHub {
  files: Map<string, string>;
  requests: { method: string; url: string; headers: Record<string, string>; body?: any }[];
  /** Status to return for every request, simulating an error (e.g. 401). */
  failWith?: number;
}

export function installFakeGitHub(owner = 'someone', repo = 'family-tree', branch = 'main'): FakeGitHub {
  const fake: FakeGitHub = { files: new Map(), requests: [] };
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
  const repoBase = `https://api.github.com/repos/${owner}/${repo}`;

  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const headers = init?.headers as Record<string, string>;
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    fake.requests.push({ method, url, headers, body });
    // The deployed website serves whatever was last committed.
    if (!url.startsWith('https://') && url.endsWith('family-tree.ftree')) {
      const text = fake.files.get('public/family-tree.ftree');
      return text === undefined ? new Response('', { status: 404 }) : new Response(text, { status: 200 });
    }
    if (!url.startsWith(repoBase)) return json(404, { message: 'Not Found' });
    if (fake.failWith) return json(fake.failWith, { message: 'error' });

    if (url === `${repoBase}/branches/${branch}`) return json(200, { name: branch });
    const match = url.slice(repoBase.length).match(/^\/contents\/([^?]+)(\?ref=(.+))?$/);
    if (!match) return json(404, { message: 'Not Found' });
    const path = decodeURIComponent(match[1]!);

    if (method === 'GET') {
      const text = fake.files.get(path);
      if (text === undefined) return json(404, { message: 'Not Found' });
      if (headers.Accept === 'application/vnd.github.raw+json') return new Response(text, { status: 200 });
      const large = text.length > 1_000_000;
      return json(200, {
        type: 'file',
        sha: await gitBlobSha(text),
        encoding: large ? 'none' : 'base64',
        content: large ? '' : bytesToBase64(new TextEncoder().encode(text)),
      });
    }
    if (method === 'PUT') {
      const current = fake.files.get(path);
      const currentSha = current === undefined ? undefined : await gitBlobSha(current);
      if (body.sha !== currentSha) return json(409, { message: 'sha mismatch' });
      const text = new TextDecoder().decode(base64ToBytes(body.content));
      fake.files.set(path, text);
      return json(current === undefined ? 201 : 200, { content: { sha: await gitBlobSha(text) } });
    }
    return json(405, {});
  });
  return fake;
}
