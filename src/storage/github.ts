/**
 * Publishing the encrypted tree to the site's GitHub repository.
 *
 * The app commits `public/family-tree.ftree` through the GitHub REST API using a
 * fine-grained personal access token that the editor pastes in. The token is
 * kept in memory only and is sent to api.github.com and nowhere else. Only the
 * encrypted container is ever uploaded.
 *
 * Overwrites are guarded by git blob SHAs: an update names the SHA it replaces,
 * so GitHub refuses it if the file changed in the meantime.
 */
import { bytesToBase64, base64ToBytes } from '../crypto/base64';
import { HOSTED_TREE_FILE } from './hosted';

const API = 'https://api.github.com';
export const PUBLISH_PATH = `public/${HOSTED_TREE_FILE}`;
export const COMMIT_MESSAGE = 'Update encrypted family tree';

export interface GitHubTarget {
  owner: string;
  repo: string;
  branch: string;
  path: string;
}

/** Repository details baked in at build time by the deploy workflow (not secret). */
export function defaultTarget(): Partial<GitHubTarget> {
  const [owner, repo] = (import.meta.env.VITE_GITHUB_REPOSITORY ?? '').split('/');
  return {
    owner: owner || undefined,
    repo: repo || undefined,
    branch: import.meta.env.VITE_GITHUB_BRANCH || 'main',
    path: PUBLISH_PATH,
  };
}

/** Parses "owner/repo" (also accepts a github.com URL). */
export function parseRepository(input: string): { owner: string; repo: string } | undefined {
  const match = input
    .trim()
    .replace(/^https?:\/\/github\.com\//i, '')
    .replace(/\.git$/i, '')
    .replace(/\/+$/, '')
    .match(/^([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100})$/);
  return match ? { owner: match[1]!, repo: match[2]! } : undefined;
}

export type GitHubErrorCode = 'unauthorized' | 'forbidden' | 'not-found' | 'conflict' | 'too-large' | 'network' | 'unknown';

const MESSAGES: Record<GitHubErrorCode, string> = {
  unauthorized: 'GitHub rejected the token. Check that it was copied correctly and has not expired.',
  forbidden:
    'The token is not allowed to change this repository. It needs access to this repository with “Contents: Read and write” permission.',
  'not-found':
    'The repository or branch was not found. Check the repository name, and that the token has been given access to it.',
  conflict: 'The published tree changed while you were publishing. Nothing was overwritten; please try again.',
  'too-large': 'The tree is too large to publish through the GitHub API (over 100 MB).',
  network: 'Could not reach GitHub. Check your internet connection and try again.',
  unknown: 'GitHub could not complete the request. Please try again later.',
};

/** Errors never include the token or response bodies, only a fixed message. */
export class GitHubError extends Error {
  readonly code: GitHubErrorCode;
  constructor(code: GitHubErrorCode) {
    super(MESSAGES[code]);
    this.name = 'GitHubError';
    this.code = code;
  }
}

/** The "blob" SHA-1 git uses to identify file contents (not used for security). */
export async function gitBlobSha(text: string): Promise<string> {
  const body = new TextEncoder().encode(text);
  const header = new TextEncoder().encode(`blob ${body.length}\0`);
  const data = new Uint8Array(header.length + body.length);
  data.set(header);
  data.set(body, header.length);
  const digest = await crypto.subtle.digest('SHA-1', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function contentsUrl(target: GitHubTarget, withRef: boolean): string {
  const path = target.path.split('/').map(encodeURIComponent).join('/');
  const base = `${API}/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}/contents/${path}`;
  return withRef ? `${base}?ref=${encodeURIComponent(target.branch)}` : base;
}

async function request(url: string, token: string, init: RequestInit & { accept?: string } = {}): Promise<Response> {
  const { accept, ...rest } = init;
  try {
    return await fetch(url, {
      ...rest,
      cache: 'no-store',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      headers: {
        Accept: accept ?? 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(rest.body ? { 'Content-Type': 'application/json' } : {}),
      },
    });
  } catch {
    throw new GitHubError('network');
  }
}

function errorFor(status: number): GitHubError {
  if (status === 401) return new GitHubError('unauthorized');
  if (status === 403) return new GitHubError('forbidden');
  if (status === 404) return new GitHubError('not-found');
  if (status === 409 || status === 422) return new GitHubError('conflict');
  if (status === 413) return new GitHubError('too-large');
  return new GitHubError('unknown');
}

export interface PublishedFile {
  sha: string;
  text: string;
}

/** Reads the currently committed file, or undefined if it does not exist yet. */
export async function getPublishedFile(target: GitHubTarget, token: string): Promise<PublishedFile | undefined> {
  const response = await request(contentsUrl(target, true), token);
  if (response.status === 404) {
    // Distinguish "file not published yet" from "repository/branch not accessible".
    const repo = await request(
      `${API}/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}/branches/${encodeURIComponent(target.branch)}`,
      token,
    );
    if (repo.ok) return undefined;
    throw errorFor(repo.status);
  }
  if (!response.ok) throw errorFor(response.status);
  const meta = (await response.json()) as { sha?: unknown; content?: unknown; encoding?: unknown; type?: unknown };
  if (typeof meta.sha !== 'string' || meta.type !== 'file') throw new GitHubError('unknown');

  if (meta.encoding === 'base64' && typeof meta.content === 'string' && meta.content) {
    const bytes = base64ToBytes(meta.content.replace(/\s/g, ''));
    return { sha: meta.sha, text: new TextDecoder().decode(bytes) };
  }
  // Files over 1 MB are only available through the raw media type.
  const raw = await request(contentsUrl(target, true), token, { accept: 'application/vnd.github.raw+json' });
  if (!raw.ok) throw errorFor(raw.status);
  return { sha: meta.sha, text: await raw.text() };
}

/**
 * Commits the file. `replacesSha` must be the SHA of the current file (or
 * undefined when creating it); GitHub rejects the commit if it no longer matches.
 * Returns the SHA of the newly committed file.
 */
export async function publishFile(
  target: GitHubTarget,
  token: string,
  text: string,
  replacesSha: string | undefined,
): Promise<string> {
  const body: Record<string, string> = {
    message: COMMIT_MESSAGE,
    content: bytesToBase64(new TextEncoder().encode(text)),
    branch: target.branch,
  };
  if (replacesSha) body.sha = replacesSha;
  const response = await request(contentsUrl(target, false), token, { method: 'PUT', body: JSON.stringify(body) });
  if (!response.ok) throw errorFor(response.status);
  const result = (await response.json()) as { content?: { sha?: unknown } };
  if (typeof result.content?.sha !== 'string') throw new GitHubError('unknown');
  return result.content.sha;
}
