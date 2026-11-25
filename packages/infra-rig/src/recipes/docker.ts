import { setTimeout as sleep } from "node:timers/promises";
import { shell, sh } from "../primitives/shell.js";
import { files } from "../primitives/files.js";
import { apt } from "./apt.js";
import { run, capture, tryRun, type Transport } from "../transports/transport.js";

export interface DockerInstallOptions {
	/** Adds this user to the docker group so it can use the daemon without sudo. */
	user?: string;
}

export interface DockerImageBuild {
	image: string;
	/** Build context, relative to the transport's working directory. */
	context: string;
	dockerfile?: string;
	/** Target platform, e.g. linux/amd64. Defaults to the builder's platform. */
	platform?: string;
	target?: string;
	buildArgs?: Record<string, string>;
}

export interface DockerImageSaveGzip {
	image: string;
	/** Path of the gzipped archive to write. */
	outputPath: string;
}

export interface DockerComposeUpOptions {
	directory: string;
	/** Compose files, relative to `directory`. Defaults to compose.yaml. */
	files?: string[];
	/** Environment passed to `docker compose`, e.g. APP_IMAGE. */
	environment?: Record<string, string>;
	/** Services to act on. Defaults to every service in the project. */
	services?: string[];
	/** Recreate containers even when their configuration has not changed. */
	forceRecreate?: boolean;
	/** Remove containers for services not defined in the selected files. */
	removeOrphans?: boolean;
	/** Wait for services to be running or healthy for up to this many seconds. */
	waitTimeoutSeconds?: number;
}

export const docker = {
	installer: {
		async official(transport: Transport, options: DockerInstallOptions = {}): Promise<void> {
			const release = await readOsRelease(transport);
			const repository = dockerRepositories[release.id];

			if (repository === undefined) {
				throw new Error(
					`Docker publishes packages for Ubuntu and Debian, not "${release.id}".`
				);
			}

			const keyring = "/etc/apt/keyrings/docker.asc";
			const list = "/etc/apt/sources.list.d/docker.list";

			await apt.update(transport);
			await apt.install(transport, ["ca-certificates", "curl"]);

			await run(
				transport,
				[
					"install --directory --mode 0755 /etc/apt/keyrings",
					`&& curl --fail --silent --show-error --location ${repository}/gpg --output ${keyring}`,
					`&& chmod a+r ${keyring}`
				].join(" "),
				{ sudo: true }
			);

			const architecture = (await capture(transport, "dpkg --print-architecture")).trim();
			await files.write(
				transport,
				list,
				`deb [arch=${architecture} signed-by=${keyring}] ${repository} ${release.codename} stable\n`,
				{ sudo: true }
			);

			await apt.update(transport);
			await apt.install(transport, [
				"docker-ce",
				"docker-ce-cli",
				"containerd.io",
				"docker-buildx-plugin",
				"docker-compose-plugin"
			]);

			// enable --now also starts a daemon that was installed but is stopped.
			await run(transport, "systemctl enable --now docker", { sudo: true });

			if (options.user !== undefined && options.user !== "root") {
				await run(transport, sh`usermod --append --groups docker ${options.user}`, {
					sudo: true
				});
			}

			await waitForDaemon(transport);
		}
	},

	image: {
		async build(transport: Transport, spec: DockerImageBuild): Promise<void> {
			let command = sh`docker build --tag ${spec.image}`;

			if (spec.dockerfile !== undefined) command += sh` --file ${spec.dockerfile}`;
			if (spec.platform !== undefined) command += sh` --platform ${spec.platform}`;
			if (spec.target !== undefined) command += sh` --target ${spec.target}`;
			for (const [key, value] of Object.entries(spec.buildArgs ?? {})) {
				command += sh` --build-arg ${`${key}=${value}`}`;
			}

			command += sh` ${spec.context}`;
			await run(transport, command);
		},

		async saveGzip(transport: Transport, spec: DockerImageSaveGzip): Promise<void> {
			await run(transport, sh`docker save -- ${spec.image} | gzip --stdout > ${spec.outputPath}`);
		},

		async load(transport: Transport, inputPath: string): Promise<void> {
			await run(transport, sh`docker load --input ${inputPath}`);
		}
	},

	compose: {
		async up(transport: Transport, spec: DockerComposeUpOptions): Promise<void> {
			const composeFiles = spec.files ?? ["compose.yaml"];
			const environment = Object.entries(spec.environment ?? {})
				.map(([key, value]) => {
					if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
						throw new Error(`Invalid Compose environment variable name: ${key}`);
					}
					return `${key}=${shell.quote(value)}`;
				})
				.join(" ");

			const command = [
				"docker compose",
				...composeFiles.map((file) => `--file ${shell.quote(file)}`),
				"up --detach",
				...(spec.removeOrphans ? ["--remove-orphans"] : []),
				...(spec.waitTimeoutSeconds === undefined ? [] : [sh`--wait --wait-timeout ${spec.waitTimeoutSeconds}`]),
				...(spec.forceRecreate ? ["--force-recreate"] : []),
				"--",
				...(spec.services ?? []).map((service) => shell.quote(service))
			].join(" ");

			await run(
				transport,
				`cd ${shell.quote(spec.directory)} && ${environment ? `${environment} ` : ""}${command}`
			);
		},

		async version(transport: Transport): Promise<string> {
			const version = (await capture(transport, "docker compose version --short")).trim();
			return version.replace(/^v/, "");
		}
	},

	engine: {
		async version(transport: Transport): Promise<string> {
			return (await capture(transport, "docker version --format '{{.Server.Version}}'")).trim();
		}
	}
};

const dockerRepositories: Readonly<Record<string, string>> = {
	ubuntu: "https://download.docker.com/linux/ubuntu",
	debian: "https://download.docker.com/linux/debian"
};

async function readOsRelease(
	transport: Transport
): Promise<{ id: string; codename: string }> {
	const output = await capture(
		transport,
		`. /etc/os-release && printf '%s\\n%s\\n' "$ID" "$VERSION_CODENAME"`
	);
	const [id = "", codename = ""] = output.trim().split("\n");

	if (id.length === 0 || codename.length === 0) {
		throw new Error(
			`${transport.label} does not report both ID and VERSION_CODENAME in /etc/os-release.`
		);
	}

	return { id, codename };
}

async function waitForDaemon(transport: Transport): Promise<void> {
	for (let attempt = 0; attempt < 30; attempt += 1) {
		if ((await tryRun(transport, "docker info", { sudo: true })).exitCode === 0) return;
		await sleep(1000);
	}

	throw new Error(`The Docker daemon on ${transport.label} did not become ready.`);
}
