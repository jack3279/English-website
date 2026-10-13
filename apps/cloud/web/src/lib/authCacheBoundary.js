import { getUser } from "./auth-store.js";

export function installAuthCacheBoundary(client) {
  if (typeof window === "undefined") return () => {};
  const identity = () => { const user=getUser(); return user?.id ? `${user.id}:${user.role||""}` : null; };
  let current=identity();
  const sync=()=>{
    const next=identity();
    if(next!==current){current=next;client.clear();}
  };
  window.addEventListener("auth:changed",sync);
  return ()=>window.removeEventListener("auth:changed",sync);
}
