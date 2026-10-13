import {test,expect,vi,afterEach} from "vitest";
import {render,screen,cleanup} from "@testing-library/react";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import StudentDetailPage from "../../src/features/students/StudentDetailPage.jsx";
import {http} from "../../src/lib/http.js";
const state=vi.hoisted(()=>({role:"teacher"}));
vi.mock("react-router-dom",()=>({useParams:()=>({id:"student"})}));
vi.mock("../../src/features/auth/useAuth.js",()=>({useAuth:()=>({user:{role:state.role}})}));
vi.mock("../../src/features/students/useStudent.js",()=>({useStudent:()=>({data:{id:"student",full_name:"Lily",status:"active",remaining_hours:3,packages:[],transactions:[]}})}));
vi.mock("../../src/features/students/StudentReport.jsx",()=>({StudentReport:()=> <div>学习报告</div>}));
vi.mock("../../src/components/PageHeader.jsx",()=>({PageHeader:({title})=><h1>{title}</h1>}));
vi.mock("../../src/components/ui/toast.jsx",()=>({useToast:()=>({success:vi.fn(),error:vi.fn()})}));
vi.mock("../../src/lib/http.js",()=>({http:vi.fn(async()=>({data:[]}))}));
let client;
function mount(role){state.role=role;client=new QueryClient({defaultOptions:{queries:{retry:false}}});render(<QueryClientProvider client={client}><StudentDetailPage/></QueryClientProvider>);}
afterEach(()=>{cleanup();client?.clear();vi.clearAllMocks();});
test("老师只能查看教学和课时信息，不展示财务操作或请求缴费数据",()=>{mount("teacher");expect(screen.getByText("学习报告")).toBeInTheDocument();expect(screen.queryByRole("button",{name:/购买课时包/})).not.toBeInTheDocument();expect(screen.queryByRole("button",{name:"手动调整课时"})).not.toBeInTheDocument();expect(screen.queryByText("缴费记录")).not.toBeInTheDocument();expect(http).not.toHaveBeenCalled();});
test("家长能看自己的缴费记录但没有修改课时、购包和退款按钮",async()=>{mount("parent");expect(await screen.findByText("缴费记录")).toBeInTheDocument();expect(screen.queryByRole("button",{name:/购买课时包/})).not.toBeInTheDocument();expect(screen.queryByRole("button",{name:"手动调整课时"})).not.toBeInTheDocument();expect(screen.queryByRole("button",{name:"办理退费"})).not.toBeInTheDocument();});
test("管理员保留购包、课时调整与退费操作",()=>{mount("admin");expect(screen.getByRole("button",{name:/购买课时包/})).toBeInTheDocument();expect(screen.getByRole("button",{name:"手动调整课时"})).toBeInTheDocument();expect(screen.getByRole("button",{name:"办理退费"})).toBeInTheDocument();});
