import { screen } from '@testing-library/react';
import InviteModal from './InviteModal';
import { renderWithProviders } from '../../../utilities/test-utilities/mockStore';
import { defaultRootState } from '../../../store/rootSelectors';
import { defaultCLNState } from '../../../store/clnSelectors';
import { defaultBKPRState } from '../../../store/bkprSelectors';

const IID = 'a'.repeat(64);

function storeWithNodeInfo(nodeOverride: Partial<typeof defaultRootState.nodeInfo>) {
  return {
    root: {
      ...defaultRootState,
      nodeInfo: { ...defaultRootState.nodeInfo, ...nodeOverride },
    },
    cln: defaultCLNState,
    bkpr: defaultBKPRState,
  };
}

const LSP_PUBKEY = 'c'.repeat(66);

describe('InviteModal', () => {
  it('renders nothing when show=false', async () => {
    await renderWithProviders(
      <InviteModal show={false} onHide={() => undefined} factoryInstanceIdHex={IID} />,
      { useRouter: false, preloadedState: storeWithNodeInfo({ id: LSP_PUBKEY, address: [{ type: 'ipv4', address: '203.0.113.5', port: 9735 }] }) },
    );
    expect(screen.queryByText(/Share invite/i)).not.toBeInTheDocument();
  });

  it('builds an invite URL with the LSP pubkey + ipv4 address when no tor', async () => {
    await renderWithProviders(
      <InviteModal show={true} onHide={() => undefined} factoryInstanceIdHex={IID} />,
      { useRouter: false, preloadedState: storeWithNodeInfo({
        id: LSP_PUBKEY,
        address: [{ type: 'ipv4', address: '203.0.113.5', port: 9735 }],
      }) },
    );
    /* The URL appears in a Form.Control whose value contains the
     * full superscalar:// link. */
    const input = screen.getByDisplayValue(/^superscalar:\/\/join\?/);
    expect(input).toBeInTheDocument();
    expect((input as HTMLInputElement).value).toContain(`iid=${IID}`);
    expect((input as HTMLInputElement).value).toContain(`lsp=${LSP_PUBKEY}`);
    expect((input as HTMLInputElement).value).toContain('203.0.113.5');
  });

  it('prefers tor address when both ipv4 and .onion are present (preferTor default)', async () => {
    await renderWithProviders(
      <InviteModal show={true} onHide={() => undefined} factoryInstanceIdHex={IID} />,
      { useRouter: false, preloadedState: storeWithNodeInfo({
        id: LSP_PUBKEY,
        address: [
          { type: 'ipv4', address: '203.0.113.5', port: 9735 },
          { type: 'torv3', address: 'sometorhash.onion', port: 9735 },
        ],
      }) },
    );
    const input = screen.getByDisplayValue(/^superscalar:\/\/join\?/);
    /* The URL should encode the .onion address (URL-encoded) since
     * preferTor defaults to true. */
    expect((input as HTMLInputElement).value).toContain('sometorhash.onion');
  });

  it('shows the privacy warning when only a public ipv4 address is available', async () => {
    await renderWithProviders(
      <InviteModal show={true} onHide={() => undefined} factoryInstanceIdHex={IID} />,
      { useRouter: false, preloadedState: storeWithNodeInfo({
        id: LSP_PUBKEY,
        address: [{ type: 'ipv4', address: '203.0.113.5', port: 9735 }],
      }) },
    );
    expect(screen.getByTestId('invite-privacy-warning')).toBeInTheDocument();
  });

  it('does NOT show privacy warning when address is .onion', async () => {
    await renderWithProviders(
      <InviteModal show={true} onHide={() => undefined} factoryInstanceIdHex={IID} />,
      { useRouter: false, preloadedState: storeWithNodeInfo({
        id: LSP_PUBKEY,
        address: [{ type: 'torv3', address: 'abc.onion', port: 9735 }],
      }) },
    );
    expect(screen.queryByTestId('invite-privacy-warning')).not.toBeInTheDocument();
  });
});
