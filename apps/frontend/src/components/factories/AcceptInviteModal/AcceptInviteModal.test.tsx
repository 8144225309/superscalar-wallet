import { render, screen, fireEvent } from '@testing-library/react';
import AcceptInviteModal from './AcceptInviteModal';
import { buildInviteUrl } from '../../../utilities/inviteUrl';

const IID = 'a'.repeat(64);   // 32 bytes hex
const LSP = 'b'.repeat(66);   // 33 bytes hex

describe('AcceptInviteModal', () => {
  it('renders the textarea and an empty modal body when show=true', () => {
    render(<AcceptInviteModal show={true} onHide={() => undefined} />);
    expect(screen.getByTestId('accept-invite-url')).toBeInTheDocument();
  });

  it('does not render content when show=false', () => {
    render(<AcceptInviteModal show={false} onHide={() => undefined} />);
    expect(screen.queryByTestId('accept-invite-url')).not.toBeInTheDocument();
  });

  it('shows malformed-URL error when input is junk', () => {
    render(<AcceptInviteModal show={true} onHide={() => undefined} />);
    const input = screen.getByTestId('accept-invite-url') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'not a real url' } });
    expect(screen.getByText(/Not a valid superscalar:\/\/ invite/i)).toBeInTheDocument();
  });

  it('parses a valid invite URL and surfaces the iid + lsp', () => {
    const url = buildInviteUrl({ iid: IID, lspNodeId: LSP });
    render(<AcceptInviteModal show={true} onHide={() => undefined} />);
    const input = screen.getByTestId('accept-invite-url') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: url } });
    /* The parsed-info block renders truncated iid + lsp via short codes. */
    expect(screen.getByText(/Factory:/i)).toBeInTheDocument();
    expect(screen.getByText(/LSP:/i)).toBeInTheDocument();
    expect(screen.getByTestId('accept-invite-contribution')).toBeInTheDocument();
  });

  it('surfaces the expired error when invite is past its expires-at', () => {
    const past = Math.floor(Date.now() / 1000) - 3600;
    /* Build a URL with an expired timestamp by hand — buildInviteUrl
     * doesn't reject past values at build time (only parse rejects). */
    const url = `superscalar://join?iid=${IID}&lsp=${LSP}&expires=${past}`;
    render(<AcceptInviteModal show={true} onHide={() => undefined} />);
    const input = screen.getByTestId('accept-invite-url') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: url } });
    expect(screen.getByText(/expired/i)).toBeInTheDocument();
  });

  it('public-IP invite shows the trust gate', () => {
    /* Plain RFC-routable IPv4 address triggers the 'public' class. */
    const url = `superscalar://join?iid=${IID}&lsp=${LSP}&address=203.0.113.5:9735`;
    render(<AcceptInviteModal show={true} onHide={() => undefined} />);
    const input = screen.getByTestId('accept-invite-url') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: url } });
    expect(screen.getByTestId('accept-invite-trust-gate')).toBeInTheDocument();
  });

  it('tor (.onion) invite does NOT show the trust gate', () => {
    const url = `superscalar://join?iid=${IID}&lsp=${LSP}&address=abc123xyz.onion:9735`;
    render(<AcceptInviteModal show={true} onHide={() => undefined} />);
    const input = screen.getByTestId('accept-invite-url') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: url } });
    expect(screen.queryByTestId('accept-invite-trust-gate')).not.toBeInTheDocument();
  });

  it('clearing the input wipes the parsed state', () => {
    render(<AcceptInviteModal show={true} onHide={() => undefined} />);
    const input = screen.getByTestId('accept-invite-url') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: buildInviteUrl({ iid: IID, lspNodeId: LSP }) } });
    expect(screen.getByText(/Factory:/i)).toBeInTheDocument();
    fireEvent.change(input, { target: { value: '' } });
    expect(screen.queryByText(/Factory:/i)).not.toBeInTheDocument();
  });
});
