import {useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {http} from '../../lib/http.js';
import {Dialog} from '../../components/ui/dialog.jsx';
import {Button} from '../../components/ui/button.jsx';
import {Input} from '../../components/ui/input.jsx';
import {Textarea} from '../../components/ui/textarea.jsx';
export default function HistoryLessonModal({onClose,onSaved}) {
  const qc=useQueryClient();
  const [form,setForm]=useState({student_id:'',teacher_id:'',course_id:'',scheduled_at:'',duration_min:60,result:'attended',content:'',note:''});
  const [confirmed,setConfirmed]=useState(false),[password,setPassword]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [requestId]=useState(()=>crypto.randomUUID());
  const students=useQuery({queryKey:['students','history-options'],queryFn:async()=>{const rows=[];for(let page=1;page<=50;page++){const r=await http(`/students?page=${page}&pageSize=100`);rows.push(...r.data);if(r.data.length<100||rows.length>=r.meta?.total)return rows;}throw new Error('学生资料过多，请缩小录入范围');}});
  const teachers=useQuery({queryKey:['teachers','history-options'],queryFn:async()=>(await http('/teachers')).data});
  const courses=useQuery({queryKey:['courses','history-options'],queryFn:async()=>(await http('/courses')).data});
  const field=(key,value)=>setForm(old=>({...old,[key]:value,...(['student_id','teacher_id'].includes(key)?{course_id:''}:{})}));
  async function submit(e) {
    e.preventDefault();setError('');setBusy(true);
    try {
      const body={...form,course_id:form.course_id||null,scheduled_at:new Date(`${form.scheduled_at}:00+08:00`).toISOString(),request_id:requestId,fees_already_settled:true,opening_balance_includes_history:true,current_password:password};
      const r=await http('/lessons/history',{method:'POST',body});
      for(const key of ['schedules','lesson-detail','parent-feeds','reports','operations'])qc.invalidateQueries({queryKey:[key]});
      setPassword('');onSaved(r.data);
    } catch(e){setError(e.message||'历史补录失败，请保持原内容重试');} finally {setBusy(false);}
  }
  const loading=students.isPending||teachers.isPending||courses.isPending;
  const failed=students.isError||teachers.isError||courses.isError;
  const selectClass='mt-1 w-full rounded-md border border-gray-300 bg-white p-2 dark:border-gray-700 dark:bg-gray-900';
  return <Dialog open onClose={onClose} title="补录已结清历史课程" footer={<><Button variant="outline" onClick={onClose} disabled={busy}>取消</Button><Button type="submit" form="history-lesson-form" disabled={busy||loading||failed||!confirmed||!password}>{busy?'保存中…':'保存历史记录'}</Button></>}>
    <form id="history-lesson-form" onSubmit={submit} className="space-y-4">
      <p className="rounded-lg bg-sky-50 p-3 text-sm dark:bg-sky-950">用于已经结清的旧课程。只补记录，不扣期初余额、不生成待付课酬，不发送旧课提醒。</p>
      {failed&&<p role="alert">学生、教师或课程资料读取失败，请刷新重试。</p>}
      <label className="block">学生<select required className={selectClass} value={form.student_id} onChange={e=>field('student_id',e.target.value)} disabled={busy||loading}><option value="">选择学生</option>{(students.data||[]).map(s=><option key={s.id} value={s.id}>{s.full_name}</option>)}</select></label>
      <label className="block">教师<select required className={selectClass} value={form.teacher_id} onChange={e=>field('teacher_id',e.target.value)} disabled={busy||loading}><option value="">选择教师</option>{(teachers.data||[]).map(t=><option key={t.profile_id} value={t.profile_id}>{t.full_name}</option>)}</select></label>
      <label className="block">课程（可选）<select className={selectClass} value={form.course_id} onChange={e=>field('course_id',e.target.value)} disabled={busy}><option value="">不关联固定课程</option>{(courses.data||[]).filter(c=>c.teacher_id===form.teacher_id&&(!c.student_id||c.student_id===form.student_id)).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <div className="grid grid-cols-2 gap-3"><label>上课时间（北京时间）<Input required type="datetime-local" value={form.scheduled_at} onChange={e=>field('scheduled_at',e.target.value)} disabled={busy}/></label><label>时长（分钟）<Input required type="number" min={15} max={240} value={form.duration_min} onChange={e=>field('duration_min',Number(e.target.value))} disabled={busy}/></label></div>
      <label className="block">出勤结果<select className={selectClass} value={form.result} onChange={e=>field('result',e.target.value)} disabled={busy}><option value="attended">上课</option><option value="leave">请假</option><option value="no_show">缺勤</option></select></label>
      <label className="block">上课内容<Textarea required maxLength={5000} value={form.content} onChange={e=>field('content',e.target.value)} disabled={busy}/></label>
      <label className="block">历史备注<Textarea maxLength={500} value={form.note} onChange={e=>field('note',e.target.value)} disabled={busy}/></label>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)} disabled={busy}/>确认当前期初余额已包含这些历史消课，教师课酬已结清；此次仅补记录。</label>
      <label className="block">当前管理员密码<Input required type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} disabled={busy}/></label>
      {error&&<p role="alert" className="text-sm text-red-600">{error}</p>}
    </form>
  </Dialog>;
}
