import { run, sh, ui } from "@heledron/infra-rig";
import { config } from "./config";

ui.title("Deploy the app");

await ui.confirm({
	message: "Upload everything to production?",
	phrase: `${config.app.name}-all`
});

ui.autoConfirm(async () => {
	await run(config.ssh.deploy, sh`mkdir --parents ${config.app.remoteDirectory}`);
	await import("./deploy-env");
	await import("./deploy-caddy");
	await import("./deploy-pnpm");
	await import("./deploy-app");
});
