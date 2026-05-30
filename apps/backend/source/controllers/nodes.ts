/**
 * Nodes Controller — /v1/nodes/* express handlers.
 *
 * What it provides
 *   The multi-profile switcher. The demo wallet (and any operator with
 *   multiple CLN nodes — see project-signet-node-fleet for the a/b/c/d
 *   pattern) needs to flip the active node without restarting the
 *   wallet. This controller owns:
 *   - listProfiles: returns sanitized profiles (rune stripped) for the
 *     UI dropdown
 *   - addProfile / removeProfile: persisted profile editing
 *   - switchProfile: rebinds the NodeManager to a different transport
 *     target, then re-runs the connection flow
 *   - discoverNodes: scans the local network / known hosts for CLN
 *     endpoints to suggest as profiles
 *
 * Rune handling
 *   The `rune` field on a NodeProfile is the commando bearer secret.
 *   sanitizeProfile() destructure-rest strips it before any response
 *   so the rune never leaves the server. The disable comment is
 *   localized (not project-wide) per code style — see Lightning
 *   controller for the same pattern.
 *
 * Routing
 *   Mounted under /v1/nodes/* by source/routes/nodes.routes.ts.
 */
import { Request, Response, NextFunction } from 'express';
import handleError from '../shared/error-handler.js';
import { NodeManager } from '../service/node-manager.service.js';
import { logger } from '../shared/logger.js';
import { HttpStatusCode } from '../shared/consts.js';
import { APIError } from '../models/errors.js';
import { NodeProfile } from '../models/node-profile.type.js';

/** Strip the rune field from a profile before sending to the frontend */
function sanitizeProfile(profile: NodeProfile): Omit<NodeProfile, 'rune'> & { rune?: undefined } {
  // The `rune` binding is intentionally unused — the destructure-rest is
  // how we omit the field from `safe`. Disabling locally rather than
  // relaxing no-unused-vars project-wide keeps the rule maximally strict.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { rune, ...safe } = profile;
  return safe;
}

export class NodesController {
  private nodeManager: NodeManager;

  constructor(nodeManager: NodeManager) {
    this.nodeManager = nodeManager;
  }

  listProfiles = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const profiles = this.nodeManager.listProfiles();
      const activeProfile = this.nodeManager.getActiveProfile();
      res.status(200).json({
        activeProfileId: activeProfile?.id || null,
        profiles: profiles.map(sanitizeProfile),
        isConnected: this.nodeManager.isConnected(),
      });
    } catch (error: any) {
      handleError(error, req, res, next);
    }
  };

  getActiveProfile = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const profile = this.nodeManager.getActiveProfile();
      if (!profile) {
        return res.status(200).json({ profile: null });
      }
      res.status(200).json({ profile: sanitizeProfile(profile) });
    } catch (error: any) {
      handleError(error, req, res, next);
    }
  };

  switchNode = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { profileId } = req.body;
      if (!profileId) {
        return handleError(
          new APIError(HttpStatusCode.BAD_REQUEST, 'profileId is required'),
          req,
          res,
          next,
        );
      }
      logger.info('Switching to node profile: ' + profileId);
      const profile = await this.nodeManager.switchNode(profileId);
      res.status(200).json({ profile: sanitizeProfile(profile) });
    } catch (error: any) {
      handleError(error, req, res, next);
    }
  };

  discoverNodes = async (req: Request, res: Response, next: NextFunction) => {
    try {
      logger.info('Discovering nodes on the system');
      const discovered = await this.nodeManager.discoverNodes();
      res.status(200).json({
        profiles: discovered.map(sanitizeProfile),
      });
    } catch (error: any) {
      handleError(error, req, res, next);
    }
  };

  addProfile = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { label, pubkey, rune, wsHost, wsPort } = req.body;
      if (!pubkey || !rune || !wsHost || !wsPort) {
        return handleError(
          new APIError(HttpStatusCode.BAD_REQUEST, 'pubkey, rune, wsHost, and wsPort are required'),
          req,
          res,
          next,
        );
      }
      logger.info('Adding node profile for pubkey: ' + pubkey);
      const profile = await this.nodeManager.addProfile({
        label,
        pubkey,
        rune,
        wsHost,
        wsPort: Number(wsPort),
      });
      res.status(201).json({ profile: sanitizeProfile(profile) });
    } catch (error: any) {
      handleError(error, req, res, next);
    }
  };

  healthCheck = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const health = await this.nodeManager.checkAllHealth();
      res.status(200).json({ health });
    } catch (error: any) {
      handleError(error, req, res, next);
    }
  };

  removeProfile = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id as string;
      if (!id) {
        return handleError(
          new APIError(HttpStatusCode.BAD_REQUEST, 'Profile id is required'),
          req,
          res,
          next,
        );
      }
      logger.info('Removing node profile: ' + id);
      await this.nodeManager.removeProfile(id);
      res.status(204).send();
    } catch (error: any) {
      handleError(error, req, res, next);
    }
  };
}
