import { useState, useEffect, useCallback } from "react";
import { http } from "../../lib/http.js";
import { getToken, getUser, setSession, clearSession, setLastEmail } from "../../lib/auth-store.js";

function readFromStore() {
  return { token: getToken(), user: getUser() };
}

/**
 * 全站登录态 hook —— 从 auth-store 读, 跨多个组件/tab 共享同一份 token。
 * 登录/登出时同步写 store + localStorage, http() 通过 store 拿 token 做 401 自动刷新。
 */
export function useAuth() {
  // mount 时从 store 读, 之后监听 auth:changed 事件 (跨 tab 同步 + 401 刷新后)
  const [{ token, user }, setState] = useState(readFromStore);

  useEffect(() => {
    function sync() {
      setState(readFromStore());
    }
    window.addEventListener("auth:changed", sync);

    // 强制登出 (本机在 SessionsPage 自己点登出) —— 清登录态 + 跳登录页
    function forceLogout() {
      clearSession();
      setState({ token: null, user: null });
      // 避免在登录页反复跳
      if (typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
        window.location.href = "/login";
      }
    }
    window.addEventListener("auth:force-logout", forceLogout);

    return () => {
      window.removeEventListener("auth:changed", sync);
      window.removeEventListener("auth:force-logout", forceLogout);
    };
  }, []);

  /**
   * 登录.
   *   remember=true  -> refresh_token 落 localStorage, 30 天免登录
   *   remember=false -> refresh_token 不持久, 浏览器关闭后失效
   */
  const login = useCallback(async (email, password, remember = true) => {
    // 1. 拿 token
    const data = await http("/auth/login", { method: "POST", body: { email, password } });
    const access = data.data.access_token;
    const refresh = remember ? data.data.refresh_token : null;
    // 2. fetchMe 拿完整用户
    setSession({ access_token: access, refresh_token: refresh });
    const me = await http("/me");
    const fullUser = {
      ...data.data.user,
      ...me.data,
      password_change_recommended: !!data.data.password_change_recommended,
    };
    setSession({ access_token: access, refresh_token: refresh, user: fullUser });
    setLastEmail(email);
    setState({ token: access, user: fullUser });
    return fullUser;
  }, []);

  const signup = useCallback(async (email, password, fullName, phone) => {
    const r = await http("/auth/signup", {
      method: "POST",
      body: { email, password, fullName, phone },
    });
    return r.data;
  }, []);

  const resetPassword = useCallback(async (email) => {
    return (await http("/auth/reset-password", { method: "POST", body: { email } })).data;
  }, []);

  const logout = useCallback(() => {
    clearSession();
    setState({ token: null, user: null });
  }, []);

  return { token, user, login, signup, logout, resetPassword };
}

export async function fetchMe() {
  return (await http("/me")).data;
}
