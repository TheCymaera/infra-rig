import { sh, shell } from "../primitives/shell.js";
import { run, capture, tryRun, type Transport } from "../transports/transport.js";
import { systemd } from "./systemd.js";

export interface Pm2App {
	name: string;
	entryPoint: string;
	directory: string;
	envFile: string;
}

export const pm2 = {
	installer: {
		async npm(transport: Transport): Promise<void> {
			await run(transport, "npm install --global --no-fund --no-audit pm2", { sudo: true });
		}
	},

	async start(transport: Transport, app: Pm2App): Promise<void> {
		const nodeArguments = `--env-file=${app.envFile}`;
		await run(
			transport,
			sh`pm2 start ${app.entryPoint} --cwd ${app.directory} --node-args=${nodeArguments} --name ${app.name} --time`
		);
		await run(transport, "pm2 save");
	},

	async restart(transport: Transport, name: string): Promise<void> {
		await run(transport, sh`pm2 restart ${name} --update-env`);
		await run(transport, "pm2 save");
	},

	async delete(transport: Transport, name: string): Promise<void> {
		await run(transport, sh`pm2 delete ${name}`);
		await run(transport, "pm2 save");
	},

	async ensure(transport: Transport, app: Pm2App): Promise<void> {
		await tryRun(transport, sh`pm2 delete ${app.name}`);
		return this.start(transport, app);
	},

	async describe(transport: Transport, name: string): Promise<string> {
		return capture(transport, sh`pm2 describe ${name}`);
	},

	async isRunning(transport: Transport, name: string): Promise<boolean> {
		// Read through tryRun: with no daemon yet, pm2 jlist still exits non-zero.
		const { stdout } = await tryRun(transport, "pm2 jlist");

		try {
			const processes = JSON.parse(stdout) as { name: string }[];
			return processes.some((process) => process.name === name);
		} catch {
			return false;
		}
	},

	async startup(transport: Transport, user: string): Promise<void> {
		const quotedUser = shell.quote(user);
		const home = `"$(getent passwd ${quotedUser} | cut --delimiter=: --fields=6)"`;

		const result = await tryRun(
			transport,
			`pm2 startup systemd --user ${quotedUser} --hp ${home}`,
			{ sudo: true }
		);
		const output = `${result.stdout}${result.stderr}`;

		// pm2 7 writes and enables the unit itself; older versions print a
		// command to copy and paste. Handle both, then assert the unit exists.
		if (!(await pm2.isEnabled(transport, user))) {
			const printed = output
				.split("\n")
				.map((line) => line.trim())
				.find((line) => line.includes("pm2 startup systemd"));

			if (printed) await run(transport, printed.replace(/^sudo\s+/, ""), { sudo: true });
		}

		if (!(await pm2.isEnabled(transport, user))) {
			throw new Error(`The pm2 systemd unit for ${user} was not enabled.\n${output}`);
		}
	},

	async isEnabled(transport: Transport, user: string): Promise<boolean> {
		return systemd.isEnabled(transport, `pm2-${user}`);
	}
};
