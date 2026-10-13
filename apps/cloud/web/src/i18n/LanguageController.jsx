import {useLayoutEffect} from 'react';
import {useAuth} from '../features/auth/useAuth.js';
import {configureUiUser} from './store.js';
export default function LanguageController({children}){
 const {user}=useAuth();
 useLayoutEffect(()=>{configureUiUser(user);},[user?.id,user?.role]);
 return children;
}
