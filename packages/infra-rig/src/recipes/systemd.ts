import { sh } from "../primitives/shell.js";
import { files } from "../primitives/files.js";
import { run, tryRun, type Transport } from "../transports/transport.js";

export interface SystemdUnit {
	description: string;
	execStart: string;
	type?: string;
	user?: string;
	group?: string;
	workingDirectory?: string;
	environmentFiles?: string[];
	environment?: Record<string, string>;
	restart?: string;
	restartSec?: number;
	extra?: string[];
}

export const systemd = {
	async daemonReload(transport: Transport): Promise<void> {
		await run(transport, "systemctl daemon-reload", { sudo: true });
	},

	async isActive(transport: Transport, unit: string): Promise<boolean> {
		return (await tryRun(transport, sh`systemctl is-active ${unit}`)).stdout.trim() === "active";
	},

	async isEnabled(transport: Transport, unit: string): Promise<boolean> {
		return (await tryRun(transport, sh`systemctl is-enabled ${unit}`)).stdout.trim() === "enabled";
	},

	async enable(transport: Transport, unit: string): Promise<void> {
		await run(transport, sh`systemctl enable ${unit}`, { sudo: true });
	},

	async restart(transport: Transport, unit: string): Promise<void> {
		await run(transport, sh`systemctl restart ${unit}`, { sudo: true });
	},

	async stop(transport: Transport, unit: string): Promise<void> {
		await run(transport, sh`systemctl stop ${unit}`, { sudo: true });
	},

	async writeUnit(transport: Transport, name: string, content: string): Promise<void> {
		assertUnitName(name);

		// Staged under a valid unit filename: `systemd-analyze verify` reads the
		// path it is given, but the suffix is what tells it the unit type.
		const stagingDirectory = `/tmp/infra-rig-systemd-${process.pid}`;
		const staging = `${stagingDirectory}/${name}.service`;
		await files.write(transport, staging, content);

		try {
			await run(transport, sh`systemd-analyze verify ${staging}`, { sudo: true });
		} catch (error) {
			await run(transport, sh`rm --recursive --force ${stagingDirectory}`, { silent: true });
			throw error;
		}

		await run(
			transport,
			sh`install --mode 0644 --owner root --group root ${staging} ${unitPath(name)}`,
			{ sudo: true }
		);
		await run(transport, sh`rm --recursive --force ${stagingDirectory}`, { silent: true });
		await systemd.daemonReload(transport);
	},

	async removeUnit(transport: Transport, name: string): Promise<void> {
		assertUnitName(name);

		// Read through tryRun: both commands fail when the unit is absent,
		// and absent is the state we wanted anyway.
		await tryRun(transport, sh`systemctl disable --now ${name}`, { sudo: true });
		await tryRun(transport, sh`rm --force ${unitPath(name)}`, { sudo: true });
		await systemd.daemonReload(transport);
	},

	renderUnitFile(unit: SystemdUnit): string {
		assertExecStart(unit.execStart);

		const environment = Object.entries(unit.environment ?? {}).map(
			([key, value]) => `Environment=${quoteEnvironment(key, value)}`
		);
		const environmentFiles = (unit.environmentFiles ?? []).map((path) => `EnvironmentFile=${path}`);

		return [
			"[Unit]",
			`Description=${unit.description}`,
			"After=network-online.target",
			"Wants=network-online.target",
			"",
			"[Service]",
			`Type=${unit.type ?? "simple"}`,
			...(unit.user ? [`User=${unit.user}`] : []),
			...(unit.group ? [`Group=${unit.group}`] : []),
			...(unit.workingDirectory ? [`WorkingDirectory=${unit.workingDirectory}`] : []),
			...environment,
			...environmentFiles,
			`ExecStart=${unit.execStart}`,
			`Restart=${unit.restart ?? "always"}`,
			`RestartSec=${unit.restartSec ?? 2}`,
			...(unit.extra ?? []),
			"",
			"[Install]",
			"WantedBy=multi-user.target",
			""
		].join("\n");
	}
};

function unitPath(name: string): string {
	return `/etc/systemd/system/${name}.service`;
}

function quoteEnvironment(key: string, value: string): string {
	return `"${key}=${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function assertUnitName(name: string): void {
	if (!/^[A-Za-z0-9@._-]+$/.test(name)) {
		throw new Error(`"${name}" is not a usable systemd unit name.`);
	}
}

function assertExecStart(execStart: string): void {
	// systemd allows a prefix before the command, e.g. `-` to ignore failure.
	const prefixless = execStart.trim().replace(/^[-@:+!]+/, "");
	const [executable = ""] = prefixless.split(/\s+/);

	if (executable.includes("/") && !executable.startsWith("/")) {
		throw new Error(
			`SystemdUnit.execStart "${executable}" is neither a bare executable name nor an absolute path, so systemd would reject it.`
		);
	}
}
