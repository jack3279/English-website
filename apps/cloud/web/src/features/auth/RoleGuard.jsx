import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "./useAuth.js";

const ROLE_LABEL = { admin: "管理员", teacher: "老师", parent: "家长" };

export default function RoleGuard({ roles, children }) {
  const { token, user } = useAuth();
  const loc = useLocation();
  if (!token) return <Navigate to="/login" state={{ from: loc.pathname }} replace />;

  if (roles && user && !roles.includes(user.role)) {
    // 角色不匹配 —— 跳到通用 403 页,保持全站错误视觉一致。
    // 把所需角色 / 当前角色作为 query 透传给 ForbiddenPage,文案可以更精准。
    const need = roles.map((r) => ROLE_LABEL[r] || r).join("/");
    const mine = ROLE_LABEL[user.role] || user.role;
    const qs = new URLSearchParams({ need, mine, from: loc.pathname }).toString();
    return <Navigate to={`/403?${qs}`} replace />;
  }
  return children;
}
