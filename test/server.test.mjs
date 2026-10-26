import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { buildReviewForInput } from "../lib/approved-list.mjs";
import { createReviewServer } from "../server.mjs";

test("website reviews save dated versions without changing source data", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "shopping-review-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const historyDirectory = pathToFileURL(`${directory}/`);
  let date = new Date(2026, 9, 23, 12);
  const server = createReviewServer({
    historyDirectory,
    now: () => date,
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const files = ["shopping_list", "products.json", "approved-list.json"].map(
    (file) => new URL(`../data/${file}`, import.meta.url),
  );
  const before = await Promise.all(files.map((file) => readFile(file, "utf8")));
  const saved = { text: before[0] };
  for (const [path, contentType] of [
    ["/", "text/html"],
    ["/app.css", "text/css"],
    ["/app.js", "text/javascript"],
  ]) {
    const response = await fetch(`${base}${path}`);
    assert.equal(response.status, 200);
    assert.ok(response.headers.get("content-type").startsWith(contentType));
    assert.match(
      response.headers.get("content-security-policy"),
      /default-src 'self'/,
    );
    assert.ok((await response.text()).length > 0);
  }
  for (const text of [saved.text, "200 g pomodori\n1 mystery ingredient"]) {
    const response = await fetch(`${base}/api/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    assert.equal(response.status, 200);
    const { savedList, ...review } = await response.json();
    assert.match(savedList, /^2026-10-23-v\d+\.txt$/);
    assert.equal(
      await readFile(new URL(savedList, historyDirectory), "utf8"),
      text,
    );
    assert.deepEqual(
      review,
      buildReviewForInput(text, JSON.parse(before[1]), JSON.parse(before[2])),
    );
  }
  assert.deepEqual((await readdir(directory)).sort(), [
    "2026-10-23-v1.txt",
    "2026-10-23-v2.txt",
  ]);
  const concurrent = await Promise.all(
    Array.from({ length: 4 }, async () => {
      const response = await fetch(`${base}/api/review`, {
        method: "POST",
        body: JSON.stringify({ text: saved.text }),
      });
      assert.equal(response.status, 200);
      return (await response.json()).savedList;
    }),
  );
  assert.deepEqual(
    concurrent.sort(),
    [3, 4, 5, 6].map((version) => `2026-10-23-v${version}.txt`),
  );
  for (const filename of concurrent)
    assert.equal(
      await readFile(new URL(filename, historyDirectory), "utf8"),
      saved.text,
    );
  date = new Date(2026, 9, 24, 12);
  const nextDay = await fetch(`${base}/api/review`, {
    method: "POST",
    body: JSON.stringify({ text: saved.text }),
  });
  assert.equal(nextDay.status, 200);
  assert.equal((await nextDay.json()).savedList, "2026-10-24-v1.txt");
  assert.equal(
    await readFile(new URL("2026-10-24-v1.txt", historyDirectory), "utf8"),
    saved.text,
  );
  for (const body of ["bad json", "{}", '{"text":"  "}']) {
    assert.equal(
      (await fetch(`${base}/api/review`, { method: "POST", body })).status,
      400,
    );
  }
  assert.equal(
    (
      await fetch(`${base}/api/review`, {
        method: "POST",
        headers: { Origin: "https://unrelated.example" },
        body: JSON.stringify({ text: saved.text }),
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await fetch(`${base}/api/review`, {
        method: "POST",
        body: "x".repeat(256 * 1024 + 1),
      })
    ).status,
    413,
  );
  for (const path of [
    "/api/list",
    "/shopping-lists/2026-10-23-v1.txt",
    "/products.json",
    "/approved-list.json",
    "/fakturas/21-10-2026.txt",
    "/data/products.json",
    "/data/fakturas/21-10-2026.txt",
    "/unknown",
  ]) {
    assert.equal((await fetch(`${base}${path}`)).status, 404);
  }
  assert.equal((await readdir(directory)).length, 7);
  assert.deepEqual(
    await Promise.all(files.map((file) => readFile(file, "utf8"))),
    before,
  );
});

test("a configured public origin may review through a proxy", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "shopping-review-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const server = createReviewServer({
    historyDirectory: pathToFileURL(`${directory}/`),
    publicOrigin: "https://shop.example",
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const review = (origin) =>
    fetch(`http://127.0.0.1:${server.address().port}/api/review`, {
      method: "POST",
      headers: { Origin: origin },
      body: JSON.stringify({ text: "200 g pomodori" }),
    });
  assert.equal((await review("https://shop.example")).status, 200);
  assert.equal((await review("https://unrelated.example")).status, 403);
  assert.equal((await readdir(directory)).length, 1);
});

test("an access key admits only devices that opened the private link", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "shopping-review-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const server = createReviewServer({
    historyDirectory: pathToFileURL(`${directory}/`),
    accessKey: "correct-key",
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = (path, cookie) =>
    fetch(`${base}${path}`, {
      redirect: "manual",
      headers: cookie ? { Cookie: cookie } : {},
    });
  assert.equal((await get("/")).status, 401);
  assert.equal((await get("/?key=wrong")).status, 403);
  assert.equal((await get("/", "access=forged")).status, 401);
  const login = await get("/?key=correct-key");
  assert.equal(login.status, 303);
  assert.equal(login.headers.get("location"), "/");
  const setCookie = login.headers.get("set-cookie");
  assert.match(setCookie, /Max-Age=31536000;.*HttpOnly; Secure; SameSite=Lax/);
  const cookie = setCookie.split(";")[0];
  assert.equal((await get("/", cookie)).status, 200);
  const review = (headers) =>
    fetch(`${base}/api/review`, {
      method: "POST",
      headers,
      body: JSON.stringify({ text: "200 g pomodori" }),
    });
  assert.equal((await review({})).status, 401);
  assert.equal((await review({ Cookie: cookie })).status, 200);
  assert.equal((await readdir(directory)).length, 1);
  const rotated = createReviewServer({ accessKey: "new-key" });
  rotated.listen(0, "127.0.0.1");
  await once(rotated, "listening");
  context.after(() => new Promise((resolve) => rotated.close(resolve)));
  assert.equal(
    (
      await fetch(`http://127.0.0.1:${rotated.address().port}/`, {
        headers: { Cookie: cookie },
      })
    ).status,
    401,
  );
});

test("household supplies are shown read-only without receipt details", async (context) => {
  const server = createReviewServer({ now: () => new Date(2026, 9, 23, 12) });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(`${base}/api/household`);
  assert.equal(response.status, 200);
  const body = await response.text();
  const data = JSON.parse(body);
  assert.equal(data.on, "2026-10-23");
  assert.ok(data.items.length > 0);
  for (const item of data.items) {
    assert.deepEqual(Object.keys(item).sort(), [
      "attention",
      "checkOffers",
      "dueOn",
      "label",
      "lastPurchasedOn",
      "name",
      "question",
    ]);
    assert.equal(typeof item.label, "string");
  }
  assert.doesNotMatch(body, /fakturas|\.txt|\d{7}/);
  assert.equal(
    (await fetch(`${base}/api/household`, { method: "POST" })).status,
    404,
  );
});

test("a failed history save does not return a successful review", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "shopping-review-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const blocked = join(directory, "blocked");
  await writeFile(blocked, "not a directory");
  const server = createReviewServer({
    historyDirectory: pathToFileURL(`${blocked}/`),
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const response = await fetch(
    `http://127.0.0.1:${server.address().port}/api/review`,
    {
      method: "POST",
      body: JSON.stringify({ text: "200 g pomodori" }),
    },
  );
  assert.equal(response.status, 500);
  const result = await response.json();
  assert.match(result.error, /Could not save/);
  assert.equal(result.savedList, undefined);
  assert.equal(result.importUrl, undefined);
  assert.equal(await readFile(blocked, "utf8"), "not a directory");
});
