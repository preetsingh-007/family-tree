import { afterEach, describe, expect, it, vi } from 'vitest';
import { installFakeGitHub } from '../test/githubMock';
import { getPublishedFile, gitBlobSha, GitHubError, parseRepository, publishFile, PUBLISH_PATH, type GitHubTarget } from './github';

const target: GitHubTarget = { owner: 'someone', repo: 'family-tree', branch: 'main', path: PUBLISH_PATH };
const TOKEN = 'github_pat_TEST_TOKEN_VALUE';

afterEach(() => vi.restoreAllMocks());

describe('git blob SHA', () => {
  it('matches git hash-object', async () => {
    expect(await gitBlobSha('')).toBe('e69de29bb2d1d6434b8b29ae775ad8c2e48c5391');
    expect(await gitBlobSha('hello\n')).toBe('ce013625030ba8dba906f756967f9e9ca394464a');
  });
});

describe('repository names', () => {
  it('accepts owner/repo and GitHub URLs', () => {
    expect(parseRepository(' someone/family-tree ')).toEqual({ owner: 'someone', repo: 'family-tree' });
    expect(parseRepository('https://github.com/someone/family-tree.git')).toEqual({ owner: 'someone', repo: 'family-tree' });
    expect(parseRepository('family-tree')).toBeUndefined();
    expect(parseRepository('a/b/c')).toBeUndefined();
    expect(parseRepository('someone/../x?')).toBeUndefined();
  });
});

describe('GitHub publishing', () => {
  it('creates, reads and updates the file with SHA-guarded commits', async () => {
    const fake = installFakeGitHub();
    expect(await getPublishedFile(target, TOKEN)).toBeUndefined();

    const sha1 = await publishFile(target, TOKEN, '{"v":1}', undefined);
    expect(fake.files.get(PUBLISH_PATH)).toBe('{"v":1}');
    expect(await getPublishedFile(target, TOKEN)).toEqual({ sha: sha1, text: '{"v":1}' });

    // Updating with a stale SHA is refused and nothing is overwritten.
    await expect(publishFile(target, TOKEN, '{"v":2}', 'stale')).rejects.toMatchObject({ code: 'conflict' });
    await expect(publishFile(target, TOKEN, '{"v":2}', undefined)).rejects.toMatchObject({ code: 'conflict' });
    expect(fake.files.get(PUBLISH_PATH)).toBe('{"v":1}');

    await publishFile(target, TOKEN, '{"v":2}', sha1);
    expect(fake.files.get(PUBLISH_PATH)).toBe('{"v":2}');

    const put = fake.requests.find((r) => r.method === 'PUT')!;
    expect(put.url).toBe('https://api.github.com/repos/someone/family-tree/contents/public/family-tree.ftree');
    expect(put.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(put.body).toMatchObject({ message: 'Update encrypted family tree', branch: 'main' });
    // Only GitHub's API is ever contacted.
    expect(fake.requests.every((r) => r.url.startsWith('https://api.github.com/'))).toBe(true);
  });

  it('reads large files through the raw media type', async () => {
    const fake = installFakeGitHub();
    const big = 'x'.repeat(1_500_000);
    fake.files.set(PUBLISH_PATH, big);
    expect((await getPublishedFile(target, TOKEN))?.text).toBe(big);
  });

  it('reports inaccessible repositories and bad tokens without revealing the token', async () => {
    const fake = installFakeGitHub();
    await expect(getPublishedFile({ ...target, repo: 'other' }, TOKEN)).rejects.toMatchObject({ code: 'not-found' });
    for (const [status, code] of [
      [401, 'unauthorized'],
      [403, 'forbidden'],
      [500, 'unknown'],
    ] as const) {
      fake.failWith = status;
      const error = (await publishFile(target, TOKEN, '{}', undefined).catch((e: unknown) => e)) as GitHubError;
      expect(error).toBeInstanceOf(GitHubError);
      expect(error.code).toBe(code);
      expect(error.message).not.toContain(TOKEN);
    }
  });

  it('reports network failures', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(getPublishedFile(target, TOKEN)).rejects.toMatchObject({ code: 'network' });
  });
});
