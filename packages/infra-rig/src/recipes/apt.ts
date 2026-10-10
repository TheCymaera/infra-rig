import { sh, shell } from "../primitives/shell.js";
import { run, tryRun, type Transport } from "../transports/transport.js";

export const apt = {
	async update(transport: Transport): Promise<void> {
		await run(transport, "apt-get update", { sudo: true });
	},

	async upgrade(transport: Transport): Promise<void> {
		await run(transport, "DEBIAN_FRONTEND=noninteractive apt-get --yes upgrade", { sudo: true });
	},

	async install(transport: Transport, packages: string[]): Promise<void> {
		const list = packages.map((name) => shell.quote(name)).join(" ");

		await run(
			transport,
			[
				"DEBIAN_FRONTEND=noninteractive apt-get install --yes",
				"-o Dpkg::Options::=--force-confdef",
				"-o Dpkg::Options::=--force-confold",
				list
			].join(" "),
			{ sudo: true }
		);
	},

	async isInstalled(transport: Transport, packageName: string): Promise<boolean> {
		const { stdout } = await tryRun(
			transport,
			sh`dpkg-query --show --showformat='\${Status}' ${packageName}`
		);

		return stdout.includes("install ok installed");
	}
};
