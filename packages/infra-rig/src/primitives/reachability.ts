import { setTimeout as sleep } from "node:timers/promises";
import { CommandError } from "./shell.js";
import { ui } from "./ui.js";
import { capture, type Transport } from "../transports/transport.js";

export interface WaitReachableOptions {
	attempts?: number;
	intervalMs?: number;
}

export async function isReachable(transport: Transport): Promise<boolean> {
	return (await probe(transport)) === undefined;
}

export async function waitReachable(
	transport: Transport,
	options: WaitReachableOptions = {}
): Promise<void> {
	const attempts = options.attempts ?? 30;
	const intervalMs = options.intervalMs ?? 2000;

	for (let attempt = 1; attempt <= attempts; attempt += 1) {
		const failure = await probe(transport);
		if (failure === undefined) return;

		if (isHostKeyFailure(failure)) throw new Error(hostKeyFailureMessage(transport, failure));

		ui.log(`Waiting for ${transport.label} (${attempt}/${attempts})…`);
		await sleep(intervalMs);
	}

	throw new Error(`Timed out waiting for ${transport.label}.`);
}


async function probe(transport: Transport): Promise<CommandError | undefined> {
	try {
		await capture(transport, "true");
		return undefined;
	} catch (error) {
		if (error instanceof CommandError) return error;
		throw error;
	}
}

const hostKeyFailurePattern = /Host key verification failed/i;

function isHostKeyFailure(error: CommandError): boolean {
	return hostKeyFailurePattern.test(error.result.stderr);
}

function hostKeyFailureMessage(transport: Transport, error: CommandError): string {
	return [
		`${transport.label} refused the server's host key: known_hosts rejects it.`,
		"Usually the server was destroyed and recreated, so it now presents a new key.",
		"If that is expected, remove the stale entry and try again, for example: ssh-keygen -R \"[host]:port\"",
		"",
		error.message
	].join("\n");
}