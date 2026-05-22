import './OperatorPrefs.scss';
import { useEffect, useState } from 'react';
import { Card, Form, Button, Spinner, Alert } from 'react-bootstrap';
import { FactoriesService } from '../../../services/http.service';

/* Session 3 slice B: global LSP operator preferences editor.
 * Parallels SigningPrefs.tsx (client-side) but for the LSP role.
 *
 * Reads/writes lsp_operator_prefs rows with factory_instance_id=NULL
 * via wallet-get-operator-pref / wallet-set-operator-pref. These act
 * as defaults; per-factory overrides live in OperatorPrefsCard on
 * FactoryDetail. */

type PrefKey =
  | 'auto_accept_threshold'
  | 'min_contribution'
  | 'max_contribution'
  | 'required_reputation';

const FIELDS: { key: PrefKey; label: string; unit: string; help: string }[] = [
  {
    key: 'auto_accept_threshold',
    label: 'Auto-accept threshold',
    unit: 'sats',
    help: 'Default: join requests at-or-above this contribution are auto-accepted. Below this they queue for manual review. Set to 0 to manually review every request.',
  },
  {
    key: 'min_contribution',
    label: 'Minimum contribution',
    unit: 'sats',
    help: 'Refuse joins below this size. Set to 0 to accept any contribution amount.',
  },
  {
    key: 'max_contribution',
    label: 'Maximum contribution',
    unit: 'sats',
    help: 'Refuse joins above this size. Set to 0 for no cap.',
  },
  {
    key: 'required_reputation',
    label: 'Required peer reputation',
    unit: 'score',
    help: 'Refuse joins from peers below this reputation score. Set to 0 to accept any reputation. Future: tied to per-peer reputation tracking (session 4).',
  },
];

function OperatorPrefs() {
  const [values, setValues] = useState<Record<PrefKey, string>>({
    auto_accept_threshold: '',
    min_contribution: '',
    max_contribution: '',
    required_reputation: '',
  });
  const [original, setOriginal] = useState<Record<PrefKey, string>>(values);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const next: Record<PrefKey, string> = { ...values };
      for (const f of FIELDS) {
        try {
          const r = await FactoriesService.getOperatorPref(null, f.key);
          const v = (r as any)?.value;
          next[f.key] = v == null ? '' : String(v);
        } catch {
          next[f.key] = '';
        }
      }
      setValues(next);
      setOriginal(next);
      setError(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const isDirty = FIELDS.some((f) => values[f.key] !== original[f.key]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSavedMsg(null);
    try {
      for (const f of FIELDS) {
        if (values[f.key] !== original[f.key]) {
          const v = values[f.key].trim();
          await FactoriesService.setOperatorPref(null, f.key, v === '' ? null : v);
        }
      }
      setOriginal(values);
      setSavedMsg('Global defaults saved.');
      setTimeout(() => setSavedMsg(null), 3000);
    } catch (e: any) {
      setError(`Save failed: ${e?.message ?? e}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className='operator-prefs' data-testid='operator-prefs-card'>
      <Card.Body>
        <Card.Title>LSP operator preferences (global defaults)</Card.Title>
        <Card.Subtitle className='text-muted mb-3' style={{ fontSize: '0.9rem' }}>
          These thresholds gate incoming <code>factory-join-request</code> messages. Per-factory overrides on FactoryDetail take precedence when set.
        </Card.Subtitle>

        {error && (
          <Alert variant='warning' className='py-2 mb-3' style={{ fontSize: '0.85rem' }}>{error}</Alert>
        )}
        {savedMsg && (
          <Alert variant='success' className='py-2 mb-3' style={{ fontSize: '0.85rem' }}>{savedMsg}</Alert>
        )}

        {loading ? (
          <div className='text-center py-3'>
            <Spinner animation='border' size='sm' /> <span className='text-muted ms-2'>Loading defaults…</span>
          </div>
        ) : (
          <Form onSubmit={(e) => { e.preventDefault(); handleSave(); }}>
            {FIELDS.map((f) => (
              <Form.Group key={f.key} className='mb-2'>
                <Form.Label className='mb-1' style={{ fontSize: '0.9rem' }}>{f.label}</Form.Label>
                <div className='d-flex align-items-center'>
                  <Form.Control
                    type='text'
                    inputMode='numeric'
                    value={values[f.key]}
                    onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                    placeholder='(unset — disables this gate)'
                    style={{ maxWidth: 280 }}
                    data-testid={`global-pref-${f.key}`}
                  />
                  <span className='units-suffix ms-2 text-muted' style={{ fontSize: '0.85rem' }}>{f.unit}</span>
                </div>
                <div className='field-help'>{f.help}</div>
              </Form.Group>
            ))}

            <div className='save-bar'>
              <Button
                type='submit'
                variant='primary'
                disabled={!isDirty || saving}
                data-testid='save-global-prefs'
              >
                {saving ? <><Spinner animation='border' size='sm' className='me-2' />Saving…</> : 'Save defaults'}
              </Button>
              <Button
                type='button'
                variant='outline-secondary'
                onClick={() => setValues(original)}
                disabled={!isDirty || saving}
              >
                Discard
              </Button>
            </div>
          </Form>
        )}
      </Card.Body>
    </Card>
  );
}

export default OperatorPrefs;
