import { shell, type CommandResult } from "../primitives/shell.js";
import { type ExecOptions, type Transport } from "./transport.js";
import type { RsyncEndpoint } from "../primitives/rsync.js";

export interface LocalTarget {
	cwd?: string;
}

export class LocalTransport implements Transport {
	readonly label: string;

	private readonly cwd: string | undefined;

	constructor(target: LocalTarget = {}) {
		this.cwd = target.cwd;
		this.label = target.cwd === undefined ? "local shell" : `local shell (${target.cwd})`;
	}

	async exec(script: string, options?: ExecOptions): Promise<CommandResult> {
		const argv = [...(options?.sudo ? ["sudo", "-n"] : []), "bash", "-c", shell.strict(script)];

		return shell.exec(argv, {
			cwd: this.cwd,
			silent: options?.silent,
			stdin: options?.stdin
		});
	}

	rsyncEndpoint(path: string): RsyncEndpoint {
		return { argument: path };
	}
}
