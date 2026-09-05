import { create } from "zustand";
import type { AuthUser, WorklistFilters, WorklistSort } from "@axis/types";
import type { ThemeMode } from "@/lib/theme";

type AuthStatus = "loading" | "authenticated" | "anonymous";

interface AppState {
  railCollapsed: boolean;
  selectedStudyUid: string | null;
  filterState: Partial<WorklistFilters>;
  sortState: WorklistSort;
  currentUser: AuthUser | null;
  authStatus: AuthStatus;
  theme: ThemeMode;
  setRailCollapsed: (collapsed: boolean) => void;
  setSelectedStudyUid: (uid: string | null) => void;
  setFilterState: (filters: Partial<WorklistFilters>) => void;
  setSortState: (sort: WorklistSort) => void;
  setCurrentUser: (user: AuthUser | null) => void;
  clearCurrentUser: () => void;
  setTheme: (theme: ThemeMode) => void;
}

export const useAppStore = create<AppState>((set) => ({
  railCollapsed: false,
  selectedStudyUid: null,
  filterState: {},
  sortState: { field: "priority", direction: "desc" },
  currentUser: null,
  authStatus: "loading",
  theme: "system",
  setRailCollapsed: (collapsed) => set({ railCollapsed: collapsed }),
  setSelectedStudyUid: (uid) => set({ selectedStudyUid: uid }),
  setFilterState: (filters) =>
    set((state) => ({ filterState: { ...state.filterState, ...filters } })),
  setSortState: (sort) => set({ sortState: sort }),
  setCurrentUser: (user) =>
    set({
      currentUser: user,
      authStatus: user ? "authenticated" : "anonymous",
    }),
  clearCurrentUser: () => set({ currentUser: null, authStatus: "anonymous" }),
  setTheme: (theme) => set({ theme }),
}));