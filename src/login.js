import { createServer } from "node:http";

/**
 * Start a temporary HTTP server on 127.0.0.1 that waits for the web app
 * to redirect back with an API token via query parameter.
 *
 * Resolves with { port, tokenPromise, close }.
 * - port: the randomly-assigned port the server is listening on
 * - tokenPromise: resolves with the token string once /callback?token=... is hit
 * - close: shuts down the server and clears the timeout
 *
 * The server automatically rejects tokenPromise after `timeoutMs` (default 5 min).
 */
export function startCallbackServer(timeoutMs = 300_000) {
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

        res.writeHead(200, { "Content-Type": "text/html", Connection: "close" });
        res.end([
          "<!DOCTYPE html><html><head><title>JotBird CLI</title></head>",
          '<body style="font-family:system-ui,sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#f8fafc;color:#0f172a">',
          '<div style="text-align:center;max-width:400px;padding:2rem">',
          '<h1 style="font-size:1.5rem;font-weight:700;margin:0 0 .5rem">Logged in</h1>',
          '<p style="color:#64748b;margin:0">You can close this tab and return to your terminal.</p>',
          "</div></body></html>",
        ].join(""));

        if (token) {
          clearTimeout(timeout);
          resolveToken(token);
        }
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    server.listen(0, "127.0.0.1", () => {
      resolve({
        port: server.address().port,
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
