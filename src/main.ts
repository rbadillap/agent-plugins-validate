import { readContext } from "./context.ts";
import { realIo } from "./report/io.ts";
import { run } from "./run.ts";

/** Entry point: reads the inputs and the environment, runs the Action, sets the exit code. */
export async function main(): Promise<void> {
  const context = readContext(process.env);
  process.exitCode = await run(context, { io: realIo });
}

await main();
