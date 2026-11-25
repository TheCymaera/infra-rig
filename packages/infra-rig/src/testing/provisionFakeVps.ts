import { mkdir, readFile, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { sh, shell } from "../primitives/shell.js";
import { ui } from "../primitives/ui.js";
import { DockerTransport } from "../transports/docker.js";
import { LocalTransport } from "../transports/local.js";
import { capture, run, tryRun } from "../transports/transport.js";
import { fakeVpsDockerfile } from "./fakeVps.js";

export interface FakeVpsTarget {
	name: string;
	/** Mount dedicated Docker and containerd state volumes. Destroy always removes them. */
	nestedDocker?: boolean;
}

export interface FakeVpsOptions extends FakeVpsTarget {
	identityFile: string;
	/** Ports are published on IPv4 loopback only. */
	publishedPorts: { host: number; container: number }[];
	image?: string;
	build?: { context: string } | { dockerfile: string };
}

const local = new LocalTransport();

export const fakeVps = {
	async provision(options: FakeVpsOptions): Promise<void> {
		if (options.publishedPorts.some(({ host }) => host === 22)) {
			throw new Error("Publishing to host port 22 is not allowed.");
		}
		if (!(await shell.which("docker"))) throw new Error("docker is not on PATH.");
		if (await findContainer(options.name)) {
			throw new Error(`Container "${options.name}" already exists. Destroy it before provisioning again.`);
		}

		await ensureSshKey(options.identityFile);
		const publicKey = (await readFile(`${options.identityFile}.pub`, "utf8")).trim();
		const image = options.image ?? `${options.name.toLowerCase()}:fake-vps`;
		const build = options.build ?? { dockerfile: fakeVpsDockerfile };
		const command = sh`docker build --tag ${image} --build-arg ${`SSH_PUBLIC_KEY=${publicKey}`}`;
		if ("dockerfile" in build) {
			await run(local, `${command} -`, { stdin: build.dockerfile });
		} else {
			await run(local, `${command} -- ${shell.quote(build.context)}`);
		}

		const ports = options.publishedPorts.map(({ host, container }) =>
			sh`--publish ${`127.0.0.1:${host}:${container}`}`);
		const volumes = stateVolumes(options).map(({ name, target }) =>
			sh`--volume ${`${name}:${target}`}`);
		const id = (await capture(local, [
			sh`docker create --name ${options.name} --privileged --cgroupns=host`,
			...ports, ...volumes, sh`-- ${image}`
		].join(" "))).trim();

		try {
			await run(local, sh`docker start ${id}`);
			await waitForSystemd(id, options.name);
		} catch (error) {
			try {
				await run(local, sh`docker rm --force ${id}`);
			} catch (cleanupError) {
				throw new AggregateError([error, cleanupError], `Failed to provision and clean up ${options.name}.`);
			}
			throw error;
		}
	},

	async destroy(options: FakeVpsTarget): Promise<void> {
		const id = await findContainer(options.name);
		if (id) {
			await run(local, sh`docker rm --force ${id}`);
		} else {
			ui.log(`No container named "${options.name}".`);
		}

		// Removed even when nestedDocker is now off, in case it was on at provision time.
		// --force makes missing volumes a no-op; in-use volumes still error.
		const volumes = nestedDockerVolumes(options.name);
		await run(local, `docker volume rm --force -- ${volumes.map(({ name }) => shell.quote(name)).join(" ")}`);
	}
};

function stateVolumes({ name, nestedDocker }: FakeVpsTarget) {
	return nestedDocker ? nestedDockerVolumes(name) : [];
}

function nestedDockerVolumes(name: string) {
	return [
		{ name: `${name}-docker`, target: "/var/lib/docker" },
		{ name: `${name}-containerd`, target: "/var/lib/containerd" }
	];
}

async function findContainer(name: string): Promise<string | undefined> {
	const output = await capture(local, "docker ps --all --no-trunc --format '{{.ID}} {{.Names}}'");
	for (const line of output.trim().split("\n")) {
		const [id, actualName] = line.split(" ");
		if (actualName === name) return id;
	}
}

async function ensureSshKey(path: string): Promise<void> {
	try {
		await stat(path);
		return;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	await mkdir(dirname(path), { recursive: true });
	await run(local, sh`ssh-keygen -t ed25519 -N '' -C 'infra fake-vps' -f ${path}`);
}

async function waitForSystemd(id: string, name: string): Promise<void> {
	const transport = new DockerTransport({ container: id });
	for (let attempt = 0; attempt < 60; attempt += 1) {
		const state = (await tryRun(transport, "systemctl is-system-running")).stdout.trim();
		if (state === "running" || state === "degraded") return;
		await sleep(1000);
	}
	throw new Error(`Timed out waiting for systemd inside ${name}.`);
}
