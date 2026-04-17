import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { clearBKPRStore } from '../store/bkprSlice';
import { clearCLNStore } from '../store/clnSlice';
import { clearFactoriesStore } from '../store/factoriesSlice';
import { setProfileHealth } from '../store/nodesSlice';
import { APP_WAIT_TIME } from '../utilities/constants';
import { useDispatch, useSelector } from 'react-redux';
import { BookkeeperService, CLNService, FactoriesService, NodesService, RootService } from '../services/http.service';
import { selectAuthStatus, selectNodeInfo } from '../store/rootSelectors';
import { appStore } from '../store/appStore';
import logger from '../services/logger.service';

export function RootRouterReduxSync() {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const { pathname } = useLocation();
  const authStatus = useSelector(selectAuthStatus);
  const nodeInfo = useSelector(selectNodeInfo);
  
  // Fetch node profiles, run background discovery, detect factory plugin
  useEffect(() => {
    if (!authStatus?.isAuthenticated || !authStatus?.isValidPassword) return;

    NodesService.fetchAndDispatchNodes();

    // Run background discovery to find all local CLN nodes
    NodesService.discoverNodes()
      .then(() => NodesService.fetchAndDispatchNodes())
      .catch(() => {});

    // Delay plugin detection to ensure commando connection is ready
    const timer = setTimeout(() => NodesService.detectFactoryPlugin(), 3000);
    return () => clearTimeout(timer);
  }, [authStatus?.isAuthenticated, authStatus?.isValidPassword]);

  // Handle polling
  useEffect(() => {
    if (!authStatus?.isAuthenticated || !authStatus?.isValidPassword) return;

    const interval = setInterval(async () => {
      if (document.visibilityState === 'visible' && authStatus?.isAuthenticated) {
        try {
          await RootService.refreshData();
          if (pathname.includes('/factories')) {
            await FactoriesService.fetchFactoriesData();
          }
        } catch (error) {
          logger.error('Error fetching root data:', error);
        }
      }
    }, APP_WAIT_TIME);

    return () => clearInterval(interval);
  }, [authStatus.isAuthenticated]);

  // Health polling: only active when the active node has an error.
  // Probes all profiles so the dropdown shows live red/green dots.
  // Auto-retries fetchRootData when the active node comes back alive.
  useEffect(() => {
    if (!authStatus?.isAuthenticated || !nodeInfo.error) return;

    const healthInterval = setInterval(async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const result = await NodesService.healthCheck();
        if (result.health) {
          appStore.dispatch(setProfileHealth(result.health));
          // Auto-recover: if active node is alive again, retry root data
          const activeId = (appStore.getState() as any).nodes?.activeProfileId;
          const activeHealth = result.health.find((h: any) => h.profileId === activeId);
          if (activeHealth?.alive) {
            RootService.fetchRootData().catch(() => {});
            RootService.refreshData().catch(() => {});
          }
        }
      } catch {
        // Health endpoint itself failed — backend may be restarting
      }
    }, 10000);

    return () => clearInterval(healthInterval);
  }, [authStatus?.isAuthenticated, nodeInfo.error]);

  // Handle navigation for authenticated users
  useEffect(() => {
    const fetchRouteData = async () => {
      if (pathname.includes('/cln')) {
        try {
          await CLNService.fetchCLNData();
        } catch (error) {
          logger.error('Error fetching CLN data:', error);
        }
      }
      else if (pathname.includes('/bookkeeper')) {
        try {
          await BookkeeperService.fetchBKPRData();
        } catch (error) {
          logger.error('Error fetching BKPR data:', error);
        }
      }
      else if (pathname.includes('/factories')) {
        try {
          await FactoriesService.fetchFactoriesData();
        } catch (error) {
          logger.error('Error fetching factories data:', error);
        }
      }
    };
    const targetPath = pathname.includes('/bookkeeper') ? pathname
      : pathname.includes('/factories') ? pathname
      : pathname.includes('/connect') ? pathname
      : '/cln';
    fetchRouteData();
    if (pathname !== targetPath) {
      navigate(targetPath, { replace: true });
    }
  }, [authStatus, pathname, navigate]);

  // Clear store on route unmounting
  useEffect(() => {
    return () => {
      if (pathname.includes('/cln')) {
        dispatch(clearCLNStore());
      }
      else if (pathname.includes('/bookkeeper')) {
        dispatch(clearBKPRStore());
      }
      else if (pathname.includes('/factories')) {
        dispatch(clearFactoriesStore());
      }
    };
  }, [pathname, dispatch]);

  return null;
}
