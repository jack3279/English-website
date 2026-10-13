import { QueryClient } from "@tanstack/react-query";
import { installAuthCacheBoundary } from "./authCacheBoundary.js";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: (count, err) => {
        const status = err?.status;
        if (status && status >= 400 && status < 500) return false;
        return count < 2;
      },
    },
  },
});
installAuthCacheBoundary(queryClient);
