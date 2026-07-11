import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

function callbackPage(heading, body) {
  return [
    "<!DOCTYPE html><html><head><title>JotBird CLI</title></head>",
    '<body style="font-family:system-ui,sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#f8fafc;color:#0f172a">',
    '<div style="text-align:center;max-width:400px;padding:2rem">',
    `<h1 style="font-size:1.5rem;font-weight:700;margin:0 0 .5rem">${heading}</h1>`,
    `<p style="color:#64748b;margin:0">${body}</p>`,
    "</div></body></html>",
  ].join("");
}

/**
 * Start a temporary HTTP server on 127.0.0.1 that waits for the web app
 * to redirect back with an API token via query parameter.
 *
 * Resolves with { port, state, tokenPromise, close }.
 * - port: the randomly-assigned port the server is listening on
 * - state: a single-use CSRF nonce the caller MUST include on the browser
 *   sign-in URL (`&state=<state>`); the api-key page echoes it back into the
 *   localhost callback, and this server only accepts a callback whose `state`
 *   matches. Without it, a drive-by page could port-scan 127.0.0.1 during a
 *   pending `jotbird login` and fixate the CLI to an attacker's account.
 *   Mirrors the VS Code / Obsidian deep-link nonce (see docs/auth.md).
 * - tokenPromise: resolves with the token string once /callback?token=...&state=<state> is hit
 * - close: shuts down the server and clears the timeout
 *
 * The server automatically rejects tokenPromise after `timeoutMs` (default 5 min).
 * A callback with a missing/mismatched `state` is rejected (error page, no
 * resolve) so it cannot hijack or cancel the pending login — the promise stays
 * open for the legitimate callback (or the timeout).
 */
export function startCallbackServer(timeoutMs = 300_000, expectedState = randomUUID()) {
  return new Promise((resolve, reject) => {
    let resolveToken, rejectToken;
    const tokenPromise = new Promise((res, rej) => {
      resolveToken = res;
      rejectToken = rej;
    });

    const timeout = setTimeout(() => rejectToken(new Error("timeout")), timeoutMs);

    const server = createServer((req, res) => {
      const url = new URL(req.url, "http://127.0.0.1");

      if (url.pathname === "/callback") {
        const token = url.searchParams.get("token");
        const state = url.searchParams.get("state");
        const accepted = Boolean(token) && state === expectedState;

        if (accepted) {
          res.writeHead(200, { "Content-Type": "text/html", Connection: "close" });
          res.end(callbackPage(
            "Logged in",
            "You can close this tab and return to your terminal.",
          ));
          clearTimeout(timeout);
          resolveToken(token);
        } else {
          // Missing token, or a state that doesn't match the pending nonce:
          // do NOT resolve (a drive-by callback must not hijack or cancel the
          // legitimate login). Keep waiting for a valid callback or the timeout.
          res.writeHead(token ? 403 : 400, { "Content-Type": "text/html", Connection: "close" });
          res.end(callbackPage(
            "Couldn't verify sign-in",
            "This request could not be verified. Please return to your terminal and run <code>jotbird login</code> again.",
          ));
        }
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    server.listen(0, "127.0.0.1", () => {
      resolve({
        port: server.address().port,
        state: expectedState,
        tokenPromise,
        close: () => { clearTimeout(timeout); server.close(); },
      });
    });

    server.on("error", reject);
  });
}

/**
 * Try to open a URL in the user's default browser.
 * Returns true if the command succeeded, false otherwise.
 */
export async function openBrowser(url) {
  try {
    const { execFile } = await import("node:child_process");
    const cmd = process.platform === "darwin" ? "open"
      : process.platform === "win32" ? "start"
      : "xdg-open";
    return new Promise((resolve) => {
      execFile(cmd, [url], (err) => resolve(!err));
    });
  } catch {
    return false;
  }
}
