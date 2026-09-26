/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "owner/repo" of the repository the site is deployed from (set by the deploy workflow). */
  readonly VITE_GITHUB_REPOSITORY?: string;
  /** Branch that publishing commits to (set by the deploy workflow). */
  readonly VITE_GITHUB_BRANCH?: string;
}
