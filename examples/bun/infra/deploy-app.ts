import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { capture, docker, files, LocalTransport, rsync, run, sh, shell, tryRun, ui } from "@heledron/infra-rig";
import { config } from "./config";

const { app, ssh } = config;

const local = new LocalTransport({ cwd: app.localDirectory });

ui.title(`Deploy ${app.name}`);

await ui.confirm({
	message: `Build ${app.image} locally and deploy it to ${app.name}?`,
	phrase: app.name
});

if (!(await shell.which("docker"))) throw new Error("docker is not on PATH.");

ui.heading("Checking the server's Docker installation");
try {
	const serverDocker = await docker.engine.version(ssh.deploy);
	const composeVersion = await docker.compose.version(ssh.deploy);
	ui.fields({ Docker: serverDocker, Compose: composeVersion });
} catch (cause) {
	throw new Error("Cannot use Docker Engine and Compose on the server. Verify SSH access and run `infra/provision/2-setup-server.ts` if setup is incomplete.", { cause });
}

ui.heading("Building the image");
await docker.image.build(local, {
	image: app.image,
	context: app.localDirectory,
	platform: app.platform,
	target: "production"
});

ui.heading("Uploading the image");
const staging = await mkdtemp(join(tmpdir(), `${app.name}-image-`));
const archive = join(staging, "image.tar.gz");
const remoteArchive = `/tmp/${app.name}-${process.pid}.tar.gz`;

try {
	await docker.image.saveGzip(local, { image: app.image, outputPath: archive });
	await rsync({
		from: local.rsyncEndpoint(archive),
		to: ssh.deploy.rsyncEndpoint(remoteArchive)
	});

	try {
		await docker.image.load(ssh.deploy, remoteArchive);
	} finally {
		await run(ssh.deploy, sh`rm --force ${remoteArchive}`, { silent: true });
	}
} finally {
	await rm(staging, { recursive: true, force: true });
}

ui.heading("Writing the Compose file");
const compose = await readFile(join(app.localDirectory, "compose.yaml"), "utf8");
await files.write(ssh.deploy, join(app.remoteDirectory, app.remoteComposeFile), compose);

const envFile = join(app.remoteDirectory, app.remoteEnvFile);
if (!(await files.exists(ssh.deploy, envFile))) {
	ui.warn(`${envFile} is missing. Run \`infra/deploy-env.ts\` first: Compose will not read the app's environment without it.`);
}

ui.heading("Starting the Compose project");
try {
	await docker.compose.up(ssh.deploy, {
		directory: app.remoteDirectory,
		files: [app.remoteComposeFile],
		environment: { APP_IMAGE: app.image, HOST_PORT: String(app.port) },
		// Reusing one tag means Compose may otherwise leave the old container
		// running after `docker load` replaces the tag.
		forceRecreate: true,
		waitTimeoutSeconds: 90
	});
} catch (error) {
	await tryRun(
		ssh.deploy,
		sh`cd ${app.remoteDirectory} && docker compose logs --tail 40`,
		{ silent: false }
	);
	throw error;
}

ui.heading("Checking the app");
const health = await capture(
	ssh.deploy,
	`curl --fail --silent --show-error http://localhost:${app.port}/health`
);
ui.log(health.trim());
ui.log(`${app.name} is running from ${app.image}.`);
