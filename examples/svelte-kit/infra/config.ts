import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import * as fs from "node:fs/promises";
import { SshTransport, digitalOcean, type DockerConfig } from "@heledron/infra-rig";
import { fakeVpsDockerfile } from "@heledron/infra-rig/testing";

const infraDirectory = import.meta.dirname;

function resolvePath(path: string): string {
	const expanded = path.replace(/^~(?=$|\/)/, homedir());
	return isAbsolute(expanded) ? expanded : join(infraDirectory, expanded);
}

const target = (process.env.INFRA_TARGET as "digitalOcean" | "docker") ?? "docker";
if (!["digitalOcean", "docker"].includes(target)) throw new Error(`Unknown INFRA_TARGET: ${target}`);

const deployUser = "example-user";
const appName = "example-app";


function digitalOceanAccess() {
	const reservedIp = "<YOUR_RESERVED_IP>";
	const sshKeyIds = ["<YOUR_SSH_KEY_ID>"];

	return {
		target: "digitalOcean" as const,
		reservedIp,
		droplet: {
			// doctl compute droplet list --format "ID,Name,PublicIPv4,Region,Size,Image"
			name: "example-vm",
			region: "sgp1",
			size: "s-1vcpu-1gb-amd",
			image: "ubuntu-24-04-x64",
			monitoring: true,
			ipv6: true,
			sshKeyIds
		},
		project: "<YOUR_PROJECT_NAME>",
		firewall: "<YOUR_FIREWALL_NAME>",
		ssh: {
			bootstrap: new SshTransport({ host: reservedIp, user: "root", port: 22 }),
			deploy: new SshTransport({ host: reservedIp, user: deployUser, port: 2891 })
		},
		authorizedKeys: async () => {
			return Array.fromAsync(sshKeyIds.map((id) => digitalOcean.sshKey.read(id)));
		}
	};
}

function dockerAccess() {
	const identityFile = resolvePath(".ssh/fake-vps");
	const knownHostsFile = resolvePath(".ssh/known_hosts");

	const ip = "127.0.0.1";
	const bootstrap = new SshTransport({ host: ip, user: "root", port: 2222, identityFile, knownHostsFile });
	const deploy = new SshTransport({ host: ip, user: deployUser, port: 2891, identityFile, knownHostsFile });

	return {
		target: "docker" as const,
		reservedIp: ip,
		container: {
			name: "example-vm",
			image: "fake-vps:latest",
			build: { dockerfile: fakeVpsDockerfile },
			publishedPorts: [
				{ host: deploy.port, container: deploy.port },
				{ host: bootstrap.port, container: 22 },

				{ host: 3001, container: 80 }
			],
			identityFile
		} satisfies DockerConfig,
		ssh: {
			bootstrap,
			deploy
		},
		authorizedKeys: async () => {
			const path = resolvePath(".ssh/fake-vps.pub");
			return [await fs.readFile(path, "utf8")];
		}
	};
}

export const config = {
	...({
		digitalOcean: digitalOceanAccess,
		docker: dockerAccess,
	}[target])(),

	app: {
		name: appName,
		port: 3000,
		localDirectory: resolvePath(".."),
		localEnvFile: resolvePath(".app-production.env"),
		remoteDirectory: `/home/${deployUser}/${appName}`,
		entryPoint: "build/index.js",
		remoteEnvFile: ".env",
		runtimeFiles: [
			"/.npmrc",
			"/package.json",
			"/pnpm-lock.yaml",
			"/build/***"
		]
	},

	runtime: {
		node: 24
	},

	caddy: {
		siteAddress: target === "digitalOcean" ? "example.heledron.com" : `http://localhost`,
		acmeEmail: "morgan@heledron.com"
	}
};
