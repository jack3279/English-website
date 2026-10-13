import {test,expect} from 'vitest';
import {findPayrollSettlement,payrollSettlementChanged} from '../src/lib/payrollSettlement.js';
const row={teacher_id:'teacher',period:'monthly',period_from:'2026-06-01',period_to:'2026-06-30',pay_currency:'USD',pay_amount:100,lesson_ids:['a','b']};
test('月初同日起算的周结不能显示为整月已发放，不同币种不能误匹配',()=>{
 const weekly={teacher_id:'teacher',from:'2026-06-01',to:'2026-06-07',currency:'USD',state:'paid'};
 expect(findPayrollSettlement(row,[weekly])).toBeUndefined();
 expect(findPayrollSettlement(row,[{...weekly,to:'2026-06-30',currency:'PHP'}])).toBeUndefined();
});
test('相同金额但课程发生变化也提示核对，顺序变化不误报',()=>{
 const paid={state:'paid',amount_cents:10000,currency:'USD',lesson_ids:['b','a']};
 expect(payrollSettlementChanged(row,paid)).toBe(false);
 expect(payrollSettlementChanged(row,{...paid,lesson_ids:['a','c']})).toBe(true);
});
