import { createServer, type Server, type ServerResponse } from "node:http";

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

/** Creates the HTTP server. Routes are added here as the product grows. */
export function createApp(): Server {
  return createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");

    if (req.method === "GET" && url.pathname === "/health") {
      sendJson(res, 200, { status: "ok", service: "giftbot" });
      return;
    }

    sendJson(res, 404, { error: "not_found" });
  });
}
