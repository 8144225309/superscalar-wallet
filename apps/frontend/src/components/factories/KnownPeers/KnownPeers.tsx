import './KnownPeers.scss';
import { useEffect, useMemo, useState } from 'react';
import { Card, Table, Button, Form, Badge, Spinner, Alert, Modal } from 'react-bootstrap';
import { FactoriesService } from '../../../services/http.service';

/* Session 4 slice D: cross-factory peer management.
 *
 * Aggregates lsp_join_queue + peer_notes + peer_reputation into a
 * single per-peer view. Operator can ban/unban (reputation = -1
 * sentinel), set a reputation score, edit per-peer notes.
 *
 * Backed by plugin RPCs:
 *   wallet-list-known-peers
 *   wallet-set-peer-reputation
 *   wallet-set-peer-note
 */

type KnownPeer = {
  peer_pubkey_hex: string;
  total_contribution_sats: string;
  factory_count: number;
  score: number | null;
  banned: boolean;
  label: string | null;
  body: string | null;
  last_seen_block: number | null;
};

const short = (hex: string, n = 12): string =>
  hex.length > n + 4 ? `${hex.slice(0, n)}…${hex.slice(-4)}` : hex;

function KnownPeers() {
  const [peers, setPeers] = useState<KnownPeer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'banned' | 'noted'>('all');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<KnownPeer | null>(null);
  const [draft, setDraft] = useState<{ score: string; label: string; body: string }>({ score: '', label: '', body: '' });
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const r = await FactoriesService.listKnownPeers();
      setPeers((r as any)?.peers ?? []);
      setError(null);
    } catch (e: any) {
      setError(`Failed to load peers: ${e?.message ?? e}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return peers.filter((p) => {
      if (filter === 'banned' && !p.banned) return false;
      if (filter === 'noted' && !p.label && !p.body) return false;
      if (q && !p.peer_pubkey_hex.toLowerCase().includes(q) && !(p.label ?? '').toLowerCase().includes(q)) return false;
      return true;
    });
  }, [peers, filter, search]);

  const handleBanToggle = async (p: KnownPeer) => {
    setBusy(true);
    try {
      const newScore = p.banned ? 0 : -1;
      await FactoriesService.setPeerReputation(p.peer_pubkey_hex, newScore, p.banned ? 'unban' : 'ban');
      await load();
    } catch (e: any) {
      setError(`Ban toggle failed: ${e?.message ?? e}`);
    } finally {
      setBusy(false);
    }
  };

  const openEdit = (p: KnownPeer) => {
    setEditing(p);
    setDraft({
      score: p.score == null ? '' : String(p.score),
      label: p.label ?? '',
      body: p.body ?? '',
    });
  };

  const handleSave = async () => {
    if (!editing) return;
    setBusy(true);
    try {
      const scoreStr = draft.score.trim();
      if (scoreStr !== '') {
        const n = parseInt(scoreStr, 10);
        if (!Number.isFinite(n)) throw new Error('score must be an integer');
        await FactoriesService.setPeerReputation(editing.peer_pubkey_hex, n);
      }
      if (draft.label || draft.body || editing.label || editing.body) {
        await FactoriesService.setPeerNote(editing.peer_pubkey_hex, draft.label || null, draft.body || null);
      }
      setEditing(null);
      await load();
    } catch (e: any) {
      setError(`Save failed: ${e?.message ?? e}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className='known-peers' data-testid='known-peers-card'>
      <Card.Body>
        <Card.Title>Known peers</Card.Title>
        <Card.Subtitle className='text-muted mb-3' style={{ fontSize: '0.9rem' }}>
          Every peer that has interacted with this LSP, across all factories. Set a reputation score, leave operator notes, or ban a peer (sets score to −1).
        </Card.Subtitle>

        {error && <Alert variant='warning' className='py-2 mb-3'>{error}</Alert>}

        <div className='d-flex gap-2 mb-3 align-items-stretch align-items-sm-center flex-column flex-sm-row'>
          <Form.Control
            size='sm'
            type='search'
            placeholder='Search by pubkey or label…'
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className='flex-grow-1'
            style={{ maxWidth: 280, minWidth: 0 }}
          />
          <div className='btn-group' role='group'>
            {(['all', 'banned', 'noted'] as const).map((f) => (
              <Button
                key={f}
                size='sm'
                variant={filter === f ? 'primary' : 'outline-secondary'}
                onClick={() => setFilter(f)}
              >
                {f[0].toUpperCase() + f.slice(1)}
              </Button>
            ))}
          </div>
          <span className='ms-sm-auto text-muted' style={{ fontSize: '0.85rem' }}>
            {filtered.length} peer{filtered.length === 1 ? '' : 's'}
          </span>
        </div>

        {loading ? (
          <div className='text-center py-3'>
            <Spinner animation='border' size='sm' /> <span className='text-muted ms-2'>Loading…</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className='text-muted text-center py-4'>
            {peers.length === 0
              ? 'No peers have interacted with your LSP yet.'
              : 'No peers match the current filter.'}
          </div>
        ) : (
          <div className='table-responsive'>
          <Table size='sm' className='mb-0'>
            <thead>
              <tr style={{ fontSize: '0.8rem' }}>
                <th>Pubkey</th>
                <th>Label / note</th>
                <th className='text-end'>Contrib.</th>
                <th className='text-end'>Factories</th>
                <th>Status</th>
                <th className='text-end'>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.peer_pubkey_hex} style={{ fontSize: '0.85rem' }}>
                  <td title={p.peer_pubkey_hex}><code>{short(p.peer_pubkey_hex, 14)}</code></td>
                  <td>
                    {p.label && <div><strong>{p.label}</strong></div>}
                    {p.body && <div className='text-muted' style={{ fontSize: '0.78rem' }}>{p.body}</div>}
                  </td>
                  <td className='text-end'>
                    {Number(p.total_contribution_sats).toLocaleString()} sat
                  </td>
                  <td className='text-end'>{p.factory_count}</td>
                  <td>
                    {p.banned ? (
                      <Badge bg='danger'>Banned</Badge>
                    ) : p.score != null ? (
                      <Badge bg='info' text='dark'>Score {p.score}</Badge>
                    ) : (
                      <span className='text-muted'>—</span>
                    )}
                  </td>
                  <td className='text-end'>
                    <Button
                      size='sm'
                      variant='outline-primary'
                      className='me-1'
                      disabled={busy}
                      onClick={() => openEdit(p)}
                    >
                      Edit
                    </Button>
                    <Button
                      size='sm'
                      variant={p.banned ? 'outline-success' : 'outline-danger'}
                      disabled={busy}
                      onClick={() => handleBanToggle(p)}
                    >
                      {p.banned ? 'Unban' : 'Ban'}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
          </div>
        )}
      </Card.Body>

      <Modal show={editing !== null} onHide={() => setEditing(null)} centered>
        <Modal.Header closeButton>
          <Modal.Title style={{ fontSize: '1.1rem' }}>Edit peer</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {editing && (
            <Form>
              <p className='text-muted mb-3' style={{ fontSize: '0.85rem' }}>
                <code>{editing.peer_pubkey_hex}</code>
              </p>
              <Form.Group className='mb-2'>
                <Form.Label className='mb-1'>Reputation score</Form.Label>
                <Form.Control
                  type='text'
                  inputMode='numeric'
                  value={draft.score}
                  onChange={(e) => setDraft((d) => ({ ...d, score: e.target.value }))}
                  placeholder='leave blank to keep current'
                />
                <Form.Text className='text-muted'>
                  Integer. -1 bans the peer; 0 is the default. Higher = more trusted.
                </Form.Text>
              </Form.Group>
              <Form.Group className='mb-2'>
                <Form.Label className='mb-1'>Label</Form.Label>
                <Form.Control
                  type='text'
                  value={draft.label}
                  onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
                  placeholder='e.g. Alice'
                />
              </Form.Group>
              <Form.Group>
                <Form.Label className='mb-1'>Note</Form.Label>
                <Form.Control
                  as='textarea'
                  rows={3}
                  value={draft.body}
                  onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))}
                  placeholder='Operator notes about this peer'
                />
              </Form.Group>
            </Form>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant='outline-secondary' onClick={() => setEditing(null)} disabled={busy}>
            Cancel
          </Button>
          <Button variant='primary' onClick={handleSave} disabled={busy}>
            {busy ? <><Spinner animation='border' size='sm' className='me-2' />Saving…</> : 'Save'}
          </Button>
        </Modal.Footer>
      </Modal>
    </Card>
  );
}

export default KnownPeers;
