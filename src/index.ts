import { Env } from './env';
import { handleRequest } from './handler';
import { checkFeeds } from './push';

export { SyncRoom } from './room';

export default {
  fetch: handleRequest,

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(checkFeeds(env));
  },
} satisfies ExportedHandler<Env>;
