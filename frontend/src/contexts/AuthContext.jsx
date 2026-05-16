import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import api from "../lib/api";

const AuthCtx = createContext(null);

export const AuthProvider = ({ children }) => {
  const [merchant, setMerchant] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const token = localStorage.getItem("bf_token");
    if (!token) { setMerchant(null); return null; }
    try {
      const { data } = await api.get("/auth/me");
      setMerchant(data);
      return data;
    } catch {
      localStorage.removeItem("bf_token");
      setMerchant(null);
      return null;
    }
  }, []);

  useEffect(() => {
    const token = localStorage.getItem("bf_token");
    if (!token) { setLoading(false); return; }
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  const login = async (email, password) => {
    const { data } = await api.post("/auth/login", { email, password });
    localStorage.setItem("bf_token", data.token);
    setMerchant(data.merchant);
    return data.merchant;
  };

  const register = async (payload) => {
    const { data } = await api.post("/auth/register", payload);
    localStorage.setItem("bf_token", data.token);
    setMerchant(data.merchant);
    return data.merchant;
  };

  const logout = () => {
    localStorage.removeItem("bf_token");
    setMerchant(null);
  };

  return (
    <AuthCtx.Provider value={{ merchant, loading, login, register, logout, refresh }}>
      {children}
    </AuthCtx.Provider>
  );
};

export const useAuth = () => useContext(AuthCtx);
