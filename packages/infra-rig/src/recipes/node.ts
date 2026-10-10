import { files } from "../primitives/files.js";
import { sh } from "../primitives/shell.js";
import { run, capture, type Transport } from "../transports/transport.js";
import { apt } from "./apt.js";

export type NodeVersion = number | "lts" | "current";

export const node = {
	installer: {
		async nodesource(transport: Transport, version: NodeVersion): Promise<void> {
			if (typeof version === "number" && (!Number.isInteger(version) || version < 1)) {
				throw new Error(
					`NodeSource versions are whole major versions, like 24; "${version}" is not.`
				);
			}

			await files.write(
				transport,
				"/etc/apt/preferences.d/nodesource",
				"Package: nodejs\nPin: origin deb.nodesource.com\nPin-Priority: 600\n",
				{ sudo: true }
			);

			const setup = `https://deb.nodesource.com/setup_${version}.x`;
			await run(transport, sh`curl --fail --silent --show-error --location ${setup} --output /tmp/nodesource_setup.sh`);
			await run(transport, "bash /tmp/nodesource_setup.sh", { sudo: true });
			await run(transport, "rm --force /tmp/nodesource_setup.sh");
			await apt.install(transport, ["nodejs"]);
		}
	},

	async majorVersion(transport: Transport): Promise<number> {
		const version = (await capture(transport, "node --version")).trim();
		const major = /^v(\d+)\./.exec(version)?.[1];

		if (major === undefined) throw new Error(`Unable to read a Node.js version from "${version}".`);
		return Number(major);
	},

	async binaryPath(transport: Transport): Promise<string> {
		return (await capture(transport, "command -v node")).trim();
	}
};
