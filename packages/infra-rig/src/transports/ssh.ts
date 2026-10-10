import { shell, type CommandResult } from "../primitives/shell.js";
import { type ExecOptions, type Transport } from "./transport.js";
import type { RsyncEndpoint } from "../primitives/rsync.js";

export interface SshTarget {
	host: string;
	user: string;
	port: number;
	identityFile?: string;
	knownHostsFile?: string;
}

export class SshTransport implements Transport {
	readonly label: string;
	readonly host: string;
	readonly user: string;
	readonly port: number;

	private readonly destination: string;
	private readonly sshOptions: readonly string[];

	constructor(target: SshTarget) {
		this.host = target.host;
		this.user = target.user;
		this.port = target.port;
		this.destination = `${target.user}@${target.host}`;
		this.sshOptions = [
			"-o", "BatchMode=yes",
			"-o", "StrictHostKeyChecking=accept-new",
			"-o", "ConnectTimeout=15",
			...(target.knownHostsFile ? ["-o", `UserKnownHostsFile=${target.knownHostsFile}`] : []),
			...(target.identityFile ? ["-i", target.identityFile] : []),
			"-p", String(target.port)
		];
		this.label = `ssh ${this.destination}:${this.port}`;
	}

	async exec(script: string, options?: ExecOptions): Promise<CommandResult> {
		return shell.exec(this.sshArgv(script, options), {
			silent: options?.silent,
			stdin: options?.stdin
		});
	}

	rsyncEndpoint(path: string): RsyncEndpoint {
		return {
			argument: `${this.destination}:${path}`,
			rsh: ["ssh", ...this.sshOptions].join(" ")
		};
	}

	private sshArgv(script: string, options?: Pick<ExecOptions, "sudo">): string[] {
		return ["ssh", ...this.sshOptions, this.destination, wrapScript(script, options)];
	}
}



function wrapScript(script: string, options?: Pick<ExecOptions, "sudo">): string {
	const command = `bash -c ${shell.quote(shell.strict(script))}`;
	return options?.sudo ? `sudo -n ${command}` : command;
}
