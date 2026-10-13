import {schoolDay} from "../features/schedule/scheduleInsights.js";
export function financeRange(key,now=new Date()){
 const day=schoolDay(now),date=new Date(`${day}T00:00:00Z`);
 if(key==="this_month")return {from:`${day.slice(0,7)}-01`,to:day};
 if(key==="last_30")return {from:new Date(date.getTime()-29*86400000).toISOString().slice(0,10),to:day};
 if(key==="quarter")return {from:new Date(Date.UTC(date.getUTCFullYear(),Math.floor(date.getUTCMonth()/3)*3,1)).toISOString().slice(0,10),to:day};
 return {from:"2000-01-01",to:day};
}
