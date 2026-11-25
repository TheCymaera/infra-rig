import type { RequestHandler } from "./$types";

export const GET: RequestHandler = () => {
	return Response.json({
		status: "ok",
		uptime: Math.round(process.uptime())
	});
};
