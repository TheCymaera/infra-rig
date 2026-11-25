import { APP_GREETING } from "$app/env/private";

export function load() {
	return { greeting: APP_GREETING };
}
