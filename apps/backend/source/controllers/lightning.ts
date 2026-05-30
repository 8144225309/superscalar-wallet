/**
 * Lightning Controller — /v1/cln/* and /v1/factories/* express handlers.
 *
 * What it provides
 *   The transport bridge between the wallet UI and the CLN node:
 *   - `callMethod`: POST /v1/cln/call — generic CLN RPC dispatcher.
 *     Receives `{ method, params }`, forwards via the configured
 *     NodeManager (gRPC / REST / lnmessage commando), and routes
 *     the result back. The SuperScalar plugin RPCs (factory-create,
 *     factory-rotate, wallet-list-events-since, etc.) all flow
 *     through this single endpoint.
 *
 * Side effects
 *   - Calls the active CLN transport (selected by APP_CONNECT env)
 *   - Mutating methods are routed through clnMethodToAuditEvent and
 *     written to the audit log (login_*, factory_*, fundchannel,
 *     close). Read-only methods (listpeers/listfunds/getinfo/sql)
 *     are NOT logged to keep the audit trail scannable.
 *
 * Transport selection
 *   APP_CONNECT determines the NodeManager flavor at boot:
 *     COMMANDO  → lnmessage (Tor-friendly, used by the demo wallet)
 *     GRPC      → grpc.js client (mainnet hardened)
 *     REST      → c-lightning-REST gateway
 *   Each implements the same .callMethod(method, params) interface.
 *
 * Routing
 *   Mounted under /v1/cln/* by source/routes/cln.routes.ts. The
 *   /v1/factories/* routes also reach this controller because all
 *   plugin RPCs are CLN-method calls under the hood.
 */
import { Request, Response, NextFunction } from 'express';
import handleError from '../shared/error-handler.js';
import { NodeManager } from '../service/node-manager.service.js';
import { logger } from '../shared/logger.js';
import { AppConnect, APP_CONSTANTS } from '../shared/consts.js';
import { appendAudit, clnMethodToAuditEvent } from '../shared/audit-log.js';

export class LightningController {
  private nodeManager: NodeManager;

  constructor(nodeManager: NodeManager) {
    this.nodeManager = nodeManager;
  }

  callMethod = async (req: Request, res: Response, next: NextFunction) => {
    try {
      logger.info('Calling method: ' + req.body.method);
      const auditEvent = clnMethodToAuditEvent(req.body.method);
      if (auditEvent) {
        appendAudit(auditEvent, req, { method: req.body.method });
      }
      const clnService = this.nodeManager.getActiveService();
      clnService
        .call(req.body.method, req.body.params)
        .then((commandRes: any) => {
          logger.info(
            'Controller received response for ' +
              req.body.method +
              ': ' +
              JSON.stringify(commandRes),
          );
          if (
            APP_CONSTANTS.APP_CONNECT == AppConnect.COMMANDO &&
            req.body.method &&
            req.body.method === 'listpeers'
          ) {
            // Filter out ln message pubkey from peers list
            const lnmPubkey = clnService.getLNMsgPubkey();
            commandRes.peers = commandRes.peers.filter((peer: any) => peer.id !== lnmPubkey);
            res.status(200).json(commandRes);
          } else {
            res.status(200).json(commandRes);
          }
        })
        .catch((err: any) => {
          logger.error(
            'Controller caught lightning error from ' +
              req.body.method +
              ': ' +
              JSON.stringify(err),
          );
          return handleError(err, req, res, next);
        });
    } catch (error: any) {
      return handleError(error, req, res, next);
    }
  };
}
