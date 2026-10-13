import { Link } from "react-router-dom";
import { AuthShell } from "../../components/AuthShell.jsx";

export default function SignupPage() {
  return (
    <AuthShell
      title="暂不开放注册"
      subtitle="账号由管理员开通"
      footer={
        <>
          已有账号?{" "}
          <Link
            to="/login"
            className="font-medium text-primary-700 hover:underline dark:text-primary-300 "
          >
            直接登录
          </Link>
        </>
      }
    >
      <p className="text-sm leading-6 text-gray-600 dark:text-gray-300">
        为避免外人自行注册成家长账号，公开注册已关闭。老师和家长账号请联系机构管理员开通。
      </p>
    </AuthShell>
  );
}
