import './FactoryCreate.scss';
import { useMemo, useState } from 'react';
import { Card, Row, Col, Form, Spinner, Accordion, InputGroup, Alert, OverlayTrigger, Tooltip } from 'react-bootstrap';
import { CallStatus, CLEAR_STATUS_ALERT_DELAY } from '../../../utilities/constants';
import { FactoriesService } from '../../../services/http.service';
import StatusAlert from '../../shared/StatusAlert/StatusAlert';
import {
  FACTORY_PLAN_DEFAULTS,
  BLOCKS_PER_HOUR,
  blocksToDuration,
  planFactory,
} from '../../../utilities/factory-planner';
import { FactoryAllocation, FactoryCreateOptions } from '../../../types/factories.type';

type FactoryCreateProps = {
  onClose: () => void;
};

const numOrDefault = (s: string, fallback: number): number => {
  const n = parseInt(s, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

const FactoryCreate = ({ onClose }: FactoryCreateProps) => {
  const [factoryLabel, setFactoryLabel] = useState('');
  const [fundingSats, setFundingSats] = useState(String(FACTORY_PLAN_DEFAULTS.fundingSats));
  const [nClients, setNClients] = useState(String(FACTORY_PLAN_DEFAULTS.nClients));
  const [perClientCapacity, setPerClientCapacity] = useState(String(FACTORY_PLAN_DEFAULTS.perClientCapacitySat));
  const [lspReservePerLeaf, setLspReservePerLeaf] = useState(String(FACTORY_PLAN_DEFAULTS.lspReservePerLeafSat));
  const [clientPubkeysRaw, setClientPubkeysRaw] = useState('');

  const [leafArity, setLeafArity] = useState(String(FACTORY_PLAN_DEFAULTS.leafArity));

  const [lifetimeBlocks, setLifetimeBlocks] = useState(String(FACTORY_PLAN_DEFAULTS.lifetimeBlocks));
  const [dyingPeriodBlocks, setDyingPeriodBlocks] = useState(String(FACTORY_PLAN_DEFAULTS.dyingPeriodBlocks));
  const [epochCount, setEpochCount] = useState(String(FACTORY_PLAN_DEFAULTS.epochCount));
  const [ladderCadenceHours, setLadderCadenceHours] = useState(String(FACTORY_PLAN_DEFAULTS.ladderCadenceHours));

  const [lspFeeSat, setLspFeeSat] = useState(String(FACTORY_PLAN_DEFAULTS.lspFeeSat));
  const [lspFeePpm, setLspFeePpm] = useState(String(FACTORY_PLAN_DEFAULTS.lspFeePpm));

  const [useAllocationOverride, setUseAllocationOverride] = useState(false);
  const [allocationOverrideRaw, setAllocationOverrideRaw] = useState('');

  const [responseStatus, setResponseStatus] = useState(CallStatus.NONE);
  const [responseMessage, setResponseMessage] = useState('');

  const clientNodeIds = useMemo(() => clientPubkeysRaw
    .split(/\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 0), [clientPubkeysRaw]);

  const parsedAllocations: FactoryAllocation[] = useMemo(() => {
    if (!useAllocationOverride) return [];
    return allocationOverrideRaw
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .map(line => {
        const [node_id, capStr] = line.split(/[,\s]+/);
        return { node_id: node_id || '', capacity_sat: parseInt(capStr, 10) || 0 };
      });
  }, [useAllocationOverride, allocationOverrideRaw]);

  const plan = useMemo(() => planFactory({
    fundingSats: numOrDefault(fundingSats, 0),
    nClients: numOrDefault(nClients, 0),
    perClientCapacitySat: numOrDefault(perClientCapacity, 0),
    lspReservePerLeafSat: numOrDefault(lspReservePerLeaf, 0),
    leafArity: numOrDefault(leafArity, 2),
    lifetimeBlocks: numOrDefault(lifetimeBlocks, 0),
    dyingPeriodBlocks: numOrDefault(dyingPeriodBlocks, 0),
    epochCount: numOrDefault(epochCount, 1),
    ladderCadenceHours: numOrDefault(ladderCadenceHours, 1),
    lspFeeSat: numOrDefault(lspFeeSat, 0),
    lspFeePpm: numOrDefault(lspFeePpm, 0),
    allocationsOverride: parsedAllocations,
    clientNodeIds,
  }), [fundingSats, nClients, perClientCapacity, lspReservePerLeaf, leafArity,
    lifetimeBlocks, dyingPeriodBlocks, epochCount, ladderCadenceHours,
    lspFeeSat, lspFeePpm, parsedAllocations, clientNodeIds]);

  const handleCreate = async () => {
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
    if (!plan.canSubmit) {
      setResponseStatus(CallStatus.ERROR);
      setResponseMessage('Fix the errors in the summary panel before hosting.');
      return;
    }

    const options: FactoryCreateOptions = {};
    const arity = numOrDefault(leafArity, FACTORY_PLAN_DEFAULTS.leafArity);
    if (arity !== FACTORY_PLAN_DEFAULTS.leafArity) options.leaf_arity = arity;

    const epochs = numOrDefault(epochCount, FACTORY_PLAN_DEFAULTS.epochCount);
    if (epochs !== FACTORY_PLAN_DEFAULTS.epochCount) options.epoch_count = epochs;

    const lifetime = numOrDefault(lifetimeBlocks, FACTORY_PLAN_DEFAULTS.lifetimeBlocks);
    if (lifetime !== FACTORY_PLAN_DEFAULTS.lifetimeBlocks) options.lifetime_blocks = lifetime;

    const dying = numOrDefault(dyingPeriodBlocks, FACTORY_PLAN_DEFAULTS.dyingPeriodBlocks);
    if (dying !== FACTORY_PLAN_DEFAULTS.dyingPeriodBlocks) options.dying_period_blocks = dying;

    const feeSat = numOrDefault(lspFeeSat, 0);
    if (feeSat > 0) options.lsp_fee_sat = feeSat;

    const feePpm = numOrDefault(lspFeePpm, 0);
    if (feePpm > 0) options.lsp_fee_ppm = feePpm;

    if (useAllocationOverride && parsedAllocations.length > 0) {
      options.allocations = parsedAllocations;
    }

    setResponseStatus(CallStatus.PENDING);
    setResponseMessage('Hosting factory...');

    try {
      const res = await FactoriesService.createFactory(funding, clientNodeIds, options);
      if (factoryLabel.trim() && res.instance_id) {
        try {
          localStorage.setItem(`factory-label-${res.instance_id}`, factoryLabel.trim());
        } catch { /* localStorage may be unavailable; non-fatal */ }
      }
      setResponseStatus(CallStatus.SUCCESS);
      setResponseMessage(`Factory hosted: ${res.instance_id.substring(0, 16)}...`);
      FactoriesService.fetchFactoriesData();
      setTimeout(() => {
        onClose();
      }, CLEAR_STATUS_ALERT_DELAY);
    } catch (err: any) {
      setResponseStatus(CallStatus.ERROR);
      setResponseMessage(typeof err === 'string' ? err : err.message || 'Factory hosting failed');
    }
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
                  placeholder='e.g. "Mobile users batch 1"'
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
                    <Form.Label className='text-light mb-1'>Leaf arity</Form.Label>
                    <Form.Select value={leafArity} onChange={(e) => setLeafArity(e.target.value)} disabled={isBusy}>
                      <option value='2'>2 (default — two clients share a leaf)</option>
                      <option value='4'>4</option>
                      <option value='8'>8</option>
                    </Form.Select>
                  </Col>
                  <Col xs={6} className='d-flex align-items-end'>
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
                    <Form.Label className='text-light mb-1'>Max rotations (epochs)</Form.Label>
                    <Form.Control type='number' value={epochCount} onChange={(e) => setEpochCount(e.target.value)} disabled={isBusy} />
                    <Form.Text className='text-light'>
                      Decker-Wattenhofer limit — each rotation decrements an nSequence slot. Rotations are <strong>offchain</strong> (no kickoff transaction).
                    </Form.Text>
                  </Col>
                  <Col xs={12} md={6}>
                    <Form.Label className='text-light mb-1'>Ladder cadence (hours)</Form.Label>
                    <InputGroup>
                      <Form.Control type='number' value={ladderCadenceHours} onChange={(e) => setLadderCadenceHours(e.target.value)} disabled={isBusy} />
                      <InputGroup.Text className='text-light'>~{(numOrDefault(ladderCadenceHours, 1) * BLOCKS_PER_HOUR).toLocaleString()} blocks</InputGroup.Text>
                    </InputGroup>
                    <Form.Text className='text-light'>
                      Local-only. How often you plan to host the next factory in the ladder. Each hosting is one onchain kickoff.
                    </Form.Text>
                  </Col>
                </Row>
              </Accordion.Body>
            </Accordion.Item>

            <Accordion.Item eventKey='economics'>
              <Accordion.Header>Economics</Accordion.Header>
              <Accordion.Body>
                <Row className='g-2'>
                  <Col xs={6}>
                    <Form.Label className='text-light mb-1'>
                      Flat LSP fee (sat)
                      <OverlayTrigger placement='auto' overlay={<Tooltip>One-time fee per client, paid at factory creation. Locked in for this factory's lifetime — change it on the next ladder generation if you want.</Tooltip>}>
                        <span className='ms-1 text-info cursor-pointer'>&#9432;</span>
                      </OverlayTrigger>
                    </Form.Label>
                    <Form.Control type='number' value={lspFeeSat} onChange={(e) => setLspFeeSat(e.target.value)} disabled={isBusy} />
                  </Col>
                  <Col xs={6}>
                    <Form.Label className='text-light mb-1'>
                      LSP fee (ppm)
                      <OverlayTrigger placement='auto' overlay={<Tooltip>Parts-per-million of each client's allocated capacity, paid at factory creation. ppm = ÷1,000,000 (so 1000 ppm = 0.1% of capacity).</Tooltip>}>
                        <span className='ms-1 text-info cursor-pointer'>&#9432;</span>
                      </OverlayTrigger>
                    </Form.Label>
                    <Form.Control type='number' value={lspFeePpm} onChange={(e) => setLspFeePpm(e.target.value)} disabled={isBusy} />
                  </Col>
                  <Col xs={12}>
                    <Form.Text className='text-light'>
                      Estimated revenue per factory: <strong className='text-dark'>{fmtSat(plan.derived.feeRevenuePerFactorySat)} sat</strong>
                      {' '}· per month across the ladder: <strong className='text-dark'>{fmtSat(plan.derived.feeRevenuePerMonthSat)} sat</strong>
                    </Form.Text>
                  </Col>
                </Row>
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
                <div className='text-light'>Ladder footprint</div>
                <div className='fs-18px fw-bold text-dark'>{plan.derived.ladderFootprint} factories</div>
              </Col>
              <Col xs={6} md={4}>
                <div className='text-light'>Avg new-client wait</div>
                <div className='fs-18px fw-bold text-dark'>~{plan.derived.avgWaitHours.toFixed(1)} h</div>
              </Col>
              <Col xs={6} md={4}>
                <div className='text-light d-flex align-items-center'>
                  Onchain kickoffs / mo
                  <OverlayTrigger placement='auto' overlay={<Tooltip>One kickoff transaction per new factory hosted. Rotations within an existing factory are offchain and don't count here. Sat estimate uses a placeholder feerate.</Tooltip>}>
                    <span className='ms-1 text-info cursor-pointer'>&#9432;</span>
                  </OverlayTrigger>
                </div>
                <div className='fs-18px fw-bold text-dark'>~{plan.derived.kickoffsPerMonth.toFixed(1)} <span className='fs-7 text-light'>(~{fmtSat(plan.derived.approxOnchainCostPerMonthSat)} sat fees)</span></div>
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
                  <OverlayTrigger placement='auto' overlay={<Tooltip>Blocks remaining for HTLC routing through factory channels after Decker-Wattenhofer overhead and dying period are subtracted. Below ~2016 blocks, some payment paths refuse to route.</Tooltip>}>
                    <span className='ms-1 text-info cursor-pointer'>&#9432;</span>
                  </OverlayTrigger>
                </div>
                <div className='fs-18px fw-bold text-dark'>{plan.derived.clientCltvBudgetBlocks} blocks</div>
              </Col>
            </Row>
          </section>

          {plan.warnings.length > 0 && (
            <section className='mt-2'>
              {plan.warnings.map(w => (
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
          disabled={isBusy || !plan.canSubmit}
          data-testid='button-submit-create-factory'
        >
          {isBusy ? <Spinner animation='border' size='sm' className='me-2' /> : null}
          Host Factory
        </button>
      </Card.Footer>
    </Card>
  );
};

export default FactoryCreate;
