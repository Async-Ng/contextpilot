import { writeFocus } from "../core/context";
import { EXIT_OK, exitMissingFlag, out, requireHarness } from "../core/io";

export interface FocusOptions {
  text?: string;
}

export function runFocus(argText: string | undefined, options: FocusOptions): void {
  const harnessDir = requireHarness();
  const text = options.text ?? argText;
  if (!text) {
    exitMissingFlag("--text", 'Provide focus text: contextpilot focus "task description"');
  }

  writeFocus(harnessDir, text);
  out("Focus updated.", { status: "focus_set" });
  process.exit(EXIT_OK);
}
