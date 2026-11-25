import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { LocalTransport, docker, files, rsync, run, sh, tryRun, ui } from "@heledron/infra-rig";
import { config } from "./config";

const { app, ssh } = config;

ui.title("Deploy the production environment file");

const local = new LocalTransport();
const localFile = app.localEnvFile;
const remoteFile = join(app.remoteDirectory, app.remoteEnvFile);
const remoteComposeFile = join(app.remoteDirectory, app.remoteComposeFile);

const contents = await readFile(localFile, "utf8").catch(() => {
	throw new Error(`Missing ${localFile}. Copy infra/.app-production.env.example to it first.`);
});
if (contents.trim().length === 0) throw new Error(`${localFile} is empty.`);

ui.fields({
	From: localFile,
	Modified: (await stat(localFile)).mtime.toISOString(),
	To: `${ssh.deploy.label}:${remoteFile}`
});

await ui.confirm({
	message: "Upload the production environment file?",
	phrase: `${app.name}-production-env`
});

ui.heading("Uploading");
await rsync({ from: local.rsyncEndpoint(localFile), to: ssh.deploy.rsyncEndpoint(remoteFile) });
await run(ssh.deploy, sh`chmod 0600 ${remoteFile}`, { silent: true });

ui.heading("Reloading the app");
const composeDeployed = await files.exists(ssh.deploy, remoteComposeFile);
const running = composeDeployed && (await tryRun(
	ssh.deploy,
	sh`cd ${app.remoteDirectory} && docker compose ps --status running --quiet ${app.service}`
)).stdout.trim().length > 0;

if (running) {
	await docker.compose.up(ssh.deploy, {
		directory: app.remoteDirectory,
		files: [app.remoteComposeFile],
		environment: { APP_IMAGE: app.image, HOST_PORT: String(app.port) },
		forceRecreate: true,
		services: [app.service],
		waitTimeoutSeconds: 90
	});
} else {
	ui.warn(`${app.name} is not running yet; a deploy will pick the new environment up.`);
}
