import {test,expect,vi,afterEach} from "vitest";
import {render,screen,fireEvent,cleanup,waitFor} from "@testing-library/react";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {MemoryRouter} from "react-router-dom";
import AccountsPage from "../../src/features/admin/AccountsPage.jsx";
import {http} from "../../src/lib/http.js";
vi.mock("../../src/components/PageHeader.jsx",()=>({PageHeader:({title})=><h1>{title}</h1>}));
vi.mock("../../src/features/auth/useAuth.js",()=>({useAuth:()=>({user:{id:"current",email:"current@example.com"}})}));
vi.mock("../../src/components/ui/toast.jsx",()=>({useToast:()=>({success:vi.fn(),error:vi.fn()})}));
vi.mock("../../src/lib/http.js",()=>({http:vi.fn(async(path,options)=>options?.method?{data:{message:"已保存"}}:{data:{items:[{id:"current",name:"Admin",email:"current@example.com",role:"admin"},{id:"parent",name:"Parent",email:"parent@example.com",role:"parent"}]}})}));
let client;
function mount(){client=new QueryClient({defaultOptions:{queries:{retry:false}}});render(<MemoryRouter><QueryClientProvider client={client}><AccountsPage/></QueryClientProvider></MemoryRouter>);}
afterEach(()=>{cleanup();client?.clear();vi.clearAllMocks();});
test("账号列表不允许通过管理重置自身密码，显示账号设置入口",async()=>{
  mount();await screen.findByText("parent@example.com");
  expect(screen.getByRole("link",{name:"修改我的密码"})).toHaveAttribute("href","/settings");
  expect(screen.getAllByRole("button",{name:"重置密码"})).toHaveLength(1);
});
test("重置其他用户必须确认身份，提交准确的目标账号",async()=>{
  mount();fireEvent.click(await screen.findByRole("button",{name:"重置密码"}));
  fireEvent.change(screen.getByLabelText("新账号密码"),{target:{value:"NewPassword123!"}});
  fireEvent.change(screen.getByLabelText("确认新账号密码"),{target:{value:"NewPassword123!"}});
  fireEvent.change(screen.getByLabelText("当前管理员密码"),{target:{value:"current-password"}});
  expect(screen.getByRole("button",{name:"确认重置密码"})).toBeDisabled();
  fireEvent.click(screen.getByRole("checkbox"));fireEvent.click(screen.getByRole("button",{name:"确认重置密码"}));
  await waitFor(()=>expect(http).toHaveBeenCalledWith("/accounts/password",{method:"POST",body:{id:"parent",password:"NewPassword123!",current_password:"current-password",confirmed:true}}));
});
