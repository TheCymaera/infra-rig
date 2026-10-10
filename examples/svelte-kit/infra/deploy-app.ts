import { join } from "node:path";
import { files, LocalTransport, node, pnpm, rsync, run, systemd, ui } from "@heledron/infra-rig";
import { config } from "./config";

const { app, ssh } = config;

const local = new LocalTransport({ cwd: app.localDirectory });

ui.title(`Deploy ${app.name}`);

await ui.confirm({
	message: `Build locally and publish runtime files to ${app.name}?`,
	phrase: app.name
});

ui.heading("Checking the server's toolchain");
const major = await node.majorVersion(ssh.deploy);
if (major !== config.runtime.node) {
	throw new Error(`Server is on Node.js ${major}, expected ${config.runtime.node}.`);
}

const declared = await pnpm.declaredVersion(join(app.localDirectory, "package.json"));
const actual = await pnpm.version(ssh.deploy);
if (actual !== declared) {
	throw new Error(
		`Server has pnpm ${actual}, expected ${declared} (package.json). Run: sudo npm install --global pnpm@${declared}`
	);
}

ui.log(`node ${major}, pnpm ${actual}`);

ui.heading("Building");
await run(local, "pnpm run build");

ui.heading("Uploading runtime files");
await rsync({
	from: local.rsyncEndpoint(`${app.localDirectory}/`),
	to: ssh.deploy.rsyncEndpoint(`${app.remoteDirectory}/`),
	include: app.runtimeFiles,
	exclude: ["*"],
	delete: true
});

ui.heading("Installing dependencies");
await pnpm.installAppDependencies(ssh.deploy, app.remoteDirectory);

const envFile = join(app.remoteDirectory, app.remoteEnvFile);
if (!(await files.exists(ssh.deploy, envFile))) {
	ui.warn(`${envFile} is missing. Run \`infra/deploy-env.ts\` first: systemd will not start ${app.name} without it.`);
}

ui.heading("Writing the systemd unit");
await systemd.writeUnit(ssh.deploy, app.name, systemd.renderUnitFile({
	description: `${app.name} web app`,
	execStart: `${await node.binaryPath(ssh.deploy)} ${join(app.remoteDirectory, app.entryPoint)}`,
	user: ssh.deploy.user,
	workingDirectory: app.remoteDirectory,
	environmentFiles: [envFile],
	extra: ["NoNewPrivileges=true"]
}));

ui.heading("Restarting the app");
await systemd.enable(ssh.deploy, app.name);
await systemd.restart(ssh.deploy, app.name);

if (!(await systemd.isActive(ssh.deploy, app.name))) {
	throw new Error(`${app.name} did not start. Check: journalctl --unit ${app.name} --lines 50`);
}

ui.log(`${app.name} is active on port ${app.port}.`);
