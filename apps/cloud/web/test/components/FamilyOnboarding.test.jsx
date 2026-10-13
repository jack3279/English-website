import {test,expect,vi,afterEach} from "vitest";
import {render,screen,fireEvent,cleanup,waitFor} from "@testing-library/react";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import CreateAccountDialog from "../../src/features/admin/CreateAccountDialog.jsx";
import FamilyPanel from "../../src/features/students/FamilyPanel.jsx";
import {http} from "../../src/lib/http.js";
const STUDENT="00000000-0000-0000-0000-000000000004",PARENT="00000000-0000-0000-0000-000000000003";
vi.mock("../../src/features/auth/useAuth.js",()=>({useAuth:()=>({user:{id:"admin",email:"admin@example.com"}})}));
vi.mock("../../src/components/ui/toast.jsx",()=>({useToast:()=>({success:vi.fn(),error:vi.fn()})}));
vi.mock("../../src/lib/http.js",()=>({http:vi.fn(async(path,options)=>{
  if(options?.method)return {data:{message:"已保存"}};
  if(path==="/families/parents")return {data:[{id:PARENT,name:"Lily 妈妈",email:"parent@example.com",phone:"13800000000"}]};
  if(path.startsWith("/families/students/"))return {data:[]};
  return {data:[{id:STUDENT,full_name:"Lily"}]};
})}));
let client;
function mount(component){client=new QueryClient({defaultOptions:{queries:{retry:false}}});render(<QueryClientProvider client={client}>{component}</QueryClientProvider>);}
afterEach(()=>{cleanup();client?.clear();vi.clearAllMocks();});
function credentials(){fireEvent.change(screen.getByLabelText("姓名"),{target:{value:"Lily 妈妈"}});fireEvent.change(screen.getByLabelText("登录邮箱"),{target:{value:"parent@example.com"}});fireEvent.change(screen.getByLabelText("初始密码"),{target:{value:"NewPassword123!"}});fireEvent.change(screen.getByLabelText("确认初始密码"),{target:{value:"NewPassword123!"}});fireEvent.change(screen.getByLabelText("当前管理员密码"),{target:{value:"current-password"}});}
test("从学员详情开户锁定家长角色与当前孩子，确认身份前不能提交",async()=>{
  mount(<CreateAccountDialog open studentId={STUDENT} onClose={vi.fn()}/>);credentials();
  expect(screen.queryByLabelText("账号角色")).not.toBeInTheDocument();expect(screen.getByRole("button",{name:"开通账号"})).toBeDisabled();
  fireEvent.click(screen.getByRole("checkbox"));fireEvent.click(screen.getByRole("button",{name:"开通账号"}));
  await waitFor(()=>expect(http).toHaveBeenCalledWith("/accounts/create",{method:"POST",body:{name:"Lily 妈妈",email:"parent@example.com",password:"NewPassword123!",current_password:"current-password",confirmed:true,phone:"",role:"parent",student_ids:[STUDENT]}}));
});
test("教师开户包含课酬信息，不传家长孩子关联",async()=>{
  mount(<CreateAccountDialog open initialRole="teacher" onClose={vi.fn()}/>);credentials();
  fireEvent.change(screen.getByLabelText("课酬单价（每小时）"),{target:{value:"200"}});fireEvent.click(screen.getByRole("checkbox"));fireEvent.click(screen.getByRole("button",{name:"开通账号"}));
  await waitFor(()=>expect(http.mock.calls.some(([path,options])=>path==="/accounts/create"&&options?.body.role==="teacher"&&options.body.teacher_hourly_pay===200&&!options.body.student_ids)).toBe(true));
});
test("绑定已有家长使用姓名选择并确认监护关系，避免输入内部ID",async()=>{
  mount(<FamilyPanel studentId={STUDENT}/>);fireEvent.click(screen.getByRole("button",{name:"绑定已有家长"}));
  await screen.findByRole("option",{name:/Lily 妈妈/});fireEvent.change(screen.getByLabelText("家长账号"),{target:{value:PARENT}});
  expect(screen.getByRole("button",{name:"确认绑定"})).toBeDisabled();fireEvent.click(screen.getByRole("checkbox"));fireEvent.click(screen.getByRole("button",{name:"确认绑定"}));
  await waitFor(()=>expect(http).toHaveBeenCalledWith(`/families/students/${STUDENT}`,{method:"POST",body:{parent_id:PARENT,relation:"guardian",confirmed:true}}));
});
