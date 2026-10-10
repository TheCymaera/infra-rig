import { spawn } from "node:child_process";

export interface CommandResult {
	stdout: string;
	stderr: string;
	exitCode: number;
}

export class CommandError extends Error {
	/** The command as it appears in the message. */
	readonly command: string;
	readonly result: CommandResult;

	constructor(command: string | readonly string[], result: CommandResult) {
		const display = typeof command === "string" ? command : command.join(" ");
		const tail = (result.stderr.trim() || result.stdout.trim()).split("\n").slice(-8).join("\n");
		super(`\`${display}\` exited with code ${result.exitCode}${tail ? `\n${tail}` : ""}`);
		this.name = "CommandError";
		this.command = display;
		this.result = result;
	}
}

export interface SpawnOptions {
	silent?: boolean;
	/** Text to write to the command's stdin. */
	stdin?: string;
	cwd?: string;
}

export const shell = {
	exec(argv: readonly string[], options: SpawnOptions = {}): Promise<CommandResult> {
		return spawnCommand(argv, options);
	},

	async which(binary: string): Promise<string | undefined> {
		const result = await spawnCommand(["which", binary], { silent: true });
		if (result.exitCode !== 0) return undefined;
		return result.stdout.trim().split("\n")[0];
	},

	/** Wraps a value so a POSIX shell hands it to the command unchanged. */
	quote(value: string): string {
		return `'${value.replaceAll("'", "'\\''")}'`;
	},

	/** Wraps a script in `set -euo pipefail`. */
	strict(script: string): string {
		return `set -euo pipefail\n${script.trim()}\n`;
	}
};

export function sh(strings: TemplateStringsArray, ...values: (string | number)[]): string {
	let script = strings[0] ?? "";

	for (const [index, value] of values.entries()) {
		script += shell.quote(String(value)) + (strings[index + 1] ?? "");
	}

	return script;
}

function spawnCommand(argv: readonly string[], options: SpawnOptions): Promise<CommandResult> {
	return new Promise((resolve, reject) => {
		const child = spawn(argv[0]!, argv.slice(1), {
			cwd: options.cwd,
			stdio: [options.stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"]
		});

		let stdout = "";
		let stderr = "";

		child.stdout?.on("data", (chunk: Buffer) => {
			stdout += chunk;
			if (!options.silent) process.stdout.write(chunk);
		});
		child.stderr?.on("data", (chunk: Buffer) => {
			stderr += chunk;
			if (!options.silent) process.stderr.write(chunk);
		});

		child.once("error", reject);
		child.once("close", (code) => resolve({ stdout, stderr, exitCode: code ?? 1 }));

		if (options.stdin !== undefined) child.stdin?.end(options.stdin);
	});
}
