import { CommandError, type CommandResult } from "../primitives/shell.js";

export interface ExecOptions {
	sudo?: boolean;
	/** Suppress echoing the script's output to the terminal; it is still captured. */
	silent?: boolean;
	/** Text to write to the script's stdin. */
	stdin?: string;
}

export interface Transport {
	readonly label: string;
	exec(script: string, options?: ExecOptions): Promise<CommandResult>;
}

/** Runs a script, streaming its output to the terminal. Throws on a non-zero exit. */
export async function run(
	transport: Transport,
	script: string,
	options: ExecOptions = {}
): Promise<void> {
	const result = await transport.exec(script, { ...options, silent: options.silent ?? false });
	if (result.exitCode !== 0) throw new CommandError([transport.label, script], result);
}

/** Runs a script and returns its raw stdout. Throws on a non-zero exit. */
export async function capture(
	transport: Transport,
	script: string,
	options: ExecOptions = {}
): Promise<string> {
	const result = await transport.exec(script, { ...options, silent: options.silent ?? true });
	if (result.exitCode !== 0) throw new CommandError([transport.label, script], result);
	return result.stdout;
}

/** Runs a script and returns its result instead of throwing. Output is not shown. */
export async function tryRun(
	transport: Transport,
	script: string,
	options: ExecOptions = {}
): Promise<CommandResult> {
	return transport.exec(script, { ...options, silent: options.silent ?? true });
}
