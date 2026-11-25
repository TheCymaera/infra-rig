import { caddy, ui } from "@heledron/infra-rig";
import { config } from "./config";

const { ssh } = config;

ui.title("Deploy the Caddy config");

const content = `
{
	email ${config.caddy.acmeEmail}
	admin off
}

${config.caddy.siteAddress} {
	encode zstd gzip

	reverse_proxy 127.0.0.1:${config.app.port} {
		# Buffer request bodies before forwarding.
		request_buffers 10MB
	}
}
`.trim();

await ui.confirm({
	message: `Replace the Caddyfile on ${config.caddy.siteAddress}?`,
	phrase: config.caddy.siteAddress
});

ui.heading("Validating and installing the Caddyfile");
await caddy.deployConfig(ssh.deploy, content);

ui.heading("Checking Caddy");
ui.log(`caddy active: ${await caddy.isActive(ssh.deploy)}`);
