import { digitalOcean, docker, ui } from "@heledron/infra-rig";
import { config } from "../config";

const name = config.target === "digitalOcean" ? config.droplet.name : config.container.name;

ui.title(`Destroy ${name}`);

await ui.confirm({
	message: [
		`Destroy ${config.target} machine "${name}"? This cannot be undone.`,
		"If a reserved IP is configured it stays reserved, unassigned."
	].join("\n"),
	phrase: name
});

ui.heading(`Destroying ${name}`);
if (config.target === "digitalOcean") {
	const id = await digitalOcean.droplets.find(config.droplet.name);
	if (id === undefined) {
		ui.log(`No droplet named "${config.droplet.name}".`);
	} else {
		await digitalOcean.droplets.destroy({ id });
	}
} else {
	await docker.container.destroy({ name: config.container.name });
}
