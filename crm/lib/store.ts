// crm/lib/store.ts
'use client';
import { create } from 'zustand';
import type { FilterState, SavedView } from './types';

type State = {
  selectedLeadId: string | null;
  filters: FilterState;
  activeViewId: string | null;
  setSelectedLead: (id: string | null) => void;
  setFilters: (f: FilterState) => void;
  applyView: (v: SavedView) => void;
};

export const useStore = create<State>((set) => ({
  selectedLeadId: null,
  filters: {},
  activeViewId: null,
  setSelectedLead: (id) => set({ selectedLeadId: id }),
  setFilters: (f) => set({ filters: f, activeViewId: null }),
  applyView: (v) => set({ filters: v.filters, activeViewId: v.id }),
}));
