import './Settings.scss';
import { useRef, ChangeEvent } from 'react';
import { Dropdown } from 'react-bootstrap';
import { useDispatch, useSelector } from 'react-redux';
import logger from '../../../services/logger.service';
import useBreakpoint from '../../../hooks/use-breakpoint';
import { CURRENCY_UNITS, Units } from '../../../utilities/constants';
import { SettingsSVG } from '../../../svgs/Settings';
import FiatSelection from '../../shared/FiatSelection/FiatSelection';
import ToggleSwitch from '../../shared/ToggleSwitch/ToggleSwitch';
import { setShowModals, setShowToast } from '../../../store/rootSlice';
import { RootService } from '../../../services/http.service';
import { setConfig } from '../../../store/rootSlice';
import { selectShowFiatBesideSats } from '../../../store/rootSelectors';
import { selectAppConfig } from '../../../store/rootSelectors';
import { selectIsAuthenticated, selectNodeInfo, selectServerConfig, selectShowModals, selectUIConfigUnit, selectWalletConnect } from '../../../store/rootSelectors';
import { ApplicationConfiguration } from '../../../types/root.type';

const Settings = (props) => {
  const dispatch = useDispatch();
  const appConfig = useSelector(selectAppConfig);
  const isAuthenticated = useSelector(selectIsAuthenticated);
  const uiConfigUnit = useSelector(selectUIConfigUnit);
  const nodeInfo = useSelector(selectNodeInfo);
  const showModals = useSelector(selectShowModals);
  const connectWallet = useSelector(selectWalletConnect);
  const serverConfig = useSelector(selectServerConfig);
  const currentScreenSize = useBreakpoint();
  const importFileInputRef = useRef<HTMLInputElement>(null);
  logger.info('Screen Size Changed: ' + currentScreenSize);

  const showFiatBesideSats = useSelector(selectShowFiatBesideSats);

  const exportConfigHandler = async () => {
    try {
      const envelope = await RootService.exportConfig();
      const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `soupwallet-config-${envelope.exportedAt.replace(/[:.]/g, '-')}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      dispatch(setShowToast({ show: true, message: 'Wallet config exported', bg: 'success' }));
    } catch (err: any) {
      logger.error('Config export failed: ' + JSON.stringify(err));
      dispatch(setShowToast({ show: true, message: 'Config export failed', bg: 'danger' }));
    }
  };

  const importConfigHandler = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const envelope = JSON.parse(text);
      await RootService.importConfig(envelope);
      dispatch(setShowToast({ show: true, message: 'Config imported. Reloading…', bg: 'success' }));
      setTimeout(() => window.location.reload(), 800);
    } catch (err: any) {
      logger.error('Config import failed: ' + JSON.stringify(err));
      const msg = err?.response?.data?.error || 'Config import failed (check file format)';
      dispatch(setShowToast({ show: true, message: msg, bg: 'danger' }));
    } finally {
      if (importFileInputRef.current) importFileInputRef.current.value = '';
    }
  };

  const changeShowFiatHandler = async () => {
    const updatedConfig: ApplicationConfiguration = {
      ...appConfig,
      uiConfig: {
        ...appConfig.uiConfig,
        showFiatBesideSats: !showFiatBesideSats,
      },
    };
    await RootService.updateConfig(updatedConfig);
    dispatch(setConfig(updatedConfig));
  };

  const changeCurrencyUnitHandler = async(changedIndex: number) => {
    const updatedConfig: ApplicationConfiguration = { 
      ...appConfig, 
      uiConfig: {
        ...appConfig.uiConfig,
        unit: CURRENCY_UNITS[changedIndex]
      }
    };
    await RootService.updateConfig(updatedConfig);
    dispatch(setConfig(updatedConfig));
  };

  return (
    <Dropdown autoClose={'outside'} className={!!(nodeInfo.error || (isAuthenticated && nodeInfo.isLoading)) ? 'settings-menu dropdown-disabled' : 'settings-menu'} data-testid='settings'>
      <Dropdown.Toggle variant={props.compact ? '' : 'primary'} disabled={!!(nodeInfo.error || (isAuthenticated && nodeInfo.isLoading))} className={props.compact ? 'd-flex align-items-center btn-rounded btn-compact btn-settings-menu' : 'd-flex align-items-center btn-rounded btn-settings-menu'}>
        <span className={props.compact ? '' : 'me-3'}>{props.compact ? '' : 'Settings'}</span>
        <SettingsSVG className={((!!nodeInfo.error || (isAuthenticated && nodeInfo.isLoading)) ? 'mt-1 svg-fill-disabled' : 'mt-1')} />
      </Dropdown.Toggle>
      <Dropdown.Menu className='fs-7 inner-box-shadow'>
        <Dropdown.Item>Version: {connectWallet.APP_VERSION}</Dropdown.Item>
        <Dropdown.Item
          data-bs-toggle='modal'
          data-bs-target='#staticBackdrop'
          onClick={() => dispatch(setShowModals({...showModals, nodeInfoModal: true}))}
          title='Open a QR + copyable text of your full node URI (pubkey@host:port). Share this when someone wants to peer with your node, join your factory, or browse your LSP.'
          data-testid='settings-show-node-id'
        >
          Show node ID
        </Dropdown.Item>
        <Dropdown.Item data-bs-toggle='modal' data-bs-target='#staticBackdrop' onClick={() => dispatch(setShowModals({ ...showModals, connectWalletModal: true }))}>Connect wallet</Dropdown.Item>
        <Dropdown.Item data-bs-toggle='modal' data-bs-target='#staticBackdrop' onClick={() => dispatch(setShowModals({ ...showModals, sqlTerminalModal: true }))}>SQL Terminal</Dropdown.Item>
        <Dropdown.Item
          data-bs-toggle='modal'
          data-bs-target='#staticBackdrop'
          onClick={() => dispatch(setShowModals({ ...showModals, glossaryModal: true }))}
          title='Searchable reference for SuperScalar and bLIP-56 terms (factory, MuSig2, epoch, breach window, etc.)'
          data-testid='settings-glossary'
        >
          Glossary
        </Dropdown.Item>
        <Dropdown.Item
          data-bs-toggle='modal'
          data-bs-target='#staticBackdrop'
          onClick={() => dispatch(setShowModals({ ...showModals, whatsNewModal: true }))}
          title='See what shipped in the latest release(s) — recent features, fixes, and security work.'
          data-testid='settings-whats-new'
        >
          What&apos;s new
        </Dropdown.Item>
        { serverConfig.singleSignOn === true || serverConfig.singleSignOn === "true" ?
            <></>
          :
            <Dropdown.Item data-bs-toggle='modal' data-bs-target='#staticBackdrop' onClick={() => dispatch(setShowModals({ ...showModals, setPasswordModal: true }))}>Reset Password</Dropdown.Item>
        }
        <Dropdown.Divider />
        <Dropdown.Item
          onClick={exportConfigHandler}
          title='Download a JSON backup of your wallet UI settings (currency, fiat, theme). Password and node-side keys are NOT exported — see docs/SEED_BACKUP.md for key backup.'
          data-testid='settings-export-config'
        >
          Export Config
        </Dropdown.Item>
        <Dropdown.Item
          onClick={() => importFileInputRef.current?.click()}
          title='Restore wallet UI settings from a previously exported JSON file. Your password and any node-side state are unaffected.'
          data-testid='settings-import-config'
        >
          Import Config
        </Dropdown.Item>
        <input
          ref={importFileInputRef}
          type='file'
          accept='application/json,.json'
          className='d-none'
          onChange={importConfigHandler}
          data-testid='settings-import-config-input'
        />
        <Dropdown.Divider />
        <Dropdown.Item as='div' className='d-flex align-items-center justify-content-between'>Fiat Currency <FiatSelection className='ms-4 fiat-dropdown' /></Dropdown.Item>
        <Dropdown.Item as='div' className='d-flex align-items-center justify-content-between'>Currency <ToggleSwitch onChange={changeCurrencyUnitHandler} values={CURRENCY_UNITS} selIndex={uiConfigUnit === Units.BTC ? 1 : 0} /></Dropdown.Item>
        <Dropdown.Item as='div' className='d-flex align-items-center justify-content-between'>Fiat beside sats <ToggleSwitch onChange={changeShowFiatHandler} values={['Off', 'On']} selIndex={showFiatBesideSats ? 1 : 0} /></Dropdown.Item>
      </Dropdown.Menu>
    </Dropdown>
  );
};

export default Settings;
