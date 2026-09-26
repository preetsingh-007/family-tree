# Family Tree

A private family-tree editor that runs entirely in your browser. You can create,
view, edit, and search a family tree, write Markdown notes, attach photos, and
save everything as a single **encrypted file**. The app is a static website with
no server, database, account, analytics, or tracking, so it can be hosted free
on GitHub Pages.

- **Private by design.** The tree is encrypted in the browser (AES-256-GCM, with
  the key derived from your passphrase by PBKDF2-SHA-256) before it is saved.
  Only the encrypted file is ever written anywhere.
- **Portable.** Both the encrypted file and the plain JSON document are
  [documented and versioned](docs/DATA_FORMAT.md). Your data can be recovered
  with a short Node or Python script, without this application.
- **Real families.** Multiple marriages and partnerships, children from different
  relationships, adoption, step- and foster relationships, godparents and other
  links, and incomplete or uncertain dates ("about 1890", "between 1890 and
  1895", "March, year unknown").
- **Works offline** once loaded, and on desktop, tablet, and phone.

> **Important:** the passphrase cannot be recovered. If you lose it, nobody,
> including you and the authors of this software, can open the encrypted tree.

---

## Contents

1. [Using the application](#using-the-application)
2. [Installing and running locally](#installing-and-running-locally)
3. [Building](#building)
4. [Deploying to GitHub Pages](#deploying-to-github-pages)
5. [Data model](#data-model)
6. [How encryption works](#how-encryption-works)
7. [What is public, what stays secret](#what-is-public-what-stays-secret)
8. [Passphrases](#passphrases)
9. [Import, export, and backups](#import-export-and-backups)
10. [Local storage in the browser](#local-storage-in-the-browser)
11. [Security limitations](#security-limitations)
12. [Browser requirements](#browser-requirements)
13. [Project structure and contributing](#project-structure-and-contributing)
14. [Dependencies](#dependencies)
15. [Security review](#security-review)

---

## Using the application

**Start screen**

- **Start a new family tree.** Choose a name and a passphrase.
- **Open an encrypted file.** Open a `.ftree` file you saved earlier.
- **Open the published tree.** This appears only if the site publishes
  an encrypted tree (see [Publishing the family tree](#publishing-the-family-tree-to-the-website)).
- **Recover unsaved work.** This appears if the browser closed while you had unsaved
  changes.
- **Import an unencrypted backup.** Open a `.plaintext.json` export and protect it
  with a new passphrase.

**Workspace**

- **People** (left, or the *People* tab on small screens): a searchable list of
  everyone. Search matches names, alternate names, places, years, custom fields,
  and notes, ignoring accents. Press Enter to jump to the first result. The list
  is also the accessible, non-graphical way to navigate the tree.
- **Tree** (centre): a generational diagram. Drag to pan, use the mouse wheel or a
  pinch to zoom, and use the toolbar to zoom, fit the tree to the screen, or
  centre it on the selected person. Choose how much of the family to show, from
  "Close family" up to "Everyone". A **+** badge means that person has relatives
  outside the current view. Dashed lines mark adoptive, step, foster, and guardian
  relationships; a dotted line between partners means the relationship ended.
  With the keyboard, arrow keys move between people (up to parents, down to
  children, left and right within a generation), Enter opens a person's details,
  and F centres the tree on the selected person.
- **Person** (right, or the *Person* tab): details, family (parents, partners and
  the children of each partnership, siblings, step-parents, other relationships),
  life events, rendered Markdown notes, custom fields, and photos. From here you
  can edit, add relatives, change or remove relationships, and delete the person.
- **Save** (Ctrl/⌘+S) encrypts the tree and writes the file. In Chromium-based
  browsers, the same file is overwritten on later saves. Other browsers download
  a new copy each time. The status next to the tree name shows *Unsaved changes*,
  *Encrypting…*, *Saved 14:05*, *Published 14:05*, or *Save failed*.
- **Undo/redo** (Ctrl/⌘+Z, Ctrl/⌘+Shift+Z) covers the last 100 changes, until
  you lock the tree.
- The **⋯ menu** has *Save as…*, *Publish to website…*, *Tree name & notes*,
  *Change passphrase*, *Export unencrypted JSON…*, *How your data is protected*,
  and *Lock*.

Destructive actions (deleting people, relationships, or photos; discarding edits;
exporting without encryption; locking with unsaved changes) ask for confirmation.
Deletions can also be undone.

---

## Installing and running locally

Requirements: **Node.js 20 or newer** (22 recommended) and npm.

```sh
npm ci            # install exact dependency versions from package-lock.json
npm run dev       # start the dev server at http://localhost:5173
```

The development server does not apply the Content Security Policy, because Vite's
hot-reload client needs inline scripts. Use `npm run build && npm run preview` to
run the production configuration.

### Checks

```sh
npm run lint        # ESLint (includes a no-console rule for application code)
npm run typecheck   # TypeScript
npm test            # unit + UI workflow tests (Vitest, jsdom, real Web Crypto)
npm run build       # type-check, build dist/, then verify the build (see below)
npm run test:e2e    # Playwright tests against the built site, desktop + mobile
npm run check:data  # verify public/ contains no unencrypted family data
```

`npm run test:e2e` serves `dist/` under `/family-tree/`, like a GitHub Pages
project site, so run `npm run build` first. Install a browser once with
`npx playwright install chromium`. If you already have Chromium, set
`CHROMIUM_PATH=/path/to/chromium` instead.

---

## Building

```sh
npm run build
```

This produces a static site in `dist/`: `index.html`, hashed JS and CSS bundles,
a web manifest, and a service worker. Upload the contents to any static host.

Asset URLs are **relative** (`./assets/...`), so the same build works at a domain
root, at `https://user.github.io/repo/`, or in any sub-folder. To force an
absolute base, set `BASE_PATH=/some/path/` when building.

After building, `scripts/check-build.mjs` fails the build if `dist/` contains any
of the following:

- source maps
- anything that looks like an unencrypted family tree
- names from the test fixtures
- inline scripts
- a missing Content Security Policy
- `.ftree` files that are not well-formed encrypted containers

---

## Deploying to GitHub Pages

The repository includes `.github/workflows/deploy.yml`. On every push and pull
request it runs lint, the data check, unit and UI tests, the build (with the
build checks), and the end-to-end tests. On pushes to `main` it also deploys
`dist/` to GitHub Pages.

1. Push the repository to GitHub, with `main` as the default branch.
2. In **Settings → Pages**, set **Source** to **GitHub Actions**.
3. Push to `main`, or run the workflow manually from the **Actions** tab.
4. The site is published at `https://<user>.github.io/<repository>/`.

No secrets or configuration are required. The workflow uses only the standard
`GITHUB_TOKEN` permissions for Pages (`pages: write`, `id-token: write`), and its
actions are pinned to commit SHAs.

> **Recommended: give the app its own origin.** All project sites of one GitHub
> account (`https://<user>.github.io/<any-repo>/`) share a single web origin, so
> a malicious or compromised page in another of your repositories could interfere
> with this app while it is open. Use a custom domain (Settings → Pages → Custom
> domain) or a dedicated account or organisation site (`<name>.github.io`) that
> hosts nothing else.

### Publishing the family tree to the website

The whole family, including any unconnected branches, lives in **one encrypted
file**: `public/family-tree.ftree` in this repository. Anyone who opens the website
and knows the passphrase can view it with **Open the published tree**.
Only you, as the holder of a GitHub access token, can change it.

**One-time setup: create an access token**

1. Open GitHub → Settings → Developer settings → **Fine-grained personal access
   tokens** → *Generate new token*
   ([direct link](https://github.com/settings/personal-access-tokens/new)).
2. Under **Repository access**, choose **Only select repositories** and pick this
   repository.
3. Under **Permissions → Repository permissions**, set **Contents** to **Read and
   write**. Leave everything else at *No access*.
4. Choose an expiry date and generate the token. Store it in your password manager.
   Anyone with it can change the repository, so never share it.

**Publishing**

1. Open the tree: from the website, or from a saved file.
2. Make your changes.
3. Choose **⋯ → Publish to website…**. The repository and branch are filled in
   automatically on the deployed site. Paste the token the first time in each
   session.
4. The app encrypts the tree in your browser and commits the encrypted file to the
   repository through GitHub's API, with the generic message *Update encrypted
   family tree*. That commit triggers the deploy workflow, and the website shows the
   new version after a few minutes.

Details:

- **Nothing is overwritten by accident.** The app records which published version
  you opened. If the repository holds a different version when you publish (from
  another device, or because the site had not finished deploying), it asks before
  replacing it. GitHub also refuses the commit if the file changes while you are
  publishing. Replaced versions remain in the git history.
- **The token is kept only in memory** for the unlocked session. It is sent only to
  `api.github.com`, and it is forgotten when you lock the tree or close the tab.
- **Publishing counts as saving.** The unsaved-changes indicator clears, and the
  local recovery copy is deleted. You can still use **Save** for a local backup
  file.
- **Viewers need no token and no account.** They need only the passphrase. They can
  change their own copy in the browser, but cannot publish.
- You can also publish by hand: save a `.ftree` file, copy it to
  `public/family-tree.ftree`, and commit it.

Only the encrypted file is ever published. The application ignores a plaintext
file at that path, and `npm run check:data` fails CI if `public/` contains anything
unencrypted.

Remember that **anyone** can download a published file and try passphrases
offline, and git history keeps every version forever. Use a strong passphrase
(see [Passphrases](#passphrases)), and read
[Security limitations](#security-limitations). To stop someone viewing future
versions, change the passphrase and publish again. Old versions in the history can
still be opened with the old passphrase.

The deploy workflow passes the repository name and default branch to the build
(`VITE_GITHUB_REPOSITORY`, `VITE_GITHUB_BRANCH`) so the publish dialog can fill
them in. These values are not secret.

---

## Data model

The complete specification is in [docs/DATA_FORMAT.md](docs/DATA_FORMAT.md).
In summary:

- **People** have given names, a surname, an optional display name, alternate names
  (birth, married, nickname, …), optional sex and free-text gender, a living
  status, birth and death (date, place, note), other life events, Markdown notes,
  custom label/value fields, and photos. Every field is optional.
- **Dates** can be exact, month/year, year only, "about", "before", "after",
  "between X and Y", or unknown (omitted). They can also keep the original wording
  from a source, such as "Michaelmas 1850".
- **Parent links** (parent → child) carry a kind: biological, adoptive, step,
  foster, guardian, or unspecified. A child can have any number of parents.
- **Partnerships** connect two people, with a kind (marriage, civil union, …), a
  start, and an optional end with a reason (divorce, death, …). People can have
  any number of them.
- **Associations** record any other relationship ("godparent", "guardian", …).
- **Siblings, half-siblings, step-siblings, and step-parents are derived**, not
  stored, so the data cannot contradict itself.
- **Photos** are stored inside the document as base64 JPEG, so they are encrypted
  with everything else.

All edits go through pure functions in `src/model/tree.ts`, which reject
inconsistent changes such as references to missing people, self-relationships, or
someone becoming their own ancestor. All imported data goes through
`src/model/schema.ts`, which checks structure, identifiers, references, dates,
and ancestry loops, and reports readable errors.

---

## How encryption works

1. When you choose a passphrase, the app generates a random 16-byte **salt** and
   derives a 256-bit key with **PBKDF2-HMAC-SHA-256** and 600,000 iterations. The
   iterations make every passphrase guess slow for an attacker as well as for you.
2. The key is a **non-extractable** Web Crypto key. Page scripts can use it but
   cannot read its bytes, and it exists only in memory while the tree is open.
3. On every save, the whole tree (including photos) is serialised to JSON and
   encrypted with **AES-256-GCM** under a fresh random 12-byte IV. GCM provides
   confidentiality and **integrity**: any change to the ciphertext or the header
   makes decryption fail.
4. The header holds the non-secret parameters needed to decrypt: format, version,
   algorithm names, iteration count, salt, and IV. The whole header is also
   authenticated, so nobody can quietly weaken these parameters.

All cryptography comes from the browser's built-in **Web Crypto API**. This
project does not implement any cryptographic algorithm itself.

When decryption fails, the app says the file **could not be decrypted**, and
that you should check the passphrase and, if it is right, whether the file has
been damaged or modified. GCM cannot tell these cases apart, so the app does not
claim the passphrase was wrong.

---

## What is public, what stays secret

| May be public                                   | Stays secret |
| ----------------------------------------------- | ------------ |
| All application code, CSS, and this repository  | Your passphrase |
| The encrypted `.ftree` file                     | The derived encryption key |
| Salt, IV, iteration count, algorithm names      | All family information: names, dates, places, notes, relationships, photos, and the tree's name |
| The approximate size of the tree (file size)    | |

File names that the app suggests (`family-tree-2026-09-26.ftree`) contain only a
date. The tree's name is stored inside the encrypted document.

---

## Passphrases

- A new passphrase must have at least 12 characters and either four words or at
  least 16 characters. **Suggest a random passphrase** generates six words from
  the EFF Diceware list (about 77 bits), using the browser's secure random number
  generator. PBKDF2 slows down guessing, but it cannot save a guessable passphrase
  such as a name, date, or quotation.
- The passphrase is never stored: not in the code, configuration, URLs,
  `localStorage`, or IndexedDB. It is held in the unlock form only until the key
  is derived, and then cleared. The derived key stays in memory until you lock
  the tree or close the tab.
- **There is no recovery mechanism.** Store the passphrase in a password manager
  or another safe place.
- **Change passphrase** generates a new salt and key. The change takes effect when
  you next save. Files saved earlier keep the old passphrase, so replace or delete
  them if the old passphrase might be known to others.

---

## Import, export, and backups

| Action                       | Result |
| ---------------------------- | ------ |
| **Save / Save as…**          | Encrypted `.ftree` file (the normal format) |
| **Publish to website…**      | Commits the encrypted file to the repository (see [Publishing](#publishing-the-family-tree-to-the-website)) |
| **Open an encrypted file**   | Decrypts, validates, and opens a `.ftree` file |
| **Export unencrypted JSON…** | Readable `.plaintext.json` document, after an explicit warning |
| **Import an unencrypted backup** | Validates a plaintext document, then asks for a passphrase to protect it |

`.gitignore` ignores `*.plaintext.json`, so plaintext exports are not committed
by accident.

**Backup recommendations**

- Save the encrypted file regularly, and keep copies in at least two places, for
  example a USB drive and a cloud folder. Encrypted files are safe to store with
  cloud providers.
- Keep the passphrase in a password manager, and make sure someone you trust can
  reach it if something happens to you.
- Now and then, test a backup by opening it.
- For very long-term preservation, you may also keep an unencrypted JSON export in
  a physically secure place. It is plain, documented JSON that any future software
  can read. Treat it like the family's private papers.
- You can decrypt a file without the app using `node scripts/decrypt.mjs file.ftree`
  or the Python snippet in [docs/DATA_FORMAT.md](docs/DATA_FORMAT.md).

---

## Local storage in the browser

| Storage                    | What is stored | Plaintext? |
| -------------------------- | -------------- | ---------- |
| IndexedDB (`family-tree`)  | An **encrypted** recovery copy of the tree, only while there are unsaved changes. It is deleted after a successful save or when you discard it. | No |
| Service-worker cache       | The application's code and styles, for offline use. Family data, including the optional published `.ftree`, is never cached. | No |
| `localStorage`, cookies, URLs, browser history | Nothing | — |

The recovery copy uses the same key and format as a saved file, so it is protected
by your passphrase. It lets you continue after an accidental refresh, a crash, or
a closed tab. Only one recovery copy is kept, so unsaved edits to a different tree
replace it. Decrypted data exists only in the page's memory and in what is shown
on screen.

---

## Security limitations

This application protects the **encrypted data**. It cannot protect against
everything:

- **Application delivery.** A static web app is only as trustworthy as the code
  the browser receives. Anyone who controls the repository, the GitHub account, or
  the hosting could change the code to capture passphrases or decrypted data the
  next time someone unlocks a tree. Encryption does not prevent this. Protect the
  repository with two-factor authentication and branch protection. For the highest
  assurance, run a copy you have reviewed locally (`npm run build && npm run preview`)
  or from your own device.
- **Your device and browser.** Malware, malicious browser extensions, or someone
  with access to your unlocked computer can see the tree while it is open.
- **Weak passphrases.** Anyone with the encrypted file can guess passphrases
  offline, as fast as their hardware allows. PBKDF2 slows this down but cannot stop
  it. Memory-hard key derivation (Argon2id) would resist specialised hardware
  better, but browsers do not provide it natively. The versioned container format
  allows adding it later.
- **Metadata.** File size reveals roughly how much is in the tree, and the header
  reveals that it is a family-tree file. Timestamps of files and commits are
  visible.
- **Unencrypted exports** are readable by anyone who obtains them.
- **Published trees and git history.** A `.ftree` committed to a public repository
  stays in its history even after deletion. If a passphrase is later compromised,
  old copies remain decryptable with it.
- **Memory.** JavaScript cannot reliably wipe memory. Decrypted data and strings
  may stay in memory until the browser frees them. Lock the tree and close the tab
  when you are done.
- **Shared origin on github.io.** See the recommendation in
  [Deploying to GitHub Pages](#deploying-to-github-pages).
- **Browser features.** Cloud spell-checkers (such as Chrome's "enhanced spell
  check") can send typed text to their provider. Password managers store the
  passphrase if you let them. Disable these features if that is a concern.
- **Framing.** GitHub Pages cannot send `frame-ancestors` or `X-Frame-Options`
  headers, so the app refuses to run inside a frame, which blocks click-jacking.

---

## Browser requirements

A current version of Firefox, Chrome, Edge, or Safari, desktop or mobile. The
page must be served over **HTTPS** or from `localhost`, because Web Crypto is only
available in secure contexts. The app refuses to run without it. Saving in place
uses the File System Access API where it exists (Chromium). Elsewhere, saving
downloads the file.

---

## Project structure and contributing

```
src/
  model/      Data types, pure tree operations, derived relationships, dates,
              search, validation (zod), and format migrations
  crypto/     Encrypted container format (Web Crypto: PBKDF2 + AES-GCM)
  storage/    File open/save, encrypted drafts (IndexedDB), published-tree fetch
  layout/     Generational tree layout (pure, unit-tested)
  markdown/   Safe Markdown rendering
  media/      Photo resizing and metadata stripping
  passphrase/ Passphrase rules and random (Diceware) suggestions
  state/      Undoable editor state
  ui/         React components
  test/       Test setup, synthetic fixtures, and helpers (never bundled)
scripts/      Build/data checks and the stand-alone decrypt tool
tests/e2e/    Playwright tests against the production build
docs/         Data format specification
```

Guidelines:

- Keep model code pure and put changes in `src/model/tree.ts` with tests.
- Never log application data. ESLint enforces `no-console`.
- Never put family data in URLs, DOM attributes (other than random ids), or
  browser storage other than the encrypted draft.
- Any change to the stored format requires a version bump, a migration, tests,
  and an update to `docs/DATA_FORMAT.md`.
- Use only invented names in tests and fixtures. `scripts/check-build.mjs` fails if
  fixture names reach the build.
- Run `npm run lint && npm test && npm run build && npm run test:e2e` before
  opening a pull request.

---

## Dependencies

Runtime (bundled into the site):

| Package | Purpose | Can it receive family data? |
| ------- | ------- | --------------------------- |
| `react`, `react-dom` | User interface | In memory only. It makes no network requests. |
| `markdown-it` | Rendering Markdown notes (HTML disabled) | In memory only. It makes no network requests. |
| `zod` | Validating imported and decrypted documents | In memory only. It makes no network requests. |

Cryptography uses the browser's built-in Web Crypto API, with no third-party
crypto library.

The passphrase generator uses the [EFF large Diceware wordlist](https://www.eff.org/dice)
(© Electronic Frontier Foundation, CC BY 3.0 US), vendored as
`src/passphrase/eff_large_wordlist.txt` and loaded only when a suggestion is
requested.

Development only: Vite, TypeScript, Vitest, Testing Library, jsdom,
fake-indexeddb, Playwright, ESLint, and `vite-plugin-pwa` (which generates the
Workbox service worker for offline use).

The production Content Security Policy (`default-src 'self'`,
`connect-src 'self' https://api.github.com`, `img-src 'self' data: blob:`, no inline
scripts or styles) stops the page from loading scripts or content from any other
origin. It also stops the page from sending data with `fetch` anywhere except this
site and GitHub's API, which *Publish to website* uses to commit the encrypted file.

---

## Security review

The review checklist, its results, and remaining limitations are recorded in
[docs/SECURITY.md](docs/SECURITY.md).
