import { DurableObject } from 'cloudflare:workers';

import { Env } from './env';

/** One room per sync code: relays "changed" to every connected device. */
export class SyncRoom extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') === 'websocket') {
      const pair = new WebSocketPair();
      this.ctx.acceptWebSocket(pair[1]);
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.send('changed');
      } catch {
        /* closed socket */
      }
    }
    return new Response('ok');
  }

  webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): void {
    if (message === 'ping') socket.send('pong');
  }

  webSocketClose(socket: WebSocket, code: number): void {
    socket.close(code);
  }
}
