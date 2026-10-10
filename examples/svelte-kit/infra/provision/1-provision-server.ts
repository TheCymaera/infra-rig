import { digitalOcean, docker, harden, ui, waitReachable } from "@heledron/infra-rig";
import { config } from "../config";

const { ssh } = config;

ui.title(`1. Provisioning the server`);

const fail = (message: string) => { throw new Error(message); }

if (config.target === "docker") {
	ui.heading("Creating the Docker container");
	await docker.container.provision(config.container);

	await hardenServer();
} else {
	ui.heading("Creating the DigitalOcean droplet");

	const projectId = await digitalOcean.project.find(config.project) ??
		fail(`No DigitalOcean project named "${config.project}".`);
	
		const firewallId = await digitalOcean.firewall.find(config.firewall) ??
		fail(`No DigitalOcean firewall named "${config.firewall}".`);

	const dropletId = await digitalOcean.droplets.provision({
		...config.droplet,
		projectId
	});

	ui.heading("Assigning the reserved IP");
	await digitalOcean.droplets.assignReservedIp({ dropletId, reservedIp: config.reservedIp });

	ui.heading("Sending outbound traffic over the reserved IP");
	await digitalOcean.outboundReservedIp.enable(ssh.bootstrap);

	await hardenServer();

	ui.heading("Attaching firewall");
	await digitalOcean.firewall.attach({
		firewallId,
		dropletIds: [dropletId]
	});
}

ui.heading(`Waiting for SSH as ${ssh.bootstrap.user}@${ssh.bootstrap.host}:${ssh.bootstrap.port}`);
await waitReachable(ssh.bootstrap);

ui.log(`Bootstrap SSH is now reachable.`);

async function hardenServer() {
	ui.heading(`Creating ${ssh.deploy.user} and hardening sshd`);
	await harden.ssh(ssh.bootstrap, {
		user: ssh.deploy.user,
		siteName: config.app.name,
		ports: [ssh.deploy.port],
		authorizedKeys: await config.authorizedKeys()
	});
	await waitReachable(ssh.deploy, { attempts: 10, intervalMs: 1000 });
}