import { mkdir, readFile, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { shell, sh } from "../primitives/shell.js";
import { ui } from "../primitives/ui.js";
import { run, capture, tryRun } from "../transports/transport.js";
import { LocalTransport } from "../transports/local.js";
import { DockerTransport } from "../transports/docker.js";

const local = new LocalTransport();

export type DockerBuild =
	| { readonly context: string }
	| { readonly dockerfile: string };

export interface DockerConfig {
	name: string;
	image: string;
	build: DockerBuild;
	identityFile: string;
	publishedPorts: { host: number; container: number }[];
}

export const docker = {
	container: {
		async provision(config: DockerConfig): Promise<void> {
			if (config.publishedPorts.some((port) => port.host === 22)) {
				throw new Error("Publishing to host port 22 is not allowed.");
			}
			if (!(await shell.which("docker"))) throw new Error("docker is not on PATH.");

			await ensureImage(config);

			const publish = config.publishedPorts
				.map((port) => `--publish ${port.host}:${port.container}`)
				.join(" ");

			await run(
				local,
				`docker run --detach --name ${shell.quote(config.name)} --privileged --cgroupns=host ${publish} ${shell.quote(config.image)}`
			);

			await waitForSystemd(config.name);
		},

		async destroy(spec: { name: string; }): Promise<void> {
			if (!(await containerExists(spec.name))) {
				ui.log(`No container named "${spec.name}".`);
				return;
			}

			await run(local, sh`docker rm --force ${spec.name}`);
		}
	}
};

async function containerExists(name: string): Promise<boolean> {
	const filter = `name=^${name}$`;
	const result = await capture(local, sh`docker ps --all --quiet --filter ${filter}`);
	return result.trim().length > 0;
}

async function ensureImage(config: DockerConfig): Promise<void> {
	await ensureSshKey(config.identityFile);
	const publicKey = (await readFile(`${config.identityFile}.pub`, "utf8")).trim();
	const buildArgument = `SSH_PUBLIC_KEY=${publicKey}`;
	const command = sh`docker build --tag ${config.image} --build-arg ${buildArgument}`;

	if ("dockerfile" in config.build) {
		ui.log(`Building ${config.image} from an inline Dockerfile.`);
		await run(local, `${command} -`, { stdin: config.build.dockerfile });
		return;
	}

	ui.log(`Building ${config.image} from ${config.build.context}.`);
	await run(local, `${command} ${shell.quote(config.build.context)}`);
}

async function ensureSshKey(privateKeyFile: string): Promise<void> {
	if (await pathExists(privateKeyFile)) return;

	await mkdir(dirname(privateKeyFile), { recursive: true });
	await run(local, sh`ssh-keygen -t ed25519 -N '' -C 'infra fake-vps' -f ${privateKeyFile}`);
}

async function pathExists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}

async function waitForSystemd(container: string): Promise<void> {
	const transport = new DockerTransport({ container });

	for (let attempt = 0; attempt < 60; attempt += 1) {
		try {
			const state = (await tryRun(transport, "systemctl is-system-running")).stdout.trim();
			if (state === "running" || state === "degraded") return;
		} catch {
			// The container may not accept exec yet.
		}

		await sleep(1000);
	}

	throw new Error(`Timed out waiting for systemd inside ${container}.`);
}
