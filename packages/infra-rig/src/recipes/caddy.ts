import { sh } from "../primitives/shell.js";
import { files } from "../primitives/files.js";
import { apt } from "./apt.js";
import { systemd } from "./systemd.js";
import { run, capture, tryRun, type Transport } from "../transports/transport.js";
import { LocalTransport } from "../transports/local.js";

const local = new LocalTransport();

export const caddy = {
	installer: {
		async cloudsmith(transport: Transport): Promise<void> {
			if (await apt.isInstalled(transport, "caddy")) return;

			// The Cloudsmith key is ASCII armored; apt's signed-by keyring must be a
			// dearmored (binary) GnuPG keyring, or apt reports NO_PUBKEY.
			await run(
				transport,
				[
					"curl --fail --silent --show-error --location https://dl.cloudsmith.io/public/caddy/stable/gpg.key",
					"| gpg --dearmor --yes --output /usr/share/keyrings/caddy-stable-archive-keyring.gpg",
					"&& curl --fail --silent --show-error --location https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt",
					"> /etc/apt/sources.list.d/caddy-stable.list",
					"&& apt-get update"
				].join(" "),
				{ sudo: true }
			);

			await apt.install(transport, ["caddy"]);
			await systemd.enable(transport, "caddy");
		},

		async github(transport: Transport, version: string): Promise<void> {
			if (!/^\d+\.\d+\.\d+$/.test(version)) {
				throw new Error(
					`Caddy release assets are named "caddy_<major>.<minor>.<patch>_..."; "${version}" is not a full version.`
				);
			}

			const architecture = await releaseArchitecture(transport);
			const asset = `caddy_${version}_linux_${architecture}.deb`;
			const checksums = `caddy_${version}_checksums.txt`;
			const stagingDirectory = `/tmp/infra-rig-caddy-${process.pid}`;
			const assetPath = `${stagingDirectory}/${asset}`;
			const release = `https://github.com/caddyserver/caddy/releases/download/v${version}`;
			const download = (name: string): string =>
				sh`curl --fail --silent --show-error --location ${`${release}/${name}`} --output ${`${stagingDirectory}/${name}`}`;

			await run(transport, sh`install --directory --mode 0700 ${stagingDirectory}`, { sudo: true });

			try {
				await run(transport, download(asset), { sudo: true });
				await run(transport, download(checksums), { sudo: true });
				await run(transport, checkReleaseChecksums(stagingDirectory, checksums, asset), { sudo: true });
				await run(transport, sh`dpkg --install ${assetPath}`, { sudo: true });
			} finally {
				await tryRun(transport, sh`rm --recursive --force ${stagingDirectory}`, { sudo: true });
			}
		},

		async latestVersion(): Promise<string> {
			const body = await capture(
				local,
				"curl --fail --silent --show-error --location https://api.github.com/repos/caddyserver/caddy/releases/latest"
			);

			let release: { tag_name?: string };
			try {
				release = JSON.parse(body) as { tag_name?: string };
			} catch {
				// A proxy or captive portal answers with HTML, not an API error.
				throw new Error(`GitHub's release API did not answer with JSON: ${body.slice(0, 200)}`);
			}

			const tag = release.tag_name;
			if (tag === undefined) {
				throw new Error("GitHub's release response for Caddy has no tag name.");
			}

			const version = /^v(\d+\.\d+\.\d+)$/.exec(tag)?.[1];
			if (version === undefined) {
				throw new Error(`The Caddy release tag "${tag}" is not a version like "v2.11.7".`);
			}

			return version;
		}
	},

	async deployConfig(transport: Transport, content: string): Promise<void> {
		const staging = `/tmp/Caddyfile.staging.${process.pid}`;
		await files.write(transport, staging, content);

		try {
			await run(transport, sh`caddy validate --config ${staging}`, { sudo: true });
		} catch (error) {
			await run(transport, sh`rm --force ${staging}`, { silent: true });
			throw error;
		}

		for (const script of [
			sh`install --mode 0644 --owner root --group root ${staging} /etc/caddy/Caddyfile`,
			sh`rm --force ${staging}`
		]) {
			await run(transport, script, { sudo: true });
		}

		await systemd.restart(transport, "caddy");
	},

	async isActive(transport: Transport): Promise<boolean> {
		return systemd.isActive(transport, "caddy");
	},

	async recentLogs(transport: Transport, options: { lines: number }): Promise<string> {
		const lines = options?.lines ?? 30;
		return capture(transport, `journalctl --unit caddy --no-pager --lines ${lines}`, { sudo: true });
	}
};

const releaseArchitectures: Readonly<Record<string, string>> = {
	amd64: "amd64",
	arm64: "arm64",
	ppc64el: "ppc64le",
	riscv64: "riscv64",
	s390x: "s390x"
};

async function releaseArchitecture(transport: Transport): Promise<string> {
	const debianArchitecture = (await capture(transport, "dpkg --print-architecture")).trim();
	const architecture = releaseArchitectures[debianArchitecture];

	if (architecture === undefined) {
		throw new Error(
			`Caddy publishes no Debian package for Debian architecture "${debianArchitecture}". Supported: ${Object.keys(releaseArchitectures).join(", ")}.`
		);
	}

	return architecture;
}

function checkReleaseChecksums(directory: string, checksums: string, asset: string): string {
	return [
		// The list names assets bare, so `sha512sum` has to run from the directory
		// they were downloaded into.
		sh`cd ${directory}`,
		"&&",
		sh`awk -v asset=${asset} '$2 == asset { print }' ${checksums}`,
		"| sha512sum --check"
	].join(" ");
}
