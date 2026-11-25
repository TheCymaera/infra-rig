import { defineEnvVars } from "@sveltejs/kit/env";

export const variables = defineEnvVars({
	APP_GREETING: {
		description: "Greeting rendered on the home page.",
		schema: (value) => value ?? (() => { throw new Error("APP_GREETING is not set") })()
	}
});
