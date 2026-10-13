import {test,expect,vi,afterEach} from 'vitest';
import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import LessonCorrectionDialog from '../../src/features/lessons/LessonCorrectionDialog.jsx';
import {http} from '../../src/lib/http.js';
const state=vi.hoisted(()=>({role:'teacher'}));
vi.mock('../../src/lib/http.js',()=>({http:vi.fn()}));
vi.mock('../../src/features/auth/useAuth.js',()=>({useAuth:()=>({user:{id:'teacher',role:state.role}})}));
vi.mock('../../src/features/admin/InstitutionContext.jsx',()=>({useInstitution:()=>({rules:{absenceDeductHours:false}})}));
afterEach(()=>{cleanup();http.mockReset();state.role='teacher';});
const lesson={id:'lesson',status:'completed',record:{id:'record',content:'Original unit'}};
function mount(){http.mockImplementation(async path=>({data:path.endsWith('preview')?{expected_hash:'a'.repeat(64),hour_change:1.5,pay_before:12,pay_after:12,currency:'USD'}:{corrected:true}}));render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}})}><LessonCorrectionDialog lesson={lesson} onClose={vi.fn()} onSaved={vi.fn()}/></QueryClientProvider>);}
test('teacher corrects content without attendance or password fields',async()=>{mount();expect(screen.queryByText('同时更正点名与结算')).not.toBeInTheDocument();fireEvent.change(screen.getByLabelText('本节课上课内容'),{target:{value:'Corrected unit'}});await waitFor(()=>expect(screen.getByRole('button',{name:'确认更正'})).toBeEnabled());fireEvent.click(screen.getByRole('button',{name:'确认更正'}));await waitFor(()=>expect(http).toHaveBeenCalledWith('/lessons/lesson/correction',expect.objectContaining({method:'PATCH',body:expect.objectContaining({mode:'content',content:'Corrected unit'})})));const body=http.mock.calls.find(([path])=>path.endsWith('/correction'))[1].body;expect(body).not.toHaveProperty('current_password');expect(body).not.toHaveProperty('result');});
test('admin attendance amendment previews impact and requires reason and reauthentication',async()=>{state.role='admin';mount();fireEvent.click(screen.getByRole('checkbox',{name:'同时更正点名与结算'}));expect(await screen.findByText('课时余额变动：1.5 小时')).toBeInTheDocument();expect(screen.getByRole('button',{name:'确认更正'})).toBeDisabled();fireEvent.change(screen.getByLabelText('更正原因'),{target:{value:'Correct original attendance'}});fireEvent.change(screen.getByLabelText('当前管理员密码'),{target:{value:'MOCK-password'}});await waitFor(()=>expect(screen.getByRole('button',{name:'确认更正'})).toBeEnabled());});
test('failed preview cannot submit a financial correction',async()=>{state.role='admin';mount();http.mockRejectedValue(new Error('Period already paid'));fireEvent.click(screen.getByRole('checkbox',{name:'同时更正点名与结算'}));expect(await screen.findByRole('alert')).toHaveTextContent('Period already paid');expect(screen.getByRole('button',{name:'确认更正'})).toBeDisabled();});
