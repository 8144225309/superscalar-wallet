import './FactoryCreate.scss';
import { useMemo, useState } from 'react';
import { useSelector } from 'react-redux';
import { Card, Row, Col, Form, Spinner, Accordion, InputGroup, Alert, OverlayTrigger, Tooltip } from 'react-bootstrap';
import { CallStatus, CLEAR_STATUS_ALERT_DELAY } from '../../../utilities/constants';
import { FactoriesService, RendezvousService } from '../../../services/http.service';
import { publishSignedEvent } from '../../../services/nostr.service';
import StatusAlert from '../../shared/StatusAlert/StatusAlert';
import {
  FACTORY_PLAN_DEFAULTS,
  BLOCKS_PER_HOUR,
  blocksToDuration,
  planFactory,
  FactoryPlanWarning,
} from '../../../utilities/factory-planner';
import { FactoryAllocation, FactoryCreateOptions, FactoryLocalPrefs } from '../../../types/factories.type';
import { selectNodeInfo } from '../../../store/rootSelectors';
import { isCompressedPubkey, truncatePubkey } from '../../../utilities/validators';

type AdvertiseNetwork = 'bitcoin' | 'signet' | 'testnet4';
const ADVERTISE_NETWORKS: AdvertiseNetwork[] = ['bitcoin', 'signet', 'testnet4'];

/**
 * Map a CLN getinfo.network value to a soup-rendezvous network.
 * CLN reports "bitcoin" for mainnet, "regtest" / "testnet" / "testnet4" / "signet"
 * for others. We only advertise to coordinators that exist; regtest and legacy
 * testnet fall back to signet for the default.
 */
const mapClnNetwork = (n?: string): AdvertiseNetwork => {
  switch (n) {
    case 'bitcoin':
    case 'mainnet':
      return 'bitcoin';
    case 'testnet4':
      return 'testnet4';
    case 'signet':
    case 'regtest':
    case 'testnet':
    case 'testnet3':
    default:
      return 'signet';
  }
};

type FactoryCreateProps = {
  onClose: () => void;
};

const numOrDefault = (s: string, fallback: number): number => {
  const n = parseInt(s, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

const InfoIcon = ({ text }: { text: string }) => (
  <OverlayTrigger placement='auto' overlay={<Tooltip>{text}</Tooltip>}>
    <span className='ms-1 text-info cursor-pointer'>&#9432;</span>
  </OverlayTrigger>
);

const FactoryCreate = ({ onClose }: FactoryCreateProps) => {
  const [factoryLabel, setFactoryLabel] = useState('');
  const [fundingSats, setFundingSats] = useState(String(FACTORY_PLAN_DEFAULTS.fundingSats));
  const [nClients, setNClients] = useState(String(FACTORY_PLAN_DEFAULTS.nClients));
  const [perClientCapacity, setPerClientCapacity] = useState(String(FACTORY_PLAN_DEFAULTS.perClientCapacitySat));
  const [lspReservePerLeaf, setLspReservePerLeaf] = useState(String(FACTORY_PLAN_DEFAULTS.lspReservePerLeafSat));
  const [clientPubkeysRaw, setClientPubkeysRaw] = useState('');

  const [leafArity, setLeafArity] = useState(String(FACTORY_PLAN_DEFAULTS.leafArity));
  const [leafChannelType, setLeafChannelType] = useState<'pseudo-spilman' | 'ln-penalty'>(FACTORY_PLAN_DEFAULTS.leafChannelType);
  const [psSubfactoryArity, setPsSubfactoryArity] = useState(String(FACTORY_PLAN_DEFAULTS.psSubfactoryArity));

  const [lifetimeBlocks, setLifetimeBlocks] = useState(String(FACTORY_PLAN_DEFAULTS.lifetimeBlocks));
  const [dyingPeriodBlocks, setDyingPeriodBlocks] = useState(String(FACTORY_PLAN_DEFAULTS.dyingPeriodBlocks));
  const [epochCount, setEpochCount] = useState(String(FACTORY_PLAN_DEFAULTS.epochCount));
  const [blockEarlyCount, setBlockEarlyCount] = useState(String(FACTORY_PLAN_DEFAULTS.blockEarlyCount));
  const [ladderCadenceHours, setLadderCadenceHours] = useState(String(FACTORY_PLAN_DEFAULTS.ladderCadenceHours));

  const [autoHostNext, setAutoHostNext] = useState(FACTORY_PLAN_DEFAULTS.autoHostNext);
  const [autoFinalizeOnDying, setAutoFinalizeOnDying] = useState(FACTORY_PLAN_DEFAULTS.autoFinalizeOnDying);
  const [autoRotatePeriodically, setAutoRotatePeriodically] = useState(FACTORY_PLAN_DEFAULTS.autoRotatePeriodically);

  const [autoAcceptJoiners, setAutoAcceptJoiners] = useState(FACTORY_PLAN_DEFAULTS.autoAcceptJoiners);
  const [banlistRaw, setBanlistRaw] = useState('');

  const [allowBolt12, setAllowBolt12] = useState(FACTORY_PLAN_DEFAULTS.allowBolt12);
  const [allowAmp, setAllowAmp] = useState(FACTORY_PLAN_DEFAULTS.allowAmp);
  const [htlcMinSat, setHtlcMinSat] = useState(String(FACTORY_PLAN_DEFAULTS.htlcMinSat));
  const [htlcMaxSat, setHtlcMaxSat] = useState(String(FACTORY_PLAN_DEFAULTS.htlcMaxSat));

  const [advertiseOnNostr, setAdvertiseOnNostr] = useState(FACTORY_PLAN_DEFAULTS.advertiseOnNostr);
  const nodeInfo = useSelector(selectNodeInfo);
  const [advertiseNetwork, setAdvertiseNetwork] = useState<AdvertiseNetwork>(() =>
    mapClnNetwork(nodeInfo?.network),
  );

  const [useAllocationOverride, setUseAllocationOverride] = useState(false);
  const [allocationOverrideRaw, setAllocationOverrideRaw] = useState('');

  const [responseStatus, setResponseStatus] = useState(CallStatus.NONE);
  const [responseMessage, setResponseMessage] = useState('');

  const clientPubkeyParse = useMemo(() => {
    const items = clientPubkeysRaw.split(/\s+/).map(s => s.trim()).filter(s => s.length > 0);
    return {
      valid: items.filter(isCompressedPubkey),
      invalid: items.filter(s => !isCompressedPubkey(s)),
    };
  }, [clientPubkeysRaw]);
  const clientNodeIds = clientPubkeyParse.valid;

  const banlistParse = useMemo(() => {
    const items = banlistRaw.split(/\s+/).map(s => s.trim()).filter(s => s.length > 0);
    return {
      valid: items.filter(isCompressedPubkey),
      invalid: items.filter(s => !isCompressedPubkey(s)),
    };
  }, [banlistRaw]);
  const banlist = banlistParse.valid;

  const allocationParse = useMemo(() => {
    if (!useAllocationOverride) return { valid: [] as FactoryAllocation[], lineErrors: [] as Array<{ line: number; reason: string }> };
    const lines = allocationOverrideRaw.split('\n').map(l => l.trim());
    const valid: FactoryAllocation[] = [];
    const lineErrors: Array<{ line: number; reason: string }> = [];
    lines.forEach((line, idx) => {
      if (line.length === 0) return;
      const parts = line.split(/[,\s]+/).filter(p => p.length > 0);
      const [node_id, capStr] = [parts[0] || '', parts[1] || ''];
      if (!isCompressedPubkey(node_id)) {
        lineErrors.push({ line: idx + 1, reason: `node_id "${truncatePubkey(node_id) || '<missing>'}" is not a valid compressed pubkey` });
        return;
      }
      const capacity_sat = parseInt(capStr, 10);
      if (!Number.isFinite(capacity_sat) || capacity_sat <= 0) {
        lineErrors.push({ line: idx + 1, reason: `capacity "${capStr || '<missing>'}" is not a positive integer` });
        return;
      }
      valid.push({ node_id, capacity_sat });
    });
    return { valid, lineErrors };
  }, [useAllocationOverride, allocationOverrideRaw]);
  const parsedAllocations = allocationParse.valid;

  const inputWarnings: FactoryPlanWarning[] = useMemo(() => {
    const warnings: FactoryPlanWarning[] = [];
    if (clientPubkeyParse.invalid.length > 0) {
      const samples = clientPubkeyParse.invalid.slice(0, 3).map(s => truncatePubkey(s)).join(', ');
      const more = clientPubkeyParse.invalid.length > 3 ? `, +${clientPubkeyParse.invalid.length - 3} more` : '';
      warnings.push({
        id: 'client_pubkey_invalid',
        severity: 'error',
        message: `${clientPubkeyParse.invalid.length} client pubkey(s) invalid: ${samples}${more}. Each must be 64 hex chars starting with 02 or 03.`,
      });
    }
    if (banlistParse.invalid.length > 0) {
      const samples = banlistParse.invalid.slice(0, 3).map(s => truncatePubkey(s)).join(', ');
      const more = banlistParse.invalid.length > 3 ? `, +${banlistParse.invalid.length - 3} more` : '';
      warnings.push({
        id: 'banlist_invalid',
        severity: 'error',
        message: `${banlistParse.invalid.length} banlist entry(ies) invalid: ${samples}${more}. Each must be 64 hex chars starting with 02 or 03.`,
      });
    }
    allocationParse.lineErrors.forEach(err => {
      warnings.push({
        id: `allocation_line_${err.line}`,
        severity: 'error',
        message: `Allocation line ${err.line}: ${err.reason}.`,
      });
    });
    return warnings;
  }, [clientPubkeyParse, banlistParse, allocationParse]);

  const plan = useMemo(() => planFactory({
    fundingSats: numOrDefault(fundingSats, 0),
    nClients: numOrDefault(nClients, 0),
    perClientCapacitySat: numOrDefault(perClientCapacity, 0),
    lspReservePerLeafSat: numOrDefault(lspReservePerLeaf, 0),
    leafArity: numOrDefault(leafArity, 2),
    leafChannelType,
    psSubfactoryArity: numOrDefault(psSubfactoryArity, FACTORY_PLAN_DEFAULTS.psSubfactoryArity),
    lifetimeBlocks: numOrDefault(lifetimeBlocks, 0),
    dyingPeriodBlocks: numOrDefault(dyingPeriodBlocks, 0),
    epochCount: numOrDefault(epochCount, 1),
    blockEarlyCount: numOrDefault(blockEarlyCount, 0),
    ladderCadenceHours: numOrDefault(ladderCadenceHours, 1),
    allocationsOverride: parsedAllocations,
    clientNodeIds,
  }), [fundingSats, nClients, perClientCapacity, lspReservePerLeaf, leafArity, leafChannelType,
    psSubfactoryArity, lifetimeBlocks, dyingPeriodBlocks, epochCount, blockEarlyCount, ladderCadenceHours,
    parsedAllocations, clientNodeIds]);

  const allWarnings = useMemo(() => [...inputWarnings, ...plan.warnings], [inputWarnings, plan.warnings]);
  const canSubmit = plan.canSubmit && inputWarnings.length === 0;

  const persistLocalPrefs = (instanceId: string) => {
    const prefs: FactoryLocalPrefs = {
      label: factoryLabel.trim() || undefined,
      autoHostNext,
      autoFinalizeOnDying,
      autoRotatePeriodically,
      autoAcceptJoiners,
      banlist,
      allowBolt12,
      allowAmp,
      htlcMinSat: numOrDefault(htlcMinSat, 1),
      htlcMaxSat: numOrDefault(htlcMaxSat, 0),
      advertiseOnNostr,
    };
    try {
      localStorage.setItem(`factory-prefs-${instanceId}`, JSON.stringify(prefs));
      if (factoryLabel.trim()) {
        localStorage.setItem(`factory-label-${instanceId}`, factoryLabel.trim());
      }
    } catch { /* localStorage may be unavailable; non-fatal */ }
  };

  const handleCreate = async () => {
    /* Two modes:
     *  - Advertise on Nostr ON  → publish LSP capability vouch only, no factory-create.
     *    Joiners discover the LSP via the rendezvous list and contact peer-to-peer.
     *    The actual factory materializes later (manual factory-create RPC, or
     *    auto-create when the plugin gains a JOIN_REQUEST queue).
     *  - Advertise on Nostr OFF → call factory-create immediately with the policy
     *    inputs from the dialog. Use when you already have known joiners (clients
     *    field populated) and want to materialize a specific factory now.
     */
    if (advertiseOnNostr) {
      const lnNodeId = nodeInfo?.id;
      if (!lnNodeId) {
        setResponseStatus(CallStatus.ERROR);
        setResponseMessage('No active node pubkey — cannot advertise on Nostr. Connect a CLN node and retry.');
        return;
      }
      setResponseStatus(CallStatus.PENDING);
      setResponseMessage(`Publishing LSP advertisement to ${advertiseNetwork} relays...`);
      try {
        const prepared = await RendezvousService.prepareVouchEvent({
          network: advertiseNetwork,
          lnNodeId,
        });
        const relayResults = await publishSignedEvent(prepared.signedEvent, prepared.relays);
        const okCount = relayResults.filter(r => r.status === 'ok').length;
        const total = relayResults.length;
        if (okCount === 0) {
          setResponseStatus(CallStatus.ERROR);
          setResponseMessage(
            `Nostr publish failed on all ${total} relays. Check the rendezvous-settings panel for per-relay errors.`,
          );
        } else {
          setResponseStatus(CallStatus.SUCCESS);
          setResponseMessage(
            `LSP advertised on ${advertiseNetwork}: vouch DM accepted by ${okCount}/${total} relays. Coordinator typically publishes the kind-38101 vouch within ~15s.`,
          );
          setTimeout(() => onClose(), CLEAR_STATUS_ALERT_DELAY);
        }
      } catch (err: any) {
        setResponseStatus(CallStatus.ERROR);
        setResponseMessage(
          `Nostr publish failed: ${typeof err === 'string' ? err : err.message || 'unknown error'}`,
        );
      }
      return;
    }

    /* Factory-create path (Advertise on Nostr OFF). */
    const funding = numOrDefault(fundingSats, 0);
    const clientCount = numOrDefault(nClients, 0);

    if (funding <= 0) {
      setResponseStatus(CallStatus.ERROR);
      setResponseMessage('Funding amount must be greater than 0');
      return;
    }
    if (clientCount <= 0) {
      setResponseStatus(CallStatus.ERROR);
      setResponseMessage('Client count must be at least 1');
      return;
    }
    if (!canSubmit) {
      setResponseStatus(CallStatus.ERROR);
      setResponseMessage('Fix the errors in the summary panel before hosting.');
      return;
    }

    const options: FactoryCreateOptions = {};
    const arity = numOrDefault(leafArity, FACTORY_PLAN_DEFAULTS.leafArity);
    if (arity !== FACTORY_PLAN_DEFAULTS.leafArity) options.leaf_arity = arity;

    if (leafChannelType !== FACTORY_PLAN_DEFAULTS.leafChannelType) options.leaf_channel_type = leafChannelType;

    const psSub = numOrDefault(psSubfactoryArity, FACTORY_PLAN_DEFAULTS.psSubfactoryArity);
    if (psSub !== FACTORY_PLAN_DEFAULTS.psSubfactoryArity) options.ps_subfactory_arity = psSub;

    const epochs = numOrDefault(epochCount, FACTORY_PLAN_DEFAULTS.epochCount);
    if (epochs !== FACTORY_PLAN_DEFAULTS.epochCount) options.epoch_count = epochs;

    const lifetime = numOrDefault(lifetimeBlocks, FACTORY_PLAN_DEFAULTS.lifetimeBlocks);
    if (lifetime !== FACTORY_PLAN_DEFAULTS.lifetimeBlocks) options.lifetime_blocks = lifetime;

    const dying = numOrDefault(dyingPeriodBlocks, FACTORY_PLAN_DEFAULTS.dyingPeriodBlocks);
    if (dying !== FACTORY_PLAN_DEFAULTS.dyingPeriodBlocks) options.dying_period_blocks = dying;

    const blockEarly = numOrDefault(blockEarlyCount, FACTORY_PLAN_DEFAULTS.blockEarlyCount);
    if (blockEarly !== FACTORY_PLAN_DEFAULTS.blockEarlyCount) options.block_early_count = blockEarly;

    if (useAllocationOverride && parsedAllocations.length > 0) {
      options.allocations = parsedAllocations;
    }

    setResponseStatus(CallStatus.PENDING);
    setResponseMessage('Hosting factory...');

    let createRes;
    try {
      createRes = await FactoriesService.createFactory(funding, clientNodeIds, options);
      if (createRes.instance_id) {
        persistLocalPrefs(createRes.instance_id);
      }
      FactoriesService.fetchFactoriesData();
    } catch (err: any) {
      setResponseStatus(CallStatus.ERROR);
      setResponseMessage(typeof err === 'string' ? err : err.message || 'Factory hosting failed');
      return;
    }

    const instanceShort = createRes.instance_id.substring(0, 16);
    setResponseStatus(CallStatus.SUCCESS);
    setResponseMessage(`Factory hosted: ${instanceShort}...`);
    setTimeout(() => onClose(), CLEAR_STATUS_ALERT_DELAY);
  };

  const fmtSat = (n: number) => n.toLocaleString();
  const isBusy = responseStatus === CallStatus.PENDING;

  return (
    <Card className='h-100 d-flex align-items-stretch px-4 pt-4 pb-3' data-testid='factory-create'>
      <Card.Header className='px-1 pb-2 p-0 d-flex justify-content-between align-items-center'>
        <span className='fs-18px fw-bold text-dark'>Host Factory</span>
        <button className='btn btn-sm btn-outline-secondary btn-rounded' onClick={onClose} disabled={isBusy}>Cancel</button>
      </Card.Header>
      <Card.Body className='py-2 px-1 factory-create-scroll'>
        <Form>
          <section className='mb-3'>
            <div className='fs-18px fw-bold text-dark mb-2'>Basics</div>
            <Row className='g-2'>
              <Col xs={12}>
                <Form.Label className='text-light mb-1'>Factory label (optional, local-only)</Form.Label>
                <Form.Control
                  type='text'
                  value={factoryLabel}
                  onChange={(e) => setFactoryLabel(e.target.value)}
                  placeholder='e.g. "Daily mainnet ladder"'
                  disabled={isBusy}
                />
                <Form.Text className='text-light'>
                  Saved in your browser to help you recognize this factory later. Never sent to the plugin or other nodes.
                </Form.Text>
              </Col>
              <Col xs={12} md={6}>
                <Form.Label className='text-light mb-1'>Total funding (sats)</Form.Label>
                <Form.Control
                  type='number'
                  value={fundingSats}
                  onChange={(e) => setFundingSats(e.target.value)}
                  disabled={isBusy}
                  data-testid='factory-create-amount'
                  autoFocus
                />
              </Col>
              <Col xs={6} md={3}>
                <Form.Label className='text-light mb-1'>Clients</Form.Label>
                <Form.Control
                  type='number'
                  min={1}
                  value={nClients}
                  onChange={(e) => setNClients(e.target.value)}
                  disabled={isBusy}
                  data-testid='factory-create-n-clients'
                />
              </Col>
              <Col xs={6} md={3}>
                <Form.Label className='text-light mb-1'>Per-client capacity (sat)</Form.Label>
                <Form.Control
                  type='number'
                  value={perClientCapacity}
                  onChange={(e) => setPerClientCapacity(e.target.value)}
                  disabled={isBusy}
                />
              </Col>
              <Col xs={12} md={6}>
                <Form.Label className='text-light mb-1'>LSP reserve per leaf (sat)</Form.Label>
                <Form.Control
                  type='number'
                  value={lspReservePerLeaf}
                  onChange={(e) => setLspReservePerLeaf(e.target.value)}
                  disabled={isBusy}
                />
                <Form.Text className='text-light'>
                  LSP-only output per leaf. Lets you sell inbound liquidity without clients being online.
                </Form.Text>
              </Col>
              <Col xs={12}>
                <Form.Label className='text-light mb-1'>Client pubkeys (one per line)</Form.Label>
                <Form.Control
                  as='textarea'
                  rows={3}
                  placeholder={'03abc...\n02def...'}
                  value={clientPubkeysRaw}
                  onChange={(e) => setClientPubkeysRaw(e.target.value)}
                  disabled={isBusy}
                  data-testid='factory-create-clients'
                />
                <Form.Text className='text-light'>
                  Leave empty to let the plugin fill slots during the ceremony.
                </Form.Text>
              </Col>
            </Row>
          </section>

          <Accordion alwaysOpen>
            <Accordion.Item eventKey='tree'>
              <Accordion.Header>Tree shape</Accordion.Header>
              <Accordion.Body>
                <Row className='g-2'>
                  <Col xs={6}>
                    <Form.Label className='text-light mb-1'>
                      Leaf channel type
                      <InfoIcon text='Pseudo-Spilman is the design preferred type — simpler signing, lighter client liveness, no extra Decker-Wattenhofer layer at the leaf. LN-Penalty kept for power users who need bidirectional symmetry.' />
                    </Form.Label>
                    <Form.Select
                      value={leafChannelType}
                      onChange={(e) => setLeafChannelType(e.target.value as 'pseudo-spilman' | 'ln-penalty')}
                      disabled={isBusy}
                    >
                      <option value='pseudo-spilman'>Pseudo-Spilman (recommended)</option>
                      <option value='ln-penalty'>LN-Penalty (Poon-Dryja)</option>
                    </Form.Select>
                  </Col>
                  <Col xs={6}>
                    <Form.Label className='text-light mb-1'>Leaf arity</Form.Label>
                    <Form.Select value={leafArity} onChange={(e) => setLeafArity(e.target.value)} disabled={isBusy}>
                      <option value='2'>2 (default — two clients share a leaf)</option>
                      <option value='4'>4</option>
                      <option value='8'>8</option>
                    </Form.Select>
                  </Col>
                  <Col xs={6}>
                    <Form.Label className='text-light mb-1'>
                      PS subfactory arity (k, wide-leaf)
                      <InfoIcon text='k=1 = flat: each leaf is one PS channel. k≥2 = wide-leaf: each leaf is a k×k subfactory holding k² clients. Use k≥2 only when you need to host more clients than a flat tree can fit under BIP-68 CSV stack limits (typically >~100 clients). Requires leaf type = pseudo-spilman.' />
                    </Form.Label>
                    <Form.Select
                      value={psSubfactoryArity}
                      onChange={(e) => setPsSubfactoryArity(e.target.value)}
                      disabled={isBusy}
                    >
                      <option value='1'>1 (flat — one PS channel per leaf, recommended)</option>
                      <option value='2'>2 (wide-leaf: 4 clients per outer leaf)</option>
                      <option value='3'>3 (wide-leaf: 9 clients per outer leaf)</option>
                      <option value='4'>4 (wide-leaf: 16 clients per outer leaf)</option>
                    </Form.Select>
                  </Col>
                  <Col xs={12}>
                    <div className='text-light'>
                      Derived leaves: <span className='fw-bold text-dark'>{plan.derived.nLeaves}</span>
                    </div>
                  </Col>
                </Row>
              </Accordion.Body>
            </Accordion.Item>

            <Accordion.Item eventKey='lifecycle'>
              <Accordion.Header>Lifecycle &amp; ladder cadence</Accordion.Header>
              <Accordion.Body>
                <Row className='g-2'>
                  <Col xs={12} md={6}>
                    <Form.Label className='text-light mb-1'>Active period (blocks)</Form.Label>
                    <InputGroup>
                      <Form.Control type='number' value={lifetimeBlocks} onChange={(e) => setLifetimeBlocks(e.target.value)} disabled={isBusy} />
                      <InputGroup.Text className='text-light'>{blocksToDuration(numOrDefault(lifetimeBlocks, 0))}</InputGroup.Text>
                    </InputGroup>
                  </Col>
                  <Col xs={12} md={6}>
                    <Form.Label className='text-light mb-1'>Dying period (blocks)</Form.Label>
                    <InputGroup>
                      <Form.Control type='number' value={dyingPeriodBlocks} onChange={(e) => setDyingPeriodBlocks(e.target.value)} disabled={isBusy} />
                      <InputGroup.Text className='text-light'>{blocksToDuration(numOrDefault(dyingPeriodBlocks, 0))}</InputGroup.Text>
                    </InputGroup>
                  </Col>
                  <Col xs={12} md={6}>
                    <Form.Label className='text-light mb-1'>
                      Max rotations (epochs)
                      <InfoIcon text='SuperScalar reference design uses 4. With pseudo-Spilman leaves, payments do NOT consume epochs — only allocation changes do. Most operators do not need many.' />
                    </Form.Label>
                    <Form.Control type='number' value={epochCount} onChange={(e) => setEpochCount(e.target.value)} disabled={isBusy} />
                    <Form.Text className='text-light'>
                      Each rotation decrements a Decker-Wattenhofer nSequence slot at 144-block step. Burns {plan.derived.dwOverheadBlocks} blocks of CLTV budget.
                    </Form.Text>
                  </Col>
                  <Col xs={12} md={6}>
                    <Form.Label className='text-light mb-1'>
                      Block-early count
                      <InfoIcon text='How many blocks before timeout the plugin starts unilateral exit. Larger = safer but locks funds longer. Default 144 (~1 day buffer).' />
                    </Form.Label>
                    <InputGroup>
                      <Form.Control type='number' value={blockEarlyCount} onChange={(e) => setBlockEarlyCount(e.target.value)} disabled={isBusy} />
                      <InputGroup.Text className='text-light'>{blocksToDuration(numOrDefault(blockEarlyCount, 0))}</InputGroup.Text>
                    </InputGroup>
                  </Col>
                  <Col xs={12} md={6}>
                    <Form.Label className='text-light mb-1'>Ladder cadence (hours)</Form.Label>
                    <InputGroup>
                      <Form.Control type='number' value={ladderCadenceHours} onChange={(e) => setLadderCadenceHours(e.target.value)} disabled={isBusy} />
                      <InputGroup.Text className='text-light'>~{(numOrDefault(ladderCadenceHours, 1) * BLOCKS_PER_HOUR).toLocaleString()} blocks</InputGroup.Text>
                    </InputGroup>
                    <Form.Text className='text-light'>
                      How often you plan to host the next factory in the ladder. Each hosting is one onchain kickoff.
                    </Form.Text>
                  </Col>
                </Row>
              </Accordion.Body>
            </Accordion.Item>

            <Accordion.Item eventKey='automation'>
              <Accordion.Header>Lifecycle automation</Accordion.Header>
              <Accordion.Body>
                <Form.Check
                  type='switch'
                  id='auto-host-next'
                  className='mb-2'
                  checked={autoHostNext}
                  onChange={(e) => setAutoHostNext(e.target.checked)}
                  disabled={isBusy}
                  label={
                    <span>
                      Auto-host next factory
                      <InfoIcon text='When ON, plugin automatically hosts the next factory at the ladder cadence so a fresh slot is always available for clients to migrate into. Recommended ON.' />
                    </span>
                  }
                />
                <Form.Check
                  type='switch'
                  id='auto-finalize-on-dying'
                  className='mb-2'
                  checked={autoFinalizeOnDying}
                  onChange={(e) => setAutoFinalizeOnDying(e.target.checked)}
                  disabled={isBusy}
                  label={
                    <span>
                      Auto-finalize on dying
                      <InfoIcon text='When ON, plugin runs one last rotation and signs the distribution transaction the moment factory enters its dying period — ensures clean wind-down. Costs one nSequence slot.' />
                    </span>
                  }
                />
                <Form.Check
                  type='switch'
                  id='auto-rotate-periodic'
                  className='mb-1'
                  checked={autoRotatePeriodically}
                  onChange={(e) => setAutoRotatePeriodically(e.target.checked)}
                  disabled={isBusy}
                  label={
                    <span>
                      Auto-rotate periodically
                      <InfoIcon text='Niche. Burns nSequence slots on a schedule even without an allocation change. Most operators leave this OFF.' />
                    </span>
                  }
                />
                <Form.Text className='text-light'>
                  All three settings save locally per factory. Plugin enforcement may lag the wallet UI as hooks land.
                </Form.Text>
              </Accordion.Body>
            </Accordion.Item>

            <Accordion.Item eventKey='joiner'>
              <Accordion.Header>Joiner policy</Accordion.Header>
              <Accordion.Body>
                <Form.Check
                  type='switch'
                  id='auto-accept-joiners'
                  className='mb-2'
                  checked={autoAcceptJoiners}
                  onChange={(e) => setAutoAcceptJoiners(e.target.checked)}
                  disabled={isBusy}
                  label={
                    <span>
                      Auto-accept joiners
                      <InfoIcon text='When ON, qualifying join requests are admitted without manual approval. OFF by default; you review each one in the Pending Joiners panel.' />
                    </span>
                  }
                />
                <Form.Label className='text-light mb-1 mt-2'>Banlist (one pubkey per line)</Form.Label>
                <Form.Control
                  as='textarea'
                  rows={3}
                  placeholder={'03abc... # pubkeys never accepted'}
                  value={banlistRaw}
                  onChange={(e) => setBanlistRaw(e.target.value)}
                  disabled={isBusy}
                />
                <Form.Text className='text-light'>
                  Pubkeys here are rejected even if auto-accept is ON. Stored locally; future PR wires it into the join flow.
                </Form.Text>
              </Accordion.Body>
            </Accordion.Item>

            <Accordion.Item eventKey='channel'>
              <Accordion.Header>Channel options</Accordion.Header>
              <Accordion.Body>
                <Form.Check
                  type='switch'
                  id='allow-bolt12'
                  className='mb-2'
                  checked={allowBolt12}
                  onChange={(e) => setAllowBolt12(e.target.checked)}
                  disabled={isBusy}
                  label={
                    <span>
                      Allow BOLT 12 offers
                      <InfoIcon text='Modern reusable invoices. Recommended ON.' />
                    </span>
                  }
                />
                <Form.Check
                  type='switch'
                  id='allow-amp'
                  className='mb-3'
                  checked={allowAmp}
                  onChange={(e) => setAllowAmp(e.target.checked)}
                  disabled={isBusy}
                  label={
                    <span>
                      Allow AMP (atomic multi-part) payments
                      <InfoIcon text='Splits a payment across multiple HTLCs. Useful when capacity per leaf is small. Plugin support varies.' />
                    </span>
                  }
                />
                <Row className='g-2'>
                  <Col xs={6}>
                    <Form.Label className='text-light mb-1'>Min HTLC (sat)</Form.Label>
                    <Form.Control type='number' value={htlcMinSat} onChange={(e) => setHtlcMinSat(e.target.value)} disabled={isBusy} />
                  </Col>
                  <Col xs={6}>
                    <Form.Label className='text-light mb-1'>Max HTLC (sat, 0 = capacity)</Form.Label>
                    <Form.Control type='number' value={htlcMaxSat} onChange={(e) => setHtlcMaxSat(e.target.value)} disabled={isBusy} />
                  </Col>
                </Row>
                <Form.Text className='text-light'>
                  Applied to every channel created by this factory. Saved locally; plugin may not honor all fields yet.
                </Form.Text>
              </Accordion.Body>
            </Accordion.Item>

            <Accordion.Item eventKey='discovery'>
              <Accordion.Header>Discovery</Accordion.Header>
              <Accordion.Body>
                <Row className='g-2 mb-3'>
                  <Col xs={12} md={6}>
                    <Form.Label className='text-light mb-1'>
                      Chain
                      <InfoIcon text='Picks which soup-rendezvous coordinator the proof DM is sent to. Should match your CLN node&#39;s network — a mismatch will fail at coordinator verification time (signmessage signed on the wrong chain).' />
                    </Form.Label>
                    <Form.Select
                      value={advertiseNetwork}
                      onChange={(e) => setAdvertiseNetwork(e.target.value as AdvertiseNetwork)}
                      disabled={isBusy}
                      data-testid='factory-create-advertise-network'
                    >
                      {ADVERTISE_NETWORKS.map(n => (
                        <option key={n} value={n}>{n === 'bitcoin' ? 'mainnet (bitcoin)' : n}</option>
                      ))}
                    </Form.Select>
                    {nodeInfo?.network && mapClnNetwork(nodeInfo.network) !== advertiseNetwork && (
                      <Form.Text className='text-warning'>
                        Active node reports network <strong>{nodeInfo.network}</strong>. Coordinator verification will likely fail.
                      </Form.Text>
                    )}
                  </Col>
                </Row>
                <Form.Check
                  type='switch'
                  id='advertise-nostr'
                  className='mb-1'
                  checked={advertiseOnNostr}
                  onChange={(e) => setAdvertiseOnNostr(e.target.checked)}
                  disabled={isBusy}
                  label={
                    <span>
                      Advertise this LSP on Nostr (no factory created yet)
                      <InfoIcon text='When ON: the wallet only publishes a soup-rendezvous proof DM to the coordinator for the selected chain — no factory-create call. The kind-38101 vouch advertises your LSP capability so joiners can discover you; the actual factory is built later when joiners arrive via peer-to-peer custommsg (or when you separately call factory-create). When OFF: the wallet calls factory-create immediately with the policy inputs in this dialog (use this when you already have specific joiner pubkeys in the Client pubkeys field).' />
                    </span>
                  }
                />
                <Form.Text className='text-light'>
                  Nostr is the discovery layer. Once a client picks your LSP from a relay, the factory + channel exchange happens over LN custommsg (bLIP-56) — channels themselves never go through Nostr.
                </Form.Text>
              </Accordion.Body>
            </Accordion.Item>

            <Accordion.Item eventKey='economics'>
              <Accordion.Header>Economics</Accordion.Header>
              <Accordion.Body>
                <Form.Text className='text-light'>
                  v1 is <strong className='text-dark'>pure-routing</strong>: joiners don&#39;t pay a setup fee.
                  Your LSP earns on per-HTLC forwarding fees as payments flow through the channels
                  this factory opens. Routing-fee policy (ppm + base) is set per-channel after the
                  factory confirms, not as a factory-wide policy. See{' '}
                  <code>FACTORY_POLICY_V1.md</code> §4.4 and §4.12.
                </Form.Text>
              </Accordion.Body>
            </Accordion.Item>

            <Accordion.Item eventKey='allocations'>
              <Accordion.Header>Allocations override (advanced)</Accordion.Header>
              <Accordion.Body>
                <Form.Check
                  type='switch'
                  id='use-allocation-override'
                  label='Set per-client capacities manually'
                  checked={useAllocationOverride}
                  onChange={(e) => setUseAllocationOverride(e.target.checked)}
                  disabled={isBusy}
                  className='mb-2'
                />
                {useAllocationOverride && (
                  <>
                    <Form.Label className='text-light mb-1'>Allocations (one per line: pubkey,capacity_sat)</Form.Label>
                    <Form.Control
                      as='textarea'
                      rows={4}
                      placeholder={'03abc...,450000\n02def...,450000'}
                      value={allocationOverrideRaw}
                      onChange={(e) => setAllocationOverrideRaw(e.target.value)}
                      disabled={isBusy}
                    />
                    <Form.Text className='text-light'>
                      Must sum to {fmtSat(plan.derived.expectedAllocationSum)} sat (funding − LSP reserve total − flat fee).
                    </Form.Text>
                  </>
                )}
              </Accordion.Body>
            </Accordion.Item>
          </Accordion>

          <section className='mt-3 p-3 border rounded bg-light-subtle'>
            <div className='fs-18px fw-bold text-dark mb-2'>Summary</div>
            <Row className='g-2'>
              <Col xs={6} md={4}>
                <div className='text-light d-flex align-items-center'>
                  Ladder steady state
                  <InfoIcon text='Eventual size of your ladder once you keep hosting at this cadence + lifetime. You are creating 1 factory now — this projection shows what the rolling set grows to.' />
                </div>
                <div className='fs-18px fw-bold text-dark'>{plan.derived.ladderFootprint} factories</div>
              </Col>
              <Col xs={6} md={4}>
                <div className='text-light'>Avg new-client wait</div>
                <div className='fs-18px fw-bold text-dark'>~{plan.derived.avgWaitHours.toFixed(1)} h</div>
              </Col>
              <Col xs={6} md={4}>
                <div className='text-light d-flex align-items-center'>
                  Onchain kickoffs / mo
                  <InfoIcon text='One kickoff transaction per new factory hosted. Rotations within an existing factory are offchain and do not count here. Sat estimate uses a placeholder feerate.' />
                </div>
                <div className='fs-18px fw-bold text-dark'>~{plan.derived.kickoffsPerMonth.toFixed(1)} <span className='text-light'>(~{fmtSat(plan.derived.approxOnchainCostPerMonthSat)} sat fees)</span></div>
              </Col>
              <Col xs={6} md={4}>
                <div className='text-light'>LSP commit / factory</div>
                <div className='fs-18px fw-bold text-dark'>{fmtSat(plan.derived.lspSingleFactoryCommitmentSat)} sat</div>
              </Col>
              <Col xs={6} md={4}>
                <div className='text-light'>LSP commit / ladder</div>
                <div className='fs-18px fw-bold text-dark'>{fmtSat(plan.derived.lspLadderCommitmentSat)} sat</div>
              </Col>
              <Col xs={6} md={4}>
                <div className='text-light d-flex align-items-center'>
                  Client CLTV budget
                  <InfoIcon text='Blocks remaining for HTLC routing through factory channels after Decker-Wattenhofer overhead, dying period, and block-early count are subtracted. Below ~2016 blocks, some payment paths refuse to route.' />
                </div>
                <div className='fs-18px fw-bold text-dark'>{plan.derived.clientCltvBudgetBlocks} blocks</div>
              </Col>
            </Row>
          </section>

          {allWarnings.length > 0 && (
            <section className='mt-2'>
              {allWarnings.map(w => (
                <Alert key={w.id} variant={w.severity === 'error' ? 'danger' : w.severity === 'warning' ? 'warning' : 'info'} className='py-2 px-3 mb-2'>
                  {w.message}
                </Alert>
              ))}
            </section>
          )}
        </Form>

        {responseStatus !== CallStatus.NONE && (
          <StatusAlert responseStatus={responseStatus} responseMessage={responseMessage} />
        )}
      </Card.Body>
      <Card.Footer className='d-flex justify-content-center'>
        <button
          className='btn-rounded bg-primary'
          onClick={handleCreate}
          disabled={isBusy || (!advertiseOnNostr && !canSubmit) || (advertiseOnNostr && !nodeInfo?.id)}
          data-testid='button-submit-create-factory'
        >
          {isBusy ? <Spinner animation='border' size='sm' className='me-2' /> : null}
          {advertiseOnNostr ? `Advertise LSP on ${advertiseNetwork} Nostr` : 'Host Factory'}
        </button>
      </Card.Footer>
    </Card>
  );
};

export default FactoryCreate;
