/**
 * An optional encrypted tree published alongside the site (public/family-tree.ftree).
 * Only encrypted containers are accepted; a plaintext file at this path is ignored.
 */
import { looksLikeContainer } from '../crypto/container';

export const HOSTED_TREE_FILE = 'family-tree.ftree';

export async function fetchHostedTree(): Promise<string | undefined> {
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}${HOSTED_TREE_FILE}`, {
      cache: 'no-cache',
      credentials: 'same-origin',
      referrerPolicy: 'no-referrer',
    });
    if (!response.ok) return undefined;
    const text = await response.text();
    return looksLikeContainer(JSON.parse(text)) ? text : undefined;
  } catch {
    return undefined;
  }
}
