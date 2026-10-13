import {useAuth} from '../features/auth/useAuth.js';
import {useUiLanguage,setUiLanguage} from './store.js';
export default function LanguageSwitcher(){
 const {user}=useAuth(),language=useUiLanguage();
 if(user&&user.role!=='teacher')return null;
 return <select aria-label="Interface language / 界面语言" title="Interface language / 界面语言" value={language} onChange={event=>setUiLanguage(event.target.value)} className="h-9 max-w-[76px] rounded-lg border border-gray-200 bg-white px-2 text-xs font-medium text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"><option value="en">EN</option><option value="zh">中文</option></select>;
}
