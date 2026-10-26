import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import {
  buildHouseholdReview,
  householdStatusLabels,
  localDate,
  readHouseholdInputs,
} from "./household-supplies.mjs";
import { buildReviewForInput } from "./lib/approved-list.mjs";

const root = new URL("./", import.meta.url);
const deviceCookieMaxAge = 365 * 24 * 60 * 60;
const assets = new Map([
  ["/", ["web/index.html", "text/html; charset=utf-8"]],
  ["/app.css", ["web/app.css", "text/css; charset=utf-8"]],
  ["/app.js", ["web/app.js", "text/javascript; charset=utf-8"]],
]);

async function saveShoppingList(text, directory, date) {
  await mkdir(directory, { recursive: true });
  const day = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
  for (let version = 1; ; version += 1) {
    const filename = `${day}-v${version}.txt`;
    try {
      await writeFile(new URL(filename, directory), text, {
        encoding: "utf8",
        flag: "wx",
      });
      return filename;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
  }
}

function sameSecret(left, right) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createReviewServer({
  historyDirectory = new URL("data/shopping-lists/", root),
  householdDirectory = new URL("data/", root),
  now = () => new Date(),
  publicOrigin,
  accessKey,
} = {}) {
  // Derived from the key, so changing ACCESS_KEY logs out every device.
  const deviceToken =
    accessKey &&
    createHmac("sha256", accessKey).update("device-access").digest("hex");
  return createServer(async (request, response) => {
    const send = (status, body, type = "application/json; charset=utf-8") => {
      response.writeHead(status, {
        "Content-Type": type,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        "Content-Security-Policy":
          "default-src 'self'; img-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
      });
      response.end(
        typeof body === "string" || Buffer.isBuffer(body)
          ? body
          : JSON.stringify(body),
      );
    };
    try {
      const url = new URL(request.url, "http://localhost");
      const path = url.pathname;
      if (deviceToken) {
        const key = url.searchParams.get("key");
        if (key !== null) {
          if (!sameSecret(key, accessKey)) {
            send(403, "Invalid access link.", "text/plain; charset=utf-8");
            return;
          }
          url.searchParams.delete("key");
          response.writeHead(303, {
            Location: `${path}${url.search}`,
            "Set-Cookie": `access=${deviceToken}; Max-Age=${deviceCookieMaxAge}; Path=/; HttpOnly; Secure; SameSite=Lax`,
            "Cache-Control": "no-store",
            "Referrer-Policy": "no-referrer",
          });
          response.end();
          return;
        }
        const cookie =
          (request.headers.cookie ?? "")
            .split(/;\s*/)
            .find((part) => part.startsWith("access="))
            ?.slice("access=".length) ?? "";
        if (!sameSecret(cookie, deviceToken)) {
          send(
            401,
            "Open your private access link once on this device.",
            "text/plain; charset=utf-8",
          );
          return;
        }
      }
      if (request.method === "POST" && path === "/api/review") {
        if (
          request.headers.origin &&
          request.headers.origin !== publicOrigin &&
          request.headers.origin !== `http://${request.headers.host}` &&
          request.headers.origin !== `https://${request.headers.host}`
        ) {
          send(403, { error: "Cross-origin reviews are not allowed." });
          return;
        }
        const chunks = [];
        let size = 0;
        for await (const chunk of request) {
          size += chunk.length;
          if (size > 256 * 1024) {
            send(413, {
              error: "The shopping list is too large (maximum 256 KB).",
            });
            return;
          }
          chunks.push(chunk);
        }
        let input;
        try {
          input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        } catch {
          send(400, { error: "Send a JSON shopping list." });
          return;
        }
        if (typeof input?.text !== "string" || !input.text.trim()) {
          send(400, { error: "Enter a shopping list before reviewing." });
          return;
        }
        const [products, decisions] = await Promise.all([
          readFile(new URL("data/products.json", root), "utf8"),
          readFile(new URL("data/approved-list.json", root), "utf8"),
        ]);
        const review = buildReviewForInput(
          input.text,
          JSON.parse(products),
          JSON.parse(decisions),
        );
        const savedList = await saveShoppingList(
          input.text,
          historyDirectory,
          now(),
        );
        send(200, { ...review, savedList });
        return;
      }
      if (request.method === "GET" && path === "/api/household") {
        const { config, state, receipts } =
          await readHouseholdInputs(householdDirectory);
        const report = buildHouseholdReview(
          config,
          receipts,
          state,
          localDate(now()),
        );
        // Display fields only: receipt rows and file names stay on the server.
        send(200, {
          on: report.on,
          warnings: report.issues.length,
          items: report.items.map((item) => ({
            name: item.name,
            label: householdStatusLabels[item.status] ?? "Needs review",
            attention: Boolean(item.question || item.checkOffers),
            question: item.question,
            lastPurchasedOn: item.lastPurchasedOn,
            dueOn: item.dueOn,
            checkOffers: item.checkOffers,
          })),
        });
        return;
      }
      if (request.method === "GET" && assets.has(path)) {
        const [file, type] = assets.get(path);
        send(200, await readFile(new URL(file, root)), type);
        return;
      }
      send(404, { error: "Not found." });
    } catch (error) {
      console.error("Review request failed:", error.message);
      if (!response.headersSent)
        send(500, {
          error:
            "Could not save or build the review. Check the server data files and shopping-lists directory permissions, then try again.",
        });
    }
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const host = process.env.HOST ?? "127.0.0.1";
  const port = Number(process.env.PORT ?? 3000);
  const server = createReviewServer({
    publicOrigin: process.env.PUBLIC_ORIGIN,
    accessKey: process.env.ACCESS_KEY || undefined,
  });
  server.on("error", (error) => {
    console.error(`Server failed: ${error.message}`);
    process.exitCode = 1;
  });
  server.listen(port, host, () =>
    console.log(`Shopping review: http://${host}:${server.address().port}`),
  );
}
