import * as fs from 'fs';
import * as path from 'path';
import {
  RendezvousSettings,
  CoordinatorNetwork,
  buildDefaultSettings,
  DEFAULT_COORDINATORS,
  DEFAULT_RELAYS,
} from '../models/rendezvous-settings.type.js';
import { logger } from '../shared/logger.js';

const SETTINGS_FILE = './rendezvous-settings.json';

export class RendezvousSettingsService {
  private configPath: string;

  constructor(configPath?: string) {
    this.configPath = configPath || SETTINGS_FILE;
  }

  load(): RendezvousSettings {
    try {
      if (fs.existsSync(this.configPath)) {
        const raw = fs.readFileSync(this.configPath, 'utf-8');
        const parsed = JSON.parse(raw) as RendezvousSettings;
        return this.reconcileDefaults(parsed);
      }
    } catch (error: any) {
      logger.error('Error loading rendezvous settings: ' + (error.message || error));
    }
    const fresh = buildDefaultSettings();
    this.save(fresh);
    return fresh;
  }

  save(settings: RendezvousSettings): void {
    try {
      const dir = path.dirname(path.resolve(this.configPath));
      const tmp = path.join(dir, '.rendezvous-settings.tmp.' + process.pid + '.json');
      fs.writeFileSync(tmp, JSON.stringify(settings, null, 2), 'utf-8');
      fs.renameSync(tmp, path.resolve(this.configPath));
      logger.info('Rendezvous settings saved');
    } catch (error: any) {
      logger.error('Error saving rendezvous settings: ' + (error.message || error));
      throw error;
    }
  }

  /**
   * Replace settings wholesale. Caller is expected to send a complete
   * RendezvousSettings object (the frontend reads, mutates locally,
   * then PUTs the whole thing back).
   */
  replace(next: RendezvousSettings): RendezvousSettings {
    const reconciled = this.reconcileDefaults(next);
    this.save(reconciled);
    return reconciled;
  }

  /**
   * Restore the default coordinators + default relays in their enabled
   * state, but keep any user-added coordinators / relays the user previously
   * appended. Knobs (caps, intervals, etc.) snap back to defaults.
   */
  reset(): RendezvousSettings {
    const current = this.load();
    const fresh = buildDefaultSettings();

    const networks: CoordinatorNetwork[] = ['bitcoin', 'signet', 'testnet4'];
    for (const net of networks) {
      const customs = current.coordinators[net].filter(c => !c.isDefault);
      fresh.coordinators[net] = [
        ...fresh.coordinators[net],
        ...customs.map(c => ({ ...c, enabled: c.enabled })),
      ];
    }

    const customRelays = current.relays.filter(r => !r.isDefault);
    fresh.relays = [...fresh.relays, ...customRelays.map(r => ({ ...r, enabled: r.enabled }))];

    this.save(fresh);
    return fresh;
  }

  /**
   * Make sure baked-in defaults are always present even if the user's
   * settings file was authored before a default was added. Defaults that
   * already exist keep their `enabled` flag — we only add missing ones,
   * we never silently re-enable something the user disabled.
   */
  private reconcileDefaults(settings: RendezvousSettings): RendezvousSettings {
    const out: RendezvousSettings = JSON.parse(JSON.stringify(settings));
    if (!out.version) out.version = 1;

    const networks: CoordinatorNetwork[] = ['bitcoin', 'signet', 'testnet4'];
    if (!out.coordinators) out.coordinators = { bitcoin: [], signet: [], testnet4: [] };
    for (const net of networks) {
      if (!out.coordinators[net]) out.coordinators[net] = [];
      const defaultNpub = DEFAULT_COORDINATORS[net];
      const has = out.coordinators[net].some(c => c.npub === defaultNpub);
      if (!has) {
        out.coordinators[net].unshift({
          npub: defaultNpub,
          enabled: true,
          isDefault: true,
          label: 'soup-rendezvous (' + net + ')',
        });
      } else {
        out.coordinators[net] = out.coordinators[net].map(c =>
          c.npub === defaultNpub ? { ...c, isDefault: true } : c,
        );
      }
    }

    if (!out.relays) out.relays = [];
    for (const url of DEFAULT_RELAYS) {
      const has = out.relays.some(r => r.url === url);
      if (!has) {
        out.relays.unshift({ url, enabled: true, isDefault: true });
      } else {
        out.relays = out.relays.map(r => (r.url === url ? { ...r, isDefault: true } : r));
      }
    }

    if (!out.tierCaps) out.tierCaps = { channel: 500, utxo: 500, peer: 100 };
    if (!out.showPeerTier) out.showPeerTier = { signet: true, testnet4: true, bitcoin: false };
    if (typeof out.maxEntries !== 'number') out.maxEntries = 500;
    if (typeof out.vouchRefreshMin !== 'number') out.vouchRefreshMin = 60;
    if (typeof out.vouchAutoRefresh !== 'boolean') out.vouchAutoRefresh = false;
    if (typeof out.browseCacheTtlMin !== 'number') out.browseCacheTtlMin = 5;

    return out;
  }
}
