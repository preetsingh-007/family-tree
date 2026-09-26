import { DEFAULT_PBKDF2_ITERATIONS } from '../crypto/container';
import { Modal } from './Modal';

/** Plain-language description of what is and is not protected. */
export function SecurityInfo({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="How your family data is protected" onClose={onClose} size="large">
      <div className="prose">
        <h3>What happens to your data</h3>
        <ul>
          <li>
            Your family tree is <strong>encrypted in this browser</strong> before it is saved. Only the encrypted file leaves
            your device, and only when you save or export it.
          </li>
          <li>
            There is <strong>no server and no account</strong>. This website is a set of static files; it has no database and
            does not receive your family information. There is no analytics or tracking.
          </li>
          <li>
            The encryption uses AES-256-GCM with a key derived from your passphrase using PBKDF2-SHA-256 (
            {DEFAULT_PBKDF2_ITERATIONS.toLocaleString('en')} iterations) and a random salt, all provided by your browser’s
            built-in Web Crypto API. Any change to an encrypted file is detected.
          </li>
          <li>
            While you have unsaved changes, an <strong>encrypted</strong> recovery copy is kept in this browser so that a
            refresh or crash does not lose your work. It is deleted when you save. Unencrypted data is never stored.
          </li>
        </ul>

        <h3>Your passphrase</h3>
        <ul>
          <li>Your passphrase is never stored or sent anywhere. It is kept only while the tree is unlocked.</li>
          <li>
            <strong>It cannot be recovered.</strong> If it is lost, the encrypted tree cannot be opened by anyone, including
            the authors of this application.
          </li>
          <li>
            Someone who obtains your encrypted file can try to guess the passphrase on their own computers. A long, random
            passphrase (for example four or more unrelated words) makes this impractical; a short or guessable one does not.
          </li>
        </ul>

        <h3>What this cannot protect against</h3>
        <ul>
          <li>
            <strong>A compromised device or browser</strong> (malware, malicious extensions, someone using your unlocked
            computer) can see the tree while it is open.
          </li>
          <li>
            <strong>A modified copy of this application.</strong> Whoever controls the website or its code repository could
            change the code to capture passphrases. Only use a copy of the site you trust.
          </li>
          <li>
            <strong>Unencrypted exports.</strong> If you choose “Export unencrypted JSON”, that file is readable by anyone who
            gets it. Store it carefully and do not upload it.
          </li>
          <li>
            The size of an encrypted file roughly reveals how much data it contains, and the file itself shows that it is a
            family-tree file. Names and details are not revealed.
          </li>
        </ul>

        <h3>Backups</h3>
        <p>
          Keep copies of your encrypted <code>.ftree</code> file in more than one place (for example a USB drive and a cloud
          folder), and keep your passphrase somewhere safe such as a password manager. The file format is documented, so your
          data can be recovered even without this application.
        </p>
      </div>
    </Modal>
  );
}
