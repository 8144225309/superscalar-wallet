import { useEffect, useState } from 'react';
import { Card, Form, Button, Spinner, Alert } from 'react-bootstrap';
import { FactoriesService } from '../../../services/http.service';

/* Session 2 slice B (per-factory editor): LSP operator preferences for
 * one specific factory. Reads/writes lsp_operator_prefs rows where
 * factory_instance_id = this iid. Fields fall back to global defaults
 * (factory_instance_id=NULL) when the per-factory row is missing — the
 * card shows an "Inherited from global" badge in that case. Writes via
 * wallet-set-operator-pref with this factory's iid. */

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
    help: 'Join requests with contribution at-or-above this are auto-accepted. Below this, they queue for manual review.',
  },
  {
    key: 'min_contribution',
    label: 'Minimum contribution',
    unit: 'sats',
    help: 'Refuse joins below this size. Set to 0 to accept anything.',
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
    help: 'Refuse joins from peers below this reputation score. Set to 0 to accept any reputation.',
  },
];

type Props = {
  factoryInstanceIdHex: string;
};

function OperatorPrefsCard({ factoryInstanceIdHex }: Props) {
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
          const r = await FactoriesService.getOperatorPref(factoryInstanceIdHex, f.key);
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
  }, [factoryInstanceIdHex]);

  const isDirty = FIELDS.some((f) => values[f.key] !== original[f.key]);

  const handleChange = (k: PrefKey, raw: string) => {
    setValues((v) => ({ ...v, [k]: raw }));
    setSavedMsg(null);
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSavedMsg(null);
    try {
      for (const f of FIELDS) {
        if (values[f.key] !== original[f.key]) {
          const v = values[f.key].trim();
          await FactoriesService.setOperatorPref(
            factoryInstanceIdHex,
            f.key,
            v === '' ? null : v,
          );
        }
      }
      setOriginal(values);
      setSavedMsg('Saved.');
      setTimeout(() => setSavedMsg(null), 3000);
    } catch (e: any) {
      setError(`Save failed: ${e?.message ?? e}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className='mb-3' data-testid='operator-prefs-card'>
      <Card.Body>
        <Card.Title style={{ fontSize: '1rem' }}>Acceptance policy (this factory)</Card.Title>
        <Card.Subtitle className='text-muted mb-3' style={{ fontSize: '0.85rem' }}>
          Per-factory overrides. Leave blank to inherit from your global LSP defaults.
        </Card.Subtitle>

        {error && (
          <Alert variant='warning' className='py-2 mb-3' style={{ fontSize: '0.85rem' }}>{error}</Alert>
        )}
        {savedMsg && (
          <Alert variant='success' className='py-2 mb-3' style={{ fontSize: '0.85rem' }}>{savedMsg}</Alert>
        )}

        {loading ? (
          <div className='text-center py-2'>
            <Spinner animation='border' size='sm' /> <span className='text-muted ms-2'>Loading…</span>
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
                    onChange={(e) => handleChange(f.key, e.target.value)}
                    placeholder='inherit'
                    style={{ maxWidth: 220 }}
                    data-testid={`pref-${f.key}`}
                  />
                  <span className='units-suffix ms-2 text-muted' style={{ fontSize: '0.85rem' }}>{f.unit}</span>
                </div>
                <div className='text-muted' style={{ fontSize: '0.75rem', lineHeight: 1.3, marginTop: '0.1rem' }}>
                  {f.help}
                </div>
              </Form.Group>
            ))}

            <div className='d-flex gap-2 mt-3'>
              <Button
                type='submit'
                variant='primary'
                size='sm'
                disabled={!isDirty || saving}
                data-testid='save-operator-prefs'
              >
                {saving ? <><Spinner animation='border' size='sm' className='me-2' />Saving…</> : 'Save policy'}
              </Button>
              <Button
                type='button'
                variant='outline-secondary'
                size='sm'
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

export default OperatorPrefsCard;
