import { LoaderFunctionArgs } from "react-router-dom";
import { BookkeeperService, CLNService, FactoriesService, RootService } from "../services/http.service";
import { appStore } from "../store/appStore";
import { AppState } from "../store/store.type";

export async function rootLoader({}: LoaderFunctionArgs) {
  const state = appStore.getState() as AppState;
  if (state.root.authStatus.isAuthenticated) {
    // Fire-and-forget: data arrives via Redux dispatches inside these methods.
    // Do not await — a dead node would block React Router from rendering the
    // entire UI, leaving the user stuck on "Loading..." with no node picker.
    RootService.fetchRootData().catch(() => {});
    RootService.refreshData().catch(() => {});
  }
  return null;
}

export async function clnLoader({}: LoaderFunctionArgs) {
  const state = appStore.getState() as AppState;
  if (state.root.authStatus.isAuthenticated) {
    const clnData = await CLNService.fetchCLNData();
    return clnData;
  }
  return null;
}

export async function bkprLoader({}: LoaderFunctionArgs) {
  const state = appStore.getState() as AppState;
  if (state.root.authStatus.isAuthenticated) {
    const bkprData = await BookkeeperService.fetchBKPRData();
    return bkprData;
  }
  return null;
}

export async function factoriesLoader({}: LoaderFunctionArgs) {
  const state = appStore.getState() as AppState;
  if (state.root.authStatus.isAuthenticated) {
    const factoriesData = await FactoriesService.fetchFactoriesData();
    return factoriesData;
  }
  return null;
}
