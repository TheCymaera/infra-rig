const port = Number(Bun.env.PORT ?? (()=> { throw new Error("PORT is not set") })());
const greeting = Bun.env.APP_GREETING ?? (()=> { throw new Error("APP_GREETING is not set") })();

function renderPage(): string {
	return `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<title>${escapeHtml(greeting)}</title>
	</head>
	<body>
		<h1>${escapeHtml(greeting)}</h1>
	</body>
</html>`;
}

function handle(request: Request): Response {
	const { pathname } = new URL(request.url);

	if (pathname === "/health") {
		return Response.json({
			status: "ok",
			uptime: Math.round(process.uptime())
		});
	}

	if (pathname === "/") {
		return new Response(renderPage(), {
			headers: { "content-type": "text/html; charset=utf-8" }
		});
	}

	return new Response("Not found\n", { status: 404 });
}

const server = Bun.serve({ port, fetch: handle });
console.log(`Listening on http://localhost:${server.port}`);

function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");
}
