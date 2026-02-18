import "./globals.css";
import type { ReactNode } from "react";

export const metadata = {
  title: "AutoCue",
  description: "Remote cue submission and operator approval"
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <main>
          <header>
            <h1>AutoCue</h1>
            <p>Remote cue submission with operator approval.</p>
          </header>
          {children}
        </main>
      </body>
    </html>
  );
}
