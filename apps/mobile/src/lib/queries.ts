import { useQuery } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';
import { useCallback, useRef } from 'react';
import { api } from '../api/client';

// Query keys are arrays rooted at the resource; mutations invalidate by root.
export const useEligible = () => useQuery({ queryKey: ['eligible'], queryFn: () => api('eligibleStudies') });
export const useTesterStudy = (id: string) => useQuery({ queryKey: ['testerStudy', id], queryFn: () => api('getTesterStudy', { params: { id } }), enabled: !!id });
export const useMyParticipations = () => useQuery({ queryKey: ['participations'], queryFn: () => api('myParticipations') });
export const useParticipation = (id: string) => useQuery({ queryKey: ['participation', id], queryFn: () => api('getParticipation', { params: { id } }) });
export const useEvidence = (id: string, enabled = true) => useQuery({ queryKey: ['evidence', id], queryFn: () => api('listEvidence', { params: { id } }), enabled });
export const useFindings = (id: string) => useQuery({ queryKey: ['findings', id], queryFn: () => api('listFindings', { params: { id } }) });
export const useCredits = () => useQuery({ queryKey: ['credits'], queryFn: () => api('credits') });
export const useStudies = () => useQuery({ queryKey: ['studies'], queryFn: () => api('listStudies') });
export const useStudy = (id: string) => useQuery({ queryKey: ['study', id], queryFn: () => api('getStudy', { params: { id } }), enabled: !!id });
export const useStudyParticipations = (id: string) => useQuery({ queryKey: ['studyParticipations', id], queryFn: () => api('studyParticipations', { params: { id } }) });
export const useMyDisputes = () => useQuery({ queryKey: ['myDisputes'], queryFn: () => api('myDisputes') });
export const useAdminDisputes = () => useQuery({ queryKey: ['adminDisputes'], queryFn: () => api('adminDisputes') });
export const useAdminStudies = () => useQuery({ queryKey: ['adminStudies'], queryFn: () => api('adminStudies') });
export const useAudit = () => useQuery({ queryKey: ['audit'], queryFn: () => api('adminAudit') });
export const useStudyDisputes = (id: string) => useQuery({ queryKey: ['studyDisputes', id], queryFn: () => api('studyDisputes', { params: { id } }), enabled: !!id });
export const useAdminStuck = () => useQuery({ queryKey: ['adminStuck'], queryFn: () => api('adminStuck') });
/** Polls while any transfer is still waiting on the chain, so states update without a reload. */
export const useParticipationTransfers = (id: string) =>
  useQuery({
    queryKey: ['transfers', id],
    queryFn: () => api('participationTransfers', { params: { id } }),
    enabled: !!id,
    refetchInterval: (q) => (q.state.data?.items.some((t) => t.status === 'pending' || t.status === 'awaiting_signature') ? 4000 : false),
  });
/** A tester's own reputation. Testers only: anyone else passes `enabled: false` (the route would refuse them). */
export const useReputation = ({ enabled = true }: { enabled?: boolean } = {}) => useQuery({ queryKey: ['reputation'], queryFn: () => api('myReputation'), enabled });
export const useLeaderboard = () => useQuery({ queryKey: ['leaderboard'], queryFn: () => api('leaderboard') });
/** The labelled demo showcase (devnet demo deployment only): fetched only while it is on and shown. */
export const useDemoShowcase = ({ enabled }: { enabled: boolean }) => useQuery({ queryKey: ['demo-showcase'], queryFn: () => api('demoShowcase'), enabled });
/** Escrow payment states move on their own (the settlement worker): poll while one is still open. */
export const useMyPayouts = () =>
  useQuery({ queryKey: ['rewards'], queryFn: () => api('myPayouts'), refetchInterval: (q) => (q.state.data?.items.some((x) => x.status !== 'confirmed') ? 5000 : false) });
export const useAiStatus = () => useQuery({ queryKey: ['ai'], queryFn: () => api('aiStatus'), staleTime: 60_000 });

/**
 * Tabs stay mounted; refetch a list whenever its screen regains focus so it's never stale.
 * The effect must not depend on the query object (a new object every render), or it
 * re-runs on every render and loops; the latest refetch is read through a ref instead.
 */
export function useFocusRefetch(q: { refetch: () => unknown }) {
  const first = useRef(true);
  const refetch = useRef(q.refetch);
  refetch.current = q.refetch;
  useFocusEffect(
    useCallback(() => {
      if (first.current) {
        first.current = false;
        return;
      }
      void refetch.current();
    }, []),
  );
}
