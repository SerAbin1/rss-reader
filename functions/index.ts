// The Worker entry. On Pages the file layout under functions/ was the router;
// on Workers that's ours to do, so this table maps each path to the handlers
// its file exports. Static assets never get here: wrangler.toml runs this
// Worker first only for /api/*, and everything else is served from dist/.
import * as feed from "./api/feed";
import * as claim from "./api/sync/claim";
import * as device from "./api/sync/device";
import * as feeds from "./api/sync/feeds";
import * as pair from "./api/sync/pair";
import * as state from "./api/sync/state";
import { jsonError, type SyncContext } from "./api/sync/_shared";

type Handler = (ctx: SyncContext) => Promise<Response>;

const routes: Record<string, Record<string, Handler>> = {
  "/api/feed": { GET: feed.onRequestGet },
  "/api/sync/claim": { POST: claim.onRequestPost },
  "/api/sync/device": { DELETE: device.onRequestDelete },
  "/api/sync/feeds": { GET: feeds.onRequestGet, POST: feeds.onRequestPost },
  "/api/sync/pair": { POST: pair.onRequestPost },
  "/api/sync/state": { GET: state.onRequestGet, POST: state.onRequestPost },
};

export default {
  async fetch(request: Request, env: SyncContext["env"]): Promise<Response> {
    const methods = routes[new URL(request.url).pathname];
    if (methods === undefined) return jsonError("Not found.", 404);

    const handler = methods[request.method];
    // What Pages answered for a route without a handler for the method.
    if (handler === undefined) return jsonError("Method not allowed.", 405);

    return handler({ request, env });
  },
};
