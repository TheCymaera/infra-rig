import { readFile } from "node:fs/promises";
import { shell, sh } from "../primitives/shell.js";
import { run, capture, type Transport } from "../transports/transport.js";

export const pnpm = {
	installer: {
		async npm(transport: Transport, version: string): Promise<void> {
			await run(transport, `npm install --global --no-fund --no-audit ${shell.quote(`pnpm@${version}`)}`, {
				sudo: true
			});
		}
	},

	async installAppDependencies(transport: Transport, directory: string): Promise<void> {
		await run(transport, sh`cd ${directory} && pnpm install --prod --frozen-lockfile`);
	},

	async version(transport: Transport): Promise<string> {
		return (await capture(transport, "pnpm --version")).trim();
	},

	/**
	 * The exact pnpm version the project pins in `packageManager`.
	 */
	async declaredVersion(manifestPath: string): Promise<string> {
		const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
			packageManager?: string;
		};
		const declared = manifest.packageManager;

		if (declared === undefined) {
			throw new Error(
				`No \`packageManager\` in ${manifestPath}. Pin the pnpm version, e.g. "pnpm@10.15.0".`
			);
		}

		const parsed = /^pnpm@(\d+(?:\.\d+)*)(?:\+.+)?$/.exec(declared);
		if (parsed === null) {
			throw new Error(
				`\`packageManager\` in ${manifestPath} is "${declared}", which is not a pnpm version like "pnpm@10.15.0".`
			);
		}

		return parsed[1]!;
	}
};
