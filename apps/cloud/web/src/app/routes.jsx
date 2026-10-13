import AllFeaturesPage from "../features/admin/AllFeaturesPage.jsx";
import InboxPage from "../features/notifications/InboxPage.jsx";
import { createBrowserRouter, Navigate } from "react-router-dom";
import { lazy, Suspense } from "react";
import RoleGuard from "../features/auth/RoleGuard.jsx";
import { AppLayout } from "../layout/AppLayout.jsx";
import RouteError from "./RouteError.jsx";
import LoginPage from "../features/auth/LoginPage.jsx";
import SchedulePage from "../features/schedule/SchedulePage.jsx";

const AdminAssistantPage = lazy(() => import("../features/admin/AdminAssistantPage.jsx"));
const RenewalsPage = lazy(() => import("../features/parent-h5/RenewalsPage.jsx"));
const SignupPage = lazy(() => import("../features/auth/SignupPage.jsx"));
const ForgotPasswordPage = lazy(() => import("../features/auth/ForgotPasswordPage.jsx"));
const TeacherTodayPage = lazy(() => import("../features/lessons/TodayLessonsPage.jsx"));
const MyPayrollPage = lazy(() => import("../features/teacher/MyPayrollPage.jsx"));
const PayrollPage = lazy(() => import("../features/admin/PayrollPage.jsx"));
const StudentsPage = lazy(() => import("../features/students/StudentsPage.jsx"));
const StudentDetailPage = lazy(() => import("../features/students/StudentDetailPage.jsx"));
const ClassRecordsPage = lazy(() => import("../features/admin/ClassRecordsPage.jsx"));
const ParentFeedsPage = lazy(() => import("../features/parent-h5/ParentFeedsPage.jsx"));
const TeacherDetailPage = lazy(() => import("../features/admin/TeacherDetailPage.jsx"));
const TeacherFeedbackPage = lazy(() => import("../features/lessons/TeacherFeedbackPage.jsx"));
const AdminDashboardPage = lazy(() => import("../features/admin/AdminDashboardPage.jsx"));
const AuditLogPage = lazy(() => import("../features/admin/AuditLogPage.jsx"));
const LeadsPage = lazy(() => import("../features/admin/LeadsPage.jsx"));
const PackagesPage = lazy(() => import("../features/admin/PackagesPage.jsx"));
const AlertsPage = lazy(() => import("../features/admin/AlertsPage.jsx"));
const SettingsPage = lazy(() => import("../features/admin/SettingsPage.jsx"));
const AccountsPage = lazy(() => import("../features/admin/AccountsPage.jsx"));
const InstitutionSettingsPage = lazy(() => import("../features/admin/InstitutionSettingsPage.jsx"));
const TeachersPage = lazy(() => import("../features/admin/TeachersPage.jsx"));
const FinancePage = lazy(() => import("../features/admin/FinancePage.jsx"));
const DataImportPage = lazy(() => import("../features/admin/DataImportPage.jsx"));
const OperationsPage = lazy(() => import("../features/admin/OperationsPage.jsx"));
const ReportsPage = lazy(() => import("../features/admin/ReportsPage.jsx"));
const BackupsPage = lazy(() => import("../features/admin/BackupsPage.jsx"));
const MessagesPage = lazy(() => import("../features/messages/MessagesPage.jsx"));
const LeaveMakeupPage = lazy(() => import("../features/leave/LeaveMakeupPage.jsx"));
const ContentPage = lazy(() => import("../features/materials/ContentPage.jsx"));
const ParentHomePage = lazy(() => import("../features/parent-h5/ParentHomePage.jsx"));
const SchoolChatPage = lazy(() => import("../features/parent-h5/SchoolChatPage.jsx"));
const RecruitPage = lazy(() => import("../features/recruit/RecruitPage.jsx"));
const NotificationsPage = lazy(() => import("../features/admin/NotificationsPage.jsx"));
const SessionsPage = lazy(() => import("../features/admin/SessionsPage.jsx"));
const NotFoundPage = lazy(() => import("../features/NotFoundPage.jsx"));
const ForbiddenPage = lazy(() => import("../features/errors/ForbiddenPage.jsx"));
const ServerErrorPage = lazy(() => import("../features/errors/ServerErrorPage.jsx"));

const Fallback = () => <div style={{ padding: 24 }}>加载中…</div>;

export const router = createBrowserRouter([
  {
    errorElement: <RouteError />,
    children: [
      {
        path: "/login",
        element: (
          <Suspense fallback={<Fallback />}>
            <LoginPage />
          </Suspense>
        ),
      },
      {
        path: "/signup",
        element: (
          <Suspense fallback={<Fallback />}>
            <SignupPage />
          </Suspense>
        ),
      },
      {
        path: "/forgot",
        element: (
          <Suspense fallback={<Fallback />}>
            <ForgotPasswordPage />
          </Suspense>
        ),
      },
      { path: "/", element: <Navigate to="/login" replace /> },
      {
        path: "/recruit",
        element: (
          <Suspense fallback={<Fallback />}>
            <RecruitPage />
          </Suspense>
        ),
      },
      {
        // 错误页通用入口 —— 任何身份(已登录或游客)都可访问,
        // 因为 RoleGuard 跳转时是登录态,游客点外链也可能进入。
        path: "/403",
        element: (
          <Suspense fallback={<Fallback />}>
            <ForbiddenPage />
          </Suspense>
        ),
      },
      {
        path: "/500",
        element: (
          <Suspense fallback={<Fallback />}>
            <ServerErrorPage />
          </Suspense>
        ),
      },
      {
        // 需要登录的页面统一挂在这个 layout 下: 左侧持久导航由它提供。
        // 背景: AppShell / Sidebar / Topbar 早就写好了却**没有任何地方引用**(死代码),
        // 于是整个应用没有任何持久导航 —— 每个页面都是孤岛, 只能靠顶栏的「← 总览」回退,
        // 通知铃铛(只在 Topbar 里渲染)也从来不显示。
        element: <AppLayout />,
        errorElement: <RouteError />,
        children: [
          {
            path: "/renewals",
            element: (
              <RoleGuard roles={["admin"]}>
                <Suspense fallback={<Fallback />}>
                  <RenewalsPage />
                </Suspense>
              </RoleGuard>
            ),
          },
          {
            path: "/teacher/messages",
            element: (
              <RoleGuard roles={["teacher"]}>
                <Suspense fallback={<Fallback />}>
                  <SchoolChatPage />
                </Suspense>
              </RoleGuard>
            ),
          },
          {
            path: "/teacher/letters",
            element: (
              <RoleGuard roles={["teacher"]}>
                <Suspense fallback={<Fallback />}>
                  <MessagesPage />
                </Suspense>
              </RoleGuard>
            ),
          },
          {
            path: "/parent/letters",
            element: (
              <RoleGuard roles={["parent"]}>
                <Suspense fallback={<Fallback />}>
                  <MessagesPage />
                </Suspense>
              </RoleGuard>
            ),
          },
          {
            path: "/admin/class-records",
            element: (
              <RoleGuard roles={["admin", "teacher"]}>
                <Suspense fallback={<Fallback />}>
                  <ClassRecordsPage />
                </Suspense>
              </RoleGuard>
            ),
          },
          {
            path: "/teacher/feedback/:id",
            element: (
              <RoleGuard roles={["admin", "teacher"]}>
                <Suspense fallback={<Fallback />}>
                  <TeacherFeedbackPage />
                </Suspense>
              </RoleGuard>
            ),
          },
          {
            path: "/admin/teachers/:id",
            element: (
              <RoleGuard roles={["admin"]}>
                <Suspense fallback={<Fallback />}>
                  <TeacherDetailPage />
                </Suspense>
              </RoleGuard>
            ),
          },
          {
            path: "/parent/feeds",
            element: (
              <RoleGuard roles={["parent"]}>
                <Suspense fallback={<Fallback />}>
                  <ParentFeedsPage />
                </Suspense>
              </RoleGuard>
            ),
          },
          {
            path: "/teacher/operations",
            element: (
              <RoleGuard roles={["teacher", "admin"]}>
                <Suspense fallback={<Fallback />}>
                  <OperationsPage teachingOnly />
                </Suspense>
              </RoleGuard>
            ),
          },
          {
            path: "/teacher/today",
            element: (
              <RoleGuard roles={["teacher", "admin"]}>
                <Suspense fallback={<Fallback />}>
                  <TeacherTodayPage />
                </Suspense>
              </RoleGuard>
            ),
          },
          {
            // 老师看自己的课酬。接口侧固定取登录身份，不接受 teacher_id 参数。
            path: "/teacher/payroll",
            element: (
              <RoleGuard roles={["teacher", "admin"]}>
                <Suspense fallback={<Fallback />}>
                  <MyPayrollPage />
                </Suspense>
              </RoleGuard>
            ),
          },
          {
            path: "/schedule",
            element: (
              <RoleGuard roles={["teacher", "admin", "parent"]}>
                <Suspense fallback={<Fallback />}>
                  <SchedulePage />
                </Suspense>
              </RoleGuard>
            ),
          },
          {
            path: "/students",
            element: (
              <RoleGuard roles={["teacher", "admin"]}>
                <Suspense fallback={<Fallback />}>
                  <StudentsPage />
                </Suspense>
              </RoleGuard>
            ),
          },
          {
            path: "/students/:id",
            element: (
              <RoleGuard roles={["teacher", "admin", "parent"]}>
                <Suspense fallback={<Fallback />}>
                  <StudentDetailPage />
                </Suspense>
              </RoleGuard>
            ),
          },
          {
            path: "/admin",
            element: (
              <RoleGuard roles={["admin"]}>
                <Suspense fallback={<Fallback />}>
                  <AdminDashboardPage />
                </Suspense>
              </RoleGuard>
            ),
          },
          {
            path: "/admin/audit",
            element: (
              <RoleGuard roles={["admin"]}>
                <Suspense fallback={<Fallback />}>
                  <AuditLogPage />
                </Suspense>
              </RoleGuard>
            ),
          },
          {
            // ⚠️ 侧边栏「招生 / 试听」只给admin，但这里放行了 teacher。
            // 后端 GET /leads 也没有按 assigned_to 过滤 → 老师会看到**全部**线索，
            // 含其他老师跟进中的家长手机号。数据没收窄就不该放行，收紧到 admin。
            path: "/admin/leads",
            element: (
              <RoleGuard roles={["admin"]}>
                <Suspense fallback={<Fallback />}>
                  <LeadsPage />
                </Suspense>
              </RoleGuard>
            ),
          },
          {
            // ⚠️ 侧边栏「课时包」只给 admin。PackagesPage 主体是课程包类型的
            // 新建/编辑/删除（后端这几处也是 admin only），老师进来只能看到一堆
            // 不能操作的表单 → 收紧到 admin，与侧边栏一致。
            path: "/admin/packages",
            element: (
              <RoleGuard roles={["admin"]}>
                <Suspense fallback={<Fallback />}>
                  <PackagesPage />
                </Suspense>
              </RoleGuard>
            ),
          },
          {
            path: "/admin/alerts",
            element: (
              <RoleGuard roles={["admin"]}>
                <Suspense fallback={<Fallback />}>
                  <AlertsPage />
                </Suspense>
              </RoleGuard>
            ),
          },
          {
            // ⚠️ /admin/settings 与 /settings 渲染的是同一个 SettingsPage（个人账号 + 改密入口），
            // 却给了两套角色 → 同一功能两个入口、权限还不一样。
            // 统一收敛到 /settings（侧边栏「账号设置」三角色都可见），旧地址重定向过去。
            path: "/admin/settings",
            element: <Navigate to="/settings" replace />,
          },
          {
            path: "/admin/accounts",
            element: (
              <RoleGuard roles={["admin"]}>
                <Suspense fallback={<Fallback />}>
                  <AccountsPage />
                </Suspense>
              </RoleGuard>
            ),
          },
          {
            path: "/admin/features",
            element: (
              <RoleGuard roles={["admin"]}>
                <AllFeaturesPage />
              </RoleGuard>
            ),
          },
          {
            path: "/admin/assistant",
            element: (
              <RoleGuard roles={["admin"]}>
                <Suspense fallback={<Fallback />}>
                  <AdminAssistantPage />
                </Suspense>
              </RoleGuard>
            ),
          },
          {
            path: "/admin/institution-settings",
            element: (
              <RoleGuard roles={["admin"]}>
                <Suspense fallback={<Fallback />}>
                  <InstitutionSettingsPage />
                </Suspense>
              </RoleGuard>
            ),
          },
          {
            path: "/inbox",
            element: (
              <RoleGuard roles={["admin", "teacher", "parent"]}>
                <InboxPage />
              </RoleGuard>
            ),
          },
          {
            path: "/settings",
            element: (
              <RoleGuard roles={["admin", "teacher", "parent"]}>
                <Suspense fallback={<Fallback />}>
                  <SettingsPage />
                </Suspense>
              </RoleGuard>
            ),
          },
          {
            // ⚠️ 原 roles 含 parent，但站内信页面是教内部沟通用的，
            // 且侧边栏「站内信」只给 admin（家长走 /parent/messages）。
            // 三处入口不一致 → 这里收回 admin。
            path: "/admin/messages",
            element: (
              <RoleGuard roles={["admin"]}>
                <Suspense fallback={<Fallback />}>
                  <MessagesPage />
                </Suspense>
              </RoleGuard>
            ),
          },
          {
            path: "/admin/notifications",
            element: (
              <RoleGuard roles={["admin"]}>
                <Suspense fallback={<Fallback />}>
                  <NotificationsPage />
                </Suspense>
              </RoleGuard>
            ),
          },
          {
            // ⚠️ 这个路由渲染 LeaveManagePage（旧版独立审批页），但侧边栏**没有任何入口**指向它，
            // 且它的能力（请假审批）已被 /leave 的「请假审批」tab 完整覆盖。
            // 两套请假审批页 = 用户不知道该点哪个。保留旧地址可用（不破坏收藏/外链），重定向过去。
            path: "/admin/leave",
            element: (
              <RoleGuard roles={["admin", "teacher"]}>
                <Navigate to="/leave" replace />
              </RoleGuard>
            ),
          },
          {
            // 多设备登录管理 (任何登录角色都可看自己的)
            path: "/admin/sessions",
            element: (
              <RoleGuard roles={["admin", "teacher", "parent"]}>
                <Suspense fallback={<Fallback />}>
                  <SessionsPage />
                </Suspense>
              </RoleGuard>
            ),
          },
          {
            path: "/admin/teachers",
            element: (
              <RoleGuard roles={["admin"]}>
                <Suspense fallback={<Fallback />}>
                  <TeachersPage />
                </Suspense>
              </RoleGuard>
            ),
          },
          {
            path: "/admin/finance",
            element: (
              <RoleGuard roles={["admin"]}>
                <Suspense fallback={<Fallback />}>
                  <FinancePage />
                </Suspense>
              </RoleGuard>
            ),
          },
          {
            // ⚠️ 侧边栏「补课管理」指向这里，但这个路由原本渲染的是默认 tab=leave 的
            // LeaveMakeupPage → 点「补课管理」看到的是请假列表。现在显式带 tab=makeup。
            path: "/admin/leave/makeup",
            element: (
              <RoleGuard roles={["admin", "teacher"]}>
                <Suspense fallback={<Fallback />}>
                  <Navigate to="/leave?tab=makeup" replace />
                </Suspense>
              </RoleGuard>
            ),
          },
          {
            path: "/admin/payroll",
            element: (
              <RoleGuard roles={["admin", "teacher"]}>
                <Suspense fallback={<Fallback />}>
                  <PayrollPage />
                </Suspense>
              </RoleGuard>
            ),
          },
          {
            path: "/admin/import",
            element: (
              <RoleGuard roles={["admin"]}>
                <Suspense fallback={<Fallback />}>
                  <DataImportPage />
                </Suspense>
              </RoleGuard>
            ),
          },
          {
            path: "/admin/operations",
            element: (
              <RoleGuard roles={["admin", "teacher"]}>
                <Suspense fallback={<Fallback />}>
                  <OperationsPage />
                </Suspense>
              </RoleGuard>
            ),
          },
          {
            path: "/admin/reports",
            element: (
              <RoleGuard roles={["admin", "teacher"]}>
                <Suspense fallback={<Fallback />}>
                  <ReportsPage />
                </Suspense>
              </RoleGuard>
            ),
          },
          {
            // 备份恢复仅限管理员: 备份里含家长手机号与老师薪酬
            path: "/admin/backups",
            element: (
              <RoleGuard roles={["admin"]}>
                <Suspense fallback={<Fallback />}>
                  <BackupsPage />
                </Suspense>
              </RoleGuard>
            ),
          },
          {
            path: "/leave",
            element: (
              <RoleGuard roles={["admin", "teacher", "parent"]}>
                <Suspense fallback={<Fallback />}>
                  <LeaveMakeupPage />
                </Suspense>
              </RoleGuard>
            ),
          },
          {
            path: "/content",
            element: (
              <RoleGuard roles={["admin", "teacher", "parent"]}>
                <Suspense fallback={<Fallback />}>
                  <ContentPage />
                </Suspense>
              </RoleGuard>
            ),
          },
          {
            path: "/parent",
            element: (
              <RoleGuard roles={["parent"]}>
                <Suspense fallback={<Fallback />}>
                  <ParentHomePage />
                </Suspense>
              </RoleGuard>
            ),
          },
          {
            // 家长给「学校 / 教务」留言（微信式聊天）
            path: "/parent/messages",
            element: (
              <RoleGuard roles={["parent"]}>
                <Suspense fallback={<Fallback />}>
                  <SchoolChatPage />
                </Suspense>
              </RoleGuard>
            ),
          },
        ],
      },
      {
        path: "*",
        element: (
          <Suspense fallback={<Fallback />}>
            <NotFoundPage />
          </Suspense>
        ),
      },
    ],
  },
]);
