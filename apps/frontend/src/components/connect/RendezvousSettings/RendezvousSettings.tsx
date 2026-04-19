import './RendezvousSettings.scss';
import { useEffect, useState } from 'react';
import { Accordion, Card, Form, Button, Row, Col, Spinner, Badge } from 'react-bootstrap';
import { useDispatch, useSelector } from 'react-redux';
import {
  CoordinatorEntry,
  CoordinatorNetwork,
  RelayEntry,
  RendezvousSettings as RendezvousSettingsT,
} from '../../../types/rendezvous.type';
import {
  selectRendezvousSettings,
  selectSettingsError,
  selectSettingsLoading,
} from '../../../store/rendezvousSelectors';
import { setSettings, setSettingsError, setSettingsLoading } from '../../../store/rendezvousSlice';
import rendezvousReducer from '../../../store/rendezvousSlice';
import { useInjectReducer } from '../../../hooks/use-injectreducer';
import { RendezvousService } from '../../../services/http.service';

const NETWORKS: CoordinatorNetwork[] = ['bitcoin', 'signet', 'testnet4'];

const NETWORK_LABEL: Record<CoordinatorNetwork, string> = {
  bitcoin: 'Mainnet',
  signet: 'Signet',
  testnet4: 'Testnet4',
};

const RendezvousSettings = () => {
  useInjectReducer('rendezvous', rendezvousReducer);
  const dispatch = useDispatch();
  const persisted = useSelector(selectRendezvousSettings);
  const isLoading = useSelector(selectSettingsLoading);
  const error = useSelector(selectSettingsError);

  // Local working copy so the user can edit without each keystroke hitting the wire.
  const [draft, setDraft] = useState<RendezvousSettingsT | null>(persisted);
  const [saving, setSaving] = useState(false);
  const [newCoordPerNet, setNewCoordPerNet] = useState<Record<CoordinatorNetwork, string>>({
    bitcoin: '',
    signet: '',
    testnet4: '',
  });
  const [newRelay, setNewRelay] = useState('');

  useEffect(() => {
    if (persisted) {
      setDraft(persisted);
      return;
    }
    let cancelled = false;
    dispatch(setSettingsLoading(true));
    RendezvousService.fetchSettings()
      .then(s => {
        if (cancelled) return;
        dispatch(setSettings(s));
        setDraft(s);
      })
      .catch(err => {
        if (cancelled) return;
        dispatch(setSettingsError(typeof err === 'string' ? err : err?.message || 'Load failed'));
      });
    return () => { cancelled = true; };
  }, [persisted, dispatch]);

  if (!draft) {
    return (
      <Card className='rendezvous-settings-card mt-3 px-4 py-3'>
        <div className='d-flex align-items-center gap-2 text-light'>
          {isLoading && <Spinner size='sm' animation='border' />}
          <span>{error ? `Settings unavailable: ${error}` : 'Loading rendezvous settings…'}</span>
        </div>
      </Card>
    );
  }

  const isDirty = JSON.stringify(draft) !== JSON.stringify(persisted);

  const updateCoord = (net: CoordinatorNetwork, npub: string, patch: Partial<CoordinatorEntry>) => {
    setDraft({
      ...draft,
      coordinators: {
        ...draft.coordinators,
        [net]: draft.coordinators[net].map(c => (c.npub === npub ? { ...c, ...patch } : c)),
      },
    });
  };

  const removeCoord = (net: CoordinatorNetwork, npub: string) => {
    setDraft({
      ...draft,
      coordinators: {
        ...draft.coordinators,
        [net]: draft.coordinators[net].filter(c => c.npub !== npub),
      },
    });
  };

  const addCoord = (net: CoordinatorNetwork) => {
    const trimmed = newCoordPerNet[net].trim();
    if (!trimmed) return;
    if (!trimmed.startsWith('npub1')) {
      window.alert('Coordinator must be a bech32 npub starting with npub1…');
      return;
    }
    if (draft.coordinators[net].some(c => c.npub === trimmed)) {
      window.alert('That coordinator is already in the list for ' + NETWORK_LABEL[net] + '.');
      return;
    }
    setDraft({
      ...draft,
      coordinators: {
        ...draft.coordinators,
        [net]: [...draft.coordinators[net], { npub: trimmed, enabled: true, isDefault: false }],
      },
    });
    setNewCoordPerNet({ ...newCoordPerNet, [net]: '' });
  };

  const updateRelay = (url: string, patch: Partial<RelayEntry>) => {
    setDraft({
      ...draft,
      relays: draft.relays.map(r => (r.url === url ? { ...r, ...patch } : r)),
    });
  };

  const removeRelay = (url: string) => {
    setDraft({ ...draft, relays: draft.relays.filter(r => r.url !== url) });
  };

  const addRelay = () => {
    const trimmed = newRelay.trim();
    if (!trimmed) return;
    if (!/^wss?:\/\//.test(trimmed)) {
      window.alert('Relay URL must start with wss:// (or ws:// for local testing).');
      return;
    }
    if (draft.relays.some(r => r.url === trimmed)) {
      window.alert('That relay is already in the list.');
      return;
    }
    setDraft({
      ...draft,
      relays: [...draft.relays, { url: trimmed, enabled: true, isDefault: false }],
    });
    setNewRelay('');
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const saved = await RendezvousService.saveSettings(draft);
      dispatch(setSettings(saved));
      setDraft(saved);
    } catch (err: any) {
      dispatch(setSettingsError(typeof err === 'string' ? err : err?.message || 'Save failed'));
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    if (!window.confirm('Reset to defaults? Custom coordinators and relays you added will be kept.')) return;
    setSaving(true);
    try {
      const saved = await RendezvousService.resetSettings();
      dispatch(setSettings(saved));
      setDraft(saved);
    } catch (err: any) {
      dispatch(setSettingsError(typeof err === 'string' ? err : err?.message || 'Reset failed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className='rendezvous-settings-card mt-3' data-testid='rendezvous-settings'>
      <Accordion>
        <Accordion.Item eventKey='0'>
          <Accordion.Header>
            <span className='fw-bold'>Rendezvous settings</span>
            <span className='ms-2 text-light fs-7'>
              coordinators · relays · vouch refresh
            </span>
          </Accordion.Header>
          <Accordion.Body className='px-3 py-3'>
            {error && <div className='text-danger fs-7 mb-2'>Error: {error}</div>}

            {/* Coordinators */}
            <div className='mb-4'>
              <h6 className='fw-bold mb-2'>Coordinator npubs</h6>
              <div className='text-light fs-7 mb-2'>
                Per-network seed lists. Disable a default to suppress it without losing the entry; add your own
                for private/community coordinators. Multiple enabled coordinators are unioned.
              </div>
              {NETWORKS.map(net => (
                <div key={net} className='mb-3'>
                  <div className='fw-semibold mb-1'>{NETWORK_LABEL[net]}</div>
                  {draft.coordinators[net].map(c => (
                    <Row key={c.npub} className='align-items-center gx-2 mb-1 rendezvous-row'>
                      <Col xs='auto'>
                        <Form.Check
                          type='switch'
                          id={`coord-${net}-${c.npub}`}
                          checked={c.enabled}
                          onChange={e => updateCoord(net, c.npub, { enabled: e.target.checked })}
                        />
                      </Col>
                      <Col className='font-monospace text-break rendezvous-value'>
                        {c.npub}
                        {c.isDefault && (
                          <Badge bg='secondary' className='ms-2 rendezvous-badge'>default</Badge>
                        )}
                        {c.label && <span className='ms-2 text-light'>· {c.label}</span>}
                      </Col>
                      <Col xs='auto'>
                        {c.isDefault ? (
                          <span className='text-light fs-7 fst-italic'>built-in</span>
                        ) : (
                          <Button
                            variant='link'
                            size='sm'
                            className='text-danger p-0'
                            onClick={() => removeCoord(net, c.npub)}
                          >
                            remove
                          </Button>
                        )}
                      </Col>
                    </Row>
                  ))}
                  <Row className='align-items-center gx-2 mt-1'>
                    <Col>
                      <Form.Control
                        size='sm'
                        type='text'
                        placeholder='npub1… (paste a custom coordinator)'
                        value={newCoordPerNet[net]}
                        onChange={e => setNewCoordPerNet({ ...newCoordPerNet, [net]: e.target.value })}
                        onKeyDown={e => { if (e.key === 'Enter') addCoord(net); }}
                      />
                    </Col>
                    <Col xs='auto'>
                      <Button size='sm' variant='outline-primary' onClick={() => addCoord(net)}>Add</Button>
                    </Col>
                  </Row>
                </div>
              ))}
            </div>

            {/* Relays */}
            <div className='mb-4'>
              <h6 className='fw-bold mb-2'>Nostr relays</h6>
              <div className='text-light fs-7 mb-2'>
                Shared across all networks. Vouches are queried from all enabled relays in parallel.
              </div>
              {draft.relays.map(r => (
                <Row key={r.url} className='align-items-center gx-2 mb-1 rendezvous-row'>
                  <Col xs='auto'>
                    <Form.Check
                      type='switch'
                      id={`relay-${r.url}`}
                      checked={r.enabled}
                      onChange={e => updateRelay(r.url, { enabled: e.target.checked })}
                    />
                  </Col>
                  <Col className='font-monospace text-break rendezvous-value'>
                    {r.url}
                    {r.isDefault && <Badge bg='secondary' className='ms-2 rendezvous-badge'>default</Badge>}
                  </Col>
                  <Col xs='auto'>
                    {r.isDefault ? (
                      <span className='text-light fs-7 fst-italic'>built-in</span>
                    ) : (
                      <Button
                        variant='link'
                        size='sm'
                        className='text-danger p-0'
                        onClick={() => removeRelay(r.url)}
                      >
                        remove
                      </Button>
                    )}
                  </Col>
                </Row>
              ))}
              <Row className='align-items-center gx-2 mt-1'>
                <Col>
                  <Form.Control
                    size='sm'
                    type='text'
                    placeholder='wss://relay.example.com'
                    value={newRelay}
                    onChange={e => setNewRelay(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') addRelay(); }}
                  />
                </Col>
                <Col xs='auto'>
                  <Button size='sm' variant='outline-primary' onClick={addRelay}>Add</Button>
                </Col>
              </Row>
            </div>

            {/* Display + refresh knobs */}
            <Row className='mb-4'>
              <Col md={6}>
                <h6 className='fw-bold mb-2'>Display caps</h6>
                <Form.Group className='mb-2'>
                  <Form.Label className='fs-7 mb-0'>Max entries (after dedup)</Form.Label>
                  <Form.Control
                    size='sm'
                    type='number'
                    value={draft.maxEntries}
                    min={10}
                    max={5000}
                    onChange={e => setDraft({ ...draft, maxEntries: Math.max(1, Number(e.target.value) || 1) })}
                  />
                </Form.Group>
                {(['channel', 'utxo', 'peer'] as const).map(t => (
                  <Form.Group className='mb-2' key={t}>
                    <Form.Label className='fs-7 mb-0'>Tier cap — {t}</Form.Label>
                    <Form.Control
                      size='sm'
                      type='number'
                      value={draft.tierCaps[t]}
                      min={1}
                      onChange={e => setDraft({
                        ...draft,
                        tierCaps: { ...draft.tierCaps, [t]: Math.max(1, Number(e.target.value) || 1) },
                      })}
                    />
                  </Form.Group>
                ))}
              </Col>
              <Col md={6}>
                <h6 className='fw-bold mb-2'>Refresh + peer tier</h6>
                <Form.Check
                  type='switch'
                  id='vouch-auto-refresh'
                  className='mb-2'
                  label='Auto-refresh vouches'
                  checked={draft.vouchAutoRefresh}
                  onChange={e => setDraft({ ...draft, vouchAutoRefresh: e.target.checked })}
                />
                <Form.Group className='mb-2'>
                  <Form.Label className='fs-7 mb-0'>Auto-refresh interval (minutes)</Form.Label>
                  <Form.Control
                    size='sm'
                    type='number'
                    disabled={!draft.vouchAutoRefresh}
                    value={draft.vouchRefreshMin}
                    min={1}
                    max={1440}
                    onChange={e => setDraft({ ...draft, vouchRefreshMin: Math.max(1, Number(e.target.value) || 1) })}
                  />
                  <Form.Text className='text-light'>
                    Off by default. Use the Refresh button on the list to pull on demand.
                  </Form.Text>
                </Form.Group>
                <Form.Group className='mb-2'>
                  <Form.Label className='fs-7 mb-0'>Browse cache TTL (minutes)</Form.Label>
                  <Form.Control
                    size='sm'
                    type='number'
                    value={draft.browseCacheTtlMin}
                    min={1}
                    max={1440}
                    onChange={e => setDraft({ ...draft, browseCacheTtlMin: Math.max(1, Number(e.target.value) || 1) })}
                  />
                </Form.Group>
                <div className='mt-3'>
                  <div className='fs-7 fw-semibold mb-1'>Show peer-tier vouches per network</div>
                  {NETWORKS.map(net => (
                    <Form.Check
                      key={net}
                      type='switch'
                      id={`peer-${net}`}
                      label={NETWORK_LABEL[net]}
                      checked={!!draft.showPeerTier?.[net]}
                      onChange={e => setDraft({
                        ...draft,
                        showPeerTier: { ...draft.showPeerTier, [net]: e.target.checked },
                      })}
                    />
                  ))}
                  <div className='text-light fs-8 mt-1'>
                    Peer-tier has no chain anchor — recommended off on mainnet.
                  </div>
                </div>
              </Col>
            </Row>

            <div className='d-flex justify-content-end gap-2'>
              <Button size='sm' variant='outline-secondary' onClick={handleReset} disabled={saving}>
                Reset to defaults
              </Button>
              <Button size='sm' variant='primary' onClick={handleSave} disabled={!isDirty || saving}>
                {saving && <Spinner size='sm' animation='border' className='me-1' />}
                Save settings
              </Button>
            </div>
          </Accordion.Body>
        </Accordion.Item>
      </Accordion>
    </Card>
  );
};

export default RendezvousSettings;
