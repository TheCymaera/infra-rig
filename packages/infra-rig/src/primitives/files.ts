import { shell, sh } from "./shell.js";
import { run, capture, type Transport } from "../transports/transport.js";

export interface FileOptions {
	sudo?: boolean;
	mode?: string;
	owner?: string;
	group?: string;
}

export const files = {
	async write(
		transport: Transport,
		to: string,
		content: string,
		options: FileOptions = {}
	): Promise<void> {
		const flags = [ "-D", `-m ${options.mode ?? "0644"}`];
		if (options.owner) flags.push(`-o ${shell.quote(options.owner)}`);
		if (options.group) flags.push(`-g ${shell.quote(options.group)}`);

		const script = [
			`temp="$(mktemp)"`,
			`trap 'rm -f "$temp"' EXIT`,
			`cat > "$temp"`,
			`install ${flags.join(" ")} "$temp" ${shell.quote(to)}`
		].join("\n");

		await run(transport, script, { sudo: options.sudo, stdin: content });
	},

	async read(transport: Transport, from: string, options: Pick<FileOptions, "sudo"> = {}): Promise<string> {
		return capture(transport, sh`cat ${from}`, { sudo: options.sudo });
	},

	async exists(transport: Transport, path: string, options: Pick<FileOptions, "sudo"> = {}): Promise<boolean> {
		const answer = await capture(transport, sh`test -e ${path} && echo yes || echo no`, {
			sudo: options.sudo
		});

		return answer.trim() === "yes";
	}
};
