import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { LocalTransport, rsync, run, sh, systemd, ui } from "@heledron/infra-rig";
import { config } from "./config";

const { app, ssh } = config;

ui.title("Deploy the production environment file");

const local = new LocalTransport();
const localFile = app.localEnvFile;
const remoteFile = join(app.remoteDirectory, app.remoteEnvFile);

const contents = await readFile(localFile, "utf8").catch(() => {
	throw new Error(`Missing ${localFile}.`);
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
if (await systemd.isActive(ssh.deploy, app.name)) {
	// A restart, not a reload: EnvironmentFile is read when the unit starts.
	await systemd.restart(ssh.deploy, app.name);
} else {
	ui.warn(`${app.name} is not running yet; a deploy will pick the new environment up.`);
}
