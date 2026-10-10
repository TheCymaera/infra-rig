import { sh } from "../primitives/shell.js";
import { ui } from "../primitives/ui.js";
import { run, capture, tryRun, type Transport } from "../transports/transport.js";
import { LocalTransport } from "../transports/local.js";
import { netplan, type NetplanOptions } from "./netplan.js";

const local = new LocalTransport();

export interface DropletConfig {
	/** The droplet's human readable name. */
	name: string;
	/** doctl compute droplet create --region */
	region: string;
	/** doctl compute droplet create --size */
	size: string;
	/** doctl compute droplet create --image, e.g. ubuntu-24-04-x64 */
	image: string;
	/** enable monitoring for the droplet. */
	monitoring: boolean;
	/** enable IPv6 for the droplet. */
	ipv6: boolean;
	/** doctl projects list --format "ID,Name,Purpose" */
	projectId?: string;
	/** doctl compute ssh-key list --format "ID,Name" */
	sshKeyIds: string[];
}

export const digitalOcean = {
	outboundReservedIp: {
		async enable(transport: Transport, options: NetplanOptions = {}): Promise<void> {
			const gateway = await anchorGateway(transport);

			await netplan.setDefaultRoute(transport, gateway, options);
			await netplan.disableCloudInitNetworkConfig(transport);
		},

		async isVia(transport: Transport): Promise<boolean> {
			return isDefaultRouteVia(transport, await anchorGateway(transport));
		},

		async disable(transport: Transport, options: NetplanOptions = {}): Promise<void> {
			const gateway = await publicGateway(transport);

			await netplan.setDefaultRoute(transport, gateway, options);
			await netplan.enableCloudInitNetworkConfig(transport);
		},
	},

	firewall: {
		async find(name: string): Promise<string | undefined> {
			const output = await capture(local, "doctl compute firewall list --output json");
			const firewalls = JSON.parse(output) as { id: number; name: string; }[];
			const firewall = firewalls.find((candidate) => candidate.name === name);

			return firewall === undefined ? undefined : String(firewall.id);
		},

		attach(spec: { firewallId: string; dropletIds: string[]; }): Promise<void> {
			return run(local, sh`doctl compute firewall add-droplets ${spec.firewallId} --droplet-ids ${spec.dropletIds.join(",")}`);
		}
	},

	project: {
		async find(name: string): Promise<string | undefined> {
			const output = await capture(local, "doctl projects list --output json");
			const projects = JSON.parse(output) as { id: number; name: string; }[];
			const project = projects.find((candidate) => candidate.name === name);

			return project === undefined ? undefined : String(project.id);
		}
	},

	droplets: {
		async find(name: string): Promise<string | undefined> {
			const output = await capture(local, "doctl compute droplet list --output json");
			const droplets = JSON.parse(output) as { id: number; name: string; }[];
			const droplet = droplets.find((candidate) => candidate.name === name);

			return droplet === undefined ? undefined : String(droplet.id);
		},

		async provision(config: DropletConfig): Promise<string> {
			if ((await digitalOcean.droplets.find(config.name)) !== undefined) {
				throw new Error(`Droplet "${config.name}" already exists.`);
			}

			let script = sh`doctl compute droplet create ${config.name} --region ${config.region} --size ${config.size} --image ${config.image} --ssh-keys ${config.sshKeyIds.join(",")} --format ID --no-header --wait`;
			if (config.projectId !== undefined) script += sh` --project-id ${config.projectId}`;
			if (config.monitoring) script += " --enable-monitoring";
			if (config.ipv6) script += " --enable-ipv6";

			const created = await capture(local, script, { silent: false });
			const id = created.trim().split("\n")[0]?.trim();
			if (!id) throw new Error(`Unable to resolve a droplet id for "${config.name}" after creation.`);

			ui.log(`Created droplet ${config.name}.`);
			return id;
		},

		async destroy(spec: { id: string; }): Promise<void> {
			await run(local, sh`doctl compute droplet delete ${spec.id} --force`);
		},

		async assignReservedIp(spec: { dropletId: string; reservedIp: string; }): Promise<void> {
			await run(local, sh`doctl compute reserved-ip-action assign ${spec.reservedIp} ${spec.dropletId}`);
		}
	},

	sshKey: {
		async read(id: string): Promise<string> {
			const { stdout, stderr } = await tryRun(
				local,
				sh`doctl compute ssh-key get ${id} --format PublicKey --no-header`
			);
			const key = stdout.trim();

			if (key.length === 0) {
				const reason = stderr.trim();
				throw new Error(`Unable to resolve public key for SSH key ID ${id}.${reason ? `\n${reason}` : ""}`);
			}

			return key;
		},
	}
};

const metadata = "http://169.254.169.254/metadata/v1";

async function readMetadata(transport: Transport, path: string): Promise<string | undefined> {
	const url = `${metadata}/${path}`;
	const { stdout } = await tryRun(transport, sh`curl --fail --silent --show-error ${url}`);
	const value = stdout.trim();

	return value.length === 0 ? undefined : value;
}

async function anchorGateway(transport: Transport): Promise<string> {
	const gateway = await readMetadata(transport, "interfaces/public/0/anchor_ipv4/gateway");

	if (gateway === undefined) {
		throw new Error(
			`${transport.label} reports no anchor IP gateway, so its outbound traffic cannot be sent over a reserved IP. Assign an anchor IP to the droplet first: https://docs.digitalocean.com/products/networking/reserved-ips/how-to/manually-enable/`
		);
	}

	return gateway;
}

async function publicGateway(transport: Transport): Promise<string> {
	const gateway = await readMetadata(transport, "interfaces/public/0/ipv4/gateway");

	if (gateway === undefined) {
		throw new Error(`${transport.label} reports no IPv4 gateway of its own.`);
	}

	return gateway;
}

async function isDefaultRouteVia(transport: Transport, gateway: string): Promise<boolean> {
	const routes = JSON.parse(await capture(transport, "ip -json route show default")) as {
		gateway?: string;
	}[];

	return routes.some((route) => route.gateway === gateway);
}
