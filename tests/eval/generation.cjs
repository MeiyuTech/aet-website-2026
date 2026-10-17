const assert = require("node:assert/strict");
const { createLoader } = require("./support/loader.cjs");
const load = createLoader();
const { assembleGeneration, sourceCatalog } = load(
  "lib/eval/domain/assemble-generation.ts",
);
const { buildSampleData } = load("lib/eval/domain/report.ts");
const { isEmptyReport } = load("lib/eval/domain/generation.ts");
const { requiredReviewFields } = load("lib/eval/templates/course-by-course.ts");
const doc = { id: "file-1", name: "Synthetic transcript.pdf" };
const extracted = {
  "file-1": {
    name: "Synthetic Applicant",
    dob: "",
    country: "USA",
    documentTitle: "Transcript",
    issuedBy: "Fictional College",
    dateIssued: "",
    certificateNo: "",
    evidence: [],
    issues: [],
    credentials: [
      {
        awardingInstitution: "Fictional College",
        program: "Computing",
        country: "USA",
        admissionRequirements: "",
        grantsAccessTo: "",
        standardProgramLength: "",
        yearsAttended: "",
        yearOfGraduation: "",
        courses: [
          {
            name: "Original course",
            year: "2021",
            level: "UG",
            credits: "3.00",
            grade: "85",
            page: 1,
            quote: "Original course 3.00 85",
          },
        ],
      },
    ],
  },
};
const proposal = {
  credentials: [
    {
      sourceIds: ["file-1:credential:0"],
      equivalenceStatement: "Proposed equivalency",
      creditBasis: "Review basis",
      courses: [
        {
          sourceIds: ["file-1:credential:0:course:0"],
          usGrade: "A",
          usCredits: "3",
          reason: "Proposed conversion",
        },
      ],
    },
  ],
  evaluationNotes: "Review required",
  issues: [],
};
let count = 0;
function check(name, fn) {
  fn();
  count++;
  console.log("PASS " + name);
}
check(
  "generation preserves original course values and computes GPA without model totals",
  () => {
    const r = assembleGeneration(buildSampleData(), [doc], extracted, proposal);
    const c = r.draft.credentials[0];
    assert.equal(c.courses[0].grade, "85");
    assert.equal(c.courses[0].credits, "3.00");
    assert.equal(c.courses[0].name, "Original course");
    assert.equal(c.gpa, "4.00");
    assert.equal(c.courses[0].conversionSource, "AI_INFERRED");
    assert.equal(r.draft.evidence[0].refs[0].docId, doc.id);
    assert.equal(r.draft.evaluatorSignature, "");
    assert.ok(r.issues.length);
  },
);
check("omitted, invented and repeated source courses are rejected", () => {
  for (const courses of [
    [],
    [{ ...proposal.credentials[0].courses[0], sourceIds: ["invented"] }],
    [...proposal.credentials[0].courses, ...proposal.credentials[0].courses],
  ]) {
    assert.throws(() =>
      assembleGeneration(buildSampleData(), [doc], extracted, {
        ...proposal,
        credentials: [{ ...proposal.credentials[0], courses }],
      }),
    );
  }
});
check("conflicting duplicate courses cannot silently merge", () => {
  const e = structuredClone(extracted);
  e[doc.id].credentials[0].courses.push({
    ...e[doc.id].credentials[0].courses[0],
    grade: "90",
  });
  const p = structuredClone(proposal);
  p.credentials[0].courses[0].sourceIds.push("file-1:credential:0:course:1");
  assert.throws(
    () => assembleGeneration(buildSampleData(), [doc], e, p),
    /cannot be merged/,
  );
});
check(
  "an explicitly missing US conversion never falls back to source credits",
  () => {
    const p = structuredClone(proposal);
    p.credentials[0].courses[0].usCredits = "";
    const result = assembleGeneration(buildSampleData(), [doc], extracted, p);
    assert.equal(result.draft.credentials[0].totalCredits, "0.00");
    assert.equal(result.draft.credentials[0].gpa, "N/A");
  },
);
check(
  "even partial human credential fields prevent automatic application",
  () => {
    const d = buildSampleData();
    assert.equal(isEmptyReport(d), true);
    d.credentials[0].admissionRequirements = "Human review";
    assert.equal(isEmptyReport(d), false);
  },
);
check(
  "approval blocks unknown grades, empty credentials and missing equivalencies",
  () => {
    const { draft } = assembleGeneration(
      buildSampleData(),
      [doc],
      extracted,
      proposal,
    );
    assert.deepEqual(requiredReviewFields(draft), []);
    draft.credentials[0].courses[0].usGrade = "UNKNOWN";
    assert.ok(requiredReviewFields(draft).length);
    draft.credentials = [];
    assert.ok(requiredReviewFields(draft).length);
  },
);
async function testRunner() {
  const calls = [];
  let state = {
    id: "run",
    report_id: "report",
    lease_token: "lease",
    materials: [doc],
    checkpoints: structuredClone(extracted),
    baseline_content: buildSampleData(),
    baseline_updated_at: "stamp",
    auto_apply: true,
    attempts: 1,
    calls: 1,
    template: {},
    rules: {},
    model: "test",
  };
  const repo = {
    checkpoint: async (run, step, options = {}) => {
      calls.push({ step, options });
      state = {
        ...state,
        step,
        ...options,
        calls: state.calls + (options.spend ? 1 : 0),
      };
      return state;
    },
    applyDraft: async () => {
      calls.push({ applied: true });
    },
    claim: async () => state,
  };
  const runner = createLoader({
    "lib/eval/server/repositories/generation.ts": repo,
    "lib/eval/server/models/openai.ts": {
      openaiGenerate: async () => proposal,
      ModelError: class extends Error {},
    },
    "lib/eval/server/services/documents.ts": {
      readSource: async () => {
        throw Error("Completed extraction was re-read");
      },
    },
  })("lib/eval/server/agent/runner.ts");
  await runner.executeRun(state);
  assert.ok(calls.some((c) => c.options?.status === "needs_review"));
  assert.ok(calls.some((c) => c.applied));
  assert.equal(calls.filter((c) => c.options?.spend).length, 1);
  console.log(
    "PASS worker resumes saved extraction and only applies after validated completion",
  );
  count++;
  const failures = [];
  class ModelError extends Error {
    constructor() {
      super("Rate limited");
      this.retryable = true;
    }
  }
  const failing = createLoader({
    "lib/eval/server/repositories/generation.ts": {
      ...repo,
      checkpoint: async (run, step, options = {}) => {
        failures.push(options);
        return { ...run, ...options };
      },
    },
    "lib/eval/server/models/openai.ts": {
      openaiGenerate: async () => {
        throw new ModelError();
      },
      ModelError,
    },
    "lib/eval/server/services/documents.ts": {},
  })("lib/eval/server/agent/runner.ts");
  await failing.executeRun({ ...state, attempts: 1, calls: 1 });
  assert.equal(failures.at(-1).status, "queued");
  await failing.executeRun({ ...state, attempts: 3, calls: 1 });
  assert.equal(failures.at(-1).status, "failed");
  console.log("PASS transient errors retry within a bounded attempt budget");
  count++;
}

async function testReview() {
  const { draft } = assembleGeneration(
    buildSampleData(),
    [doc],
    extracted,
    proposal,
  );
  const record = {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Synthetic",
    content: draft,
    updated_at: "2026-10-17T00:00:00.000Z",
  };
  let revision = 1,
    newest = "22222222-2222-4222-8222-222222222222",
    approved = 0;
  const run = {
    id: newest,
    report_id: record.id,
    result: {
      draft,
      issues: [{ id: "review-0", message: "Check sources", kind: "review" }],
    },
  };
  const approval = {
    run_id: run.id,
    material_revision: 1,
    report_updated_at: record.updated_at,
    content: draft,
  };
  const service = createLoader({
    "lib/eval/server/services/reports.ts": { getReport: async () => record },
    "lib/eval/server/repositories/generation.ts": {
      documents: async () => [],
      materialRevision: async () => revision,
      runs: async () => [{ ...run, id: newest }],
      latestApproval: async () => approval,
      findRun: async () => run,
      approve: async () => {
        approved++;
        return approval;
      },
    },
    "lib/eval/server/models/openai.ts": {
      openaiReady: () => true,
      openaiModel: () => "test",
    },
    "lib/eval/server/services/exports.ts": {
      exportReport: async () => Buffer.from("approved"),
    },
  })("lib/eval/server/services/generation.ts");
  assert.equal((await service.workflowState(record.id)).approvalCurrent, true);
  record.updated_at = "2026-10-17T00:01:00.000Z";
  await assert.rejects(
    () => service.approvedExport(record.id),
    /current human approval/,
  );
  record.updated_at = approval.report_updated_at;
  revision = 2;
  assert.equal((await service.workflowState(record.id)).approvalCurrent, false);
  revision = 1;
  newest = "33333333-3333-4333-8333-333333333333";
  assert.equal((await service.workflowState(record.id)).approvalCurrent, false);
  console.log(
    "PASS approved exports invalidate on saved edits, material revisions or newer runs",
  );
  count++;
  const body = {
    runId: run.id,
    expectedUpdatedAt: record.updated_at,
    reviewer: "Synthetic reviewer",
    notes: "Reviewed",
    acknowledgedIssues: [],
    confirmed: true,
  };
  await assert.rejects(
    () => service.approveReport(record.id, body),
    /acknowledge every review item/,
  );
  assert.equal(approved, 0);
  await service.approveReport(record.id, {
    ...body,
    acknowledgedIssues: ["review-0"],
  });
  assert.equal(approved, 1);
  record.content.credentials[0].courses[0].usCredits = "";
  await assert.rejects(
    () =>
      service.approveReport(record.id, {
        ...body,
        acknowledgedIssues: ["review-0"],
      }),
    /missing or invalid/,
  );
  assert.equal(approved, 1);
  console.log(
    "PASS approval service requires issue acknowledgment and complete conversions before persistence",
  );
  count++;
  await assert.rejects(
    () =>
      service.generationAction(record.id, {
        action: "confirm",
        id: run.id,
        revision: 1,
        expectedUpdatedAt: record.updated_at,
        confirmed: false,
      }),
    /Confirm that all source files/,
  );
  console.log(
    "PASS generation cannot start without explicit upload-complete confirmation",
  );
  count++;
}
testRunner()
  .then(testReview)
  .then(() =>
    console.log(`${count} generation checks passed; no external calls.`),
  )
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
