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

/* Inline numeric validation: any non-empty string that isn't a
 * non-negative integer is rejected at the field level so the operator
 * sees the problem before submitting and getting a vaguer server error. */
function isNumericOrEmpty(s: string): boolean {
  const t = s.trim();
  if (t === '') return true;
  return /^\d+$/.test(t);
}

const FIELDS: { key: PrefKey; label: string; unit: string; help: string }[] = [
  {
    key: 'auto_accept_threshold',
    label: 'Auto-accept threshold',
    unit: 'sats',
    help: 'Default: join requests at-or-above this requested capacity are auto-accepted. Below this they queue for manual review. Set to 0 to manually review every request.',
  },
  {
    key: 'min_contribution',
    label: 'Minimum requested capacity',
    unit: 'sats',
    help: 'Refuse joins requesting less capacity than this. Set to 0 to accept any size.',
  },
  {
    key: 'max_contribution',
    label: 'Maximum requested capacity',
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
          const r: { value?: string | number | null } = await FactoriesService.getOperatorPref(null, f.key);
          const v = r?.value;
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
  const hasInvalidField = FIELDS.some((f) => !isNumericOrEmpty(values[f.key]));

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
      /* No timeout — leave the confirmation visible until the operator
       * edits again or reloads. Auto-dismiss at 3s was disorienting on
       * slow connections where the operator was still reading the form. */
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
          <Form onSubmit={(e) => { e.preventDefault(); if (!hasInvalidField) handleSave(); }}>
            {FIELDS.map((f) => {
              const invalid = !isNumericOrEmpty(values[f.key]);
              return (
                <Form.Group key={f.key} className='mb-2'>
                  <Form.Label className='mb-1 field-label-small'>{f.label}</Form.Label>
                  <div className='d-flex align-items-center'>
                    <Form.Control
                      type='text'
                      inputMode='numeric'
                      value={values[f.key]}
                      onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                      placeholder='(unset — disables this gate)'
                      className='field-control-medium'
                      isInvalid={invalid}
                      data-testid={`global-pref-${f.key}`}
                    />
                    <span className='units-suffix ms-2 text-muted field-help-small'>{f.unit}</span>
                  </div>
                  {invalid && (
                    <Form.Control.Feedback type='invalid' className='d-block'>
                      Whole numbers only (or leave empty to disable this gate).
                    </Form.Control.Feedback>
                  )}
                  <div className='field-help'>{f.help}</div>
                </Form.Group>
              );
            })}

            <div className='save-bar'>
              <Button
                type='submit'
                variant='primary'
                disabled={!isDirty || saving || hasInvalidField}
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
              <Button
                type='button'
                variant='outline-secondary'
                onClick={load}
                disabled={saving || loading}
                title='Reload current values from the server, discarding any local edits'
                data-testid='reload-global-prefs'
              >
                Reload
              </Button>
            </div>
          </Form>
        )}
      </Card.Body>
    </Card>
  );
}

export default OperatorPrefs;
