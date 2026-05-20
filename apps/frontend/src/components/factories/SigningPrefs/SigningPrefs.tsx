import './SigningPrefs.scss';
import { useEffect, useMemo, useState } from 'react';
import {
  Card, Row, Col, Form, Button, Spinner, Alert, OverlayTrigger, Tooltip,
} from 'react-bootstrap';
import { FactoriesService } from '../../../services/http.service';
import { CallStatus, CLEAR_STATUS_ALERT_DELAY } from '../../../utilities/constants';
import StatusAlert from '../../shared/StatusAlert/StatusAlert';
import {
  ClientSigningPrefs,
  DEFAULT_CLIENT_SIGNING_PREFS,
  ProofTier,
} from '../../../types/signing-prefs.type';

const TIER_LABEL: Record<ProofTier, string> = {
  [ProofTier.CHANNEL]: 'CHANNEL (strictest — only direct channels accepted)',
  [ProofTier.INVOICE]: 'INVOICE (recommended — proof-via-invoice required)',
  [ProofTier.NONE]: 'NONE (loosest — no proof required, not recommended)',
};

type FieldKey = Exclude<
  keyof ClientSigningPrefs,
  'require_strict_proof_tier' | 'max_proof_tier' | 'require_tier_b_rollover'
  | 'auto_sign_on_validator_pass'
>;

type FieldSpec = {
  key: FieldKey;
  label: string;
  help: string;
  unit?: string;
  min?: number;
  max?: number;
};

const FIELD_SPECS: { section: string; fields: FieldSpec[] }[] = [
  {
    section: 'HTLC sizing',
    fields: [
      {
        key: 'max_htlc_min_sat',
        label: 'Max acceptable htlc_min_sat',
        help: 'Refuse if the LSP wants htlc_min_sat above this. Above 10k sat starts to hurt small payments.',
        unit: 'sat', min: 0,
      },
      {
        key: 'min_htlc_max_sat',
        label: 'Min acceptable htlc_max_sat',
        help: 'Refuse if the LSP caps htlc_max_sat below this. Below 100k sat hurts mid-size payments.',
        unit: 'sat', min: 0,
      },
    ],
  },
  {
    section: 'HTLC concurrency',
    fields: [
      {
        key: 'min_max_concurrent_htlcs',
        label: 'Min acceptable max_concurrent_htlcs',
        help: 'Refuse if the LSP allows fewer concurrent HTLCs than this per channel.',
        min: 1, max: 483,
      },
      {
        key: 'min_max_in_flight_msat',
        label: 'Min acceptable max_in_flight_msat',
        help: 'Refuse if the LSP caps total in-flight HTLC value below this (millisat).',
        unit: 'msat', min: 0,
      },
    ],
  },
  {
    section: 'CLTV expiry',
    fields: [
      {
        key: 'max_min_final_cltv_delta',
        label: 'Max acceptable min_final_cltv_expiry_delta',
        help: 'Refuse if the LSP wants final-CLTV above this many blocks. 200 ≈ 33 hr.',
        unit: 'blocks', min: 0, max: 10000,
      },
      {
        key: 'max_cltv_delta_forward',
        label: 'Max acceptable cltv_expiry_delta_forward',
        help: 'Refuse if the LSP wants forward-CLTV-delta above this many blocks.',
        unit: 'blocks', min: 0, max: 10000,
      },
    ],
  },
  {
    section: 'Per-join capacity',
    fields: [
      {
        key: 'max_min_capacity_per_join_sat',
        label: 'Max acceptable min_capacity_per_join_sat',
        help: 'Refuse if the LSP demands you bring at least this much to join. 1M sat ≈ minimum we will pay to join.',
        unit: 'sat', min: 0,
      },
      {
        key: 'min_max_capacity_per_join_sat',
        label: 'Min acceptable max_capacity_per_join_sat',
        help: 'Refuse if the LSP caps your contribution below this. 10k sat is the floor we accept.',
        unit: 'sat', min: 0,
      },
    ],
  },
  {
    section: 'Rotation cadence',
    fields: [
      {
        key: 'min_rotation_interval_blocks',
        label: 'Min acceptable rotation_interval_blocks',
        help: 'Refuse if the LSP wants to rotate the factory more often than this (would mean perma-ceremony).',
        unit: 'blocks', min: 1,
      },
    ],
  },
  {
    section: 'State replay defense',
    fields: [
      {
        key: 'min_state_replay_defense_window_blocks',
        label: 'Min acceptable state_replay_defense_window_blocks',
        help: 'Refuse if the LSP wants a replay-defense window shorter than this. 288 ≈ 2 days.',
        unit: 'blocks', min: 1,
      },
    ],
  },
];

const InfoIcon = ({ text }: { text: string }) => (
  <OverlayTrigger placement='auto' overlay={<Tooltip>{text}</Tooltip>}>
    <span className='ms-1 text-info' style={{ cursor: 'help' }}>&#9432;</span>
  </OverlayTrigger>
);

const formatErr = (err: any, fallback: string): string => {
  if (typeof err === 'string') return err;
  if (err?.message) return err.message;
  try {
    const s = JSON.stringify(err);
    if (s && s !== '{}' && s !== 'null') return s;
  } catch { /* circular ref */ }
  return fallback;
};

function SigningPrefs() {
  const [prefs, setPrefs] = useState<ClientSigningPrefs>(DEFAULT_CLIENT_SIGNING_PREFS);
  const [originalPrefs, setOriginalPrefs] = useState<ClientSigningPrefs>(DEFAULT_CLIENT_SIGNING_PREFS);
  const [isLoading, setIsLoading] = useState(true);
  const [isDefault, setIsDefault] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [callStatus, setCallStatus] = useState({ status: CallStatus.NONE, message: '' });

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    FactoriesService.getClientSigningPrefs()
      .then((resp) => {
        if (cancelled) return;
        setPrefs(resp.prefs);
        setOriginalPrefs(resp.prefs);
        setIsDefault(resp.is_default);
        setLoadError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError(
          'Could not load saved preferences — using defaults. ' +
          formatErr(err, 'Plugin RPC client-signing-prefs-get may not be available yet.'),
        );
        setPrefs(DEFAULT_CLIENT_SIGNING_PREFS);
        setOriginalPrefs(DEFAULT_CLIENT_SIGNING_PREFS);
        setIsDefault(true);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const isDirty = useMemo(() => {
    return JSON.stringify(prefs) !== JSON.stringify(originalPrefs);
  }, [prefs, originalPrefs]);

  const diffSummary = useMemo(() => {
    const out: string[] = [];
    (Object.keys(prefs) as (keyof ClientSigningPrefs)[]).forEach((k) => {
      const cur = prefs[k] as unknown;
      const def = DEFAULT_CLIENT_SIGNING_PREFS[k] as unknown;
      if (cur !== def) {
        out.push(`${k}: ${String(def)} → ${String(cur)}`);
      }
    });
    return out;
  }, [prefs]);

  const updateNumeric = (key: FieldKey, raw: string) => {
    const n = parseInt(raw, 10);
    if (raw.trim() === '') {
      setPrefs((p) => ({ ...p, [key]: 0 }));
      return;
    }
    if (Number.isFinite(n) && n >= 0) {
      setPrefs((p) => ({ ...p, [key]: n }));
    }
  };

  const handleSave = async () => {
    setCallStatus({ status: CallStatus.PENDING, message: 'Saving preferences…' });
    try {
      await FactoriesService.setClientSigningPrefs(prefs);
      setOriginalPrefs(prefs);
      setIsDefault(false);
      setCallStatus({ status: CallStatus.SUCCESS, message: 'Preferences saved.' });
      setTimeout(() => setCallStatus({ status: CallStatus.NONE, message: '' }), CLEAR_STATUS_ALERT_DELAY);
    } catch (err: any) {
      setCallStatus({
        status: CallStatus.ERROR,
        message: formatErr(err, 'Failed to save preferences. The plugin RPC client-signing-prefs-set may not be available yet.'),
      });
    }
  };

  const handleResetToDefaults = () => {
    setPrefs(DEFAULT_CLIENT_SIGNING_PREFS);
  };

  const handleDiscardChanges = () => {
    setPrefs(originalPrefs);
  };

  if (isLoading) {
    return (
      <Card>
        <Card.Body className='text-center'>
          <Spinner animation='border' size='sm' className='me-2' />
          Loading preferences…
        </Card.Body>
      </Card>
    );
  }

  return (
    <Card className='signing-prefs' data-testid='signing-prefs-card'>
      <Card.Body>
        <Card.Title className='d-flex align-items-center'>
          <span>Client signing preferences</span>
          <InfoIcon text={
            'Thresholds the plugin checks before signing an incoming FACTORY_PROPOSE. ' +
            'If an LSP advertises a policy looser than these, your plugin refuses to sign.'
          } />
        </Card.Title>
        <Card.Subtitle className='text-muted mb-3' style={{ fontSize: '0.9rem' }}>
          These thresholds drive the no-blind-signing safety gate. Defaults are conservative — loosen them only deliberately.
          {isDefault && (
            <span className='ms-2 badge bg-info'>Using built-in defaults</span>
          )}
        </Card.Subtitle>

        {loadError && (
          <Alert variant='warning' className='py-2 mb-3' style={{ fontSize: '0.85rem' }}>
            {loadError}
          </Alert>
        )}

        <Form onSubmit={(e) => { e.preventDefault(); handleSave(); }}>
          {/* D.1 auto-sign toggle — surfaced prominently because it changes
              the overall flow: ON = automatic signing, OFF = manual confirm */}
          <div
            className='p-3 mb-3'
            style={{
              border: '1px solid rgba(13, 110, 253, 0.3)',
              borderRadius: '6px',
              background: 'rgba(13, 110, 253, 0.04)',
            }}
          >
            <Form.Check
              type='switch'
              id='auto-sign-toggle'
              checked={prefs.auto_sign_on_validator_pass}
              onChange={(e) => setPrefs((p) => ({ ...p, auto_sign_on_validator_pass: e.target.checked }))}
              label={
                <span style={{ fontWeight: 600 }}>
                  Sign automatically when policy passes validation
                  <InfoIcon text={
                    'ON (recommended): when an LSP sends a FACTORY_PROPOSE that passes ' +
                    'all the thresholds below, your plugin signs it immediately. ' +
                    'OFF: every proposal pops a review modal — you must click Approve & sign ' +
                    'before any signature is sent. Use OFF if you want a human-in-the-loop ' +
                    'gate before every ceremony. HARD_FAIL proposals are always refused ' +
                    'regardless of this toggle.'
                  } />
                </span>
              }
              data-testid='pref-auto_sign_on_validator_pass'
            />
            <div className='field-help mt-1'>
              {prefs.auto_sign_on_validator_pass
                ? 'ON — proposals that pass validation are signed without prompting.'
                : 'OFF — every proposal pauses for your review (the wallet shows a confirmation modal).'}
            </div>
          </div>

          {FIELD_SPECS.map((group) => (
            <div key={group.section}>
              <div className='section-header'>{group.section}</div>
              <Row>
                {group.fields.map((spec) => (
                  <Col key={spec.key} xs={12} md={6} className='mb-3'>
                    <Form.Label className='mb-1 d-flex align-items-center' style={{ fontSize: '0.9rem' }}>
                      <span>{spec.label}</span>
                      <InfoIcon text={spec.help} />
                    </Form.Label>
                    <div className='d-flex align-items-center'>
                      <Form.Control
                        type='number'
                        value={prefs[spec.key]}
                        min={spec.min}
                        max={spec.max}
                        onChange={(e) => updateNumeric(spec.key, e.target.value)}
                        data-testid={`pref-${spec.key}`}
                      />
                      {spec.unit && <span className='units-suffix ms-2'>{spec.unit}</span>}
                    </div>
                    <div className='field-help'>{spec.help}</div>
                  </Col>
                ))}
              </Row>
            </div>
          ))}

          <div className='section-header'>Proof tier</div>
          <Row>
            <Col xs={12} md={6} className='mb-3'>
              <Form.Check
                type='checkbox'
                id='require-strict-proof-tier'
                label='Require LSP to publish a proof tier'
                checked={prefs.require_strict_proof_tier}
                onChange={(e) => setPrefs((p) => ({ ...p, require_strict_proof_tier: e.target.checked }))}
                data-testid='pref-require_strict_proof_tier'
              />
              <div className='field-help'>
                If on, the LSP must advertise a tier at least as strict as the level below.
                If off, any tier (including NONE) is accepted.
              </div>
            </Col>
            <Col xs={12} md={6} className='mb-3'>
              <Form.Label className='mb-1' style={{ fontSize: '0.9rem' }}>Strictest acceptable tier</Form.Label>
              <Form.Select
                value={prefs.max_proof_tier}
                disabled={!prefs.require_strict_proof_tier}
                onChange={(e) => setPrefs((p) => ({ ...p, max_proof_tier: parseInt(e.target.value, 10) as ProofTier }))}
                data-testid='pref-max_proof_tier'
              >
                {(Object.keys(TIER_LABEL) as unknown as ProofTier[]).map((t) => (
                  <option key={t} value={t}>{TIER_LABEL[t]}</option>
                ))}
              </Form.Select>
              <div className='field-help'>
                Tiers are numbered: CHANNEL=0 (strictest), INVOICE=1, NONE=2 (loosest).
              </div>
            </Col>
          </Row>

          <div className='section-header'>Tier B rollover</div>
          <Row>
            <Col xs={12} className='mb-3'>
              <Form.Check
                type='checkbox'
                id='require-tier-b-rollover'
                label='Require Tier B rollover support'
                checked={prefs.require_tier_b_rollover}
                onChange={(e) => setPrefs((p) => ({ ...p, require_tier_b_rollover: e.target.checked }))}
                data-testid='pref-require_tier_b_rollover'
              />
              <div className='field-help'>
                If on, the LSP must advertise allow_tier_b_rollover = true. Default off — most LSPs do not yet support this.
              </div>
            </Col>
          </Row>

          {diffSummary.length > 0 && (
            <>
              <div className='section-header'>Changes from defaults</div>
              <div className='preview-block'>
                {diffSummary.join('\n')}
              </div>
            </>
          )}

          <StatusAlert responseStatus={callStatus.status} responseMessage={callStatus.message} />

          <div className='save-bar'>
            <Button
              type='submit'
              variant='primary'
              disabled={!isDirty || callStatus.status === CallStatus.PENDING}
              data-testid='save-prefs'
            >
              {callStatus.status === CallStatus.PENDING ? (
                <><Spinner animation='border' size='sm' className='me-2' />Saving…</>
              ) : 'Save preferences'}
            </Button>
            <Button
              type='button'
              variant='outline-secondary'
              onClick={handleDiscardChanges}
              disabled={!isDirty}
              data-testid='discard-prefs'
            >
              Discard changes
            </Button>
            <Button
              type='button'
              variant='outline-danger'
              onClick={handleResetToDefaults}
              data-testid='reset-prefs'
            >
              Reset to defaults
            </Button>
            {isDirty && (
              <span className='danger-text'>Unsaved changes</span>
            )}
          </div>
        </Form>
      </Card.Body>
    </Card>
  );
}

export default SigningPrefs;
