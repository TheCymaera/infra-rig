import { join } from "node:path";
import { apt, caddy, node, pnpm, ui } from "@heledron/infra-rig";
import { config } from "../config";

const { ssh } = config;

ui.title(`2. Setting up the server`);

ui.heading("Updating apt");
await apt.update(ssh.deploy);

ui.heading("Installing base packages");
await apt.install(ssh.deploy, [
	"curl",
	"gnupg",
	"libatomic1",
	"sqlite3"
]);

ui.heading(`Installing Node.js ${config.runtime.node}`);
await node.installer.nodesource(ssh.deploy, config.runtime.node);

ui.heading(`Installing pnpm`);
const pnpmVersion = await pnpm.declaredVersion(join(config.app.localDirectory, "package.json"));
await pnpm.installer.npm(ssh.deploy, pnpmVersion);

ui.heading("Installing Caddy");
await caddy.installer.cloudsmith(ssh.deploy);

ui.heading("Deploying the app");
await ui.autoConfirm(async () => {
	await import("../deploy-all");
});

ui.log(
	`Add a DNS record for ${config.caddy.siteAddress.replace(/^https?:\/\//, "")} -> ${config.reservedIp}`
);
