import * as crypto from 'crypto';
import * as fs from 'fs';
import * as net from 'net';
import https from 'https';
import axios, { AxiosHeaders } from 'axios';
import Lnmessage from 'lnmessage';
import WebSocket from 'ws';
import { GRPCError, LightningError, ValidationError } from '../models/errors.js';
import {
  HttpStatusCode,
  APP_CONSTANTS,
  AppConnect,
  Environment,
  LN_MESSAGE_CONFIG,
  REST_CONFIG,
} from '../shared/consts.js';
import { logger } from '../shared/logger.js';
import { setEnvVariables, validateEnvVariables } from '../shared/utils.js';
import { NodeProfile } from '../models/node-profile.type.js';

/** Internal flag to skip env-based init in the constructor */
const SKIP_INIT = Symbol('skipInit');

/** Max time to wait for a commando response before giving up and marking the connection dead. */
const COMMANDO_CALL_TIMEOUT_MS = 20000;

export class LightningService {
  private clnService: any = null;
  private axiosConfig: any = {
    baseURL: '',
    headers: {},
    httpsAgent: null,
  };
  /** Per-instance rune. Defaults to APP_CONSTANTS.ADMIN_RUNE for legacy path. */
  private rune: string = '';
  /** Marks the service as unusable; NodeManager rebuilds on next getActiveService() call. */
  private dead: boolean = false;
  /** True once the WS connection has been established at least once. Prevents
   *  the initial 'disconnected' status from lnmessage from marking a fresh service dead. */
  private wasConnected: boolean = false;
  /** Local Unix-socket path (lightning-rpc) when known. Lets signMessage
   *  bypass commando-over-WebSocket on co-located CLN deployments where
   *  the local lnmessage library can't reliably deliver RPCs against
   *  newer CLN versions. Falls back to commando when not set or socket
   *  is unreachable. */
  private socketPath?: string;

  constructor(skipInit?: typeof SKIP_INIT) {
    if (skipInit === SKIP_INIT) {
      // Factory-created instance: skip env setup
      return;
    }
    try {
      setEnvVariables();
      validateEnvVariables();
    } catch (error: any) {
      throw new ValidationError(HttpStatusCode.INVALID_DATA, error);
    }
    this.rune = APP_CONSTANTS.ADMIN_RUNE;
    try {
      logger.info('Strating Lightning Service with APP_CONNECT: ' + APP_CONSTANTS.APP_CONNECT);
      switch (APP_CONSTANTS.APP_CONNECT) {
        case AppConnect.REST:
          logger.info('REST connecting with config: ' + JSON.stringify(REST_CONFIG));
          const headers = new AxiosHeaders();
          headers.set('rune', REST_CONFIG.rune);
          this.axiosConfig = {
            baseURL: REST_CONFIG.url + '/v1/',
            headers,
          };
          if (APP_CONSTANTS.LIGHTNING_REST_PROTOCOL === 'https') {
            this.axiosConfig.httpsAgent = new https.Agent({ ca: REST_CONFIG.restCaCert });
          }
          break;
        case AppConnect.GRPC:
          this.clnService = null;
          throw new ValidationError(
            HttpStatusCode.INVALID_DATA,
            'gRPC connection to the Lightning node is not supported. Please use the COMMANDO or REST options for APP_CONNECT.',
          );
          // logger.info('GRPC connecting with config: ' + JSON.stringify(GRPC_CONFIG));
          // this.clnService = new GRPCService(GRPC_CONFIG);
          break;
        default:
          logger.info('lnMessage connecting with config: ' + JSON.stringify(LN_MESSAGE_CONFIG));
          this.clnService = new Lnmessage(LN_MESSAGE_CONFIG);
          this.clnService.connect();
          break;
      }
    } catch (error: any) {
      logger.error('Failed to construct lightning service: ' + JSON.stringify(error));
      throw error;
    }
  }

  /**
   * Create a LightningService from a NodeProfile without mutating globals.
   */
  static createFromProfile(profile: NodeProfile): LightningService {
    const wsProtocol = APP_CONSTANTS.LIGHTNING_WS_PROTOCOL || 'ws';
    const config: any = {
      remoteNodePublicKey: profile.pubkey,
      wsProxy: wsProtocol + '://' + profile.wsHost + ':' + profile.wsPort,
      ip: profile.wsHost,
      port: profile.wsPort,
      privateKey: crypto.randomBytes(32).toString('hex'),
      socket: (url: string) =>
        wsProtocol === 'wss'
          ? new WebSocket(url, { rejectUnauthorized: false })
          : new WebSocket(url),
      logger: {
        info: APP_CONSTANTS.APP_MODE === Environment.PRODUCTION ? () => {} : console.info,
        warn: APP_CONSTANTS.APP_MODE === Environment.PRODUCTION ? () => {} : console.warn,
        error: console.error,
      },
    };

    const svc = new LightningService(SKIP_INIT);
    svc.clnService = new Lnmessage(config);
    svc.clnService.connect();
    svc.rune = profile.rune;
    svc.socketPath = profile.sourcePath;
    // Subscribe to connection status so we can mark the service dead when the WS closes.
    // lnmessage emits 'disconnected' when the underlying WebSocket goes away.
    try {
      if (
        svc.clnService.connectionStatus$ &&
        typeof svc.clnService.connectionStatus$.subscribe === 'function'
      ) {
        svc.clnService.connectionStatus$.subscribe((status: string) => {
          if (status === 'connected') {
            svc.wasConnected = true;
          } else if (status === 'disconnected' && svc.wasConnected) {
            // Only mark dead after the connection was established at least once.
            // lnmessage emits 'disconnected' as its initial state before the
            // WS handshake completes — that's not a real disconnection.
            logger.warn(
              'lnmessage connection lost for profile ' + profile.id + '; marking service dead',
            );
            svc.dead = true;
          }
        });
      }
    } catch (err: any) {
      logger.warn('Could not subscribe to lnmessage connectionStatus$: ' + (err.message || err));
    }
    logger.info(
      'Created LightningService from profile: ' + profile.id + ' (' + profile.label + ')',
    );
    return svc;
  }

  /** True if the service has been marked dead by a timeout or disconnect event. */
  isDead(): boolean {
    return this.dead;
  }

  /**
   * Probe a node profile: create temp connection, call getinfo, disconnect, return info.
   */
  static async probe(profile: NodeProfile): Promise<{
    alias: string;
    pubkey: string;
    network: string;
    blockheight: number;
    version: string;
  }> {
    const svc = LightningService.createFromProfile(profile);
    try {
      // Wait a moment for the connection to establish
      await new Promise(resolve => setTimeout(resolve, 1000));
      const info: any = await svc.call('getinfo', []);
      return {
        alias: info.alias || '',
        pubkey: info.id || profile.pubkey,
        network: info.network || '',
        blockheight: info.blockheight || 0,
        version: info.version || '',
      };
    } finally {
      svc.disconnect();
    }
  }

  /**
   * Tear down the lnmessage connection.
   */
  disconnect(): void {
    try {
      if (this.clnService && typeof this.clnService.disconnect === 'function') {
        this.clnService.disconnect();
        logger.info('LightningService disconnected');
      }
    } catch (error: any) {
      logger.error('Error disconnecting LightningService: ' + (error.message || error));
    }
    this.clnService = null;
  }

  getLNMsgPubkey = () => {
    return this.clnService?.publicKey || '';
  };

  /**
   * Sign an arbitrary UTF-8 message with the active CLN node's HSM key.
   * Wraps the standard CLN signmessage RPC and returns the zbase signature
   * (which checkmessage verifies via BOLT-7 gossip membership).
   *
   * Used by the soup-rendezvous proof-of-channel flow: the host signs a
   * coordinator-bound challenge here, then the backend embeds the zbase
   * in a NIP-44-encrypted proof_multi DM to the coordinator.
   */
  signMessage = async (
    message: string,
  ): Promise<{ zbase: string; signature: string; pubkey?: string }> => {
    /* Try the Unix socket first when the wallet is co-located with CLN.
     * lnmessage 0.2.9 commando hangs against newer CLN versions in some
     * configurations (WS handshake completes, commando RPCs never reply);
     * the local lightning-rpc socket bypasses that path entirely. */
    if (this.socketPath && fs.existsSync(this.socketPath)) {
      try {
        const res: any = await this.rpcViaSocket('signmessage', [message]);
        if (!res || typeof res.zbase !== 'string') {
          throw new LightningError(
            HttpStatusCode.LIGHTNING_SERVER,
            'signmessage (socket) returned no zbase field',
          );
        }
        return { zbase: res.zbase, signature: res.signature, pubkey: res.pubkey };
      } catch (err: any) {
        logger.warn(
          'signMessage via socket ' + this.socketPath + ' failed (' +
            (err.message || err) + '); falling back to commando',
        );
      }
    }
    const res: any = await this.call('signmessage', [message]);
    if (!res || typeof res.zbase !== 'string') {
      throw new LightningError(
        HttpStatusCode.LIGHTNING_SERVER,
        'signmessage returned no zbase field',
      );
    }
    return { zbase: res.zbase, signature: res.signature, pubkey: res.pubkey };
  };

  /** Send a JSON-RPC call directly over the CLN lightning-rpc Unix socket.
   * Mirrors NodeProfilesService.rpcCall — kept private here so signMessage
   * has a path that doesn't depend on lnmessage/commando. */
  private rpcViaSocket(method: string, params: any): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.socketPath) {
        reject(new Error('no socketPath on this LightningService instance'));
        return;
      }
      const client = net.createConnection({ path: this.socketPath }, () => {
        const id = Math.floor(Math.random() * 1000000);
        client.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
      });
      let data = '';
      client.on('data', chunk => {
        data += chunk.toString();
        try {
          const parsed = JSON.parse(data);
          client.destroy();
          if (parsed.error) {
            reject(new Error(parsed.error.message || JSON.stringify(parsed.error)));
          } else {
            resolve(parsed.result);
          }
        } catch { /* partial JSON, wait for more */ }
      });
      client.on('error', err => { client.destroy(); reject(err); });
      client.setTimeout(5000, () => { client.destroy(); reject(new Error('socket RPC timeout')); });
    });
  }

  call = async (method: string, methodParams: any[]) => {
    switch (APP_CONSTANTS.APP_CONNECT) {
      case AppConnect.REST:
        return axios
          .post(method, methodParams, this.axiosConfig)
          .then((commandRes: any) => {
            logger.info(
              'REST response for ' +
                method +
                ': ' +
                JSON.stringify(commandRes.data || commandRes.rows),
            );
            return Promise.resolve(commandRes.data || commandRes.rows);
          })
          .catch((err: any) => {
            logger.error('REST lightning error from ' + method + ' command');
            if (typeof err === 'string') {
              logger.error(err);
              throw new LightningError(HttpStatusCode.LIGHTNING_SERVER, err);
            } else {
              logger.error(JSON.stringify(err));
              throw new LightningError(HttpStatusCode.LIGHTNING_SERVER, err.message || err.code);
            }
          });
      case AppConnect.GRPC:
        return this.clnService
          .callMethod(method, methodParams)
          .then((gRPCRes: any) => {
            logger.info('gRPC response for ' + method + ': ' + JSON.stringify(gRPCRes));
            return Promise.resolve(gRPCRes);
          })
          .catch((err: GRPCError) => {
            logger.error('gRPC lightning error from ' + method + ' command');
            throw err;
          });
      default: {
        const commandoPromise = this.clnService.commando({
          method: method,
          params: methodParams,
          rune: this.rune || APP_CONSTANTS.ADMIN_RUNE,
          reqId: crypto.randomBytes(8).toString('hex'),
          reqIdPrefix: 'clnapp',
        });
        let timer: NodeJS.Timeout | null = null;
        const timeoutPromise = new Promise((_, reject) => {
          timer = setTimeout(() => {
            this.dead = true;
            reject(
              new Error(
                'Commando timeout after ' + COMMANDO_CALL_TIMEOUT_MS + 'ms for method ' + method,
              ),
            );
          }, COMMANDO_CALL_TIMEOUT_MS);
        });
        return Promise.race([commandoPromise, timeoutPromise])
          .then((commandRes: any) => {
            if (timer) clearTimeout(timer);
            logger.info('Commando response for ' + method + ': ' + JSON.stringify(commandRes));
            return commandRes;
          })
          .catch((err: any) => {
            if (timer) clearTimeout(timer);
            logger.error('Commando lightning error from ' + method + ' command');
            if (typeof err === 'string') {
              logger.error(err);
              throw new LightningError(HttpStatusCode.LIGHTNING_SERVER, err);
            } else {
              logger.error(JSON.stringify(err));
              throw new LightningError(HttpStatusCode.LIGHTNING_SERVER, err.message || err.code);
            }
          });
      }
    }
  };
}
