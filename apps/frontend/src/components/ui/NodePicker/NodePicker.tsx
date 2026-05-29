import './NodePicker.scss';
import { Dropdown, OverlayTrigger, Tooltip } from 'react-bootstrap';
import InlineSpinner from '../InlineSpinner/InlineSpinner';
import { useSelector } from 'react-redux';
import { useInjectReducer } from '../../../hooks/use-injectreducer';
import nodesReducer from '../../../store/nodesSlice';
import { setIsSwitching, setIsDiscovering, setActiveProfileId, setProfileHealth } from '../../../store/nodesSlice';
import { selectNodeProfiles, selectActiveProfile, selectIsSwitchingNode, selectHasMultipleNodes, selectActiveProfileId, selectIsConnected, selectIsDiscovering, selectProfileHealth } from '../../../store/nodesSelectors';
import { selectNodeInfo } from '../../../store/rootSelectors';
import { NodesService, RootService, CLNService, BookkeeperService, FactoriesService } from '../../../services/http.service';
import { clearNodeData } from '../../../store/rootSlice';
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
      if (result.profiles && result.profiles.length > 0) {
        // Re-fetch profile list
        await NodesService.fetchAndDispatchNodes();
        const nodeData = await NodesService.listNodes();
        // If not connected yet, auto-switch to the first discovered node
        if (!nodeData.activeProfileId && result.profiles.length > 0) {
          await handleSwitchNode(result.profiles[0].id);
        } else if (nodeData.activeProfileId && !nodeData.isConnected) {
          // Profile exists but not connected — reconnect
          await handleSwitchNode(nodeData.activeProfileId);
        }
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
    } finally {
      appStore.dispatch(setIsDiscovering(false));
    }
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

  // No connection and no profiles — show scan button
  if (!actuallyConnected && profiles.length === 0 && !nodeInfo.isLoading) {
    return (
      <span className='fs-7 d-flex align-items-center'>
        <OverlayTrigger placement='auto' delay={{ show: 250, hide: 250 }} overlay={<Tooltip>{nodeInfo.error || 'Disconnected'}</Tooltip>}>
          <span className='d-inline-block me-2 dot bg-danger'></span>
        </OverlayTrigger>
        <button
          className='btn btn-sm btn-outline-warning btn-rounded px-3'
          onClick={handleDiscover}
          disabled={isDiscovering}
        >
          {isDiscovering ? <InlineSpinner label='Scanning' marginEnd={1} /> : 'Scan for Nodes'}
        </button>
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
      </span>
    );
  }

  // Multiple nodes: show dropdown
  return (
    <Dropdown className='node-picker d-inline-flex align-items-center'>
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
      </Dropdown.Menu>
    </Dropdown>
  );
};

export default NodePicker;
