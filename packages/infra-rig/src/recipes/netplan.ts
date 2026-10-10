import { isMap, isSeq, parseDocument, type YAMLMap } from "yaml";
import { sh } from "../primitives/shell.js";
import { files } from "../primitives/files.js";
import { run, type Transport } from "../transports/transport.js";

// https://docs.digitalocean.com/products/networking/reserved-ips/how-to/outbound-traffic/

const cloudInitFile = "/etc/netplan/50-cloud-init.yaml";
const cloudInitNetworkConfigFile = "/etc/cloud/cloud.cfg.d/99-disable-network-config.cfg";
const cloudInitNetworkDisabled = "network: {config: disabled}\n";

export interface NetplanOptions {
	file?: string;
	interface?: string;
}

export const netplan = {
	async setDefaultRoute(
		transport: Transport,
		gateway: string,
		options: NetplanOptions = {}
	): Promise<void> {
		const file = options.file ?? cloudInitFile;
		const name = options.interface ?? "eth0";

		if (!(await files.exists(transport, file, { sudo: true }))) {
			throw new Error(
				`${file} does not exist on ${transport.label}, so ${name}'s default route cannot be set from netplan.`
			);
		}

		const original = await files.read(transport, file, { sudo: true });
		const updated = renderDefaultRoute(original, file, name, gateway);

		await writeNetplanFile(transport, file, updated);

		try {
			await run(transport, "netplan apply", { sudo: true });
		} catch (error) {
			await writeNetplanFile(transport, file, original);
			throw error;
		}
	},

	async disableCloudInitNetworkConfig(transport: Transport): Promise<void> {
		await files.write(transport, cloudInitNetworkConfigFile, cloudInitNetworkDisabled, {
			sudo: true,
			owner: "root",
			group: "root"
		});
	},

	async enableCloudInitNetworkConfig(transport: Transport): Promise<void> {
		await run(transport, sh`rm --force ${cloudInitNetworkConfigFile}`, { sudo: true });
	}
};

function renderDefaultRoute(source: string, file: string, name: string, gateway: string): string {
	const document = parseDocument(source, { prettyErrors: false });

	const [invalid] = document.errors;
	if (invalid !== undefined) throw new Error(`${file} is not valid YAML: ${invalid.message}`);

	const ethernet = document.getIn(["network", "ethernets", name], true);
	if (!isMap(ethernet)) {
		throw new Error(`${file} has no network.ethernets.${name} stanza to set a default route in.`);
	}

	const routes: unknown = ethernet.get("routes", true);
	const declared = isSeq(routes) ? routes.items.find(isDefaultRoute) : undefined;

	if (declared === undefined) {
		if (leasesRoutes(ethernet)) {
			throw new Error(
				`${file} leaves ${name}'s routes to DHCP, so a default route written there would compete with the one DHCP installs. Set dhcp4-overrides: {use-routes: false} on ${name} first.`
			);
		}

		const route = document.createNode({ to: "0.0.0.0/0", via: gateway });
		if (isSeq(routes)) routes.add(route);
		else ethernet.set("routes", document.createNode([{ to: "0.0.0.0/0", via: gateway }]));
	} else {
		declared.set("via", gateway);
	}

	return document.toString();
}

function isDefaultRoute(node: unknown): node is YAMLMap {
	if (!isMap(node)) return false;

	const to = node.get("to");

	return to === "0.0.0.0/0" || to === "default";
}

function leasesRoutes(ethernet: YAMLMap): boolean {
	if (ethernet.get("dhcp4") !== true) return false;

	const overrides = ethernet.get("dhcp4-overrides", true);

	return !isMap(overrides) || overrides.get("use-routes") !== false;
}

function writeNetplanFile(transport: Transport, file: string, content: string): Promise<void> {
	return files.write(transport, file, content, {
		sudo: true,
		mode: "0600",
		owner: "root",
		group: "root"
	});
}
