const assert = require("node:assert/strict");
const { createLoader } = require("./support/loader.cjs");
let modelCalls = 0;
let modelResponses = [];
const load = createLoader({
  "lib/eval/server/models/gemini.ts": {
    generate: async () => {
      modelCalls++;
      if (modelResponses.length) return modelResponses.shift();
      return {
        reply: "Synthetic suggestion",
        changes: [
          { path: "name", value: "Suggested name", reason: "Synthetic" },
          {
            path: "evaluatorSignature",
            value: "forbidden",
            reason: "Synthetic",
          },
        ],
      };
    },
  },
});
const { handle } = load("lib/eval/server/http/handler.ts");
const { buildSampleData } = load("lib/eval/domain/report.ts");
const { analyzePdfWithGemini } = load("lib/eval/server/services/pdf.ts");
const { EVAL_PROJECT, EVAL_BUCKET } = load("lib/eval/server/config.ts");
const id = "56bb6c94-c28b-48af-beb6-0859c9e24519";
const stamp = "2026-10-17T00:00:00.000Z";
const content = buildSampleData();
const row = {
  id,
  name: "Synthetic report",
  content,
  updated_at: stamp,
  archived_at: null,
};
const input = { id, name: row.name, content, expectedUpdatedAt: stamp };
const calls = [];
let pending = [];
const originalFetch = global.fetch;
const keys = [
  "NODE_ENV",
  "EVAL_LOCAL_ENABLED",
  "EVAL_SUPABASE_URL",
  "EVAL_SUPABASE_SERVICE_ROLE_KEY",
];
const originalEnv = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
process.env.NODE_ENV = "development";
process.env.EVAL_LOCAL_ENABLED = "true";
process.env.EVAL_SUPABASE_URL = `https://${EVAL_PROJECT}.supabase.co`;
process.env.EVAL_SUPABASE_SERVICE_ROLE_KEY = "synthetic-test-key";
global.fetch = async (url, options = {}) => {
  calls.push({ url, options });
  assert.ok(
    pending.length,
    `Unexpected network access: ${new URL(url).pathname}`,
  );
  const next = pending.shift();
  return next instanceof Response ? next : Response.json(next);
};
function call(area, { method = "GET", body, headers = {}, query = "" } = {}) {
  return handle(
    new Request(`http://localhost:3023/api/admin/eval/${area}${query}`, {
      method,
      headers: {
        host: "localhost:3023",
        origin: "http://localhost:3023",
        ...headers,
      },
      ...(body === undefined
        ? {}
        : {
            body:
              body instanceof FormData || typeof body === "string"
                ? body
                : JSON.stringify(body),
          }),
    }),
    { params: Promise.resolve({ path: area ? area.split("/") : [] }) },
  );
}
let checks = 0;
async function test(name, fn) {
  calls.length = 0;
  pending = [];
  await fn();
  assert.equal(
    pending.length,
    0,
    "All expected external responses must be consumed",
  );
  checks++;
  console.log(`PASS ${name}`);
}
async function main() {
  await test("HTTP guards run before storage; failures keep private/no-store headers", async () => {
    for (const [headers, status] of [
      [{ host: "example.com" }, 404],
      [{ origin: "https://example.com" }, 403],
      [{ "sec-fetch-site": "cross-site" }, 403],
    ]) {
      const res = await call("reports", {
        method: "POST",
        body: input,
        headers,
      });
      assert.equal(res.status, status);
      assert.equal(res.headers.get("cache-control"), "no-store, private");
      assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    }
    assert.equal(calls.length, 0);
  });
  await test("unknown paths, invalid IDs, invalid JSON and oversized bodies fail without storage", async () => {
    assert.equal((await call("unknown")).status, 404);
    assert.equal((await call("reports/a/b")).status, 404);
    assert.equal((await call("reports/not-a-uuid")).status, 400);
    assert.equal(
      (await call("reports", { method: "POST", body: "{" })).status,
      400,
    );
    assert.equal(
      (
        await call("reports", {
          method: "POST",
          body: "x",
          headers: { "content-length": "3000000" },
        })
      ).status,
      413,
    );
    assert.equal(calls.length, 0);
  });
  await test("report list retains pagination and missing records return 404", async () => {
    pending = [Array.from({ length: 101 }, (_, i) => ({ id: i })), []];
    const res = await call("reports", { query: "?offset=100" });
    const result = await res.json();
    assert.equal(result.reports.length, 100);
    assert.equal(result.hasMore, true);
    assert.match(calls[0].url, /limit=101&offset=100$/);
    assert.equal((await call(`reports/${id}`)).status, 404);
  });
  await test("save stays one atomic RPC with the expected revision stamp", async () => {
    pending = [row];
    const res = await call("reports", { method: "POST", body: input });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), row);
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /rpc\/aet_eval_save_report$/);
    assert.deepEqual(JSON.parse(calls[0].options.body), {
      p_id: id,
      p_name: row.name,
      p_content: content,
      p_expected_updated_at: stamp,
    });
    assert.equal(calls[0].options.cache, "no-store");
  });
  await test("stale saves and archive changes retain 409 conflict protection", async () => {
    pending = [
      Response.json({ message: "EVAL_CONFLICT" }, { status: 400 }),
      { ...row, archived_at: stamp },
    ];
    const res = await call("reports", { method: "POST", body: input });
    assert.equal(res.status, 409);
    const archived = await call(`reports/${id}`, {
      method: "PATCH",
      body: { expectedUpdatedAt: stamp, archived: true },
    });
    assert.equal(archived.status, 200);
    assert.deepEqual(JSON.parse(calls[1].options.body), {
      p_id: id,
      p_expected_updated_at: stamp,
      p_archived: true,
    });
    assert.match(calls[1].url, /rpc\/aet_eval_set_archived$/);
  });
  await test("database errors do not leak backend details and revisions remain accessible", async () => {
    pending = [
      Response.json({ message: "private database detail" }, { status: 500 }),
      [row],
      [{ id, created_at: stamp }],
      [{ id, content }],
    ];
    const failed = await call("reports");
    assert.equal(failed.status, 502);
    assert.doesNotMatch(await failed.text(), /private database detail/);
    assert.equal((await call(`history/${id}`)).status, 200);
    const revision = await call(`revision/${id}`);
    assert.deepEqual((await revision.json()).content, content);
  });
  await test("private attachments reject traversal and executable media before delivery", async () => {
    assert.equal(
      (await call("attachments", { query: "?path=../../secret" })).status,
      400,
    );
    assert.equal(calls.length, 0);
    pending = [
      new Response("html", { headers: { "content-type": "text/html" } }),
      new Response("synthetic-image", {
        headers: { "content-type": "image/png" },
      }),
    ];
    assert.equal(
      (await call("attachments", { query: `?path=${id}/test.png` })).status,
      415,
    );
    const res = await call("attachments", { query: `?path=${id}/test.png` });
    assert.equal(res.status, 200);
    assert.equal(
      res.headers.get("content-security-policy"),
      "default-src 'none'; sandbox",
    );
    assert.equal(await res.text(), "synthetic-image");
  });
  await test("image upload validates bytes and preserves private non-upsert object paths", async () => {
    const form = new FormData();
    form.append(
      "file",
      new File(
        [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])],
        "synthetic.png",
        { type: "image/png" },
      ),
    );
    pending = [[row], new Response(null, { status: 200 })];
    const res = await call("attachments", {
      method: "POST",
      body: form,
      query: `?reportId=${id}`,
    });
    assert.equal(res.status, 200);
    const result = await res.json();
    assert.ok(result.path.startsWith(`${id}/`));
    assert.ok(result.url.startsWith("/api/admin/eval/attachments?path="));
    assert.equal(calls[1].options.headers["x-upsert"], "false");
    const invalid = new FormData();
    invalid.append(
      "file",
      new File(["not an image"], "fake.png", { type: "image/png" }),
    );
    pending = [[row]];
    assert.equal(
      (
        await call("attachments", {
          method: "POST",
          body: invalid,
          query: `?reportId=${id}`,
        })
      ).status,
      400,
    );
  });
  await test("AI rejects another report's attachment before model invocation", async () => {
    pending = [[row], []];
    const before = modelCalls;
    const res = await call("ai", {
      method: "POST",
      body: {
        reportId: id,
        content,
        message: "Synthetic request",
        imagePaths: ["00000000-0000-4000-8000-000000000000/image.png"],
      },
    });
    assert.equal(res.status, 400);
    assert.equal(modelCalls, before);
    assert.equal(calls.length, 2);
  });
  await test("AI proposals retain filtering and append both chat rows even with an empty DB response", async () => {
    pending = [[row], [], [], new Response(null, { status: 201 })];
    const before = JSON.stringify(content);
    const res = await call("ai", {
      method: "POST",
      body: {
        reportId: id,
        content,
        message: "Synthetic request",
        imagePaths: [],
      },
    });
    assert.equal(res.status, 200);
    const answer = await res.json();
    assert.deepEqual(
      answer.changes.map((c) => c.path),
      ["name"],
    );
    const inserted = JSON.parse(calls[3].options.body);
    assert.deepEqual(
      inserted.map((r) => r.role),
      ["user", "assistant"],
    );
    assert.ok(inserted.every((r) => r.report_id === id));
    assert.equal(JSON.stringify(content), before);
  });
  await test("chat is chronological and exposes only protected attachment URLs", async () => {
    const url = `https://${EVAL_PROJECT}.supabase.co/storage/v1/object/authenticated/${EVAL_BUCKET}/${id}/image.png`;
    pending = [
      [row],
      [
        { id: "new", image_urls: [url, "https://evil.example/image.png"] },
        { id: "old", image_urls: null },
      ],
    ];
    const rows = await (await call(`chat/${id}`)).json();
    assert.deepEqual(
      rows.map((r) => r.id),
      ["old", "new"],
    );
    assert.deepEqual(rows[0].image_urls, []);
    assert.deepEqual(rows[1].image_urls, [
      `/api/admin/eval/attachments?path=${encodeURIComponent(`${id}/image.png`)}`,
    ]);
  });
  await test("non-PDF uploads are rejected before model invocation", async () => {
    const form = new FormData();
    form.append(
      "file",
      new File(["invalid"], "fake.pdf", { type: "application/pdf" }),
    );
    const before = modelCalls;
    assert.equal(
      (await call("parse", { method: "POST", body: form })).status,
      400,
    );
    assert.equal(modelCalls, before);
    assert.equal(calls.length, 0);
  });
  await test("two-stage PDF conversion preserves extracted facts and rejects missing courses", async () => {
    const raw = {
      name: "Source name",
      dob: "",
      country: "Source country",
      documents: [],
      detectedLanguage: "en",
      credentials: [
        {
          program: "Source program",
          courses: [{ name: "Source course", grade: "85", credits: "4" }],
        },
      ],
    };
    modelResponses = [
      structuredClone(raw),
      {
        ...structuredClone(raw),
        name: "Invented name",
        credentials: [
          {
            program: "Invented program",
            courses: [
              {
                name: "Invented course",
                grade: "100",
                credits: "8",
                usGrade: "A",
                usCredits: "3",
              },
            ],
          },
        ],
      },
    ];
    pending = [[]];
    const result = await analyzePdfWithGemini(new ArrayBuffer(0));
    assert.equal(result.data.name, raw.name);
    assert.equal(result.data.credentials[0].program, "Source program");
    assert.equal(result.data.credentials[0].courses[0].grade, "85");
    assert.equal(result.data.credentials[0].courses[0].usGrade, "A");
    modelResponses = [structuredClone(raw), { credentials: [{ courses: [] }] }];
    pending = [[]];
    await assert.rejects(
      () => analyzePdfWithGemini(new ArrayBuffer(0)),
      (e) => e.status === 502,
    );
  });
  console.log(`${checks} server checks passed; external services were mocked.`);
}
main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    global.fetch = originalFetch;
    for (const [key, value] of Object.entries(originalEnv))
      value === undefined
        ? delete process.env[key]
        : (process.env[key] = value);
  });
