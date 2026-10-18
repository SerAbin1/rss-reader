// Every /api/* request, on demand. The routing and the handlers stay in
// functions/; this only hands Astro's request and the Worker's bindings over.
import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import worker from "../../../functions/index";

export const prerender = false;

export const ALL: APIRoute = ({ request }) => worker.fetch(request, env);
