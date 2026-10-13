import { Navigate } from "react-router-dom";
import { Wallet } from "lucide-react";
import { useAuth } from "../auth/useAuth.js";
import { PageHeader } from "../../components/PageHeader.jsx";
import { PayrollPanel } from "./PayrollPanel.jsx";

export default function PayrollPage() {
  const { user } = useAuth();
  if (user?.role === "teacher") return <Navigate to="/teacher/payroll" replace />;
  return (
    <div className="min-h-full">
      <PageHeader icon={Wallet} title="教师课酬" />
      <main className="page-body">
        <PayrollPanel showTitle={false} />
      </main>
    </div>
  );
}
