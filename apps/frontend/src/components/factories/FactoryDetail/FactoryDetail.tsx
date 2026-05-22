import './FactoryDetail.scss';
import { useState } from 'react';
import { Card, Row, Col, ListGroup, OverlayTrigger, Tooltip, Form, Modal, Button, Badge } from 'react-bootstrap';
import { CallStatus, CLEAR_STATUS_ALERT_DELAY } from '../../../utilities/constants';
import { Factory, FactoryLifecycle, FactoryCeremony } from '../../../types/factories.type';
import { FactoriesService } from '../../../services/http.service';
import StatusAlert from '../../shared/StatusAlert/StatusAlert';
import { copyTextToClipboard } from '../../../utilities/data-formatters';
import { useSelector } from 'react-redux';
import { selectNodeInfo } from '../../../store/rootSelectors';
import CeremonyProgress from '../CeremonyProgress/CeremonyProgress';
import FactoryPolicyView from '../FactoryPolicyView/FactoryPolicyView';
import JoinRequestsCard from "../JoinRequestsCard/JoinRequestsCard";
import OperatorPrefsCard from "../OperatorPrefsCard/OperatorPrefsCard";
import InviteModal from "../InviteModal/InviteModal";

const ZERO_TXID = '0000000000000000000000000000000000000000000000000000000000000000';

const isValidTxid = (txid: string | undefined): boolean =>
  !!txid && txid !== ZERO_TXID && txid !== '';

const formatBlock = (block: number): string =>
  block > 0 ? block.toLocaleString() : 'N/A';

/* Audit item #6: classify how safe it is to cooperatively close this factory.
 * Cooperative close needs all participants online and not mid-rotation; force
 * close is always available but expensive. */
type CloseSafety = {
  level: 'safe' | 'caution' | 'unsafe';
  reason: string;
};

const classifyCloseSafety = (factory: Factory, currentBlock: number): CloseSafety => {
  if (factory.n_breach_epochs > 0) {
    return {
      level: 'unsafe',
      reason: `${factory.n_breach_epochs} breach epoch(s) on record — force close to claim breach outputs.`,
    };
  }
  if (factory.lifecycle === FactoryLifecycle.DYING) {
    return {
      level: 'caution',
      reason: 'Factory is in DYING period — settling on-chain. Wait or force close.',
    };
  }
  if (factory.lifecycle === FactoryLifecycle.EXPIRED) {
    return {
      level: 'unsafe',
      reason: 'Factory already expired. Use force close to recover funds.',
    };
  }
  if (factory.rotation_in_progress) {
    return {
      level: 'caution',
      reason: 'Rotation in progress — cooperative close will abort the rotation.',
    };
  }
  if (factory.dist_tx_status && factory.dist_tx_status !== 'unknown' && factory.dist_tx_status !== 'none') {
    return {
      level: 'caution',
      reason: `Distribution TX is "${factory.dist_tx_status}" — close behavior may be affected.`,
    };
  }
  if (currentBlock > 0 && factory.expiry_block > 0) {
    const blocksLeft = factory.expiry_block - currentBlock;
    if (blocksLeft < 1008) {
      return {
        level: 'caution',
        reason: `Expiry in ~${blocksLeft} blocks (<1 week). Closing now leaves a safety margin.`,
      };
    }
  }
  return {
    level: 'safe',
    reason: 'All participants quiescent, no breach state, expiry comfortable.',
  };
};

type FactoryDetailProps = {
  factory: Factory;
  onClose: () => void;
};

const FactoryDetail = ({ factory, onClose }: FactoryDetailProps) => {
  const [responseStatus, setResponseStatus] = useState(CallStatus.NONE);
  const [responseMessage, setResponseMessage] = useState('');
  const nodeInfo = useSelector(selectNodeInfo);
  // Auto-sign stub: local-only until `factory-set-policy` RPC lands.
  // The plugin enforces allocation/epoch invariants independent of this toggle.
  const [autoSign, setAutoSign] = useState(true);
  // Audit item #6: confirm modal for close + force-close
  const [confirmCloseMode, setConfirmCloseMode] = useState<'close' | 'force' | null>(null);
  const isLsp = factory.is_lsp;
  const currentBlock = (nodeInfo as any)?.blockheight || 0;
  const [showInvite, setShowInvite] = useState(false);
  const closeSafety = classifyCloseSafety(factory, currentBlock);

  const resetStatus = () => {
    setTimeout(() => {
      setResponseStatus(CallStatus.NONE);
      setResponseMessage('');
    }, CLEAR_STATUS_ALERT_DELAY);
  };

  const handleRotate = async () => {
    setResponseStatus(CallStatus.PENDING);
    setResponseMessage('Rotating factory...');
    try {
      const res = await FactoriesService.rotateFactory(factory.instance_id);
      setResponseStatus(CallStatus.SUCCESS);
      setResponseMessage(`Rotated: epoch ${res.old_epoch} -> ${res.new_epoch}`);
      FactoriesService.fetchFactoriesData();
      resetStatus();
    } catch (err: any) {
      setResponseStatus(CallStatus.ERROR);
      setResponseMessage(typeof err === 'string' ? err : err.message || 'Rotation failed');
      resetStatus();
    }
  };

  /* Task #124: manual trigger button. Only meaningful when the
   * factory is awaiting joins on the LSP side. Plugin auto-triggers
   * when min_clients_to_start or the force-start deadline is reached;
   * this button is the operator escape hatch (force=true). */
  const handleTrigger = async () => {
    setResponseStatus(CallStatus.PENDING);
    setResponseMessage('Triggering ceremony…');
    try {
      const res = await FactoriesService.triggerCeremony(factory.instance_id, { force: true });
      setResponseStatus(CallStatus.SUCCESS);
      setResponseMessage(
        `Ceremony triggered (ceremony_id ${res.ceremony_id_hex?.slice(0, 16)}…, ${res.n_participants} participants)`,
      );
      FactoriesService.fetchFactoriesData();
      resetStatus();
    } catch (err: any) {
      setResponseStatus(CallStatus.ERROR);
      setResponseMessage(typeof err === 'string' ? err : err.message || 'Trigger failed');
      resetStatus();
    }
  };

  const handleClose = async () => {
    setResponseStatus(CallStatus.PENDING);
    setResponseMessage('Closing factory...');
    try {
      const res = await FactoriesService.closeFactory(factory.instance_id);
      setResponseStatus(CallStatus.SUCCESS);
      setResponseMessage(`Close initiated: ${res.status}`);
      FactoriesService.fetchFactoriesData();
      resetStatus();
    } catch (err: any) {
      setResponseStatus(CallStatus.ERROR);
      setResponseMessage(typeof err === 'string' ? err : err.message || 'Close failed');
      resetStatus();
    }
  };

  const handleForceClose = async () => {
    setResponseStatus(CallStatus.PENDING);
    setResponseMessage('Force closing factory...');
    try {
      const res = await FactoriesService.forceCloseFactory(factory.instance_id);
      setResponseStatus(CallStatus.SUCCESS);
      setResponseMessage(`Force closed: ${res.n_signed_txs} transactions broadcast`);
      FactoriesService.fetchFactoriesData();
      resetStatus();
    } catch (err: any) {
      setResponseStatus(CallStatus.ERROR);
      setResponseMessage(typeof err === 'string' ? err : err.message || 'Force close failed');
      resetStatus();
    }
  };

  const handleOpenChannels = async () => {
    setResponseStatus(CallStatus.PENDING);
    setResponseMessage(`Opening ${factory.n_clients} channel(s)…`);
    try {
      const res = await FactoriesService.openChannels(factory.instance_id);
      setResponseStatus(CallStatus.SUCCESS);
      const n = res?.n_channels ?? factory.n_clients;
      setResponseMessage(`Opened ${n} channel(s) — lifecycle now active`);
      FactoriesService.fetchFactoriesData();
      resetStatus();
    } catch (err: any) {
      setResponseStatus(CallStatus.ERROR);
      setResponseMessage(typeof err === 'string' ? err : err.message || 'Open channels failed');
      resetStatus();
    }
  };

  const handleInvite = () => {
    const text = `Factory ID: ${factory.instance_id}\nLSP Pubkey: ${nodeInfo.id || 'unknown'}`;
    copyTextToClipboard(text);
    setResponseStatus(CallStatus.SUCCESS);
    setResponseMessage('Invite info copied to clipboard');
    resetStatus();
  };

  const canTrigger = isLsp && factory.lifecycle === FactoryLifecycle.AWAITING_JOINS;
  const canRotate = isLsp && factory.lifecycle === FactoryLifecycle.ACTIVE && factory.ceremony === FactoryCeremony.COMPLETE && !factory.rotation_in_progress;
  const canClose = isLsp && factory.lifecycle === FactoryLifecycle.ACTIVE;
  const canForceClose = factory.lifecycle !== FactoryLifecycle.EXPIRED;
  // Plugin sets lifecycle=ACTIVE after the FIRST channel actually opens.
  // For the initial open, gate on SIGNED; also show on ACTIVE when channels < clients (recovery).
  const canOpenChannels = isLsp
    && factory.ceremony === FactoryCeremony.COMPLETE
    && (factory.lifecycle === FactoryLifecycle.SIGNED
        || (factory.lifecycle === FactoryLifecycle.ACTIVE && factory.n_channels < factory.n_clients));
  const canInvite = isLsp && factory.lifecycle === FactoryLifecycle.ACTIVE;

  return (
    <>
    <Card className='h-100 d-flex align-items-stretch px-4 pt-4 pb-3' data-testid='factory-detail'>
      <Card.Header className='px-1 pb-2 p-0 d-flex justify-content-between align-items-center'>
        <span className='fs-18px fw-bold text-dark d-flex align-items-center gap-2'>
          Factory Detail
          <span
            className={'badge ' + (isLsp ? 'bg-primary' : 'bg-info text-dark')}
            data-testid='factory-detail-role-badge'
          >
            {isLsp ? 'LSP' : 'Client'}
          </span>
        </span>
        <button className='btn btn-sm btn-outline-secondary btn-rounded' onClick={onClose}>Back</button>
      </Card.Header>
      <Card.Body className='py-2 px-1 factory-detail-scroll'>
        <Row className='mb-2'>
          <Col xs={12}>
            <div className='fs-7 text-light'>Instance ID</div>
            <OverlayTrigger placement='auto' overlay={<Tooltip>Click to copy</Tooltip>}>
              <div
                className='fw-bold text-dark fs-7 cursor-pointer text-break'
                onClick={() => copyTextToClipboard(factory.instance_id)}
              >
                {factory.instance_id}
              </div>
            </OverlayTrigger>
          </Col>
        </Row>

        <Row className='mb-2'>
          <Col xs={12}>
            <CeremonyProgress ceremony={factory.ceremony} />
          </Col>
        </Row>

        {!isLsp && (
          <Row className='mb-2'>
            <Col xs={12} className='d-flex align-items-center justify-content-between border-top pt-2'>
              <span className='fs-7'>
                <span className='text-light'>Auto-sign rotations</span>
                <OverlayTrigger
                  placement='auto'
                  overlay={<Tooltip>Plugin signs valid rotations automatically. Invariants (allocation, epoch) are always enforced regardless of this toggle. Backend wiring pending.</Tooltip>}
                >
                  <span className='ms-1 text-info cursor-pointer'>&#9432;</span>
                </OverlayTrigger>
              </span>
              <Form.Check
                type='switch'
                id={`auto-sign-${factory.instance_id}`}
                checked={autoSign}
                onChange={(e) => setAutoSign(e.target.checked)}
                data-testid='auto-sign-toggle'
              />
            </Col>
          </Row>
        )}

        <Row className='mb-2'>
          <Col xs={6} md={4}>
            <div className='fs-7 text-light'>Lifecycle</div>
            <div className='fw-bold text-dark'>{factory.lifecycle}</div>
          </Col>
          <Col xs={6} md={4}>
            <div className='fs-7 text-light'>Role</div>
            <div className='fw-bold text-dark'>{factory.is_lsp ? 'LSP' : 'Client'}</div>
          </Col>
          <Col xs={6} md={4}>
            <div className='fs-7 text-light'>Clients</div>
            <div className='fw-bold text-dark'>{factory.n_clients}</div>
          </Col>
        </Row>

        <Row className='mb-2'>
          <Col xs={6} md={4}>
            <div className='fs-7 text-light'>Epoch</div>
            <div className='fw-bold text-dark'>{factory.epoch} / {factory.max_epochs || '?'}</div>
          </Col>
          <Col xs={6} md={4}>
            <div className='fs-7 text-light'>Channels</div>
            <div className='fw-bold text-dark'>{factory.n_channels}</div>
          </Col>
          <Col xs={6} md={4}>
            <div className='fs-7 text-light'>Rotation</div>
            <div className='fw-bold text-dark'>{factory.rotation_in_progress ? 'In Progress' : 'None'}</div>
          </Col>
        </Row>

        <Row className='mb-2'>
          <Col xs={6} md={4}>
            <div className='fs-7 text-light'>Creation Block</div>
            <div className='fw-bold text-dark'>{formatBlock(factory.creation_block)}</div>
          </Col>
          <Col xs={6} md={4}>
            <div className='fs-7 text-light'>Expiry Block</div>
            <div className='fw-bold text-dark'>{formatBlock(factory.expiry_block)}</div>
          </Col>
          <Col xs={6} md={4}>
            <div className='fs-7 text-light'>Breach Epochs</div>
            <div className={'fw-bold ' + (factory.n_breach_epochs > 0 ? 'text-danger' : 'text-dark')}>{factory.n_breach_epochs}</div>
          </Col>
        </Row>

        <Row className='mb-2'>
          <Col xs={6} md={4}>
            <div className='fs-7 text-light'>Dist TX Status</div>
            <div className='fw-bold text-dark'>{factory.dist_tx_status && factory.dist_tx_status !== 'unknown' ? factory.dist_tx_status : 'N/A'}</div>
          </Col>
          <Col xs={6} md={4}>
            <div className='fs-7 text-light'>Tree Nodes</div>
            <div className='fw-bold text-dark'>{factory.tree_nodes > 0 ? factory.tree_nodes : 'N/A'}</div>
          </Col>
          <Col xs={12}>
            <div className='fs-7 text-light'>Funding TXID</div>
            {isValidTxid(factory.funding_txid) ? (
              <OverlayTrigger placement='auto' overlay={<Tooltip>Click to copy</Tooltip>}>
                <div
                  className='fw-bold text-dark fs-7 cursor-pointer text-break'
                  onClick={() => copyTextToClipboard(factory.funding_txid)}
                >
                  {factory.funding_txid}:{factory.funding_outnum}
                </div>
              </OverlayTrigger>
            ) : (
              <div className='fw-bold text-dark'>N/A</div>
            )}
          </Col>
        </Row>

        {factory.channels && factory.channels.length > 0 && (
          <Row className='mb-2'>
            <Col xs={12}>
              <div className='fs-7 text-light fw-bold mb-1'>Factory Channels</div>
              <ListGroup variant='flush' className='fs-7'>
                {factory.channels.map((ch, idx) => (
                  <ListGroup.Item key={ch.channel_id || idx} className='px-0 py-1'>
                    <div className='d-flex justify-content-between'>
                      <OverlayTrigger placement='auto' overlay={<Tooltip>Click to copy channel ID</Tooltip>}>
                        <span className='text-dark cursor-pointer' onClick={() => copyTextToClipboard(ch.channel_id)}>
                          {ch.channel_id.substring(0, 20)}...
                        </span>
                      </OverlayTrigger>
                      <span className='text-light'>leaf {ch.leaf_index} ({ch.leaf_side})</span>
                    </div>
                    {isValidTxid(ch.funding_txid) && (
                      <OverlayTrigger placement='auto' overlay={<Tooltip>Click to copy leaf funding outpoint</Tooltip>}>
                        <div className='text-light fs-8 cursor-pointer' onClick={() => copyTextToClipboard(`${ch.funding_txid}:${ch.funding_outnum}`)}>
                          funding: {ch.funding_txid!.substring(0, 16)}...:{ch.funding_outnum}
                        </div>
                      </OverlayTrigger>
                    )}
                  </ListGroup.Item>
                ))}
              </ListGroup>
            </Col>
          </Row>
        )}


        {/* Phase C: cached policy snapshot for this factory */}
        <FactoryPolicyView instanceId={factory.instance_id} />

      {factory.is_lsp && (
        <JoinRequestsCard
          factoryInstanceIdHex={factory.instance_id}
          currentBlock={currentBlock || 0}
        />
      )}
      {factory.is_lsp && (
        <div className="mb-3">
          <button
            type="button"
            className="btn btn-sm btn-outline-primary"
            onClick={() => setShowInvite(true)}
            data-testid="open-invite-modal"
          >
            Show invite QR ›
          </button>
        </div>
      )}
      {factory.is_lsp && (
        <OperatorPrefsCard factoryInstanceIdHex={factory.instance_id} />
      )}

        {responseStatus !== CallStatus.NONE && (
          <StatusAlert responseStatus={responseStatus} responseMessage={responseMessage} />
        )}
      </Card.Body>
      <Card.Footer className='d-flex justify-content-center flex-wrap gap-2'>
        {canOpenChannels && (
          <OverlayTrigger
            placement='auto'
            overlay={
              <Tooltip>
                Broadcast factory tx and open the {factory.n_clients} leaf channels.
                This is the post-ceremony step that turns signed commitments into
                spendable channels.
              </Tooltip>
            }
          >
            <button
              className='btn-rounded bg-success btn-sm'
              onClick={handleOpenChannels}
              disabled={responseStatus === CallStatus.PENDING}
              data-testid='open-channels-btn'
            >
              Open Channels
            </button>
          </OverlayTrigger>
        )}
        {canTrigger && (
          <OverlayTrigger
            placement='auto'
            overlay={<Tooltip>Force-start the MuSig2 ceremony with the currently-accepted joiners. The plugin will auto-trigger on min_clients_to_start / force-start deadline if you wait; this button is the operator override.</Tooltip>}
          >
            <button
              className='btn-rounded bg-success btn-sm'
              onClick={handleTrigger}
              disabled={responseStatus === CallStatus.PENDING}
              data-testid='trigger-ceremony-btn'
            >
              Trigger Ceremony
            </button>
          </OverlayTrigger>
        )}
        {canRotate && (
          <button className='btn-rounded bg-primary btn-sm' onClick={handleRotate} disabled={responseStatus === CallStatus.PENDING}>
            Rotate
          </button>
        )}
        {canInvite && (
          <button className='btn btn-rounded btn-secondary btn-sm' onClick={handleInvite} disabled={responseStatus === CallStatus.PENDING}>
            Invite
          </button>
        )}
        {(canClose || canForceClose) && (
          <OverlayTrigger placement='auto' overlay={<Tooltip>{closeSafety.reason}</Tooltip>}>
            <Badge
              bg={closeSafety.level === 'safe' ? 'success' : closeSafety.level === 'caution' ? 'warning' : 'danger'}
              className='align-self-center'
              data-testid='close-safety-badge'
            >
              {closeSafety.level === 'safe' ? '✓ Safe to close' :
               closeSafety.level === 'caution' ? '⚠ Caution' : '⚠ Unsafe'}
            </Badge>
          </OverlayTrigger>
        )}
        {canClose && (
          <button className='btn-rounded bg-warning btn-sm' onClick={() => setConfirmCloseMode('close')} disabled={responseStatus === CallStatus.PENDING} data-testid='close-btn'>
            Close
          </button>
        )}
        {canForceClose && (
          <button className='btn-rounded bg-danger btn-sm' onClick={() => setConfirmCloseMode('force')} disabled={responseStatus === CallStatus.PENDING} data-testid='force-close-btn'>
            Force Close
          </button>
        )}
      </Card.Footer>

      {/* Audit item #6: confirmation modal for close + force-close */}
      <Modal show={confirmCloseMode !== null} onHide={() => setConfirmCloseMode(null)} centered data-testid='close-confirm-modal'>
        <Modal.Header closeButton>
          <Modal.Title style={{ fontSize: '1.1rem' }}>
            {confirmCloseMode === 'force' ? 'Confirm force close' : 'Confirm cooperative close'}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body style={{ fontSize: '0.9rem' }}>
          <div className='mb-3'>
            <Badge
              bg={closeSafety.level === 'safe' ? 'success' : closeSafety.level === 'caution' ? 'warning' : 'danger'}
              className='me-2'
            >
              {closeSafety.level.toUpperCase()}
            </Badge>
            {closeSafety.reason}
          </div>
          {confirmCloseMode === 'close' ? (
            <>
              <p className='mb-2'>
                A cooperative close will request all participants to sign a final
                settlement transaction returning each side&apos;s balance to their
                on-chain wallet.
              </p>
              <ul className='mb-2'>
                <li>Channels: <strong>{factory.n_channels}</strong> will close</li>
                <li>Participants: <strong>{factory.n_clients + 1}</strong> must sign</li>
                <li>Funding TXID: <code>{factory.funding_txid?.slice(0, 16)}…</code></li>
                <li>If any participant is offline, the close will time out and you&apos;ll need to force close instead.</li>
              </ul>
            </>
          ) : (
            <>
              <p className='mb-2'>
                <strong>Force close</strong> unilaterally publishes the
                pre-signed factory exit chain. Use this if cooperative close
                isn&apos;t possible (other participants offline, or breach state).
              </p>
              <ul className='mb-2'>
                <li>Channels: <strong>{factory.n_channels}</strong> will be on-chain force-closed</li>
                <li>Cost: on-chain fees for {factory.n_channels} transactions plus any HTLC sweep chain</li>
                <li>Funds will not be spendable until the DW timelock expires (~hours/days depending on the tree layer)</li>
                {factory.n_breach_epochs > 0 && (
                  <li className='text-danger'>
                    <strong>{factory.n_breach_epochs} breach epoch(s)</strong> on
                    record — force close will publish the burn TX to claim the
                    counterparty&apos;s penalty output.
                  </li>
                )}
              </ul>
            </>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant='secondary' size='sm' onClick={() => setConfirmCloseMode(null)}>
            Cancel
          </Button>
          <Button
            variant={confirmCloseMode === 'force' ? 'danger' : 'warning'}
            size='sm'
            onClick={() => {
              const mode = confirmCloseMode;
              setConfirmCloseMode(null);
              if (mode === 'force') handleForceClose();
              else handleClose();
            }}
            data-testid='close-confirm-btn'
          >
            {confirmCloseMode === 'force' ? 'Force Close' : 'Close Cooperatively'}
          </Button>
        </Modal.Footer>
      </Modal>
    </Card>
      <InviteModal
        show={showInvite}
        onHide={() => setShowInvite(false)}
        factoryInstanceIdHex={factory.instance_id}
        factoryLabel={(factory as any).label}
      />
    </>
  );
};

export default FactoryDetail;
