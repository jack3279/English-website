import { test, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import ChangePasswordForm from "../../src/features/auth/ChangePasswordForm.jsx";
import ForgotPasswordPage from "../../src/features/auth/ForgotPasswordPage.jsx";
import { http } from "../../src/lib/http.js";
const {logout}=vi.hoisted(()=>({logout:vi.fn()}));
vi.mock("../../src/features/auth/useAuth.js",()=>({useAuth:()=>({user:{email:"self@example.com"},logout})}));
vi.mock("../../src/lib/http.js",()=>({http:vi.fn()}));
afterEach(()=>{cleanup();vi.clearAllMocks();});
function mount(){render(<MemoryRouter><ChangePasswordForm /></MemoryRouter>);}
function fill(confirm="NewPassword123!"){
  fireEvent.change(screen.getByLabelText("当前密码"),{target:{value:"old-password"}});
  fireEvent.change(screen.getByLabelText("新密码"),{target:{value:"NewPassword123!"}});
  fireEvent.change(screen.getByLabelText("确认新密码"),{target:{value:confirm}});
}
test("确认密码不匹配不发送请求",()=>{
  mount();fill("Different123!");fireEvent.click(screen.getByRole("button"));
  expect(screen.getByRole("alert")).toHaveTextContent("两次输入的新密码不一致");expect(http).not.toHaveBeenCalled();
});
test("修改失败保留登录和输入，允许重试",async()=>{
  http.mockRejectedValueOnce(new Error("当前密码不正确"));mount();fill();fireEvent.click(screen.getByRole("button"));
  expect(await screen.findByRole("alert")).toHaveTextContent("当前密码不正确");expect(logout).not.toHaveBeenCalled();
  expect(screen.getByLabelText("新密码")).toHaveValue("NewPassword123!");
});
test("成功后退出旧登录，请求不携带可冒用的用户ID",async()=>{
  http.mockResolvedValueOnce({data:{changed:true}});mount();fill();fireEvent.click(screen.getByRole("button"));
  await waitFor(()=>expect(logout).toHaveBeenCalledOnce());
  expect(http).toHaveBeenCalledWith("/me/password",{method:"POST",body:{current_password:"old-password",new_password:"NewPassword123!"}});
});
test("找回账号页不展示或生成恢复凭据",()=>{
  render(<MemoryRouter><ForgotPasswordPage /></MemoryRouter>);
  expect(screen.getByText(/联系学校教务/)).toBeInTheDocument();
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();expect(http).not.toHaveBeenCalled();
});
