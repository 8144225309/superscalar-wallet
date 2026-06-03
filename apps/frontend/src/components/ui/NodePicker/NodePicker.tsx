import './NodePicker.scss';
import { useEffect, useRef } from 'react';
import { Dropdown, OverlayTrigger, Tooltip } from 'react-bootstrap';

/**
 * Node Picker — multi-CLN-node profile dropdown.
 *
 * What it renders
 *   The header profile control: active profile alias, dropdown with
 *   every discovered profile, per-row health dots (red/green/dashed),
 *   and inline spinners while a switch is in flight.
 *
 * Key state (Redux-backed via nodesSlice)
 *   - `profiles`: discovered CLN profiles (R7-era env-gated discovery)
 *   - `activeProfileId`
 *   - `isSwitching` / `isDiscovering`: spinner gates
 *   - `profileHealth`: per-profile last-known reachability (event-driven
 *     after PR #160 — no busy-polling)
 *
 * Side effects
 *   - On switch: fans out parallel calls to refetch dashboard state
 *     (PR #68 parallelized RootService.fetchRootData + refreshData)
 *   - Clears Redux node-scoped stores (clnSlice / bkprSlice /
 *     factoriesSlice / root.nodeInfo) before refetching so the UI
 *     doesn't show stale data from the previous profile
 *
 * Props contract
 *   None — fully self-contained. Mounted in Header.
 */

import { useState } from 'react';
import InlineSpinner from '../InlineSpinner/InlineSpinner';
import AddNodeModal from './AddNodeModal';
import { useSelector } from 'react-redux';
import { useInjectReducer } from '../../../hooks/use-injectreducer';
import nodesReducer from '../../../store/nodesSlice';
import { setIsSwitching, setIsDiscovering, setActiveProfileId, setProfileHealth } from '../../../store/nodesSlice';
import { selectNodeProfiles, selectActiveProfile, selectIsSwitchingNode, selectHasMultipleNodes, selectActiveProfileId, selectIsConnected, selectIsDiscovering, selectProfileHealth } from '../../../store/nodesSelectors';
import { selectNodeInfo } from '../../../store/rootSelectors';
import { NodesService, RootService, CLNService, BookkeeperService, FactoriesService } from '../../../services/http.service';
import { clearNodeData, setShowToast } from '../../../store/rootSlice';
import { clearCLNStore } from '../../../store/clnSlice';
import { clearBKPRStore } from '../../../store/bkprSlice';
import { clearFactoriesStore } from '../../../store/factoriesSlice';
import { appStore } from '../../../store/appStore';
import { truncatePubkey } from '../../../utilities/data-formatters';
import logger from '../../../services/logger.service';

const NodePicker = () => {
  useInjectReducer('nodes', nodesReducer);

  const profiles = useSelector(selectNodeProfiles);
  const activeProfile = useSelector(selectActiveProfile);
  const activeProfileId = useSelector(selectActiveProfileId);
  const isSwitching = useSelector(selectIsSwitchingNode);
  const isConnected = useSelector(selectIsConnected);
  const isDiscovering = useSelector(selectIsDiscovering);
  const hasMultipleNodes = useSelector(selectHasMultipleNodes);
  const nodeInfo = useSelector(selectNodeInfo);
  const profileHealth = useSelector(selectProfileHealth);

  /* Add-node modal visibility. Triggered from the no-profiles scan state,
   * the single-node display, and the multi-node dropdown footer (S2 gap fix). */
  const [showAddNode, setShowAddNode] = useState(false);

  /* Initial health probe: when profiles first land, fire one healthCheck so
   * every row in the dropdown gets a real red/green dot instead of staying
   * "unprobed (?)" until the user manually rescans. Guarded with a ref so we
   * only fire once per session — subsequent updates come from rescan or
   * post-switch handlers. */
  const didInitialHealthProbe = useRef(false);
  useEffect(() => {
    if (didInitialHealthProbe.current) return;
    if (profiles.length === 0) return;
    didInitialHealthProbe.current = true;
    NodesService.healthCheck()
      .then(h => {
        if (h?.health) appStore.dispatch(setProfileHealth(h.health));
      })
      .catch(err => logger.warn('Initial health check failed:', err));
  }, [profiles.length]);

  const handleSwitchNode = async (profileId: string) => {
    if (profileId === activeProfileId || isSwitching) return;

    try {
      appStore.dispatch(setIsSwitching(true));

      // Call switch endpoint
      const result = await NodesService.switchNode(profileId);

      // Clear node-specific data (preserves authStatus so polling keeps running)
      appStore.dispatch(clearNodeData());
      appStore.dispatch(clearCLNStore());
      appStore.dispatch(clearBKPRStore());
      appStore.dispatch(clearFactoriesStore());

      // Update active profile
      appStore.dispatch(setActiveProfileId(result.profile?.id || profileId));

      // Critical path: node info + balances. These don't depend on each
      // other so run them in parallel — was the dominant chunk of the
      // ~5s switch time when run sequentially. Both internally use
      // executeRequests which already pipelines its own internal RPCs;
      // firing them both at once lets the backend pipeline across them
      // too. ~2s reduction in observed switch time on the demo fleet.
      await Promise.all([
        RootService.fetchRootData(),
        RootService.refreshData(),
      ]);
    } catch (error) {
      logger.error('Failed to switch node:', error);
    } finally {
      // Clear switching state as soon as balances are loaded
      appStore.dispatch(setIsSwitching(false));
    }

    // Non-critical background refresh after profile switch. Eagerly refetches
    // ALL section data (factories, CLN dashboard, bookkeeper) regardless of
    // current pathname so the next page the user navigates to has fresh data
    // for the new profile. Previously only the section matching the current
    // pathname was refetched, which left e.g. the factories list empty when
    // a user switched profile on /bookkeeper and then navigated to /factories.
    // Fire-and-forget so a slow query on any node never blocks the UI.
    Promise.all([
      CLNService.fetchCLNData(),
      BookkeeperService.fetchBKPRData(),
      FactoriesService.fetchFactoriesData(),
      NodesService.fetchAndDispatchNodes(),
      NodesService.detectFactoryPlugin(),
      // Refresh per-profile health dots after a node switch. The probe is
      // sequential + capped server-side; failures merge into the slice so
      // any profile that lost contact stays red until the next good probe.
      NodesService.healthCheck()
        .then(h => {
          if (h?.health) appStore.dispatch(setProfileHealth(h.health));
        })
        .catch(err => logger.warn('Health check after switch failed:', err)),
    ]).catch(err => logger.error('Background post-switch refresh failed:', err));
  };

  const handleDiscover = async () => {
    if (isDiscovering) return;
    try {
      appStore.dispatch(setIsDiscovering(true));
      const result = await NodesService.discoverNodes();
      const newCount = result?.profiles?.length || 0;
      if (newCount > 0) {
        // Re-fetch profile list
        await NodesService.fetchAndDispatchNodes();
        const nodeData = await NodesService.listNodes();
        // If not connected yet, auto-switch to the first discovered node
        if (!nodeData.activeProfileId) {
          await handleSwitchNode(result.profiles[0].id);
        } else if (nodeData.activeProfileId && !nodeData.isConnected) {
          // Profile exists but not connected — reconnect
          await handleSwitchNode(nodeData.activeProfileId);
        }
        appStore.dispatch(setShowToast({
          show: true,
          message: `${newCount} new node${newCount === 1 ? '' : 's'} discovered`,
          bg: 'success',
        }));
      } else {
        /* Silence was the prior UX — no toast meant the user couldn't tell
         * if the scan ran. Surface an info toast so a no-op rescan still
         * confirms the click went through. */
        appStore.dispatch(setShowToast({
          show: true,
          message: 'Scan complete — no new nodes found',
          bg: 'info',
        }));
      }
      // Refresh per-profile health dots after the rescan so the dropdown
      // shows live red/green status for every profile in the list. Probe is
      // sequential + capped server-side; merge semantics in the slice keep
      // already-red nodes red until they actually answer.
      try {
        const health = await NodesService.healthCheck();
        if (health?.health) appStore.dispatch(setProfileHealth(health.health));
      } catch (err) {
        logger.warn('Health check after discover failed:', err);
      }
    } catch (error) {
      logger.error('Failed to discover nodes:', error);
      appStore.dispatch(setShowToast({
        show: true,
        message: 'Rescan failed — check wallet logs',
        bg: 'danger',
      }));
    } finally {
      appStore.dispatch(setIsDiscovering(false));
    }
  };

  /* After a successful add, switch to the newly-added node so the user
   * lands on it immediately rather than having to find it in the list.
   * Defined after handleSwitchNode so there's no use-before-define. */
  const handleNodeAdded = (profileId: string) => {
    appStore.dispatch(setShowToast({
      show: true,
      message: 'Node added — switching to it…',
      bg: 'success',
    }));
    handleSwitchNode(profileId);
  };

  const getNetworkBadgeVariant = (network?: string) => {
    if (!network || network === 'bitcoin') return null;
    return network === 'regtest' ? 'danger' : 'warning';
  };

  // Determine display alias and status based on nodeInfo
  const displayAlias = activeProfile?.alias
    || nodeInfo.alias?.replace('--', '-').replace(/-\d+-.*$/, '')
    || activeProfile?.label
    || 'Node';
  const displayPubkey = activeProfile?.pubkey || nodeInfo.id || '';

  // Status dot logic
  const getStatusDot = () => {
    if (isSwitching || (nodeInfo.isLoading)) {
      return (
        <OverlayTrigger
          placement='auto'
          delay={{ show: 250, hide: 250 }}
          overlay={<Tooltip>{isSwitching ? 'Switching' : 'Loading'}</Tooltip>}
        >
          <span className='d-inline-block me-2 dot bg-warning'></span>
        </OverlayTrigger>
      );
    }
    if (nodeInfo.error) {
      return (
        <OverlayTrigger
          placement='auto'
          delay={{ show: 250, hide: 250 }}
          overlay={<Tooltip>Error</Tooltip>}
        >
          <span className='d-inline-block me-2 dot bg-danger'></span>
        </OverlayTrigger>
      );
    }
    return (
      <OverlayTrigger
        placement='auto'
        delay={{ show: 250, hide: 250 }}
        overlay={<Tooltip>Connected</Tooltip>}
      >
        <span className='d-inline-block me-2 dot bg-success'></span>
      </OverlayTrigger>
    );
  };

  // Determine if we're actually connected — nodeInfo having an id means commando works
  const actuallyConnected = isConnected || !!nodeInfo.id;

  // No connection and no profiles — show scan + add buttons
  if (!actuallyConnected && profiles.length === 0 && !nodeInfo.isLoading) {
    return (
      <span className='fs-7 d-flex align-items-center'>
        <OverlayTrigger placement='auto' delay={{ show: 250, hide: 250 }} overlay={<Tooltip>{nodeInfo.error || 'Disconnected'}</Tooltip>}>
          <span className='d-inline-block me-2 dot bg-danger'></span>
        </OverlayTrigger>
        <button
          className='btn btn-sm btn-outline-warning btn-rounded px-3 me-2'
          onClick={handleDiscover}
          disabled={isDiscovering}
        >
          {isDiscovering ? <InlineSpinner label='Scanning' marginEnd={1} /> : 'Scan for Nodes'}
        </button>
        <button
          className='btn btn-sm btn-outline-primary btn-rounded px-3'
          onClick={() => setShowAddNode(true)}
          data-testid='add-node-trigger-empty'
        >
          + Add node
        </button>
        <AddNodeModal show={showAddNode} onHide={() => setShowAddNode(false)} onAdded={handleNodeAdded} />
      </span>
    );
  }

  // Single node, no dropdown needed
  if (!hasMultipleNodes) {
    return (
      <span className='fs-7 d-flex align-items-center'>
        {getStatusDot()}
        {isSwitching ? (
          <InlineSpinner label='Switching' />
        ) : nodeInfo.isLoading ? (
          'Connecting…'
        ) : nodeInfo.error ? (
          <>
            <span className='me-2'>{displayAlias} — unreachable</span>
            <button
              className='btn btn-sm btn-outline-warning btn-rounded px-2'
              onClick={handleDiscover}
              disabled={isDiscovering}
            >
              {isDiscovering ? <InlineSpinner label='Scanning' marginEnd={1} /> : 'Rescan'}
            </button>
          </>
        ) : (
          <>
            <strong>{displayAlias}</strong>
            {displayPubkey && (
              <span className='ms-1 opacity-50' style={{ fontSize: '0.85em' }}>({truncatePubkey(displayPubkey)})</span>
            )}
            {nodeInfo.version && <span className='ms-1 opacity-50' style={{ fontSize: '0.85em' }}>({nodeInfo.version})</span>}
          </>
        )}
        {/* With only one profile there's no dropdown, so surface an explicit
            "add node" affordance here — otherwise the user can never reach a
            second profile through the UI (the S2 gap). */}
        <button
          className='btn btn-sm btn-link text-light text-decoration-none ms-2 p-0'
          onClick={() => setShowAddNode(true)}
          title='Add another CLN node'
          data-testid='add-node-trigger-single'
          style={{ fontSize: '0.85em' }}
        >
          + Add node
        </button>
        <AddNodeModal show={showAddNode} onHide={() => setShowAddNode(false)} onAdded={handleNodeAdded} />
      </span>
    );
  }

  /* Multiple nodes: show dropdown.
   *
   * autoClose='outside': keep the dropdown open while the user clicks
   * "Rescan for Nodes" — the rescan can take several seconds and may
   * surface new entries the user wants to click on right away. The
   * default `autoClose=true` closes the menu the instant Rescan is
   * clicked, hiding the spinner and forcing the user to re-open to see
   * results. Profile-switch items still work — `handleSwitchNode`
   * navigates the wallet to the new profile and the dropdown is closed
   * implicitly by the user clicking elsewhere afterward. */
  return (
    <Dropdown autoClose='outside' className='node-picker d-inline-flex align-items-center'>
      <span className='d-flex align-items-center'>
        {getStatusDot()}
      </span>
      <Dropdown.Toggle variant='link' className='node-picker-toggle text-light p-0 fs-7'>
        {isSwitching ? (
          <InlineSpinner label='Switching' marginEnd={1} />
        ) : nodeInfo.isLoading ? (
          'Connecting…'
        ) : nodeInfo.error ? (
          <>{displayAlias} — <span className='text-danger'>unreachable</span></>
        ) : (
          <>
            <strong>{displayAlias}</strong>
            {displayPubkey && (
              <span className='ms-1 opacity-50' style={{ fontSize: '0.85em' }}>({truncatePubkey(displayPubkey)})</span>
            )}
          </>
        )}
      </Dropdown.Toggle>
      <Dropdown.Menu>
        <div className='node-picker-scroll'>
          {profiles.map((profile) => {
            const isActive = profile.id === activeProfileId;
            const badgeVariant = getNetworkBadgeVariant(profile.network);
            const health = profileHealth.find(h => h.profileId === profile.id);
            /* Polish 1.1/1.2 (color-blind redundancy):
             * Each health state pairs color WITH shape AND tooltip text:
             *   alive    → solid green, ✓ glyph,   tooltip "Reachable"
             *   down     → solid red,   ✕ glyph,   tooltip "Not responding"
             *   unprobed → dashed gray, ? glyph,   tooltip "Not yet probed"
             * This way colorblind users (and screen readers via the
             * tooltip) get the same signal as sighted users.
             */
            let state: 'alive' | 'down' | 'unprobed';
            if (isActive) state = nodeInfo.error ? 'down' : 'alive';
            else if (health) state = health.alive ? 'alive' : 'down';
            else state = 'unprobed';
            const dotStyle: React.CSSProperties =
              state === 'alive'
                ? { backgroundColor: '#33db95', color: '#0a3b22' }
                : state === 'down'
                  ? { backgroundColor: '#dc3545', color: '#fff' }
                  : { backgroundColor: 'transparent', border: '1px dashed #9f9f9f', color: '#9f9f9f' };
            const glyph = state === 'alive' ? '✓' : state === 'down' ? '✕' : '?';
            const tip = state === 'alive' ? 'Reachable' : state === 'down' ? 'Not responding' : 'Not yet probed';
            return (
              <Dropdown.Item
                key={profile.id}
                className='node-item'
                onClick={() => handleSwitchNode(profile.id)}
                active={isActive}
              >
                <OverlayTrigger placement='right' overlay={<Tooltip>{tip}</Tooltip>}>
                  <span
                    className='node-dot'
                    style={dotStyle}
                    aria-label={tip}
                    data-testid={`node-health-${state}`}
                  >
                    <span style={{ fontSize: '0.7em', lineHeight: 1, fontWeight: 700 }}>{glyph}</span>
                  </span>
                </OverlayTrigger>
                <div className='node-details'>
                  <div className='node-alias'>{profile.alias || profile.label}</div>
                  <div className='node-pubkey'>{truncatePubkey(profile.pubkey)}</div>
                </div>
                {badgeVariant && (
                  <span className={`node-network-badge badge bg-${badgeVariant} text-dark`}>
                    {profile.network}
                  </span>
                )}
              </Dropdown.Item>
            );
          })}
        </div>
        <Dropdown.Divider />
        <Dropdown.Item className='node-item node-picker-rescan' onClick={handleDiscover} disabled={isDiscovering}>
          {isDiscovering ? <InlineSpinner label='Scanning' marginEnd={1} /> : 'Rescan for Nodes'}
        </Dropdown.Item>
        <Dropdown.Item
          className='node-item node-picker-add'
          onClick={() => setShowAddNode(true)}
          data-testid='add-node-trigger-dropdown'
        >
          + Add a node…
        </Dropdown.Item>
      </Dropdown.Menu>
      <AddNodeModal show={showAddNode} onHide={() => setShowAddNode(false)} onAdded={handleNodeAdded} />
    </Dropdown>
  );
};

export default NodePicker;
