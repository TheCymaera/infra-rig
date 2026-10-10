import { sh, shell } from "../primitives/shell.js";
import { run, capture, tryRun, type Transport } from "../transports/transport.js";
import { files } from "../primitives/files.js";
import { systemd } from "./systemd.js";

interface PortsOptions {
	siteName: string;
	ports: number[];
}

export interface HardenOptions {
	user: string;
	siteName: string;
	ports: number[];
	authorizedKeys: string[];
}

export const harden = {
	async ssh(transport: Transport, options: HardenOptions): Promise<void> {
		const { stdout } = await tryRun(
			transport,
			"grep --count --fixed-strings '/etc/ssh/sshd_config.d/' /etc/ssh/sshd_config"
		);
		if (stdout.trim() === "0") {
			throw new Error(
				"/etc/ssh/sshd_config does not include /etc/ssh/sshd_config.d/, so a drop-in would be ignored."
			);
		}

		const user = options.user;
		await run(
			transport,
			sh`if ! id --user ${user} >/dev/null 2>&1; then useradd --create-home --shell /bin/bash --groups sudo ${user}; fi`,
			{ sudo: true }
		);

		const home = (
			await capture(transport, `getent passwd ${shell.quote(user)} | cut --delimiter=: --fields=6`, { sudo: true })
		).trim();
		if (!home) throw new Error(`Unable to resolve a home directory for ${user}.`);

		const sshDirectory = `${home}/.ssh`;
		await run(
			transport,
			sh`install --directory --mode 0700 --owner ${user} --group ${user} ${sshDirectory}`,
			{ sudo: true }
		);

		const contents = `${options.authorizedKeys.join("\n")}\n`;
		await files.write(transport, `${sshDirectory}/authorized_keys`, contents, {
			sudo: true,
			mode: "0600",
			owner: user,
			group: user
		});

		const sudoers = `/etc/sudoers.d/90-${user}`;
		await files.write(transport, sudoers, `${user} ALL=(ALL) NOPASSWD:ALL\n`, {
			sudo: true,
			mode: "0440"
		});
		// A malformed sudoers file takes sudo away entirely, so validate it now.
		await run(transport, sh`visudo --check --file ${sudoers}`, { sudo: true });

		await files.write(transport, `/etc/ssh/sshd_config.d/60-${options.siteName}.conf`, [
			`PermitRootLogin no`,
			`PasswordAuthentication no`,
			`KbdInteractiveAuthentication no`,
			`ChallengeResponseAuthentication no`,
			`UsePAM yes`,
		].join("\n"), { sudo: true });

		await setPorts(transport, {
			siteName: options.siteName,
			ports: options.ports
		});
	}
};

async function setPorts(transport: Transport, options: PortsOptions): Promise<void> {
	await files.write(
		transport,
		`/etc/ssh/sshd_config.d/50-${options.siteName}-ports.conf`,
		[...options.ports.map((port) => `Port ${port}`), ""].join("\n"),
		{ sudo: true }
	);

	// Refuse to restart sshd on a config it cannot parse. sshd, like
	// ssh-keygen, only understands short options.
	await run(transport, "sshd -t", { sudo: true });

	if (await systemd.isEnabled(transport, "ssh.socket")) {
		await systemd.daemonReload(transport);
		await systemd.restart(transport, "ssh.socket");
		return;
	}

	// Without socket activation ssh.service reads Port from the config
	// itself. Enabling it means the hardened port survives a reboot.
	await systemd.enable(transport, "ssh");
	await systemd.restart(transport, "ssh");
}

