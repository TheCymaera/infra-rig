import { apt, caddy, docker, ui } from "@heledron/infra-rig";
import { config } from "../config";

const { ssh } = config;

ui.title("2. Setting up the server");

ui.heading("Updating apt");
await apt.update(ssh.deploy);

ui.heading("Installing base packages");
await apt.install(ssh.deploy, [
	"ca-certificates",
	"curl",
	"gnupg",
	"rsync"
]);

ui.heading("Installing Caddy");
await caddy.installer.cloudsmith(ssh.deploy);

ui.heading("Installing Docker Engine and Compose");
await docker.installer.official(ssh.deploy, { user: ssh.deploy.user });

ui.heading("Deploying the app");
await ui.autoConfirm(async () => {
	await import("../deploy-all");
});

ui.log(
	`Add a DNS record for ${config.caddy.siteAddress.replace(/^https?:\/\//, "")} -> ${config.reservedIp}`
);
