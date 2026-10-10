import { shell, type CommandResult } from "../primitives/shell.js";
import type { ExecOptions, Transport } from "./transport.js";

export interface DockerTarget {
	container: string;
}

export class DockerTransport implements Transport {
	readonly label: string;

	private readonly container: string;

	constructor(target: DockerTarget) {
		this.container = target.container;
		this.label = `docker exec ${target.container}`;
	}

	async exec(script: string, options?: ExecOptions): Promise<CommandResult> {
		return shell.exec(this.execArgv(script, options), {
			silent: options?.silent,
			stdin: options?.stdin
		});
	}

	private execArgv(script: string, options?: Pick<ExecOptions, "sudo">): string[] {
		return [
			"docker",
			"exec",
			"-i",
			this.container,
			...(options?.sudo ? ["sudo", "-n"] : []),
			"bash",
			"-c",
			shell.strict(script)
		];
	}
}
