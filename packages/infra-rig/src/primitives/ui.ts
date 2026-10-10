import { createInterface } from "node:readline/promises";
import { styleText } from "node:util";

export interface Confirmation {
	message: string;
	phrase: string;
}


export const ui = {
	title(title: string): void {
		console.log(`\n${styleText("bold", title)}\n${"─".repeat(title.length)}`);
	},

	heading(message: string): void {
		console.log(`\n${styleText(["cyan", "bold"], message)}`);
	},

	log(message: string): void {
		console.log(message);
	},

	fields(values: Record<string, string>): void {
		const width = Math.max(0, ...Object.keys(values).map((label) => label.length));

		for (const [label, value] of Object.entries(values)) {
			console.log(`${label.padEnd(width)} : ${value}`);
		}
	},

	warn(message: string): void {
		console.warn(`${styleText("yellow", `! ${message}`)}`);
	},

	async confirm({ message, phrase }: Confirmation): Promise<void> {
		const divider = styleText("yellow", "=".repeat(60));
		console.log(`\n${divider}`);
		console.log(message);
		console.log(divider);

		if (openConfirmations > 0) {
			console.log(styleText("dim", "Unattended: confirmed without asking."));
			return;
		}

		const readline = createInterface({ input: process.stdin, output: process.stdout });
		const answer = await readline.question(`Type ${styleText("yellow", `"${phrase}"`)} to continue: `);
		readline.close();

		if (answer.trim() !== phrase) {
			console.error(styleText("red", "Confirmation phrase did not match. Aborting."));
			process.exit(1);
		}
		console.log(styleText("green", "Confirmed."));
	},

	async autoConfirm<T>(fn: () => Promise<T>): Promise<T> {
		openConfirmations += 1;
		try {
			return await fn();
		} finally {
			openConfirmations -= 1;
		}
	}
};

let openConfirmations = 0;