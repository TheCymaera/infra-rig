import { join } from "node:path";
import { pnpm, ui } from "@heledron/infra-rig";
import { config } from "./config";

const { app, ssh } = config;

ui.title("Deploy pnpm");

const declared = await pnpm.declaredVersion(join(app.localDirectory, "package.json"));
const installed = await pnpm.version(ssh.deploy).catch(() => undefined);

ui.fields({
	Server: installed ?? "not installed",
	Declared: declared
});

if (installed === declared) {
	ui.log(`pnpm ${declared} is already on the server.`);
} else {
	await ui.confirm({
		message: `Install pnpm ${declared} on ${ssh.deploy.label}?`,
		phrase: `pnpm-${declared}`
	});

	ui.heading(`Installing pnpm ${declared}`);
	await pnpm.installer.npm(ssh.deploy, declared);

	const after = await pnpm.version(ssh.deploy);
	if (after !== declared) {
		throw new Error(`Server is on pnpm ${after}, expected ${declared}.`);
	}

	ui.log(`pnpm ${after} installed.`);
}
