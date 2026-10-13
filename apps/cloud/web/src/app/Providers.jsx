import LanguageController from "../i18n/LanguageController.jsx";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "../lib/queryClient.js";
import { InstitutionProvider } from "../features/admin/InstitutionContext.jsx";

export default function Providers({ children }) {
  return <QueryClientProvider client={queryClient}><LanguageController><InstitutionProvider>{children}</InstitutionProvider></LanguageController></QueryClientProvider>;
}
