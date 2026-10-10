import { CommandError, shell } from "./shell.js";

export interface RsyncEndpoint {
	readonly argument: string;
	readonly rsh?: string;
}

export interface RsyncOptions {
	from: RsyncEndpoint;
	to: RsyncEndpoint;
	delete?: boolean;
	include?: string[];
	exclude?: string[];
	mkpath?: boolean;
}

export async function rsync(options: RsyncOptions): Promise<void> {
	const argv = ["rsync", "-az", "--human-readable"];
	if (options.mkpath) argv.push("--mkpath");
	if (options.delete) argv.push("--delete");
	for (const pattern of options.include ?? []) argv.push("--include", pattern);
	for (const pattern of options.exclude ?? []) argv.push("--exclude", pattern);

	const rsh = sharedRsh(options.from, options.to);
	if (rsh) argv.push("--rsh", rsh);

	argv.push(options.from.argument, options.to.argument);

	const result = await shell.exec(argv);
	if (result.exitCode !== 0) throw new CommandError(argv, result);
}

function sharedRsh(from: RsyncEndpoint, to: RsyncEndpoint): string | undefined {
	if (from.rsh === undefined) return to.rsh;
	if (to.rsh === undefined || to.rsh === from.rsh) return from.rsh;

	throw new Error("rsync cannot reach two sides over different ssh options.");
}
