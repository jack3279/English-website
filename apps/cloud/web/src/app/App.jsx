import { RouterProvider } from "react-router-dom";
import { router } from "./routes.jsx";
import Providers from "./Providers.jsx";
import ErrorBoundary from "./ErrorBoundary.jsx";
import { ToastProvider, Toaster } from "../components/ui/toast.jsx";

export default function App() {
  return (
    <ErrorBoundary>
      <ToastProvider>
        <Providers>
          <RouterProvider router={router} />
        </Providers>
        <Toaster />
      </ToastProvider>
    </ErrorBoundary>
  );
}
