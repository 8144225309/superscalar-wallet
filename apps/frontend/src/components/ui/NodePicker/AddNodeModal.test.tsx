import { render, screen, fireEvent } from '@testing-library/react';
import AddNodeModal from './AddNodeModal';

/* Tests focus on the client-side validation gates + the paste-split
 * convenience — the parts that run before any network call. The submit
 * path (NodesService.addNode → axios) is exercised by the backend
 * controller tests (nodes.test.ts) and not re-mocked here. */

const VALID_PUBKEY = '02' + 'a'.repeat(64); // 33-byte compressed, starts 02

function setup() {
  const onHide = jest.fn();
  const onAdded = jest.fn();
  render(<AddNodeModal show={true} onHide={onHide} onAdded={onAdded} />);
  return { onHide, onAdded };
}

describe('AddNodeModal', () => {
  it('renders the form fields when show=true', () => {
    setup();
    expect(screen.getByTestId('add-node-label')).toBeInTheDocument();
    expect(screen.getByTestId('add-node-pubkey')).toBeInTheDocument();
    expect(screen.getByTestId('add-node-address')).toBeInTheDocument();
    expect(screen.getByTestId('add-node-rune')).toBeInTheDocument();
    expect(screen.getByTestId('add-node-submit')).toBeInTheDocument();
  });

  it('renders nothing when show=false', () => {
    const onHide = jest.fn();
    render(<AddNodeModal show={false} onHide={onHide} />);
    expect(screen.queryByTestId('add-node-pubkey')).not.toBeInTheDocument();
  });

  it('rejects an invalid pubkey', () => {
    setup();
    fireEvent.change(screen.getByTestId('add-node-pubkey'), { target: { value: 'not-a-pubkey' } });
    fireEvent.change(screen.getByTestId('add-node-address'), { target: { value: '127.0.0.1:9735' } });
    fireEvent.change(screen.getByTestId('add-node-rune'), { target: { value: 'somerune' } });
    fireEvent.click(screen.getByTestId('add-node-submit'));
    expect(screen.getByTestId('add-node-error')).toHaveTextContent(/Pubkey must be 66 hex/i);
  });

  it('rejects a malformed address (no port)', () => {
    setup();
    fireEvent.change(screen.getByTestId('add-node-pubkey'), { target: { value: VALID_PUBKEY } });
    fireEvent.change(screen.getByTestId('add-node-address'), { target: { value: '127.0.0.1' } });
    fireEvent.change(screen.getByTestId('add-node-rune'), { target: { value: 'somerune' } });
    fireEvent.click(screen.getByTestId('add-node-submit'));
    expect(screen.getByTestId('add-node-error')).toHaveTextContent(/Address must be host:port/i);
  });

  it('requires a rune', () => {
    setup();
    fireEvent.change(screen.getByTestId('add-node-pubkey'), { target: { value: VALID_PUBKEY } });
    fireEvent.change(screen.getByTestId('add-node-address'), { target: { value: '127.0.0.1:9735' } });
    fireEvent.click(screen.getByTestId('add-node-submit'));
    expect(screen.getByTestId('add-node-error')).toHaveTextContent(/Rune is required/i);
  });

  it('rejects an out-of-range port', () => {
    setup();
    fireEvent.change(screen.getByTestId('add-node-pubkey'), { target: { value: VALID_PUBKEY } });
    fireEvent.change(screen.getByTestId('add-node-address'), { target: { value: '127.0.0.1:99999' } });
    fireEvent.change(screen.getByTestId('add-node-rune'), { target: { value: 'somerune' } });
    fireEvent.click(screen.getByTestId('add-node-submit'));
    /* 99999 matches the 1-5 digit shape regex but fails the numeric range
     * check, so the error is the port-range message. */
    expect(screen.getByTestId('add-node-error')).toHaveTextContent(/Port must be a number between 1 and 65535/i);
  });

  it('auto-splits pubkey@host:port pasted into the pubkey field', () => {
    setup();
    const combined = VALID_PUBKEY + '@127.0.0.1:9735';
    fireEvent.change(screen.getByTestId('add-node-pubkey'), { target: { value: combined } });
    expect((screen.getByTestId('add-node-pubkey') as HTMLInputElement).value).toBe(VALID_PUBKEY);
    expect((screen.getByTestId('add-node-address') as HTMLInputElement).value).toBe('127.0.0.1:9735');
  });

  it('Cancel button fires onHide', () => {
    const onHide = jest.fn();
    render(<AddNodeModal show={true} onHide={onHide} />);
    fireEvent.click(screen.getByText('Cancel'));
    expect(onHide).toHaveBeenCalled();
  });
});
