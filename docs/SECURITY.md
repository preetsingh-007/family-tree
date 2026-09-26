# Security model and review

This document describes what the application protects, how it does so, and the
results of the security review done before release. For the user-facing summary,
see the "How your data is protected" dialog in the app and the README.

## Threat model

We assume an attacker may have all of the following:

- the complete repository and its history
- the deployed website, including every JS, CSS, and HTML file
- any encrypted `.ftree` file, whether published on the site, taken from a backup,
  or copied from a device
- all encryption metadata (algorithm names, iteration count, salt, IV) and every
  file name

With all of that, the attacker still cannot recover family information without
the passphrase, as long as AES-GCM, PBKDF2, and the passphrase itself hold.
Nothing depends on minification, obscurity, hidden URLs, or the repository being
private.

The four security domains are separate:

| Domain | Protected by | Not protected against |
| ------ | ------------ | --------------------- |
| **Encrypted data** (files, published tree, IndexedDB draft) | AES-256-GCM with an authenticated header; PBKDF2-SHA-256 (600k iterations); random salt and IV | Guessing weak passphrases offline |
| **Application delivery** (GitHub repository, Pages, CDN) | HTTPS, CSP, and your GitHub account security | Anyone who can change the deployed code. They can capture passphrases on the next unlock. |
| **The passphrase** | Never stored or transmitted; kept in memory only during key derivation | Keyloggers, shoulder-surfing, reuse elsewhere |
| **The user's device and browser** | Plaintext is never written to storage; the key is non-extractable | Malware, malicious extensions, an unlocked unattended session |

## Cryptographic design

The design uses only primitives from the browser's Web Crypto API. The exact byte
layout is in [DATA_FORMAT.md](DATA_FORMAT.md).

- **KDF:** PBKDF2-HMAC-SHA-256, 600,000 iterations (the OWASP 2023 value), and a
  16-byte random salt per passphrase. Files outside 310,000–10,000,000 iterations
  are refused, which blocks both downgrades and denial of service.
- **Cipher:** AES-256-GCM with a 128-bit tag and a 12-byte random IV for every
  encryption. Even with a draft written after every edit, one key encrypts far
  fewer messages than the 2³² limit for random IVs.
- **Associated data:** the canonical JSON of every header field, so any change to
  the header makes decryption fail.
- **Keys:** derived keys are `extractable: false` and exist only in memory while
  the tree is unlocked.
- **Randomness:** `crypto.getRandomValues` is used for salts, IVs, and passphrase
  suggestions. `crypto.randomUUID` is used for identifiers.
- **Failure handling:** any GCM failure is reported as "could not be decrypted —
  check the passphrase; the file may be damaged or modified". The app does not
  claim to know which it was.

A memory-hard KDF such as Argon2id would resist GPU guessing better. We chose
PBKDF2 because it is built into every browser, which means no extra
security-critical dependency. The container is versioned so a later version can
add Argon2id without breaking existing files.

## Review checklist (September 2026)

The review combined reading the code, automated tests, inspecting the production
build, and an independent adversarial review. The result for each requirement:

| # | Requirement | Result |
| - | ----------- | ------ |
| 1 | No plaintext family data in production assets | ✅ `scripts/check-build.mjs` fails the build if `dist/` contains a plaintext tree or test-fixture names. `scripts/check-public-data.mjs` (run in CI) does the same for `public/`. |
| 2 | No secrets in source code | ✅ No passphrases, keys, or tokens exist anywhere. The deploy workflow needs no secrets. |
| 3 | No secrets in the production build | ✅ Same checks. Source maps are disabled, and the build check rejects any `.map` file. |
| 4 | Data cannot be decrypted without the secret | ✅ Tested: `container.test.ts` and the UI and e2e wrong-passphrase tests. |
| 5 | Authentication and integrity are enforced | ✅ Tests flip bits in the ciphertext and tag, truncate it, swap ciphertexts between files, and change the IV, salt, and iterations. Every case is rejected. |
| 6 | Password-based key derivation is hardened | ✅ PBKDF2 at 600k iterations with bounds. New passphrases need ≥ 12 characters and either 4 words or ≥ 16 characters, and the app offers a 6-word random passphrase (≈ 77 bits). |
| 7 | Cryptographically secure randomness | ✅ Only `crypto.getRandomValues` and `crypto.randomUUID`. Word choice uses rejection sampling, so there is no modulo bias. |
| 8 | Correct nonces and IVs | ✅ A fresh 12-byte IV for each encryption, tested to differ between encryptions. |
| 9 | Modified files are rejected | ✅ See #5. Decrypted content is also validated by a strict schema. |
| 10 | Wrong secrets never produce accepted plaintext | ✅ GCM verifies the tag before any plaintext is returned. |
| 11 | Markdown cannot execute scripts | ✅ markdown-it runs with `html: false`. Links are limited to http(s) and mailto. Images become links, so there are no remote loads. The CSP blocks inline scripts. XSS tests are in `render.test.ts`. |
| 12 | Sensitive data is not logged | ✅ No `console` calls in application code; ESLint `no-console` enforces this. Error messages never include raw exception text. |
| 13 | Sensitive data is not placed in URLs | ✅ There is no routing, and nothing is written to the URL or history. The e2e test asserts the URL holds no names or passphrase. |
| 14 | No development or test data in production | ✅ Fixtures live in `src/test/` and are never imported by application code. The build check scans for fixture names. |
| 15 | Export and import do not bypass encryption | ✅ Saving and publishing always encrypt; only the encrypted container is committed to GitHub. Plaintext export needs an explicit warning dialog. Plaintext import forces a new passphrase before the tree opens. The published-tree loader ignores plaintext. |
| 16 | Browser storage does not undermine security | ✅ Only encrypted drafts are stored in IndexedDB. localStorage holds only the side-pane widths and collapsed state (no family data, tested); there are no cookies. The service worker caches only the app shell, and never `.ftree` files. |
| 17 | Dependencies introduce no obvious problems | ✅ Three runtime dependencies (react, markdown-it, zod), none of which make network requests. `npm audit` reports 0 vulnerabilities. There is no third-party crypto. |
| 18 | GitHub Pages deployment needs no plaintext secrets | ✅ It uses only the built-in OIDC token for Pages. Actions are pinned to commit SHAs, and permissions are least-privilege. The editor's publishing token is never part of the site: it is pasted in, kept in memory only, and sent only to `api.github.com`. |

### Findings addressed during review

- **Draft deletion (data loss):** opening a saved file cleared the recovery draft,
  even when the draft belonged to another tree. Now a workspace deletes only a
  draft it wrote or recovered, and the start screen asks before any action that
  will replace an existing draft.
- **Draft write/clear race:** a draft write that finished after a save could leave
  a stale (still encrypted) draft behind. All draft operations now go through one
  ordered queue, and the "still unsaved?" check runs at write time.
- **Clickjacking:** GitHub Pages cannot send `frame-ancestors` or
  `X-Frame-Options`, so the app now refuses to render inside a frame.
- **Weak passphrases:** the rules are stricter and the app can generate a random
  passphrase from the EFF wordlist.
- **CSP:** `style-src 'unsafe-inline'` was removed. The e2e tests check that no
  CSP violations occur.
- **Recovery script:** `scripts/decrypt.mjs` now validates parameters as strictly
  as the app does.
- **Supply chain:** GitHub Actions are pinned to commit SHAs.

## Publishing through the GitHub API

*Publish to website* commits the encrypted tree to `public/family-tree.ftree`
through GitHub's REST API.

- **Token scope.** The recommended token is a fine-grained personal access token
  limited to this one repository, with only *Contents: Read and write*. If it
  leaked, someone could change or delete repository contents, including the
  deployed code (see limitation 1), but could not read the tree without the
  passphrase.
- **Token handling.** The token is pasted in by the editor, held in React state for
  the unlocked session, sent only in the `Authorization` header to
  `api.github.com`, and discarded on Lock. It is never written to storage,
  logged, placed in URLs, or included in error messages. Tests assert the error
  messages.
- **Network policy.** The CSP's `connect-src` allows only `'self'` and
  `https://api.github.com`.
- **Integrity.** Updates carry the SHA of the file being replaced, so concurrent
  changes are refused rather than overwritten. Before publishing, the app compares
  the published SHA with the version it opened, and asks before replacing a
  different version.
- **Commit metadata.** Commits use a fixed, generic message. The commit author,
  time, and file size are visible to anyone who can see the repository.

## Remaining limitations

These are inherent to the architecture, or are deliberate trade-offs. They are
also listed in the README.

1. **Trust in the delivered code.** Anyone who can modify the repository or
   deployment can ship code that captures passphrases. Use two-factor
   authentication, branch protection, and review of changes. For maximum assurance,
   build and run a reviewed copy locally.
2. **Shared origin on `github.io`.** Every project site of one GitHub account
   (`https://<user>.github.io/<repo>/`) shares a single web origin. A malicious or
   compromised page in *another* repository of the same account could script this
   app's pages and read or overwrite its IndexedDB draft, which is encrypted but
   could be deleted. **Recommendation:** deploy on its own origin, either a custom
   domain or a dedicated account or organisation site (`<name>.github.io`), and do
   not host untrusted content on the same account.
3. **Offline guessing.** Anyone with an encrypted file can guess passphrases
   offline without limit. Security depends on passphrase strength, which matters
   most for trees published with the site.
4. **Metadata.** The file size and the fact that a file is a family tree are
   visible. Commit history reveals when a published tree changed.
5. **Memory.** JavaScript cannot securely erase memory. Decrypted data may remain
   in memory until garbage collection. Lock the tree and close the tab after use.
6. **Browser features outside the app's control:** password managers (if you let
   them save the passphrase), cloud spell-checkers such as Chrome's "enhanced
   spell check" that send typed text to a server, screen readers and assistive
   tools, and screenshots. Disable cloud spell-checking if that is a concern.
7. **The encrypted draft stays on the device after Lock** so that unsaved work can
   be recovered. On a shared computer, save before locking (saving deletes the
   draft), or discard the draft from the start screen.
8. **Clickjacking defence is script-based.** Frame-busting depends on JavaScript.
   With JavaScript disabled the app does not run at all, so this is acceptable.
