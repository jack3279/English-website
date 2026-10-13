import { uiT, useUiLanguage, uiLocale } from "../../i18n/store.js";
import { Navigate } from "react-router-dom";
import { Wallet } from "lucide-react";
import { useAuth } from "../auth/useAuth.js";
import { PageHeader } from "../../components/PageHeader.jsx";
import PayrollWorkspace from "../admin/PayrollWorkspace.jsx";
export default function MyPayrollPage() {
  useUiLanguage();
  const {
    user
  } = useAuth();
  if (user?.role === "admin") return <Navigate to="/admin/payroll" replace />;
  return <div className="min-h-full">
      <PageHeader icon={Wallet} title={uiT("我的课酬")} />
      <main className="page-body">
        <PayrollWorkspace readOnly />
      </main>
    </div>;
}
