import { readFile } from "node:fs/promises";
import { shell, sh } from "../primitives/shell.js";
import { run, capture, type Transport } from "../transports/transport.js";
import { apt } from "./apt.js";

export const bun = {
	installer: {
		async official(transport: Transport, version: string): Promise<void> {
			if (!/^\d+\.\d+\.\d+$/.test(version)) {
				throw new Error(
					`Bun releases are tagged "bun-v<major>.<minor>.<patch>"; "${version}" is not a full version.`
				);
			}

			if (!(await apt.isInstalled(transport, "unzip"))) {
				await apt.update(transport);
				await apt.install(transport, ["unzip"]);
			}

			// BUN_INSTALL chooses the install directory; the version is the
			// installer's first argument, as a release tag.
			const installScript = "curl --fail --silent --show-error --location https://bun.com/install";
			const tag = shell.quote(`bun-v${version}`);
			await run(transport, `${installScript} | BUN_INSTALL=/usr/local bash -s -- ${tag}`, { sudo: true });
		}
	},

	async installAppDependencies(transport: Transport, directory: string): Promise<void> {
		await run(transport, sh`cd ${directory} && bun install --production --frozen-lockfile`);
	},

	async version(transport: Transport): Promise<string> {
		return (await capture(transport, "bun --version")).trim();
	},

	/**
	 * The exact Bun version the project pins in `packageManager`.
	 */
	async declaredVersion(manifestPath: string): Promise<string> {
		const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
			packageManager?: string;
		};
		const declared = manifest.packageManager;

		if (declared === undefined) {
			throw new Error(
				`No \`packageManager\` in ${manifestPath}. Pin the Bun version: "bun@x.x.x".`
			);
		}

		const parsed = /^bun@(\d+(?:\.\d+)*)(?:\+.+)?$/.exec(declared);
		if (parsed === null) {
			throw new Error(
				`\`packageManager\` in ${manifestPath} is "${declared}", which is not a Bun version like "bun@x.x.x".`
			);
		}

		return parsed[1]!;
	},

	async binaryPath(transport: Transport): Promise<string> {
		return (await capture(transport, "command -v bun")).trim();
	}
};
