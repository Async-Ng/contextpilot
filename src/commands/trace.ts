import { loadConfig } from "../core/config-io";
import { getRunById, getActiveRun, listEvents } from "../core/orchestration";
import { EXIT_GENERAL, EXIT_OK, errOut, out, requireHarness } from "../core/io";

export function runTraceExport(options: { format?: string; run?: string }): void {
  const harnessDir = requireHarness();
  if (options.format !== "otlp-json") {
    errOut("Trace export requires --format otlp-json.", { error: "unsupported_trace_format" });
    process.exit(EXIT_GENERAL);
  }
  const config = loadConfig(harnessDir);
  if (config.observability.mode === "off") {
    errOut("Observability is disabled.", { error: "observability_disabled" });
    process.exit(EXIT_GENERAL);
  }
  const run = options.run ? getRunById(harnessDir, options.run) : getActiveRun(harnessDir);
  if (!run) {
    errOut("Run not found.", { error: "run_not_found" });
    process.exit(EXIT_GENERAL);
  }
  const spans = listEvents(harnessDir).filter((event) => event.runId === run.id).map((event) => ({
    traceId: event.traceId ?? `trace_${run.id}`,
    spanId: event.spanId ?? event.id,
    name: `contextpilot.${event.type}`,
    startTime: event.createdAt,
    attributes: {
      "gen_ai.agent.name": "contextpilot",
      "gen_ai.conversation.id": run.id,
      "contextpilot.step_id": event.stepId,
      "contextpilot.outcome": event.outcome,
      "contextpilot.error_category": event.errorCategory,
    },
  }));
  out(`Exported ${spans.length} trace span(s).`, { resourceSpans: [{ resource: { attributes: { "service.name": "contextpilot" } }, scopeSpans: [{ spans }] }] });
  process.exit(EXIT_OK);
}
