import { useState } from 'react';
import { isCryptoAvailable } from '../crypto/container';
import { WelcomeScreen, type OpenedTree } from './WelcomeScreen';
import { Workspace } from './Workspace';

export function App() {
  const [opened, setOpened] = useState<OpenedTree>();
  // Each unlock gets a fresh workspace so no state leaks between trees.
  const [sessionCount, setSessionCount] = useState(0);

  // Refuse to run inside a frame: GitHub Pages cannot send frame-ancestors or
  // X-Frame-Options headers, so this prevents click-jacking by a framing page.
  if (window.top !== window.self) {
    return (
      <main className="welcome welcome-focused" id="main">
        <section className="welcome-card" role="alert">
          <h1>Open this page directly</h1>
          <p>For your privacy, the Family Tree application does not run inside another website. Open it in its own tab.</p>
        </section>
      </main>
    );
  }

  if (!isCryptoAvailable()) {
    return (
      <main className="welcome welcome-focused" id="main">
        <section className="welcome-card" role="alert">
          <h1>This browser cannot protect your data</h1>
          <p>
            The Family Tree application needs the Web Crypto API, which is only available in current browsers on secure
            (HTTPS) pages. Please open this site over HTTPS in an up-to-date version of Firefox, Chrome, Edge, or Safari.
          </p>
        </section>
      </main>
    );
  }

  if (!opened) {
    return (
      <WelcomeScreen
        onOpen={(tree) => {
          setSessionCount((c) => c + 1);
          setOpened(tree);
        }}
      />
    );
  }
  return <Workspace key={sessionCount} opened={opened} onLock={() => setOpened(undefined)} />;
}
