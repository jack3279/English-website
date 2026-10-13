const {getAdmin}=require('./supabase.js');
async function build(req,from,to) {
  const params=new URLSearchParams({period:'monthly'});
  if(from)params.set('from',from.slice(0,7)+'-01');
  if(to){const [year,month]=to.slice(0,7).split('-').map(Number);params.set('to',new Date(Date.UTC(year,month,0)).toISOString().slice(0,10));}
  const report=await require('./payrollReport.js').report(req,params);
  const teachers=await getAdmin().from('teachers').select('profile_id,hourly_pay,pay_currency');
  if(teachers.error)throw teachers.error;
  const ids=(teachers.data||[]).map(t=>t.profile_id);
  const profiles=ids.length?await getAdmin().from('profiles').select('id,full_name').in('id',ids):{data:[]};
  if(profiles.error)throw profiles.error;
  const names=new Map((profiles.data||[]).map(p=>[p.id,p.full_name]));
  const amounts=Object.values(report.totals.by_currency);
  return {range:{from:from||null,to:to||null},rows:report.rows,
    totals:{...report.totals,pay_amount:amounts.length>1?null:amounts[0]||0},
    pending_absences:report.pending_absences,
    rates:(teachers.data||[]).map(t=>({teacher_id:t.profile_id,teacher_name:names.get(t.profile_id)||'',hourly_pay:Number(t.hourly_pay||0),pay_currency:t.pay_currency||'PHP'}))};
}
module.exports={build};
