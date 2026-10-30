import { Error, invariant } from "./errors.mjs";

function replacement(original, edits) {
  const distinct = new Map();
  for (const edit of edits) {
    invariant(
      edit.end <= original.length,
      "INVALID_FIX",
      "Fix range exceeds its captured snapshot.",
    );
    const key = `${edit.start}:${edit.end}:${Buffer.from(edit.replacement).toString("base64")}`;
    distinct.set(key, edit);
  }
  const ordered = [...distinct.values()].sort(
    (a, b) => a.start - b.start || a.end - b.end,
  );
  const parts = [];
  let end = 0;
  let previous;
  for (const edit of ordered) {
    invariant(
      !previous ||
        (edit.start >= previous.end && edit.start !== previous.start),
      "FIX_CONFLICT",
      "Conflicting fixes overlap in the same captured snapshot.",
    );
    parts.push(original.subarray(end, edit.start), edit.replacement);
    end = edit.end;
    previous = edit;
  }
  parts.push(original.subarray(end));
  return { bytes: Buffer.concat(parts), edits: ordered.length };
}

export async function fixRun(initial, recheck, dryRun) {
  const files = [...initial.unavailable];
  const errors = [...initial.report.errors];
  const groups = new Map();
  for (const plan of initial.plans) {
    const group = groups.get(plan.candidate.id);
    if (group) {
      group.plans.push(plan);
    } else {
      groups.set(plan.candidate.id, {
        candidate: plan.candidate,
        plans: [plan],
      });
    }
  }
  for (const group of [...groups.values()].sort((a, b) =>
    a.candidate.id < b.candidate.id ? -1 : 1,
  )) {
    const result = {
      candidateId: group.candidate.id,
      path: group.candidate.path,
    };
    files.push(result);
    try {
      const original = group.plans[0].original;
      invariant(
        group.plans.every((plan) =>
          Buffer.from(plan.original).equals(original),
        ),
        "INVALID_FIX",
        "Fixes do not share the same captured snapshot.",
      );
      invariant(
        !errors.some(
          (error) =>
            error.candidateId === undefined ||
            error.candidateId === group.candidate.id,
        ),
        "FIX_BLOCKED",
        "A failed check prevents fixing this file.",
      );
      const output = replacement(
        original,
        group.plans.flatMap((plan) => plan.edits),
      );
      result.edits = output.edits;
      if (!initial.fixer) {
        Object.assign(result, {
          status: "unavailable",
          reason: "The selected source does not support writes.",
        });
        continue;
      }
      const request = {
        candidate: group.candidate,
        original,
        replacement: output.bytes,
      };
      await initial.fixer.validate(request);
      if (output.bytes.equals(original)) {
        result.status = "unchanged";
      } else if (dryRun) {
        result.status = "proposed";
      } else {
        await initial.fixer.apply(request);
        result.status = "applied";
      }
    } catch (error) {
      const detail = {
        phase: "fix",
        candidateId: group.candidate.id,
        path: group.candidate.path,
        code: error instanceof Error ? error.code : "FIX_FAILED",
        message:
          error instanceof globalThis.Error
            ? error.message
            : "Fixer threw a non-Error value.",
      };
      errors.push(detail);
      Object.assign(result, { status: "failed", reason: detail.message });
    }
  }
  const applied = files.filter((file) => file.status === "applied").length;
  const report = applied ? await recheck() : initial.report;
  report.errors = [
    ...new Map(
      [...errors, ...report.errors].map((error) => [
        JSON.stringify(error),
        error,
      ]),
    ).values(),
  ];
  if (report.errors.length) {
    report.status = "error";
    report.exitCode = 2;
    delete report.emptyReason;
  }
  report.fix = {
    dryRun,
    files,
    summary: {
      applied,
      proposed: files.filter((file) => file.status === "proposed").length,
      unavailable: files.filter((file) => file.status === "unavailable").length,
      failed: files.filter((file) => file.status === "failed").length,
    },
  };
  return report;
}
