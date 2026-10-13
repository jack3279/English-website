import { createContext, useContext } from "react";
import { useQuery } from "@tanstack/react-query";
import { http } from "../../lib/http.js";
import { useAuth } from "../auth/useAuth.js";
export const DEFAULT_INSTITUTION = {
  institutionName: "教学管理",
  defaultDurationMin: 60,
  lowBalanceHours: 3,
  expiryWarnDays: 30,
  leaveDeadlineHours: 4,
  absenceDeductHours: false,
  absencePayTeacher:true,
  renewalPercent: 20,
  renewalMinHours: 2,
  loadLimits: { dailyHours: 6, weeklyHours: 25, consecutiveLessons: 3, breakMinutes: 15 },
};
const Context = createContext({
  rules: DEFAULT_INSTITUTION,
  loading: false,
  error: null,
  refresh: () => {},
});
export function InstitutionProvider({ children }) {
  const { token } = useAuth();
  const query = useQuery({
    queryKey: ["institution-settings"],
    queryFn: async () => (await http("/institution-settings")).data,
    enabled: !!token,
    staleTime: 60000,
    refetchInterval: 60000,
  });
  return (
    <Context.Provider
      value={{
        rules: query.data || DEFAULT_INSTITUTION,
        loading: !!token && query.isPending,
        error: query.error,
        refresh: query.refetch,
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useInstitution() {
  return useContext(Context);
}
