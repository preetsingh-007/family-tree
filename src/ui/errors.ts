import { CryptoError } from '../crypto/container';
import { GitHubError } from '../storage/github';
import { InvalidTreeError } from '../storage/treeFile';

export interface UserFacingError {
  message: string;
  details?: string[];
}

/**
 * Converts any error into a message suitable for the user. Unknown errors get a
 * generic message; their raw text is never shown, since it could contain data.
 */
export function describeError(error: unknown, fallback = 'Something went wrong. Please try again.'): UserFacingError {
  if (error instanceof CryptoError || error instanceof GitHubError) return { message: error.message };
  if (error instanceof InvalidTreeError) return { message: error.message, details: error.details };
  if (error instanceof DOMException && error.name === 'QuotaExceededError') {
    return { message: 'Your device is out of storage space for this operation.' };
  }
  if (error instanceof DOMException && error.name === 'NotAllowedError') {
    return { message: 'The browser did not allow access to the file. Please try again.' };
  }
  return { message: fallback };
}
