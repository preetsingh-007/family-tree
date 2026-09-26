# Data format specification

This document describes the two file formats used by the Family Tree application
precisely enough that the data can be read, migrated, or recovered **without the
application**. Both are UTF-8 JSON.

| File                     | Extension         | Contents                                   |
| ------------------------ | ----------------- | ------------------------------------------ |
| Encrypted container      | `.ftree`          | Header + AES-GCM ciphertext of a document  |
| Family-tree document     | `.plaintext.json` | The tree itself (only when exported unencrypted) |

An encrypted file is simply a family-tree document, serialised as JSON, encrypted
as one authenticated unit and wrapped in a small JSON header.

---

## 1. Encrypted container — `family-tree-encrypted`, version 1

```json
{
  "format": "family-tree-encrypted",
  "version": 1,
  "kdf": {
    "name": "PBKDF2",
    "hash": "SHA-256",
    "iterations": 600000,
    "salt": "base64 (16 random bytes)"
  },
  "cipher": {
    "name": "AES-GCM",
    "keyBits": 256,
    "iv": "base64 (12 random bytes)",
    "tagBits": 128
  },
  "ciphertext": "base64 (encrypted document followed by the 16-byte GCM tag)"
}
```

All base64 is standard RFC 4648 §4 with padding. No other top-level fields are
allowed. None of the header values are secret.

### Key derivation

```
passphraseBytes = UTF-8( NFC-normalise(passphrase) )
key             = PBKDF2-HMAC-SHA-256(passphraseBytes, salt, iterations, dkLen = 32 bytes)
```

* `salt` is 16 bytes from a cryptographically secure RNG, generated whenever a
  passphrase is chosen (new tree, import, or passphrase change).
* `iterations` is 600,000 for files written by this version (OWASP 2023
  recommendation for PBKDF2-HMAC-SHA-256). Readers must refuse values below
  310,000 or above 10,000,000.

### Encryption

```
aad        = UTF-8( JSON.stringify([format, version, kdf.name, kdf.hash, kdf.iterations,
                                    kdf.salt, cipher.name, cipher.keyBits, cipher.iv, cipher.tagBits]) )
ciphertext = AES-256-GCM-Encrypt(key, iv, plaintext = UTF-8(JSON document), additionalData = aad)
```

* `iv` is 12 fresh random bytes **for every save**; the same key is reused for
  saves in one session, which is safe with random 96-bit IVs far below the
  2³² message limit.
* `aad` is the JSON array above with values exactly as they appear in the header
  (strings are the base64 text, numbers are JSON numbers, no spaces). Because the
  whole header is authenticated, changing any header value — e.g. lowering the
  iteration count or swapping the salt — makes decryption fail.
* The Web Crypto API appends the 16-byte authentication tag to the ciphertext;
  the `ciphertext` field contains both.

### Decrypting without the application

Any AES-GCM implementation works. With this repository:

```sh
node scripts/decrypt.mjs my-tree.ftree > my-tree.plaintext.json
```

In Python with the `cryptography` package:

```python
import base64, json, unicodedata
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes

c = json.load(open("my-tree.ftree"))
k, ci = c["kdf"], c["cipher"]
key = PBKDF2HMAC(hashes.SHA256(), 32, base64.b64decode(k["salt"]), k["iterations"]).derive(
    unicodedata.normalize("NFC", input("Passphrase: ")).encode())
aad = json.dumps([c["format"], c["version"], k["name"], k["hash"], k["iterations"], k["salt"],
                  ci["name"], ci["keyBits"], ci["iv"], ci["tagBits"]], separators=(",", ":")).encode()
doc = AESGCM(key).decrypt(base64.b64decode(ci["iv"]), base64.b64decode(c["ciphertext"]), aad)
open("my-tree.plaintext.json", "wb").write(doc)
```

(`JSON.stringify` and `json.dumps(..., separators=(",", ":"))` produce identical
output here because every value is ASCII.)

---

## 2. Family-tree document — `family-tree`, version 1

TypeScript definitions live in [`src/model/types.ts`](../src/model/types.ts) and
the validation schema in [`src/model/schema.ts`](../src/model/schema.ts).

```jsonc
{
  "format": "family-tree",
  "version": 1,
  "id": "uuid",
  "title": "Our family",
  "notes": "Markdown about the family as a whole",
  "createdAt": "2026-01-01T12:00:00.000Z",
  "updatedAt": "2026-01-02T08:30:00.000Z",
  "people": [Person],
  "parentLinks": [ParentLink],
  "partnerships": [Partnership],
  "associations": [Association],
  "media": [MediaItem]
}
```

Identifiers are opaque strings (random UUIDs when created by the app) and must be
unique across the whole document. Optional fields are omitted rather than `null`.
Unknown fields are rejected, so a newer file is never silently truncated by an
older application.

### Person

| Field            | Type                                                   | Notes |
| ---------------- | ------------------------------------------------------ | ----- |
| `id`             | string                                                 | |
| `givenNames`     | string                                                 | may be empty |
| `surname`        | string                                                 | may be empty |
| `fullName`       | string?                                                | display override |
| `alternateNames` | `{ name, type: birth\|married\|nickname\|religious\|other }[]` | |
| `sex`            | `female\|male\|intersex\|unknown`?                     | omitted = not recorded |
| `gender`         | string?                                                | free text |
| `living`         | `living\|deceased\|unknown`                             | |
| `birth`, `death` | `LifeEvent`?                                           | |
| `events`         | `{ id, type, date?, place?, note? }[]`                  | any other life event |
| `notes`          | string                                                 | Markdown |
| `customFields`   | `{ id, label, value }[]`                                | |
| `mediaIds`       | string[]                                               | first entry is the portrait |

`LifeEvent = { date?: FuzzyDate, place?: string, note?: string }`

### FuzzyDate

```jsonc
{ "qualifier": "exact|about|before|after|between",
  "year": 1890, "month": 3, "day": 12,        // each optional
  "end": { "year": 1895 },                     // only for "between"
  "text": "Spring 1890" }                      // optional original wording
```

A completely unknown date is represented by omitting the `date`. Years are
non-zero integers in −9999…9999 (negative = BC). A `day` requires a `month`; the
day must exist in that month (29 February is accepted when the year is unknown).

### ParentLink (parent → child)

`{ id, parentId, childId, kind: biological|adoptive|step|foster|guardian|unknown, note? }`

A child may have any number of parent links (e.g. birth parents *and* adoptive
parents). A given parent/child pair may appear only once, and links may not form
a loop. **Siblings are not stored**: they are derived from shared parents
(full, half, or step-siblings via a parent's partner).

### Partnership

`{ id, partnerIds: [id, id], kind: marriage|civil-union|partnership|engagement|other, start?: LifeEvent, end?: LifeEvent & { reason?: divorce|separation|annulment|death|other }, note? }`

A person may have any number of partnerships, including more than one with the
same person. Children are *not* attached to partnerships; "children of this
couple" means children linked to both partners.

### Association

`{ id, personIds: [a, b], label, note? }` — "a is b's *label*", e.g. `godparent`.

### MediaItem

`{ id, mimeType: image/jpeg|image/png|image/webp, data: base64, caption?, width?, height? }`

Photos are stored inline so they are encrypted with everything else. The app
re-encodes images to JPEG (max 1600 px), which also removes EXIF metadata such as
GPS location. Each photo belongs to exactly one person.

---

## 3. Versioning and migration

* `version` in the **document** changes when the family-tree structure changes.
  Readers migrate older versions step by step (see
  [`src/model/migrate.ts`](../src/model/migrate.ts)); files from a newer version
  are refused with a clear message rather than partially read.
* `version` in the **container** changes only if the encryption scheme changes
  (e.g. a move to Argon2id). A new container version would be added alongside
  version 1, which must remain readable.

To introduce document version 2:

1. Bump `DOCUMENT_VERSION` and update the types and schema.
2. Add `MIGRATIONS[1]`, a pure function converting a version-1 object to version 2.
3. Add tests migrating a version-1 fixture, and update this document.
